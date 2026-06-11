// /* ── GOSSIP ── */
// // change: window.API / window.WS_API if your backend moves
// window.API    = window.API    || 'http://localhost:8000/api';
// window.WS_API = window.WS_API || 'ws://localhost:8000/ws/gossip';

// let gNodes    = [], gEdges = [], gRunning = false, gPaused = false;
// let gParticles  = [], gAnimLoop = null;
// let gEdgeHops   = {};
// let gFirewalled = new Set();   // set of "N01-N02" edge keys
// let gLastSnapshot = null;
// let gStartNode  = 0;
// let gSpeed      = 1;
// let gProp       = 0;
// let gImmune     = 0;

// /* WebSocket */
// let gSocket      = null;
// let gSocketReady = false;

// /* Firewall interaction mode — toggled by toolbar button */
// let gFirewallMode = false;

// const gCvs = () => document.getElementById('gossipCanvas');
// const gCtx = () => { const c = gCvs(); return c ? c.getContext('2d') : null; };

// /* ══════════════════════════════════════════════════════
//    WEBSOCKET
//    ══════════════════════════════════════════════════════ */
// function connectGossipSocket() {
//   if (gSocket && gSocket.readyState === WebSocket.OPEN) return;
//   gSocket = new WebSocket(window.WS_API);

//   gSocket.onopen = () => {
//     gSocketReady = true;
//     gossipLog('t-ok', 'WebSocket connected to backend');
//     console.log('Gossip WebSocket open');
//   };
//   gSocket.onclose = () => {
//     gSocketReady = false;
//     gossipLog('t-warn', 'WebSocket disconnected — reconnecting in 3s...');
//     setTimeout(connectGossipSocket, 3000);
//   };
//   gSocket.onerror = () => {
//     gossipLog('t-err', 'WebSocket error — is backend running?');
//   };
//   gSocket.onmessage = (event) => {
//     try { handleGossipMessage(JSON.parse(event.data)); }
//     catch (e) { console.error('Bad WS message:', e); }
//   };
// }

// function wsSend(obj) {
//   if (gSocket && gSocket.readyState === WebSocket.OPEN)
//     gSocket.send(JSON.stringify(obj));
// }

// /* ══════════════════════════════════════════════════════
//    MESSAGE HANDLER
//    ══════════════════════════════════════════════════════ */
// function handleGossipMessage(msg) {
//   switch (msg.type) {

//     /* Full state sync for late-joining tabs */
//     case 'sync': {
//       msg.nodes.forEach(({ lbl, state, score }) => {
//         const n = gNodes.find(n => n.lbl === lbl);
//         if (n) { n.state = state; n.score = score || 0; }
//       });
//       gEdgeHops   = msg.edge_hops      || {};
//       gFirewalled = new Set(msg.firewall_edges || []);
//       gProp       = msg.total_reached  || 0;
//       gImmune     = msg.total_immune   || 0;
//       gRunning    = msg.running        || false;
//       updateContainment(msg.containment || 100);
//       renderGNodeTbl(); drawGossip();
//       if (gRunning) {
//         document.getElementById('gossipStat').textContent = 'Propagating...';
//         gossipLog('t-info', `Synced live state — ${gProp} infected, ${gImmune} immune`);
//       }
//       break;
//     }

//     /* Gossip started */
//     case 'start': {
//       gRunning = true; gPaused = false; gProp = 1; gImmune = 0;
//       const n = gNodes.find(n => n.lbl === msg.node);
//       if (n) { n.state = 'infected'; n.pulse = 10; n.score = msg.score; }
//       document.getElementById('gossipStat').textContent = 'Propagating...';
//       document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
//       gossipLog('t-warn', `Threat injected at ${msg.node} (score ${msg.score}) — gossip started`);
//       renderGNodeTbl(); drawGossip(); startAnimLoop();
//       break;
//     }

//     /* Particle travelling */
//     case 'hop': {
//       const fi = gNodes.findIndex(n => n.lbl === msg.from);
//       const ti = gNodes.findIndex(n => n.lbl === msg.to);
//       if (fi !== -1 && ti !== -1) {
//         gParticles.push({ from: fi, to: ti, progress: 0, color: '#f97316' });
//         gEdgeHops[edgeKey(fi, ti)] = msg.hop_count;
//         startAnimLoop();
//         gossipLog('t-info', `${msg.from} → ${msg.to} [hop ${msg.hop_count}] score:${msg.score}`);
//       }
//       break;
//     }

//     /* Node infected */
//     case 'infected': {
//       gProp = msg.total_reached || gProp;
//       const n = gNodes.find(n => n.lbl === msg.node);
//       if (n) {
//         n.state = 'infected';
//         n.pulse = 10;
//         n.score = msg.score;
//       }
//       updateContainment(msg.containment);

//       // Sync with Node Manager
//       if (window.updateNodeStatus) window.updateNodeStatus(msg.node, 'infected');

//       gossipLog('t-err', `${msg.node} INFECTED (${gProp}/${gNodes.length} reached)`);

//       // Update UI Stats
//       const infoEl = document.getElementById('gossipInfo');
//       if (infoEl) {
//         infoEl.textContent = `${gNodes.length} nodes · ${gProp} infected · ${gImmune} immune`;
//       }

//       renderGNodeTbl(); drawGossip();
//       break;
//     }

//     /* Node defended → immune */
//     case 'immune': {
//       gImmune = msg.total_immune || gImmune;
//       const n = gNodes.find(n => n.lbl === msg.node);
//       if (n) {
//         n.state = 'immune';
//         n.defPulse = 10;
//       }
//       updateContainment(msg.containment);

//       // Sync with Node Manager
//       if (window.updateNodeStatus) window.updateNodeStatus(msg.node, 'immune');

//       gossipLog('t-ok', `${msg.node} DEFENDED against ${msg.defended_by} → IMMUNE (${msg.defense_prob}% defense)`);

//       const infoEl = document.getElementById('gossipInfo');
//       if (infoEl) {
//         infoEl.textContent = `${gNodes.length} nodes · ${gProp} infected · ${gImmune} immune`;
//       }

//       renderGNodeTbl(); drawGossip();
//       break;
//     }

//     /* Node quarantined (firewall isolated it) */
//     case 'quarantined': {
//       const n = gNodes.find(n => n.lbl === msg.node);
//       if (n) { n.state = 'quarantined'; n.pulse = 10; }
//       updateContainment(msg.containment);
//       gossipLog('t-warn', `${msg.node} QUARANTINED — all edges firewalled`);
//       renderGNodeTbl(); drawGossip();
//       break;
//     }

//     /* Firewall edge toggled */
//     case 'firewall': {
//       gFirewalled = new Set(msg.firewall_edges || []);
//       updateContainment(msg.containment);
//       gossipLog('t-info',
//         `Firewall edge ${msg.edge} ${msg.action} — containment: ${msg.containment}`);
//       drawGossip();
//       break;
//     }

//     /* Propagation complete */
//     case 'complete': {
//       gRunning = false;
//       gEdgeHops = msg.edge_hops || gEdgeHops;
//       gProp     = msg.total_reached || gProp;
//       gImmune   = msg.total_immune  || gImmune;
//       updateContainment(msg.containment);
//       document.getElementById('gossipStat').textContent = 'Complete';
//       document.getElementById('gossipInfo').textContent =
//         `${msg.total_nodes} nodes · ${gProp} infected · ${gImmune} immune · ${msg.total_quarantine} quarantined`;
//       gossipLog('t-ok',
//         `Complete — infected:${gProp} immune:${gImmune} quarantined:${msg.total_quarantine} containment:${msg.containment}`);
//       renderGNodeTbl(); drawGossip();
//       break;
//     }

//     /* Controls */
//     case 'paused':  {
//       gPaused = true;
//       document.getElementById('pauseBtn').textContent = '▶ Resume';
//       gossipLog('t-info', 'Gossip paused'); break;
//     }
//     case 'resumed': {
//       gPaused = false;
//       document.getElementById('pauseBtn').textContent = '⏸ Pause';
//       gossipLog('t-info', 'Gossip resumed'); break;
//     }
//     case 'reset': {
//       gRunning = false; gPaused = false; gProp = 0; gImmune = 0;
//       gParticles = []; gEdgeHops = {}; gFirewalled = new Set();
      
//       // 1. Reset Gossip Canvas internal state
//       gNodes.forEach(n => { 
//         n.state = 'clean'; 
//         n.pulse = 0; 
//         n.defPulse = 0; 
//         n.score = 0; 
//       });

//       // 2. Reset the Node Manager Grid to 'online' (Green)
//       if (window.updateNodeStatus) {
//         gNodes.forEach(n => {
//           window.updateNodeStatus(n.lbl, 'online');
//         });
//       }

//       gEdges.forEach(([a, b]) => { gEdgeHops[edgeKey(a, b)] = 0; });
//       updateContainment(100);
      
//       document.getElementById('gossipStat').textContent = 'Idle';
//       document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
//       document.getElementById('pauseBtn').textContent   = '⏸ Pause';
      
//       gossipLog('t-info', 'Network reset');
//       renderGNodeTbl(); drawGossip(); 
//       break;
//     }

//     default:
//       console.warn('Unknown gossip message:', msg.type);
//   }
// }

// /* ══════════════════════════════════════════════════════
//    CONTAINMENT SCORE UI
//    ══════════════════════════════════════════════════════ */
// function updateContainment(score) {
//   const el = document.getElementById('containmentScore');
//   if (!el) return;
//   el.textContent = `${score ?? 100}`;
//   el.style.color = score >= 70
//     ? 'var(--green, #22c55e)'
//     : score >= 40
//       ? 'var(--orange, #f97316)'
//       : 'var(--red, #ef4444)';
// }

// /* ══════════════════════════════════════════════════════
//    CANVAS INIT & BUILD
//    ══════════════════════════════════════════════════════ */
// function initGossipCanvas() {
//   const c = gCvs(); if (!c) return;
//   const dpr = window.devicePixelRatio || 1;
//   c.width        = c.offsetWidth * dpr;
//   c.height       = 320 * dpr;
//   c.style.height = '320px';
//   if (!gNodes.length) buildGossip();
//   drawGossip();
//   attachCanvasEvents();
//   connectGossipSocket();
// }

// function buildGossip() {
//   gNodes = []; gEdges = []; gEdgeHops = {}; gFirewalled = new Set();
//   const c = gCvs(); if (!c) return;
//   const W = c.offsetWidth, H = 320;
//   const pos = [
//     [W/2, H/2], [W*.2, H*.2], [W*.8, H*.2], [W*.15, H*.65],
//     [W*.85, H*.65], [W*.45, H*.85], [W*.55, H*.2], [W*.8, H*.5]
//   ];
//   pos.forEach((p, i) => gNodes.push({
//     id: i, x: p[0], y: p[1],
//     lbl: `N${String(i+1).padStart(2,'0')}`,
//     state: 'clean', pulse: 0, defPulse: 0, score: 0
//   }));
//   [[0,1],[0,2],[0,5],[1,3],[2,4],[2,6],[3,5],[4,7],[1,6],[6,7],[0,7]].forEach(e => {
//     if (e[0] < gNodes.length && e[1] < gNodes.length) {
//       gEdges.push(e);
//       gEdgeHops[edgeKey(e[0], e[1])] = 0;
//     }
//   });
//   rebuildStartNodeSelect();
//   renderGNodeTbl();
// }

// function rebuildStartNodeSelect() {
//   const sel = document.getElementById('startNodeSel'); if (!sel) return;
//   sel.innerHTML = gNodes.map(n => `<option value="${n.id}">${n.lbl}</option>`).join('');
//   sel.value = gStartNode;
// }

// function edgeKey(a, b) {
//   const la = gNodes[a]?.lbl || a, lb = gNodes[b]?.lbl || b;
//   return la < lb ? `${la}-${lb}` : `${lb}-${la}`;
// }

// function edgeKeyByLbl(la, lb) {
//   return la < lb ? `${la}-${lb}` : `${lb}-${la}`;
// }

// /* ══════════════════════════════════════════════════════
//    DRAW
//    ══════════════════════════════════════════════════════ */
// function drawGossip() {
//   const ctx = gCtx(); if (!ctx) return;
//   const c   = gCvs();
//   const dpr = window.devicePixelRatio || 1;
//   const dark = document.documentElement.getAttribute('data-theme') === 'dark';
//   ctx.clearRect(0, 0, c.width, c.height);

//   /* ── edges ── */
//   gEdges.forEach(([a, b]) => {
//     const na = gNodes[a], nb = gNodes[b]; if (!na || !nb) return;
//     const key      = edgeKey(a, b);
//     const isActive = gParticles.some(p => (p.from===a&&p.to===b)||(p.from===b&&p.to===a));
//     const isFW     = gFirewalled.has(key);
//     const hops     = gEdgeHops[key] || 0;

//     ctx.beginPath();
//     ctx.moveTo(na.x * dpr, na.y * dpr);
//     ctx.lineTo(nb.x * dpr, nb.y * dpr);

//     if (isFW) {
//       /* Firewall edge — red dashed */
//       ctx.setLineDash([6 * dpr, 4 * dpr]);
//       ctx.strokeStyle = dark ? 'rgba(239,68,68,0.7)' : 'rgba(220,38,38,0.7)';
//       ctx.lineWidth   = 2;
//     } else if (isActive) {
//       ctx.setLineDash([]);
//       ctx.strokeStyle = dark ? 'rgba(0,212,255,0.45)' : 'rgba(37,99,235,0.4)';
//       ctx.lineWidth   = 2.5;
//     } else if (hops > 0) {
//       ctx.setLineDash([]);
//       ctx.strokeStyle = dark ? 'rgba(34,197,94,0.25)' : 'rgba(22,163,74,0.3)';
//       ctx.lineWidth   = 1.8;
//     } else {
//       ctx.setLineDash([]);
//       ctx.strokeStyle = dark ? 'rgba(42,48,64,0.9)' : 'rgba(200,208,220,0.9)';
//       ctx.lineWidth   = 1.5;
//     }
//     ctx.stroke();
//     ctx.setLineDash([]);

//     /* Firewall lock icon on edge midpoint */
//     if (isFW) {
//       const mx = (na.x + nb.x) / 2 * dpr;
//       const my = (na.y + nb.y) / 2 * dpr;
//       ctx.beginPath(); ctx.arc(mx, my, 9 * dpr, 0, Math.PI * 2);
//       ctx.fillStyle   = dark ? '#1e2328' : '#fff'; ctx.fill();
//       ctx.strokeStyle = 'rgba(239,68,68,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
//       ctx.fillStyle   = '#ef4444';
//       ctx.font        = `bold ${10 * dpr}px sans-serif`;
//       ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
//       ctx.fillText('🔒', mx, my);
//       return;
//     }

//     /* Hop count badge */
//     if (hops > 0) {
//       const mx = (na.x + nb.x) / 2 * dpr;
//       const my = (na.y + nb.y) / 2 * dpr;
//       ctx.beginPath(); ctx.arc(mx, my, 9 * dpr, 0, Math.PI * 2);
//       ctx.fillStyle   = dark ? '#1e2328' : '#fff'; ctx.fill();
//       ctx.strokeStyle = dark ? 'rgba(34,197,94,0.5)' : 'rgba(22,163,74,0.5)';
//       ctx.lineWidth   = 1.2; ctx.stroke();
//       ctx.fillStyle   = dark ? '#22c55e' : '#16a34a';
//       ctx.font        = `600 ${8.5 * dpr}px DM Sans,sans-serif`;
//       ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
//       ctx.fillText(String(hops), mx, my);
//     }
//   });

//   /* ── particles ── */
//   gParticles.forEach(p => {
//     const na = gNodes[p.from], nb = gNodes[p.to]; if (!na || !nb) return;
//     const x = (na.x + (nb.x - na.x) * p.progress) * dpr;
//     const y = (na.y + (nb.y - na.y) * p.progress) * dpr;
//     ctx.beginPath(); ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2);
//     ctx.fillStyle = 'rgba(249,115,22,0.15)'; ctx.fill();
//     ctx.beginPath(); ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
//     ctx.fillStyle   = '#f97316';
//     ctx.shadowColor = '#f97316';
//     ctx.shadowBlur  = 14 * dpr;
//     ctx.fill();
//     ctx.shadowBlur = 0;
//   });

//   /* ── nodes ── */
//   gNodes.forEach((n, i) => {
//     const x = n.x * dpr, y = n.y * dpr, r = 17 * dpr;
//     const isStart = (i === gStartNode);

//     /* infection pulse */
//     if (n.pulse > 0) {
//       ctx.beginPath(); ctx.arc(x, y, r + (12 * (1 - n.pulse / 10)) * dpr, 0, Math.PI * 2);
//       ctx.strokeStyle = `rgba(239,68,68,${n.pulse / 10 * 0.6})`;
//       ctx.lineWidth   = 2; ctx.stroke();
//       n.pulse--;
//     }

//     /* defense / immune pulse (blue ring) */
//     if (n.defPulse > 0) {
//       ctx.beginPath(); ctx.arc(x, y, r + (14 * (1 - n.defPulse / 10)) * dpr, 0, Math.PI * 2);
//       ctx.strokeStyle = `rgba(59,130,246,${n.defPulse / 10 * 0.7})`;
//       ctx.lineWidth   = 2.5; ctx.stroke();
//       n.defPulse--;
//     }

//     /* state glow ring */
//     if (n.state === 'infected') {
//       ctx.beginPath(); ctx.arc(x, y, r + 7 * dpr, 0, Math.PI * 2);
//       ctx.fillStyle = 'rgba(239,68,68,0.12)'; ctx.fill();
//     } else if (n.state === 'immune') {
//       ctx.beginPath(); ctx.arc(x, y, r + 7 * dpr, 0, Math.PI * 2);
//       ctx.fillStyle = 'rgba(59,130,246,0.15)'; ctx.fill();
//     } else if (n.state === 'quarantined') {
//       ctx.beginPath(); ctx.arc(x, y, r + 7 * dpr, 0, Math.PI * 2);
//       ctx.fillStyle = 'rgba(249,115,22,0.15)'; ctx.fill();
//     }

//     /* start node marker */
//     if (isStart && n.state === 'clean') {
//       ctx.beginPath(); ctx.arc(x, y, r + 5 * dpr, 0, Math.PI * 2);
//       ctx.strokeStyle = dark ? 'rgba(234,179,8,0.6)' : 'rgba(202,138,4,0.6)';
//       ctx.lineWidth   = 2; ctx.stroke();
//     }

//     /* node fill */
//     const fillColor = {
//       infected:    '#ef4444',
//       immune:      dark ? '#1e3a5f' : '#dbeafe',
//       quarantined: dark ? '#2d1f0e' : '#fff7ed',
//       clean:       isStart ? (dark ? '#2d2a1e' : '#fefce8') : (dark ? '#1e2328' : '#edf0f5')
//     }[n.state] || (dark ? '#1e2328' : '#edf0f5');

//     const strokeColor = {
//       infected:    '#ef4444',
//       immune:      '#3b82f6',
//       quarantined: '#f97316',
//       clean:       isStart ? '#eab308' : '#3b82f6'
//     }[n.state] || '#3b82f6';

//     ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
//     ctx.fillStyle   = fillColor; ctx.fill();
//     ctx.strokeStyle = strokeColor; ctx.lineWidth = 1.5; ctx.stroke();

//     /* label */
//     const lblColor = {
//       infected:    '#fff',
//       immune:      dark ? '#93c5fd' : '#1d4ed8',
//       quarantined: dark ? '#fdba74' : '#c2410c',
//       clean:       isStart ? (dark ? '#eab308' : '#ca8a04') : (dark ? '#e2e8f0' : '#1a202c')
//     }[n.state] || (dark ? '#e2e8f0' : '#1a202c');

//     ctx.fillStyle = lblColor;
//     ctx.font      = `600 ${9 * dpr}px DM Sans,sans-serif`;
//     ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
//     ctx.fillText(n.lbl, x, y);

//     /* shield icon on immune nodes */
//     if (n.state === 'immune') {
//       ctx.font      = `${8 * dpr}px sans-serif`;
//       ctx.fillText('🛡', x, y - r - 6 * dpr);
//     }
//     /* lock icon on quarantined nodes */
//     if (n.state === 'quarantined') {
//       ctx.font      = `${8 * dpr}px sans-serif`;
//       ctx.fillText('🔒', x, y - r - 6 * dpr);
//     }
//   });

//   drawLegend(ctx, dpr, dark);

//   /* firewall mode hint */
//   if (gFirewallMode) {
//     ctx.fillStyle   = 'rgba(239,68,68,0.85)';
//     ctx.font        = `600 ${11 * dpr}px DM Sans,sans-serif`;
//     ctx.textAlign   = 'center'; ctx.textBaseline = 'top';
//     ctx.fillText('🔒 FIREWALL MODE — click an edge to block/unblock',
//       c.width / 2, 6 * dpr);
//   }
// }

// function drawLegend(ctx, dpr, dark) {
//   const items = [
//     { color: '#3b82f6', label: 'Clean node'   },
//     { color: '#eab308', label: 'Start node'   },
//     { color: '#ef4444', label: 'Infected'     },
//     { color: '#3b82f6', label: '🛡 Immune'    },
//     { color: '#f97316', label: '🔒 Quarantined'},
//     { color: '#22c55e', label: 'Propagating'  },
//   ];
//   const x = 10 * dpr, startY = 10 * dpr;
//   const rowH = 17 * dpr, r = 5 * dpr, pad = 8 * dpr;

//   ctx.fillStyle   = dark ? 'rgba(13,17,23,0.80)' : 'rgba(255,255,255,0.80)';
//   ctx.beginPath();
//   ctx.roundRect(x - 6*dpr, startY - 6*dpr, 140*dpr, (items.length * rowH) + 26*dpr, 6*dpr);
//   ctx.fill();
//   ctx.strokeStyle = dark ? 'rgba(42,48,64,0.8)' : 'rgba(200,208,220,0.8)';
//   ctx.lineWidth   = 1; ctx.stroke();

//   items.forEach((item, i) => {
//     const cy = startY + i * rowH + r;
//     ctx.beginPath(); ctx.arc(x + r, cy, r, 0, Math.PI * 2);
//     ctx.fillStyle = item.color; ctx.fill();
//     ctx.fillStyle = dark ? '#8a9ab0' : '#4a5568';
//     ctx.font      = `500 ${9 * dpr}px DM Sans,sans-serif`;
//     ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
//     ctx.fillText(item.label, x + r * 2 + pad, cy);
//   });

//   /* Firewall edge example */
//   const fwY = startY + items.length * rowH + r + 4 * dpr;
//   ctx.beginPath(); ctx.moveTo(x, fwY); ctx.lineTo(x + r * 2 + pad + 60*dpr, fwY);
//   ctx.setLineDash([5*dpr, 3*dpr]);
//   ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke();
//   ctx.setLineDash([]);
//   ctx.fillStyle   = dark ? '#8a9ab0' : '#4a5568';
//   ctx.font        = `500 ${9 * dpr}px DM Sans,sans-serif`;
//   ctx.textAlign   = 'left'; ctx.textBaseline = 'middle';
//   ctx.fillText('Firewall edge', x + r * 2 + pad, fwY);
// }

// /* ══════════════════════════════════════════════════════
//    ANIMATION LOOP
//    ══════════════════════════════════════════════════════ */
// function startAnimLoop() {
//   if (gAnimLoop) return;
//   gAnimLoop = setInterval(() => {
//     gParticles.forEach(p => { p.progress += 0.018 * gSpeed; });
//     gParticles = gParticles.filter(p => p.progress <= 1);
//     drawGossip();
//     if (!gParticles.length && !gNodes.some(n => n.pulse > 0 || n.defPulse > 0)) {
//       clearInterval(gAnimLoop); gAnimLoop = null;
//     }
//   }, 30);
// }

// /* ══════════════════════════════════════════════════════
//    GOSSIP CONTROLS — called from HTML onclick
//    ══════════════════════════════════════════════════════ */

// // Start gossip (called from HTML onclick)
// async function startGossip(threatScore) {
//   if (gRunning) return;
//   gStartNode = parseInt(document.getElementById('startNodeSel').value) || 0;
//   const score = threatScore !== undefined
//     ? threatScore
//     : (window.lastThreatScore || 70);
//   gLastSnapshot = { startNode: gStartNode };

//   try {
//     const res = await fetch(`${window.API}/gossip/start`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         start_node:   gNodes[gStartNode].lbl,
//         threat_score: score,
//         nodes: gNodes.map(n => ({ id: n.id, lbl: n.lbl })),
//         edges: gEdges
//       })
//     });
//     const r = await res.json();
//     if (r.error) gossipLog('t-err', r.error);
//   } catch (err) {
//     gossipLog('t-err', 'Backend not running — start Python: python app.py');
//     console.error('Gossip start error:', err);
//   }
// }

// // Replay (called from HTML onclick)
// async function replayGossip() {
//   if (gRunning) return;
//   if (!gLastSnapshot) { gossipLog('t-warn', 'No previous propagation to replay'); return; }
//   gStartNode = gLastSnapshot.startNode;
//   document.getElementById('startNodeSel').value = gStartNode;
//   gossipLog('t-info', `Replaying from ${gNodes[gStartNode].lbl}`);
//   await startGossip(window.lastThreatScore || 70);
// }

// // Pause / Resume (called from HTML onclick)
// function pauseGossip() {
//   wsSend({ action: gPaused ? 'resume' : 'pause' });
// }

// // Reset (called from HTML onclick)
// function resetGossip() {
//   wsSend({ action: 'reset' });
//   if (gAnimLoop) { clearInterval(gAnimLoop); gAnimLoop = null; }
//   gNodes = []; gEdges = []; gEdgeHops = {}; gFirewalled = new Set();
//   buildGossip(); drawGossip();
//   document.getElementById('gossipStat').textContent = 'Idle';
//   document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
//   gProp = 0; gImmune = 0; gLastSnapshot = null;
//   updateContainment(100);
//   gossipLog('t-info', 'Network reset');
// }

// // Add node (called from HTML onclick)
// function addGossipNode() {
//   const c = gCvs(); if (!c) return;
//   const W = c.offsetWidth, H = 320;
//   const id = gNodes.length;
//   const a  = Math.random() * Math.PI * 2;
//   const r  = Math.min(W, H) * 0.3;
//   gNodes.push({
//     id, x: W/2 + Math.cos(a)*r, y: H/2 + Math.sin(a)*r,
//     lbl: `N${String(id+1).padStart(2,'0')}`,
//     state: 'clean', pulse: 0, defPulse: 0, score: 0
//   });
//   if (id > 0) {
//     const peer = ~~(Math.random() * id);
//     gEdges.push([peer, id]);
//     gEdgeHops[edgeKey(peer, id)] = 0;
//   }
//   rebuildStartNodeSelect();
//   drawGossip(); renderGNodeTbl();
//   gossipLog('t-info', `Node N${String(id+1).padStart(2,'0')} joined`);
//   document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
// }

// // Speed slider (called from HTML oninput)
// function onSpeedChange(val) {
//   gSpeed = parseFloat(val);
//   document.getElementById('speedLabel').textContent = `${gSpeed}x`;
// }

// // Toggle firewall mode (called from HTML onclick)
// // In firewall mode, clicking an edge (not a node) blocks/unblocks it
// function toggleFirewallMode() {
//   gFirewallMode = !gFirewallMode;
//   const btn = document.getElementById('firewallBtn');
//   if (btn) {
//     btn.textContent = gFirewallMode ? '🔒 Exit Firewall' : '🔒 Firewall Edge';
//     btn.style.opacity = gFirewallMode ? '1' : '0.7';
//   }
//   gossipLog('t-info', gFirewallMode
//     ? 'Firewall mode ON — click an edge to block/unblock it'
//     : 'Firewall mode OFF');
//   drawGossip();
// }

// /* ══════════════════════════════════════════════════════
//    THREAT CHECK INTEGRATION
//    ══════════════════════════════════════════════════════ */
// function onThreatCheckComplete(sourceNodeLbl, score) {
//   window.lastThreatScore = score;
//   const idx = gNodes.findIndex(n => n.lbl === sourceNodeLbl);
//   if (idx !== -1) gStartNode = idx;
//   gossipLog('t-warn',
//     `Threat check: ${sourceNodeLbl} scored ${score} — triggering gossip propagation`);
//   startGossip(score);
// }

// /* ══════════════════════════════════════════════════════
//    UI HELPERS
//    ══════════════════════════════════════════════════════ */
// function gossipLog(cls, msg) {
//   const el = document.getElementById('gossipLog'); if (!el) return;
//   const t  = new Date().toTimeString().slice(0, 8);
//   el.innerHTML += `<div><span class="t-time">[${t}]</span> <span class="${cls}">${msg}</span></div>`;
//   el.scrollTop  = el.scrollHeight;
// }

// function renderGNodeTbl() {
//   const peers = id => gEdges.filter(e => e.includes(id)).length;
//   const stateBadge = s => ({
//     infected:    '<span class="badge b-red">Infected</span>',
//     immune:      '<span class="badge b-blue">Immune 🛡</span>',
//     quarantined: '<span class="badge b-orange">Quarantined 🔒</span>',
//     clean:       '<span class="badge b-gray">Clean</span>'
//   }[s] || '<span class="badge b-gray">Clean</span>');

//   document.getElementById('gNodeTbl').innerHTML = gNodes.map(n => `<tr>
//     <td class="mono" style="color:var(--accent)">${n.lbl}</td>
//     <td class="mono">${peers(n.id)}</td>
//     <td class="mono">${n.score || 0}</td>
//     <td>${stateBadge(n.state)}</td>
//   </tr>`).join('');
// }

// /* ══════════════════════════════════════════════════════
//    EDGE HIT DETECTION (for firewall mode)
//    ══════════════════════════════════════════════════════ */
// function getEdgeAtPos(x, y) {
//   const THRESHOLD = 8;
//   for (const [a, b] of gEdges) {
//     const na = gNodes[a], nb = gNodes[b]; if (!na || !nb) continue;
//     // point-to-segment distance
//     const dx = nb.x - na.x, dy = nb.y - na.y;
//     const lenSq = dx*dx + dy*dy;
//     if (lenSq === 0) continue;
//     const t = Math.max(0, Math.min(1, ((x - na.x)*dx + (y - na.y)*dy) / lenSq));
//     const projX = na.x + t * dx, projY = na.y + t * dy;
//     const dist  = Math.sqrt((x - projX)**2 + (y - projY)**2);
//     if (dist < THRESHOLD) return [a, b];
//   }
//   return null;
// }

// /* ══════════════════════════════════════════════════════
//    DRAGGABLE NODES + FIREWALL CLICK
//    ══════════════════════════════════════════════════════ */
// let dragNode = null, dragOffX = 0, dragOffY = 0;

// function getCanvasPos(e) {
//   const c    = gCvs();
//   const rect = c.getBoundingClientRect();
//   const clientX = e.touches ? e.touches[0].clientX : e.clientX;
//   const clientY = e.touches ? e.touches[0].clientY : e.clientY;
//   return { x: clientX - rect.left, y: clientY - rect.top };
// }

// function getNodeAtPos(x, y) {
//   return [...gNodes].reverse().find(n => {
//     const dx = n.x - x, dy = n.y - y;
//     return Math.sqrt(dx*dx + dy*dy) <= 20;
//   });
// }

// function onMouseDown(e) {
//   e.preventDefault();
//   const pos  = getCanvasPos(e);

//   if (gFirewallMode) {
//     /* In firewall mode: clicks toggle edges, not drag nodes */
//     const node = getNodeAtPos(pos.x, pos.y);
//     if (!node) {
//       const edge = getEdgeAtPos(pos.x, pos.y);
//       if (edge) {
//         const la = gNodes[edge[0]].lbl, lb = gNodes[edge[1]].lbl;
//         wsSend({ action: 'firewall', node_a: la, node_b: lb });
//       }
//     }
//     return;
//   }

//   const node = getNodeAtPos(pos.x, pos.y);
//   if (node) {
//     dragNode = node;
//     dragOffX = pos.x - node.x;
//     dragOffY = pos.y - node.y;
//     gCvs().style.cursor = 'grabbing';
//   }
// }

// function onMouseMove(e) {
//   e.preventDefault();
//   const c = gCvs(); if (!c) return;
//   const pos = getCanvasPos(e);
//   if (dragNode) {
//     const padding = 20, W = c.offsetWidth, H = 320;
//     dragNode.x = Math.max(padding, Math.min(W - padding, pos.x - dragOffX));
//     dragNode.y = Math.max(padding, Math.min(H - padding, pos.y - dragOffY));
//     drawGossip();
//   } else {
//     if (gFirewallMode) {
//       c.style.cursor = getEdgeAtPos(pos.x, pos.y) ? 'crosshair' : 'default';
//     } else {
//       c.style.cursor = getNodeAtPos(pos.x, pos.y) ? 'grab' : 'default';
//     }
//   }
// }

// function onMouseUp() { dragNode = null; gCvs().style.cursor = 'default'; }

// function attachCanvasEvents() {
//   const c = gCvs(); if (!c) return;
//   ['mousedown','mousemove','mouseup','mouseleave','touchstart','touchmove','touchend']
//     .forEach(ev => c.removeEventListener(ev, ev === 'mousedown' ? onMouseDown
//       : ev === 'mousemove' ? onMouseMove : onMouseUp));
//   c.addEventListener('mousedown',  onMouseDown,  { passive: false });
//   c.addEventListener('mousemove',  onMouseMove,  { passive: false });
//   c.addEventListener('mouseup',    onMouseUp);
//   c.addEventListener('mouseleave', onMouseUp);
//   c.addEventListener('touchstart', onMouseDown,  { passive: false });
//   c.addEventListener('touchmove',  onMouseMove,  { passive: false });
//   c.addEventListener('touchend',   onMouseUp);
// }

// window.addEventListener('resize', () => {
//   const gPage = document.getElementById('page-gossip');
//   if (gPage && gPage.classList.contains('active')) initGossipCanvas();
// });

// // Verify loaded
// console.log("✅ gossip.js loaded — defense system, firewall, containment score ready");




/* ── GOSSIP ── */
window.API    = window.API    || 'http://localhost:8000/api';
window.WS_API = window.WS_API || 'ws://localhost:8000/ws/gossip';

let gNodes    = [], gEdges = [], gRunning = false, gPaused = false;
let gParticles  = [], gAnimLoop = null;
let gEdgeHops   = {};
let gFirewalled = new Set();
let gLastSnapshot = null;
let gStartNode  = 0;
let gSpeed      = 1;
let gProp       = 0;
let gImmune     = 0;

let gSocket      = null;
let gSocketReady = false;
let gFirewallMode = false;

const gCvs = () => document.getElementById('gossipCanvas');
const gCtx = () => { const c = gCvs(); return c ? c.getContext('2d') : null; };

/* ══════════════════════════════════════════════════════
   WEBSOCKET
   ══════════════════════════════════════════════════════ */
function connectGossipSocket() {
  if (gSocket && gSocket.readyState === WebSocket.OPEN) return;
  gSocket = new WebSocket(window.WS_API);

  gSocket.onopen = () => {
    gSocketReady = true;
    gossipLog('t-ok', 'WebSocket connected to backend');
    console.log('[Gossip] WebSocket open');
  };
  gSocket.onclose = () => {
    gSocketReady = false;
    gossipLog('t-warn', 'WebSocket disconnected — reconnecting in 3s...');
    setTimeout(connectGossipSocket, 3000);
  };
  gSocket.onerror = () => {
    gossipLog('t-err', 'WebSocket error — is backend running?');
  };
  gSocket.onmessage = (event) => {
    try { handleGossipMessage(JSON.parse(event.data)); }
    catch (e) { console.error('[Gossip] Bad WS message:', e); }
  };
}

function wsSend(obj) {
  if (gSocket && gSocket.readyState === WebSocket.OPEN)
    gSocket.send(JSON.stringify(obj));
}

/* ══════════════════════════════════════════════════════
   MESSAGE HANDLER
   ══════════════════════════════════════════════════════ */
function handleGossipMessage(msg) {
  console.log('[Gossip] WS message:', msg.type, msg);

  switch (msg.type) {

    /* Full state sync for late-joining tabs */
    case 'sync': {
      // FIX: Only apply node states if simulation is actively running.
      // If running=false, backend sends empty nodes[] to prevent stale state leak.
      if (msg.running && msg.nodes && msg.nodes.length > 0) {
        msg.nodes.forEach(({ lbl, state, score }) => {
          const n = gNodes.find(n => n.lbl === lbl);
          if (n) { n.state = state; n.score = score || 0; }
        });
      } else if (!msg.running) {
        // Backend is idle — force canvas nodes to clean
        console.log('[Gossip] Sync received with running=false — clearing canvas nodes');
        gNodes.forEach(n => { n.state = 'clean'; n.score = 0; n.pulse = 0; n.defPulse = 0; });
      }

      gEdgeHops   = msg.edge_hops      || {};
      gFirewalled = new Set(msg.firewall_edges || []);
      gProp       = msg.total_reached  || 0;
      gImmune     = msg.total_immune   || 0;
      gRunning    = msg.running        || false;
      updateContainment(msg.containment || 100);
      renderGNodeTbl(); drawGossip();

      // Sync with Node Manager — but only if running and we have nodes
      if (msg.running && msg.nodes && window.updateNodeStatus) {
        msg.nodes.forEach(({ lbl, state, score }) => {
          window.updateNodeStatus(lbl, state, score || 0);
        });
      } else if (!msg.running && window.resetAllNodeStates) {
        window.resetAllNodeStates();
      }

      if (gRunning) {
        document.getElementById('gossipStat').textContent = 'Propagating...';
        gossipLog('t-info', `Synced live state — ${gProp} infected, ${gImmune} immune`);
      }
      break;
    }

    /* Gossip started */
    case 'start': {
      gRunning = true; gPaused = false; gProp = 1; gImmune = 0;
      const n = gNodes.find(n => n.lbl === msg.node);
      if (n) { n.state = 'infected'; n.pulse = 10; n.score = msg.score; }

      // FIX: Also sync start node with Node Manager
      if (window.updateNodeStatus) {
        window.updateNodeStatus(msg.node, 'infected', msg.score);
      }

      document.getElementById('gossipStat').textContent = 'Propagating...';
      document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
      gossipLog('t-warn', `Threat injected at ${msg.node} (score ${msg.score}) — gossip started`);
      renderGNodeTbl(); drawGossip(); startAnimLoop();
      break;
    }

    /* Particle travelling */
    case 'hop': {
      const fi = gNodes.findIndex(n => n.lbl === msg.from);
      const ti = gNodes.findIndex(n => n.lbl === msg.to);
      if (fi !== -1 && ti !== -1) {
        gParticles.push({ from: fi, to: ti, progress: 0, color: '#f97316' });
        gEdgeHops[edgeKey(fi, ti)] = msg.hop_count;
        startAnimLoop();
        gossipLog('t-info', `${msg.from} → ${msg.to} [hop ${msg.hop_count}] score:${msg.score}`);
      }
      break;
    }

    /* Node infected */
    case 'infected': {
      gProp = msg.total_reached || gProp;
      const n = gNodes.find(n => n.lbl === msg.node);
      if (n) {
        n.state = 'infected';
        n.pulse = 10;
        n.score = msg.score;
      }
      updateContainment(msg.containment);

      // Sync with Node Manager
      if (window.updateNodeStatus) {
        console.log('[Gossip] Forwarding infected to Node Manager:', msg.node);
        window.updateNodeStatus(msg.node, 'infected', msg.score || 0);
      }

      gossipLog('t-err', `${msg.node} INFECTED (${gProp}/${gNodes.length} reached)`);

      const infoEl = document.getElementById('gossipInfo');
      if (infoEl) {
        infoEl.textContent = `${gNodes.length} nodes · ${gProp} infected · ${gImmune} immune`;
      }

      renderGNodeTbl(); drawGossip();
      break;
    }

    /* Node defended → immune */
    case 'immune': {
      gImmune = msg.total_immune || gImmune;
      const n = gNodes.find(n => n.lbl === msg.node);
      if (n) {
        n.state = 'immune';
        n.defPulse = 10;
      }
      updateContainment(msg.containment);

      // Sync with Node Manager
      if (window.updateNodeStatus) {
        console.log('[Gossip] Forwarding immune to Node Manager:', msg.node);
        window.updateNodeStatus(msg.node, 'immune', 0);
      }

      gossipLog('t-ok', `${msg.node} DEFENDED against ${msg.defended_by} → IMMUNE (${msg.defense_prob}% defense)`);

      const infoEl = document.getElementById('gossipInfo');
      if (infoEl) {
        infoEl.textContent = `${gNodes.length} nodes · ${gProp} infected · ${gImmune} immune`;
      }

      renderGNodeTbl(); drawGossip();
      break;
    }

    /* Node quarantined */
    case 'quarantined': {
      const n = gNodes.find(n => n.lbl === msg.node);
      if (n) { n.state = 'quarantined'; n.pulse = 10; }
      updateContainment(msg.containment);

      if (window.updateNodeStatus) {
        window.updateNodeStatus(msg.node, 'quarantined', 0);
      }

      gossipLog('t-warn', `${msg.node} QUARANTINED — all edges firewalled`);
      renderGNodeTbl(); drawGossip();
      break;
    }

    /* Firewall edge toggled */
    case 'firewall': {
      gFirewalled = new Set(msg.firewall_edges || []);
      updateContainment(msg.containment);
      gossipLog('t-info',
        `Firewall edge ${msg.edge} ${msg.action} — containment: ${msg.containment}`);
      drawGossip();
      break;
    }

    /* Propagation complete */
    case 'complete': {
      gRunning = false;
      gEdgeHops = msg.edge_hops || gEdgeHops;
      gProp     = msg.total_reached || gProp;
      gImmune   = msg.total_immune  || gImmune;
      updateContainment(msg.containment);
      document.getElementById('gossipStat').textContent = 'Complete';
      document.getElementById('gossipInfo').textContent =
        `${msg.total_nodes} nodes · ${gProp} infected · ${gImmune} immune · ${msg.total_quarantine} quarantined`;
      gossipLog('t-ok',
        `Complete — infected:${gProp} immune:${gImmune} quarantined:${msg.total_quarantine} containment:${msg.containment}`);
      renderGNodeTbl(); drawGossip();
      break;
    }

    /* Controls */
    case 'paused':  {
      gPaused = true;
      document.getElementById('pauseBtn').textContent = '▶ Resume';
      gossipLog('t-info', 'Gossip paused'); break;
    }
    case 'resumed': {
      gPaused = false;
      document.getElementById('pauseBtn').textContent = '⏸ Pause';
      gossipLog('t-info', 'Gossip resumed'); break;
    }

    /* Reset — clear everything */
    case 'reset': {
      gRunning = false; gPaused = false; gProp = 0; gImmune = 0;
      gParticles = []; gEdgeHops = {}; gFirewalled = new Set();

      // FIX: Reset canvas nodes to clean
      gNodes.forEach(n => {
        n.state = 'clean';
        n.pulse = 0;
        n.defPulse = 0;
        n.score = 0;
      });

      // FIX: Reset Node Manager nodes to clean (not 'online')
      if (window.resetAllNodeStates) {
        console.log('[Gossip] Calling resetAllNodeStates() for Node Manager');
        window.resetAllNodeStates();
      } else if (window.updateNodeStatus) {
        // Fallback: manually reset each node
        gNodes.forEach(n => {
          window.updateNodeStatus(n.lbl, 'clean', 0);
        });
      }

      gEdges.forEach(([a, b]) => { gEdgeHops[edgeKey(a, b)] = 0; });
      updateContainment(100);

      document.getElementById('gossipStat').textContent = 'Idle';
      document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
      document.getElementById('pauseBtn').textContent   = '⏸ Pause';

      gossipLog('t-info', 'Network reset');
      renderGNodeTbl(); drawGossip();
      break;
    }

    default:
      console.warn('[Gossip] Unknown message type:', msg.type);
  }
}

/* ══════════════════════════════════════════════════════
   CONTAINMENT SCORE UI
   ══════════════════════════════════════════════════════ */
function updateContainment(score) {
  const el = document.getElementById('containmentScore');
  if (!el) return;
  el.textContent = `${score ?? 100}`;
  el.style.color = score >= 70
    ? 'var(--green, #22c55e)'
    : score >= 40
      ? 'var(--orange, #f97316)'
      : 'var(--red, #ef4444)';
}

/* ══════════════════════════════════════════════════════
   CANVAS INIT & BUILD
   ══════════════════════════════════════════════════════ */
function initGossipCanvas() {
  const c = gCvs(); if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  c.width        = c.offsetWidth * dpr;
  c.height       = 320 * dpr;
  c.style.height = '320px';
  if (!gNodes.length) buildGossip();
  drawGossip();
  attachCanvasEvents();
  connectGossipSocket();
}

function buildGossip() {
  gNodes = []; gEdges = []; gEdgeHops = {}; gFirewalled = new Set();
  const c = gCvs(); if (!c) return;
  const W = c.offsetWidth, H = 320;
  const pos = [
    [W/2, H/2], [W*.2, H*.2], [W*.8, H*.2], [W*.15, H*.65],
    [W*.85, H*.65], [W*.45, H*.85], [W*.55, H*.2], [W*.8, H*.5]
  ];
  pos.forEach((p, i) => gNodes.push({
    id: i, x: p[0], y: p[1],
    lbl: `N${String(i+1).padStart(2,'0')}`,
    state: 'clean', pulse: 0, defPulse: 0, score: 0
  }));
  [[0,1],[0,2],[0,5],[1,3],[2,4],[2,6],[3,5],[4,7],[1,6],[6,7],[0,7]].forEach(e => {
    if (e[0] < gNodes.length && e[1] < gNodes.length) {
      gEdges.push(e);
      gEdgeHops[edgeKey(e[0], e[1])] = 0;
    }
  });
  rebuildStartNodeSelect();
  renderGNodeTbl();
}

function rebuildStartNodeSelect() {
  const sel = document.getElementById('startNodeSel'); if (!sel) return;
  sel.innerHTML = gNodes.map(n => `<option value="${n.id}">${n.lbl}</option>`).join('');
  sel.value = gStartNode;
}

function edgeKey(a, b) {
  const la = gNodes[a]?.lbl || a, lb = gNodes[b]?.lbl || b;
  return la < lb ? `${la}-${lb}` : `${lb}-${la}`;
}

function edgeKeyByLbl(la, lb) {
  return la < lb ? `${la}-${lb}` : `${lb}-${la}`;
}

/* ══════════════════════════════════════════════════════
   DRAW
   ══════════════════════════════════════════════════════ */
function drawGossip() {
  const ctx = gCtx(); if (!ctx) return;
  const c   = gCvs();
  const dpr = window.devicePixelRatio || 1;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  ctx.clearRect(0, 0, c.width, c.height);

  /* ── edges ── */
  gEdges.forEach(([a, b]) => {
    const na = gNodes[a], nb = gNodes[b]; if (!na || !nb) return;
    const key      = edgeKey(a, b);
    const isActive = gParticles.some(p => (p.from===a&&p.to===b)||(p.from===b&&p.to===a));
    const isFW     = gFirewalled.has(key);
    const hops     = gEdgeHops[key] || 0;

    ctx.beginPath();
    ctx.moveTo(na.x * dpr, na.y * dpr);
    ctx.lineTo(nb.x * dpr, nb.y * dpr);

    if (isFW) {
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeStyle = dark ? 'rgba(239,68,68,0.7)' : 'rgba(220,38,38,0.7)';
      ctx.lineWidth   = 2;
    } else if (isActive) {
      ctx.setLineDash([]);
      ctx.strokeStyle = dark ? 'rgba(0,212,255,0.45)' : 'rgba(37,99,235,0.4)';
      ctx.lineWidth   = 2.5;
    } else if (hops > 0) {
      ctx.setLineDash([]);
      ctx.strokeStyle = dark ? 'rgba(34,197,94,0.25)' : 'rgba(22,163,74,0.3)';
      ctx.lineWidth   = 1.8;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = dark ? 'rgba(42,48,64,0.9)' : 'rgba(200,208,220,0.9)';
      ctx.lineWidth   = 1.5;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (isFW) {
      const mx = (na.x + nb.x) / 2 * dpr;
      const my = (na.y + nb.y) / 2 * dpr;
      ctx.beginPath(); ctx.arc(mx, my, 9 * dpr, 0, Math.PI * 2);
      ctx.fillStyle   = dark ? '#1e2328' : '#fff'; ctx.fill();
      ctx.strokeStyle = 'rgba(239,68,68,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle   = '#ef4444';
      ctx.font        = `bold ${10 * dpr}px sans-serif`;
      ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🔒', mx, my);
      return;
    }

    if (hops > 0) {
      const mx = (na.x + nb.x) / 2 * dpr;
      const my = (na.y + nb.y) / 2 * dpr;
      ctx.beginPath(); ctx.arc(mx, my, 9 * dpr, 0, Math.PI * 2);
      ctx.fillStyle   = dark ? '#1e2328' : '#fff'; ctx.fill();
      ctx.strokeStyle = dark ? 'rgba(34,197,94,0.5)' : 'rgba(22,163,74,0.5)';
      ctx.lineWidth   = 1.2; ctx.stroke();
      ctx.fillStyle   = dark ? '#22c55e' : '#16a34a';
      ctx.font        = `600 ${8.5 * dpr}px DM Sans,sans-serif`;
      ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(hops), mx, my);
    }
  });

  /* ── particles ── */
  gParticles.forEach(p => {
    const na = gNodes[p.from], nb = gNodes[p.to]; if (!na || !nb) return;
    const x = (na.x + (nb.x - na.x) * p.progress) * dpr;
    const y = (na.y + (nb.y - na.y) * p.progress) * dpr;
    ctx.beginPath(); ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(249,115,22,0.15)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle   = '#f97316';
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur  = 14 * dpr;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  /* ── nodes ── */
  gNodes.forEach((n, i) => {
    const x = n.x * dpr, y = n.y * dpr, r = 17 * dpr;
    const isStart = (i === gStartNode);

    if (n.pulse > 0) {
      ctx.beginPath(); ctx.arc(x, y, r + (12 * (1 - n.pulse / 10)) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239,68,68,${n.pulse / 10 * 0.6})`;
      ctx.lineWidth   = 2; ctx.stroke();
      n.pulse--;
    }

    if (n.defPulse > 0) {
      ctx.beginPath(); ctx.arc(x, y, r + (14 * (1 - n.defPulse / 10)) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(59,130,246,${n.defPulse / 10 * 0.7})`;
      ctx.lineWidth   = 2.5; ctx.stroke();
      n.defPulse--;
    }

    if (n.state === 'infected') {
      ctx.beginPath(); ctx.arc(x, y, r + 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239,68,68,0.12)'; ctx.fill();
    } else if (n.state === 'immune') {
      ctx.beginPath(); ctx.arc(x, y, r + 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.15)'; ctx.fill();
    } else if (n.state === 'quarantined') {
      ctx.beginPath(); ctx.arc(x, y, r + 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(249,115,22,0.15)'; ctx.fill();
    }

    if (isStart && n.state === 'clean') {
      ctx.beginPath(); ctx.arc(x, y, r + 5 * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? 'rgba(234,179,8,0.6)' : 'rgba(202,138,4,0.6)';
      ctx.lineWidth   = 2; ctx.stroke();
    }

    const fillColor = {
      infected:    '#ef4444',
      immune:      dark ? '#1e3a5f' : '#dbeafe',
      quarantined: dark ? '#2d1f0e' : '#fff7ed',
      clean:       isStart ? (dark ? '#2d2a1e' : '#fefce8') : (dark ? '#1e2328' : '#edf0f5')
    }[n.state] || (dark ? '#1e2328' : '#edf0f5');

    const strokeColor = {
      infected:    '#ef4444',
      immune:      '#3b82f6',
      quarantined: '#f97316',
      clean:       isStart ? '#eab308' : '#3b82f6'
    }[n.state] || '#3b82f6';

    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle   = fillColor; ctx.fill();
    ctx.strokeStyle = strokeColor; ctx.lineWidth = 1.5; ctx.stroke();

    const lblColor = {
      infected:    '#fff',
      immune:      dark ? '#93c5fd' : '#1d4ed8',
      quarantined: dark ? '#fdba74' : '#c2410c',
      clean:       isStart ? (dark ? '#eab308' : '#ca8a04') : (dark ? '#e2e8f0' : '#1a202c')
    }[n.state] || (dark ? '#e2e8f0' : '#1a202c');

    ctx.fillStyle = lblColor;
    ctx.font      = `600 ${9 * dpr}px DM Sans,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n.lbl, x, y);

    if (n.state === 'immune') {
      ctx.font = `${8 * dpr}px sans-serif`;
      ctx.fillText('🛡', x, y - r - 6 * dpr);
    }
    if (n.state === 'quarantined') {
      ctx.font = `${8 * dpr}px sans-serif`;
      ctx.fillText('🔒', x, y - r - 6 * dpr);
    }
  });

  drawLegend(ctx, dpr, dark);

  if (gFirewallMode) {
    ctx.fillStyle   = 'rgba(239,68,68,0.85)';
    ctx.font        = `600 ${11 * dpr}px DM Sans,sans-serif`;
    ctx.textAlign   = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('🔒 FIREWALL MODE — click an edge to block/unblock',
      c.width / 2, 6 * dpr);
  }
}

function drawLegend(ctx, dpr, dark) {
  const items = [
    { color: '#3b82f6', label: 'Clean node'   },
    { color: '#eab308', label: 'Start node'   },
    { color: '#ef4444', label: 'Infected'     },
    { color: '#3b82f6', label: '🛡 Immune'    },
    { color: '#f97316', label: '🔒 Quarantined'},
    { color: '#22c55e', label: 'Propagating'  },
  ];
  const x = 10 * dpr, startY = 10 * dpr;
  const rowH = 17 * dpr, r = 5 * dpr, pad = 8 * dpr;

  ctx.fillStyle   = dark ? 'rgba(13,17,23,0.80)' : 'rgba(255,255,255,0.80)';
  ctx.beginPath();
  ctx.roundRect(x - 6*dpr, startY - 6*dpr, 140*dpr, (items.length * rowH) + 26*dpr, 6*dpr);
  ctx.fill();
  ctx.strokeStyle = dark ? 'rgba(42,48,64,0.8)' : 'rgba(200,208,220,0.8)';
  ctx.lineWidth   = 1; ctx.stroke();

  items.forEach((item, i) => {
    const cy = startY + i * rowH + r;
    ctx.beginPath(); ctx.arc(x + r, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = item.color; ctx.fill();
    ctx.fillStyle = dark ? '#8a9ab0' : '#4a5568';
    ctx.font      = `500 ${9 * dpr}px DM Sans,sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(item.label, x + r * 2 + pad, cy);
  });

  const fwY = startY + items.length * rowH + r + 4 * dpr;
  ctx.beginPath(); ctx.moveTo(x, fwY); ctx.lineTo(x + r * 2 + pad + 60*dpr, fwY);
  ctx.setLineDash([5*dpr, 3*dpr]);
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle   = dark ? '#8a9ab0' : '#4a5568';
  ctx.font        = `500 ${9 * dpr}px DM Sans,sans-serif`;
  ctx.textAlign   = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Firewall edge', x + r * 2 + pad, fwY);
}

/* ══════════════════════════════════════════════════════
   ANIMATION LOOP
   ══════════════════════════════════════════════════════ */
function startAnimLoop() {
  if (gAnimLoop) return;
  gAnimLoop = setInterval(() => {
    gParticles.forEach(p => { p.progress += 0.018 * gSpeed; });
    gParticles = gParticles.filter(p => p.progress <= 1);
    drawGossip();
    if (!gParticles.length && !gNodes.some(n => n.pulse > 0 || n.defPulse > 0)) {
      clearInterval(gAnimLoop); gAnimLoop = null;
    }
  }, 30);
}

/* ══════════════════════════════════════════════════════
   GOSSIP CONTROLS
   ══════════════════════════════════════════════════════ */

async function startGossip(threatScore) {
  if (gRunning) return;
  gStartNode = parseInt(document.getElementById('startNodeSel').value) || 0;
  const score = threatScore !== undefined
    ? threatScore
    : (window.lastThreatScore || 70);
  gLastSnapshot = { startNode: gStartNode };

  try {
    const res = await fetch(`${window.API}/gossip/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_node:   gNodes[gStartNode].lbl,
        threat_score: score,
        nodes: gNodes.map(n => ({ id: n.id, lbl: n.lbl })),
        edges: gEdges
      })
    });
    const r = await res.json();
    if (r.error) gossipLog('t-err', r.error);
  } catch (err) {
    gossipLog('t-err', 'Backend not running — start Python: python app.py');
    console.error('Gossip start error:', err);
  }
}

async function replayGossip() {
  if (gRunning) return;
  if (!gLastSnapshot) { gossipLog('t-warn', 'No previous propagation to replay'); return; }
  gStartNode = gLastSnapshot.startNode;
  document.getElementById('startNodeSel').value = gStartNode;
  gossipLog('t-info', `Replaying from ${gNodes[gStartNode].lbl}`);
  await startGossip(window.lastThreatScore || 70);
}

function pauseGossip() {
  wsSend({ action: gPaused ? 'resume' : 'pause' });
}

function resetGossip() {
  wsSend({ action: 'reset' });
  if (gAnimLoop) { clearInterval(gAnimLoop); gAnimLoop = null; }
  gNodes = []; gEdges = []; gEdgeHops = {}; gFirewalled = new Set();
  buildGossip(); drawGossip();
  document.getElementById('gossipStat').textContent = 'Idle';
  document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
  gProp = 0; gImmune = 0; gLastSnapshot = null;
  updateContainment(100);
  gossipLog('t-info', 'Network reset');
}

function addGossipNode() {
  const c = gCvs(); if (!c) return;
  const W = c.offsetWidth, H = 320;
  const id = gNodes.length;
  const a  = Math.random() * Math.PI * 2;
  const r  = Math.min(W, H) * 0.3;
  gNodes.push({
    id, x: W/2 + Math.cos(a)*r, y: H/2 + Math.sin(a)*r,
    lbl: `N${String(id+1).padStart(2,'0')}`,
    state: 'clean', pulse: 0, defPulse: 0, score: 0
  });
  if (id > 0) {
    const peer = ~~(Math.random() * id);
    gEdges.push([peer, id]);
    gEdgeHops[edgeKey(peer, id)] = 0;
  }
  rebuildStartNodeSelect();
  drawGossip(); renderGNodeTbl();
  gossipLog('t-info', `Node N${String(id+1).padStart(2,'0')} joined`);
  document.getElementById('gossipInfo').textContent = `${gNodes.length} nodes`;
}

function onSpeedChange(val) {
  gSpeed = parseFloat(val);
  document.getElementById('speedLabel').textContent = `${gSpeed}x`;
}

function toggleFirewallMode() {
  gFirewallMode = !gFirewallMode;
  const btn = document.getElementById('firewallBtn');
  if (btn) {
    btn.textContent = gFirewallMode ? '🔒 Exit Firewall' : '🔒 Firewall Edge';
    btn.style.opacity = gFirewallMode ? '1' : '0.7';
  }
  gossipLog('t-info', gFirewallMode
    ? 'Firewall mode ON — click an edge to block/unblock it'
    : 'Firewall mode OFF');
  drawGossip();
}

/* ══════════════════════════════════════════════════════
   THREAT CHECK INTEGRATION
   ══════════════════════════════════════════════════════ */
function onThreatCheckComplete(sourceNodeLbl, score) {
  window.lastThreatScore = score;
  const idx = gNodes.findIndex(n => n.lbl === sourceNodeLbl);
  if (idx !== -1) gStartNode = idx;
  gossipLog('t-warn',
    `Threat check: ${sourceNodeLbl} scored ${score} — triggering gossip propagation`);
  startGossip(score);
}

/* ══════════════════════════════════════════════════════
   UI HELPERS
   ══════════════════════════════════════════════════════ */
function gossipLog(cls, msg) {
  const el = document.getElementById('gossipLog'); if (!el) return;
  const t  = new Date().toTimeString().slice(0, 8);
  el.innerHTML += `<div><span class="t-time">[${t}]</span> <span class="${cls}">${msg}</span></div>`;
  el.scrollTop  = el.scrollHeight;
}

function renderGNodeTbl() {
  const peers = id => gEdges.filter(e => e.includes(id)).length;
  const stateBadge = s => ({
    infected:    '<span class="badge b-red">Infected</span>',
    immune:      '<span class="badge b-blue">Immune 🛡</span>',
    quarantined: '<span class="badge b-orange">Quarantined 🔒</span>',
    clean:       '<span class="badge b-gray">Clean</span>'
  }[s] || '<span class="badge b-gray">Clean</span>');

  document.getElementById('gNodeTbl').innerHTML = gNodes.map(n => `<tr>
    <td class="mono" style="color:var(--accent)">${n.lbl}</td>
    <td class="mono">${peers(n.id)}</td>
    <td class="mono">${n.score || 0}</td>
    <td>${stateBadge(n.state)}</td>
  </tr>`).join('');
}

/* ══════════════════════════════════════════════════════
   EDGE HIT DETECTION
   ══════════════════════════════════════════════════════ */
function getEdgeAtPos(x, y) {
  const THRESHOLD = 8;
  for (const [a, b] of gEdges) {
    const na = gNodes[a], nb = gNodes[b]; if (!na || !nb) continue;
    const dx = nb.x - na.x, dy = nb.y - na.y;
    const lenSq = dx*dx + dy*dy;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - na.x)*dx + (y - na.y)*dy) / lenSq));
    const projX = na.x + t * dx, projY = na.y + t * dy;
    const dist  = Math.sqrt((x - projX)**2 + (y - projY)**2);
    if (dist < THRESHOLD) return [a, b];
  }
  return null;
}

/* ══════════════════════════════════════════════════════
   DRAGGABLE NODES + FIREWALL CLICK
   ══════════════════════════════════════════════════════ */
let dragNode = null, dragOffX = 0, dragOffY = 0;

function getCanvasPos(e) {
  const c    = gCvs();
  const rect = c.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function getNodeAtPos(x, y) {
  return [...gNodes].reverse().find(n => {
    const dx = n.x - x, dy = n.y - y;
    return Math.sqrt(dx*dx + dy*dy) <= 20;
  });
}

function onMouseDown(e) {
  e.preventDefault();
  const pos  = getCanvasPos(e);

  if (gFirewallMode) {
    const node = getNodeAtPos(pos.x, pos.y);
    if (!node) {
      const edge = getEdgeAtPos(pos.x, pos.y);
      if (edge) {
        const la = gNodes[edge[0]].lbl, lb = gNodes[edge[1]].lbl;
        wsSend({ action: 'firewall', node_a: la, node_b: lb });
      }
    }
    return;
  }

  const node = getNodeAtPos(pos.x, pos.y);
  if (node) {
    dragNode = node;
    dragOffX = pos.x - node.x;
    dragOffY = pos.y - node.y;
    gCvs().style.cursor = 'grabbing';
  }
}

function onMouseMove(e) {
  e.preventDefault();
  const c = gCvs(); if (!c) return;
  const pos = getCanvasPos(e);
  if (dragNode) {
    const padding = 20, W = c.offsetWidth, H = 320;
    dragNode.x = Math.max(padding, Math.min(W - padding, pos.x - dragOffX));
    dragNode.y = Math.max(padding, Math.min(H - padding, pos.y - dragOffY));
    drawGossip();
  } else {
    if (gFirewallMode) {
      c.style.cursor = getEdgeAtPos(pos.x, pos.y) ? 'crosshair' : 'default';
    } else {
      c.style.cursor = getNodeAtPos(pos.x, pos.y) ? 'grab' : 'default';
    }
  }
}

function onMouseUp() { dragNode = null; gCvs().style.cursor = 'default'; }

function attachCanvasEvents() {
  const c = gCvs(); if (!c) return;
  ['mousedown','mousemove','mouseup','mouseleave','touchstart','touchmove','touchend']
    .forEach(ev => c.removeEventListener(ev, ev === 'mousedown' ? onMouseDown
      : ev === 'mousemove' ? onMouseMove : onMouseUp));
  c.addEventListener('mousedown',  onMouseDown,  { passive: false });
  c.addEventListener('mousemove',  onMouseMove,  { passive: false });
  c.addEventListener('mouseup',    onMouseUp);
  c.addEventListener('mouseleave', onMouseUp);
  c.addEventListener('touchstart', onMouseDown,  { passive: false });
  c.addEventListener('touchmove',  onMouseMove,  { passive: false });
  c.addEventListener('touchend',   onMouseUp);
}

window.addEventListener('resize', () => {
  const gPage = document.getElementById('page-gossip');
  if (gPage && gPage.classList.contains('active')) initGossipCanvas();
});

console.log("gossip.js loaded — defense system, firewall, containment score ready");