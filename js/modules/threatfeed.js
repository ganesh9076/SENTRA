/* ── THREAT FEED — Real-time indicators propagated across nodes ── */

/* ── Indicator pools (drawn from at runtime) ───────────────────── */
const INDICATOR_POOL = {
  IP:   [
    '185.220.101.45',  '91.108.4.0',     '45.33.32.156',
    '198.51.100.77',   '103.224.182.250','203.0.113.42',
    '198.18.0.99',     '45.79.200.1',    '10.248.33.91',
    '176.32.103.205',  '5.188.86.172',   '194.165.16.11',
  ],
  URL:  [
    'https://paypa1-verify.tk/login',     'https://cdn.evil-payload.ru',
    'https://secure-bank-update.xyz',     'https://update-flash-player.net',
    'https://fake-update.ru',             'https://account-verify.ml',
    'https://login-confirm-id.ru/auth',   'https://malware-drop.pw/dl',
    'https://c2panel.onion.ws/beacon',
  ],
  HASH: [
    'a1b2c3d4e5f6...8090', 'd41d8cd98f00b204e9800998ecf8427e',
    'e3b0c44298fc1c149afb', '5d41402abc4b2a76b9719d911017c592',
    'aab3238922bcc25a6f606', '9a97f65c9c4e6a2b8765d3a1e6b7c881',
  ],
};

const CAT_POOL = ['malware', 'phishing', 'suspicious', 'safe', 'unknown'];
const CAT_WEIGHTS = [30, 25, 25, 10, 10]; // weighted random

const catBadge = {
  malware:    '<span class="badge b-red">Malware</span>',
  phishing:   '<span class="badge b-orange">Phishing</span>',
  suspicious: '<span class="badge b-yellow">Suspicious</span>',
  safe:       '<span class="badge b-green">Safe</span>',
  unknown:    '<span class="badge b-purple">Unknown</span>',
};

/* ── Propagation state ─────────────────────────────────────────── */
// feedData is now a live ring-buffer; indicators arrive and spread node-to-node
let feedData   = [];       // live threat records
let feedActive = true;     // pause/resume support
let feedTimer  = null;

/* ── Helper: weighted random category ─────────────────────────── */
function weightedCat() {
  const total = CAT_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < CAT_POOL.length; i++) {
    r -= CAT_WEIGHTS[i];
    if (r <= 0) return CAT_POOL[i];
  }
  return CAT_POOL[0];
}

/* ── Helper: score from category ──────────────────────────────── */
function scoreForCat(cat) {
  const base = { malware: 80, phishing: 70, suspicious: 45, safe: 5, unknown: 30 };
  const jitter = ~~(Math.random() * 18) - 4;
  return Math.max(1, Math.min(99, (base[cat] ?? 50) + jitter));
}

/* ── Helper: get live node labels from NodeManager ────────────── */
function getLiveNodes() {
  if (typeof window.getGossipLabels === 'function') {
    const labels = window.getGossipLabels();
    if (labels && labels.length > 0) return labels;
  }
  // fallback default labels
  return ['N01','N02','N03','N04','N05','N06','N07'];
}

function labelToNodeId(lbl) {
  // N01 → NODE-01
  return lbl.replace(/^N(\d+)$/, (_, n) => `NODE-${n.padStart(2, '0')}`);
}

/* ── Create a brand-new threat indicator ──────────────────────── */
function createIndicator(overrideNode) {
  const typeKeys = Object.keys(INDICATOR_POOL);
  const type     = typeKeys[~~(Math.random() * typeKeys.length)];
  const pool     = INDICATOR_POOL[type];
  const ind      = pool[~~(Math.random() * pool.length)];
  const cat      = weightedCat();
  const nodes    = getLiveNodes();
  const originLbl= overrideNode || nodes[~~(Math.random() * nodes.length)];

  return {
    id          : `ioc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time        : new Date().toTimeString().slice(0, 8),
    ind,
    type,
    cat,
    score       : scoreForCat(cat),
    originNode  : labelToNodeId(originLbl),  // where it was first detected
    seenBy      : [labelToNodeId(originLbl)],// nodes that have received this IOC
    propagating : true,                       // still spreading
    ver         : cat !== 'unknown' && Math.random() > 0.35,
  };
}

/* ── Propagate existing indicators to neighbouring nodes ─────── */
function propagateStep() {
  const allNodes = getLiveNodes().map(labelToNodeId);
  if (allNodes.length < 2) return;

  feedData.forEach(record => {
    if (!record.propagating) return;

    // pick a random unseen node and add it
    const unseen = allNodes.filter(n => !record.seenBy.includes(n));
    if (unseen.length === 0) {
      record.propagating = false;   // fully propagated
      return;
    }

    // propagate to 1-2 new nodes per tick
    const count = Math.min(unseen.length, Math.random() > 0.5 ? 2 : 1);
    for (let i = 0; i < count; i++) {
      const idx  = ~~(Math.random() * (unseen.length - i));
      const node = unseen[idx];
      record.seenBy.push(node);
      unseen.splice(idx, 1);

      // update the node-card status if the threat is serious enough
      if (record.score >= 75 && typeof window.updateNodeStatus === 'function') {
        const lbl = node.replace(/^NODE-0*(\d+)$/, (_, n) => `N${n.padStart(2, '0')}`);
        // only escalate, never downgrade here
        window.updateNodeStatus(lbl, record.cat === 'malware' ? 'infected' : 'warning');
      }
    }

    // update timestamp of latest spread
    record.lastSpread = new Date().toTimeString().slice(0, 8);
  });

  // trim to 50 entries max
  if (feedData.length > 50) feedData = feedData.slice(0, 50);

  renderFeed();
}

/* ── Main render ───────────────────────────────────────────────── */
function renderFeed() {
  const filterEl = document.getElementById('feedFilter');
  const f        = filterEl ? filterEl.value : 'all';
  const data     = f === 'all' ? feedData : feedData.filter(t => t.cat === f);

  const tbody = document.getElementById('feedTbody');
  if (!tbody) return;

  tbody.innerHTML = data.map(t => {
    const col = t.score > 75 ? 'var(--red)' : t.score > 40 ? 'var(--orange)' : 'var(--green)';

    // propagation pill
    const nodeCount  = t.seenBy.length;
    const isPropagating = t.propagating;
    const propPill   = isPropagating
      ? `<span class="prop-pill prop-active" title="Spreading to more nodes">
           <span class="prop-dot"></span>${nodeCount} node${nodeCount !== 1 ? 's' : ''}
         </span>`
      : `<span class="prop-pill prop-done" title="Fully propagated">
           ✓ ${nodeCount} node${nodeCount !== 1 ? 's' : ''}
         </span>`;

    // mini node chips (show first 5 then +N)
    const shown  = t.seenBy.slice(0, 4);
    const extra  = t.seenBy.length - shown.length;
    const chips  = shown.map(n =>
      `<span class="node-chip">${n.replace('NODE-', '')}</span>`
    ).join('') + (extra > 0 ? `<span class="node-chip node-chip-extra">+${extra}</span>` : '');

    return `<tr class="feed-row ${t.propagating ? 'row-propagating' : ''}">
      <td class="mono">${t.time}</td>
      <td class="mono" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.ind}">${t.ind}</td>
      <td><span class="badge b-gray">${t.type}</span></td>
      <td>${catBadge[t.cat] ?? ''}</td>
      <td>
        <div class="score-wrap">
          <div class="score-track">
            <div class="score-fill" style="width:${t.score}%;background:${col}"></div>
          </div>
          <span class="score-num">${t.score}</span>
        </div>
      </td>
      <td>
        <div class="origin-wrap">
          <span class="mono" style="color:var(--accent);font-size:11px">${t.originNode}</span>
          <div class="node-chips">${chips}</div>
        </div>
      </td>
      <td>${propPill}</td>
      <td>${t.ver ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--text3)">—</span>'}</td>
    </tr>`;
  }).join('');

  // inject propagation styles once
  injectPropStyles();
}

/* ── Inject new IOC and kick off propagation ─────────────────────*/
function injectThreat(overrideNode) {
  const record = createIndicator(overrideNode);
  feedData.unshift(record);
  renderFeed();
  if (typeof logSys === 'function') {
    logSys('t-warn', `New IOC detected at ${record.originNode}: ${record.ind} [${record.cat}]`);
  }
}

/* ── Start / stop the live propagation engine ────────────────── */
function startFeedPropagation(intervalMs = 2200) {
  if (feedTimer) clearInterval(feedTimer);
  feedTimer = setInterval(() => {
    if (!feedActive) return;

    // occasionally inject a brand-new indicator (every ~8s on average)
    if (Math.random() < 0.28) injectThreat();

    // always propagate existing ones
    propagateStep();
  }, intervalMs);
}

function stopFeedPropagation() {
  if (feedTimer) { clearInterval(feedTimer); feedTimer = null; }
}

function pauseResumeFeed() {
  feedActive = !feedActive;
  const btn = document.getElementById('feedPauseBtn');
  if (btn) btn.textContent = feedActive ? '⏸ Pause' : '▶ Resume';
  if (typeof logSys === 'function') {
    logSys('t-ok', `Threat feed ${feedActive ? 'resumed' : 'paused'}`);
  }
}

/* ── Seed initial data so the table isn't empty on load ─────── */
function seedInitialFeed() {
  const seeds = [
    { ind: '185.220.101.45',                  type: 'IP',   cat: 'malware',    score: 92, origin: 'NODE-03' },
    { ind: 'https://paypa1-verify.tk/login',  type: 'URL',  cat: 'phishing',   score: 88, origin: 'NODE-01' },
    { ind: 'a1b2c3d4e5f6...8090',             type: 'HASH', cat: 'malware',    score: 97, origin: 'NODE-05' },
    { ind: '91.108.4.0/22',                   type: 'IP',   cat: 'suspicious', score: 55, origin: 'NODE-02' },
    { ind: '8.8.8.8',                         type: 'IP',   cat: 'safe',       score: 5,  origin: 'NODE-01' },
    { ind: 'https://cdn.evil-payload.ru',      type: 'URL',  cat: 'malware',    score: 95, origin: 'NODE-07' },
  ];

  const allNodes = getLiveNodes().map(labelToNodeId);

  seeds.forEach((s, idx) => {
    // give seeds partial propagation so the UI looks alive immediately
    const propCount = Math.min(allNodes.length, 1 + ~~(Math.random() * 3));
    const seenBy    = [s.origin];
    for (let i = 0; i < propCount && seenBy.length < allNodes.length; i++) {
      const unseen = allNodes.filter(n => !seenBy.includes(n));
      if (!unseen.length) break;
      seenBy.push(unseen[~~(Math.random() * unseen.length)]);
    }
    feedData.push({
      id          : `seed-${idx}`,
      time        : new Date(Date.now() - (seeds.length - idx) * 90000).toTimeString().slice(0, 8),
      ind         : s.ind,
      type        : s.type,
      cat         : s.cat,
      score       : s.score,
      originNode  : s.origin,
      seenBy,
      propagating : seenBy.length < allNodes.length,
      ver         : s.cat !== 'unknown' && Math.random() > 0.35,
    });
  });

  renderFeed();
}

/* ── CSS for propagation UI elements ─────────────────────────── */
function injectPropStyles() {
  if (document.getElementById('_tf-prop-styles')) return;
  const style = document.createElement('style');
  style.id    = '_tf-prop-styles';
  style.textContent = `
    /* Propagation pill */
    .prop-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 20px;
      white-space: nowrap;
      letter-spacing: 0.04em;
    }
    .prop-active {
      background: rgba(96,165,250,0.1);
      color: #60a5fa;
      border: 1px solid rgba(96,165,250,0.3);
    }
    .prop-done {
      background: rgba(34,197,94,0.08);
      color: #4ade80;
      border: 1px solid rgba(34,197,94,0.25);
    }
    /* Animated dot */
    .prop-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #60a5fa;
      animation: prop-pulse 1.1s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes prop-pulse {
      0%, 100% { opacity: 1;   transform: scale(1);    }
      50%       { opacity: 0.4; transform: scale(0.65); }
    }

    /* Row highlight while still propagating */
    .feed-row.row-propagating td:first-child {
      border-left: 2px solid rgba(96,165,250,0.45);
    }

    /* Node chip strip */
    .origin-wrap { display: flex; flex-direction: column; gap: 3px; }
    .node-chips  { display: flex; flex-wrap: wrap; gap: 3px; }
    .node-chip {
      display: inline-block;
      font-size: 9px;
      font-family: 'DM Mono', 'Fira Code', monospace;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(55,65,81,0.6);
      color: #9ca3af;
      border: 1px solid #374151;
    }
    .node-chip-extra {
      background: rgba(96,165,250,0.1);
      color: #60a5fa;
      border-color: rgba(96,165,250,0.3);
    }
  `;
  document.head.appendChild(style);
}

/* ── Init: seed data and start engine on load ────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // small delay so NodeManager has time to populate its node list
  setTimeout(() => {
    seedInitialFeed();
    startFeedPropagation(2200);
  }, 400);
});

/* ── Expose globals used by HTML onclick / other modules ──────── */
window.renderFeed          = renderFeed;
window.injectThreat        = injectThreat;
window.pauseResumeFeed     = pauseResumeFeed;
window.startFeedPropagation = startFeedPropagation;
window.stopFeedPropagation  = stopFeedPropagation;