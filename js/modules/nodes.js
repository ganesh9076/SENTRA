/* ═══════════════════════════════════════════════════════════════
   NODE MANAGER — wired to SENTRA FastAPI backend
   Backend gossip labels: N01, N02 … (padded 2-digit)
   Node Manager IDs:      NODE-01, NODE-02 …
   Bridge: N01 ↔ NODE-01
   ═══════════════════════════════════════════════════════════════ */

// API_BASE is declared in auth.js — used directly here

/* ── Inject node card styles if not already present ────────────── */
(function injectNodeStyles() {
  if (document.getElementById('_nm-styles')) return;
  const style = document.createElement('style');
  style.id = '_nm-styles';
  style.textContent = `
    #nodeGrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 14px;
      padding: 16px;
      width: 100%;
      box-sizing: border-box;
    }

    .node-empty {
      grid-column: 1 / -1;
      text-align: center;
      color: #6b7280;
      padding: 48px 16px;
      font-size: 14px;
      line-height: 1.8;
    }

    .node-card {
      position: relative;
      background: #111827;
      border: 1px solid #2a3040;
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
      cursor: default;
      min-height: 180px;
    }
    .node-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0,0,0,0.35);
    }

    /* Status-based card variants */
    .node-card.online {
      border-color: #1d4a2a;
      box-shadow: 0 0 0 1px rgba(34,197,94,0.12);
    }
    .node-card.infected {
      border-color: #7f1d1d;
      box-shadow: 0 0 0 1px rgba(239,68,68,0.25), 0 0 16px rgba(239,68,68,0.08);
      animation: pulse-red 2s infinite;
    }
    .node-card.warning {
      border-color: #78350f;
      box-shadow: 0 0 0 1px rgba(249,115,22,0.2);
    }
    .node-card.offline {
      border-color: #374151;
      opacity: 0.6;
    }

    @keyframes pulse-red {
      0%, 100% { box-shadow: 0 0 0 1px rgba(239,68,68,0.25), 0 0 16px rgba(239,68,68,0.08); }
      50%       { box-shadow: 0 0 0 2px rgba(239,68,68,0.45), 0 0 28px rgba(239,68,68,0.18); }
    }

    /* Status dot (top-right corner) */
    .node-dot {
      position: absolute;
      top: 14px;
      right: 40px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
    }
    .node-card.infected  .node-dot { background: #ef4444; }
    .node-card.warning   .node-dot { background: #f97316; }
    .node-card.offline   .node-dot { background: #4b5563; }

    .node-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .node-id {
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
      letter-spacing: 0.04em;
      font-family: 'DM Mono', 'Fira Code', monospace;
    }

    .node-remove-btn {
      background: none;
      border: none;
      color: #4b5563;
      cursor: pointer;
      font-size: 12px;
      padding: 2px 5px;
      border-radius: 4px;
      line-height: 1;
      transition: color 0.15s, background 0.15s;
    }
    .node-remove-btn:hover {
      color: #ef4444;
      background: rgba(239,68,68,0.1);
    }

    .node-ip {
      font-size: 11px;
      color: #6b7280;
      font-family: 'DM Mono', 'Fira Code', monospace;
      margin-top: 2px;
    }

    .node-lbl {
      font-size: 11px;
      color: #4b5563;
      font-family: 'DM Mono', monospace;
    }

    /* Badge */
    .badge {
      display: inline-flex;
      align-items: center;
      font-size: 10px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      width: fit-content;
    }
    .b-green  { background: rgba(34,197,94,0.12);  color: #22c55e; border: 1px solid rgba(34,197,94,0.3);  }
    .b-red    { background: rgba(239,68,68,0.12);  color: #ef4444; border: 1px solid rgba(239,68,68,0.3);  }
    .b-orange { background: rgba(249,115,22,0.12); color: #f97316; border: 1px solid rgba(249,115,22,0.3); }
    .b-blue   { background: rgba(59,130,246,0.12); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
    .b-gray   { background: rgba(107,114,128,0.12);color: #9ca3af; border: 1px solid rgba(107,114,128,0.3);}

    /* Stats row */
    .node-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #1f2937;
    }
    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .stat-val {
      font-size: 16px;
      font-weight: 700;
      color: #e2e8f0;
      line-height: 1;
    }
    .stat-lbl {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #4b5563;
    }

    /* Infected stat highlight */
    .node-card.infected .stat-val { color: #fca5a5; }
    .node-card.warning  .stat-val { color: #fdba74; }
  `;
  document.head.appendChild(style);
  console.log('[NodeManager] Styles injected');
})();

/* ── State ─────────────────────────────────────────────────────── */
let nodes = [];   // { id, lbl, ip, port, status, peers, msgs, ioc, score }
let nc    = 0;    // total nodes ever created (never decrements)

/* ── Label helpers ─────────────────────────────────────────────── */
function toGossipLbl(nodeId) {
  return nodeId.replace(/^NODE-0*(\d+)$/, (_, n) => `N${n.padStart(2, '0')}`);
}
function toNodeId(gossipLbl) {
  return gossipLbl.replace(/^N(\d+)$/, (_, n) => `NODE-${n.padStart(2, '0')}`);
}

/* ── Reset all local node states to clean ──────────────────────── */
function resetAllNodeStates() {
  nodes.forEach(n => {
    n.status = 'clean';
    n.score  = 0;
    n.msgs   = 0;
    n.ioc    = 0;
  });
  renderNodes();
  updateHeaderCount();
  console.log('[NodeManager] All node states reset to clean');
}

/* ── Global bridge called by gossip.js ─────────────────────────── */
window.updateNodeStatus = function(lbl, newStatus, score = 0) {
  const targetId = lbl.startsWith('NODE-') ? lbl : toNodeId(lbl);
  const node = nodes.find(n => n.id === targetId);
  if (!node) return;

  node.status = newStatus;
  if (score) node.score = score;

  if (newStatus === 'infected')    { node.ioc += 1; node.msgs += 1; }
  if (newStatus === 'immune')      { node.msgs += 1; }
  if (newStatus === 'quarantined') { node.peers = 0; }

  renderNodes();
};

/* ── Sync full state from backend ───────────────────────────────── */
async function syncFromBackend() {
  try {
    const res  = await fetch(`${API_BASE}/api/gossip/state`);
    const data = await res.json();

    // FIX: If backend is not running, force all local nodes to clean.
    if (!data.running) {
      resetAllNodeStates();
      return;
    }

    data.nodes.forEach(bn => {
      const targetId = toNodeId(bn.lbl);
      const node = nodes.find(n => n.id === targetId);
      if (node) {
        node.status = bn.state;
        node.score  = bn.score;
      }
    });
    renderNodes();
  } catch (e) {
    console.warn('[NodeManager] syncFromBackend failed:', e.message);
  }
}

/* ── Add a new node ─────────────────────────────────────────────── */
async function addNodeCard() {
  if (nodes.length === 0) {
    try {
      const res = await fetch(`${API_BASE}/api/gossip/reset`, { method: 'POST' });
      if (res.ok) {
        console.log('[NodeManager] Backend gossip state reset before first node');
      }
    } catch(e) {
      // Silently ignore backend errors — app works fine without backend
      console.log('[NodeManager] Backend not available, continuing in standalone mode');
    }
  }
  

  nc++;
  const padded  = String(nc).padStart(2, '0');
  const newNode = {
    id    : `NODE-${padded}`,
    lbl   : `N${padded}`,
    ip    : `192.168.${~~(Math.random() * 5) + 2}.${~~(Math.random() * 200) + 10}`,
    port  : 5000 + nc,
    status: 'clean',
    peers : ~~(Math.random() * 4) + 1,
    msgs  : 0,
    ioc   : 0,
    score : 0,
  };

  nodes.push(newNode);
  renderNodes();
  updateHeaderCount();

  if (typeof logSys === 'function') {
    logSys('t-ok', `${newNode.id} registered — gossip label: ${newNode.lbl} @ ${newNode.ip}:${newNode.port}`);
  }
}

/* ── Remove a node ──────────────────────────────────────────────── */
function removeNode(nodeId) {
  nodes = nodes.filter(n => n.id !== nodeId);
  renderNodes();
  updateHeaderCount();
  if (typeof logSys === 'function') {
    logSys('t-warn', `${nodeId} removed from network`);
  }
}

function clearAllNodes() {
  const nodeCount = nodes.length;
  
  if (nodeCount === 0) {
    if (typeof showToast === 'function') showToast('No nodes to clear', 'info');
    else alert('No nodes to clear');
    return;
  }
  
  if (confirm(`Are you sure you want to remove all ${nodeCount} nodes? This action cannot be undone.`)) {
    nodes = [];        // Clear the actual data array
    nc = 0;            // Reset node counter so new nodes start from 01
    renderNodes();     // Re-render (will show empty state)
    updateHeaderCount(); // Update "X Nodes Online" badge
    
    if (typeof showToast === 'function') showToast(`Cleared ${nodeCount} nodes`, 'success');
    if (typeof logSys === 'function') logSys('t-warn', `All ${nodeCount} nodes cleared from network`);
  }
}

/* ── Update header node count if element exists ─────────────────── */
function updateHeaderCount() {
  const badge = document.querySelector('[data-node-count], .node-count-badge');
  if (badge) {
    const online = nodes.filter(n => n.status !== 'offline').length;
    badge.textContent = `● ${online} Node${online !== 1 ? 's' : ''} Online`;
  }
}

/* ── Render ─────────────────────────────────────────────────────── */
function renderNodes() {
  const grid = document.getElementById('nodeGrid');
  if (!grid) {
    console.error('[NodeManager] #nodeGrid not found in DOM');
    return;
  }

  if (nodes.length === 0) {
    grid.innerHTML = `
      <div class="node-empty">
        No nodes registered yet.<br>
        Click <strong>+ Register node</strong> to add one.
      </div>`;
    return;
  }

  grid.innerHTML = nodes.map(n => {
    const cardClass =
      n.status === 'infected'    ? 'infected' :
      n.status === 'quarantined' ? 'warning'  :
      n.status === 'immune'      ? 'online'   :
      n.status === 'clean'       ? 'online'   :
      n.status === 'online'      ? 'online'   :
      n.status === 'warning'     ? 'warning'  :
      n.status === 'offline'     ? 'offline'  :
      'online';

    const badgeClass =
      n.status === 'infected'    ? 'b-red'    :
      n.status === 'quarantined' ? 'b-orange' :
      n.status === 'immune'      ? 'b-blue'   :
      n.status === 'clean'       ? 'b-green'  :
      n.status === 'online'      ? 'b-green'  :
      n.status === 'warning'     ? 'b-orange' :
      'b-gray';

    const displayStatus =
      n.status === 'clean' ? 'online' :
      n.status === 'immune' ? '🛡 immune' :
      n.status === 'quarantined' ? '🔒 quarantined' :
      n.status;

    const scoreColor =
      n.score >= 70 ? '#ef4444' :
      n.score >= 40 ? '#f97316' :
      '#22c55e';

    return `
    <div class="node-card ${cardClass}" data-id="${n.id}" data-lbl="${n.lbl}">
      <div class="node-dot"></div>
      <div class="node-header">
        <div class="node-id">${n.id}</div>
        <button class="node-remove-btn" onclick="removeNode('${n.id}')" title="Remove node">✕</button>
      </div>
      <div class="node-ip">${n.ip}:${n.port}</div>
      <div class="node-lbl">Gossip label: <span style="color:#60a5fa">${n.lbl}</span></div>
      <span class="badge ${badgeClass}" style="margin: 4px 0 8px">${displayStatus}</span>
      ${n.score > 0 ? `
        <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:#6b7280;margin-bottom:4px;">
          <span>Threat</span>
          <div style="flex:1;height:4px;background:#1f2937;border-radius:2px;overflow:hidden;">
            <div style="width:${n.score}%;height:100%;background:${scoreColor};border-radius:2px;transition:width 0.4s;"></div>
          </div>
          <span style="color:${scoreColor};font-weight:600">${n.score}</span>
        </div>` : ''}
      <div class="node-stats">
        <div class="stat"><div class="stat-val">${n.peers}</div><div class="stat-lbl">Peers</div></div>
        <div class="stat"><div class="stat-val">${n.msgs}</div><div class="stat-lbl">Msgs</div></div>
        <div class="stat"><div class="stat-val">${n.ioc}</div><div class="stat-lbl">IOCs</div></div>
      </div>
    </div>`;
  }).join('');
}

/* ── Expose node list in gossip-ready format ────────────────────── */
window.getGossipNodeList = function() {
  return nodes.map((n, i) => ({ id: i, lbl: n.lbl }));
};

window.getGossipLabels = function() {
  return nodes.map(n => n.lbl);
};

/* ── Init ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderNodes();
  syncFromBackend();
});

/* ══════════════════════════════════════════════════════════════════
   DOWNLOAD ALL NODES
   ══════════════════════════════════════════════════════════════════ */
function downloadNodes(format = 'json') {
  if (nodes.length === 0) {
    alert('No nodes to export. Add some nodes first.');
    return;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (format === 'json') {
    const payload = {
      exported_at : new Date().toISOString(),
      total_nodes : nodes.length,
      nodes       : nodes.map(n => ({
        id          : n.id,
        gossip_label: n.lbl,
        ip          : n.ip,
        port        : n.port,
        status      : n.status === 'clean' ? 'online' : n.status,
        peers       : n.peers,
        messages    : n.msgs,
        iocs        : n.ioc,
        threat_score: n.score,
      }))
    };
    _triggerDownload(JSON.stringify(payload, null, 2), `sentra-nodes-${timestamp}.json`, 'application/json');
  } else if (format === 'csv') {
    const headers = ['ID','Gossip Label','IP','Port','Status','Peers','Messages','IOCs','Threat Score'];
    const rows = nodes.map(n => [n.id, n.lbl, n.ip, n.port, n.status === 'clean' ? 'online' : n.status, n.peers, n.msgs, n.ioc, n.score]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    _triggerDownload(csv, `sentra-nodes-${timestamp}.csv`, 'text/csv');
  }
}

function _triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (typeof logSys === 'function') {
    logSys('t-ok', `Exported ${nodes.length} nodes → ${filename}`);
  }
}

/* ══════════════════════════════════════════════════════════════════
   GLOBAL EXPORTS — required for gossip.js integration
   ══════════════════════════════════════════════════════════════════ */
window.downloadNodes = downloadNodes;
window.resetAllNodeStates = resetAllNodeStates;   // ← THIS WAS MISSING
