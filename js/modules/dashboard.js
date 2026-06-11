
/* ── DASHBOARD — Live from WebSocket ── */

const DASH_WS = 'ws://localhost:8000/ws/gossip';

let dashWs;
let threatCounts = { malware: 0, phishing: 0, suspicious: 0, safe: 0, unknown: 0 };
let timeData     = { malware: Array(24).fill(0), phishing: Array(24).fill(0) };
let topIps       = [];
let distChart, timeChart, gaugeChart, sparklineChart;
let dashChartsBuilt = false;
let autoRefresh = true;
let soundEnabled = false;
let dateRange = '24h'; // '24h', '7d', '30d', 'all'
let nodeHistory = {}; // Store per-node history

/* ══ WEBSOCKET ══ */
function connectDashWS() {
  dashWs = new WebSocket(DASH_WS);

  dashWs.onopen = () => {
    logSys('t-ok', 'Dashboard connected to SENTRA backend');
  };

  dashWs.onmessage = (event) => {
    if (!autoRefresh) return;
    try {
      const msg  = JSON.parse(event.data);
      const hour = new Date().getHours();
      const now  = new Date().toISOString();

      switch(msg.type) {
        case 'infected':
          threatCounts.malware++;
          timeData.malware[hour]++;
          if (!nodeHistory[msg.node]) nodeHistory[msg.node] = [];
          nodeHistory[msg.node].push({ time: now, event: 'infected', score: msg.score });
          showToast('CRITICAL', `NODE ${msg.node} INFECTED — score ${msg.score}`, 'error');
          playAlert('high');
          logSys('t-err', `NODE ${msg.node} INFECTED — score ${msg.score}`);
          updateDashboardCharts();
          break;
        case 'immune':
          threatCounts.safe++;
          if (!nodeHistory[msg.node]) nodeHistory[msg.node] = [];
          nodeHistory[msg.node].push({ time: now, event: 'immune' });
          showToast('DEFENSE', `NODE ${msg.node} defended successfully`, 'success');
          logSys('t-ok', `NODE ${msg.node} immune — defended`);
          updateDashboardCharts();
          break;
        case 'quarantined':
          threatCounts.suspicious++;
          if (!nodeHistory[msg.node]) nodeHistory[msg.node] = [];
          nodeHistory[msg.node].push({ time: now, event: 'quarantined' });
          showToast('QUARANTINE', `NODE ${msg.node} isolated`, 'warning');
          logSys('t-warn', `NODE ${msg.node} QUARANTINED`);
          updateDashboardCharts();
          break;
        case 'hop':
          logSys('t-info', `Threat hopping: ${msg.from} → ${msg.to}`);
          break;
        case 'start':
          logSys('t-warn', `Gossip started at ${msg.node} — score ${msg.score}`);
          break;
        case 'complete':
          logSys('t-ok', `Gossip complete — containment: ${msg.containment}%`);
          logSys('t-info', `Infected: ${msg.total_reached} | Immune: ${msg.total_immune} | Quarantined: ${msg.total_quarantine}`);
          showToast('COMPLETE', `Propagation complete — ${msg.containment}% contained`, 'info');
          const blocksEl = document.querySelector('.stats-grid .stat-card:nth-child(5) .stat-value');
          if (blocksEl) blocksEl.textContent = parseInt(blocksEl.textContent) + 1;
          sendWebhook('propagation_complete', msg);
          break;
        case 'reset':
          threatCounts = { malware:0, phishing:0, suspicious:0, safe:0, unknown:0 };
          timeData     = { malware: Array(24).fill(0), phishing: Array(24).fill(0) };
          topIps       = [];
          nodeHistory  = {};
          buildTopIpTable();
          updateDashboardCharts();
          logSys('t-info', 'Dashboard reset');
          break;
        case 'firewall':
          logSys('t-warn', `Firewall updated on edge ${msg.edge} — containment: ${msg.containment}%`);
          break;
        case 'sync':
          if (msg.containment !== undefined) {
            updateGaugeChart(msg.containment);
          }
          break;
      }
    } catch(e) {
      console.error('Dashboard WS error:', e);
    }
  };

  dashWs.onclose = () => {
    logSys('t-warn', 'Backend disconnected — retrying in 3s...');
    setTimeout(connectDashWS, 3000);
  };

  dashWs.onerror = () => {
    logSys('t-err', 'WebSocket error — is Python backend running?');
  };
}

/* ══ TOAST NOTIFICATIONS ══ */
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer') || createToastContainer();
  const toast = document.createElement('div');
  const colors = {
    error:   '#ef4444',
    warning: '#f97316', 
    success: '#22c55e',
    info:    '#3b82f6'
  };
  
  toast.style.cssText = `
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 8px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideIn 0.3s ease;
    cursor: pointer;
    max-width: 320px;
  `;
  toast.innerHTML = `<strong>${title}</strong><br>${message}`;
  toast.onclick = () => toast.remove();
  
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function createToastContainer() {
  const div = document.createElement('div');
  div.id = 'toastContainer';
  div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;';
  document.body.appendChild(div);
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
  `;
  document.head.appendChild(style);
  return div;
}

/* ══ AUDIO ALERTS ══ */
function playAlert(severity) {
  if (!soundEnabled) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  const freqs = { low: 400, medium: 600, high: 800 };
  osc.frequency.value = freqs[severity] || 600;
  osc.type = 'sawtooth';
  
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

/* ══ WEBHOOK ALERTS ══ */
function sendWebhook(eventType, data) {
  const webhookUrl = localStorage.getItem('sentraWebhookUrl');
  if (!webhookUrl) return;
  
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'sentra-dashboard',
      event: eventType,
      timestamp: new Date().toISOString(),
      data: data
    })
  }).catch(e => console.log('Webhook failed:', e));
}

/* ══ THREAT CHECK HOOK ══ */
window.addToHistory = function(val, r) {
  if (typeof addToHistoryOriginal === 'function') addToHistoryOriginal(val, r);

  const hour = new Date().getHours();
  const cat  = r.cat || 'unknown';

  if (threatCounts[cat] !== undefined) threatCounts[cat]++;
  else threatCounts.unknown++;

  if (cat === 'malware')  timeData.malware[hour]++;
  if (cat === 'phishing') timeData.phishing[hour]++;

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(val)) {
    const existing = topIps.find(x => x.ip === val);
    if (existing) {
      existing.count++;
      existing.score = Math.max(existing.score, r.score);
      existing.cat   = r.cat;
    } else {
      topIps.push({ ip: val, count: 1, cat, score: r.score, country: r.country, asn: r.asn });
    }
    topIps.sort((a, b) => b.score - a.score);
    topIps = topIps.slice(0, 10);
    buildTopIpTable();
    if (r.lat && r.lon) addMapMarker(val, r.lat, r.lon, r.score);
  }
  updateDashboardCharts();
};

/* ══ BLOCKCHAIN HOOK ══ */
window.renderChain = function() {
  if (typeof renderChainOriginal === 'function') renderChainOriginal();
  if (window.blocks && window.blocks.length > 0) {
    const last = window.blocks[window.blocks.length - 1];
    logSys('t-ok', `Block #${last.num} mined — chain length: ${window.blocks.length}`);
  }
};

/* ══ TOP IPs TABLE ══ */
function buildTopIpTable() {
  const t = document.getElementById('topIpTbl2');
  if (!t) return;

  if (topIps.length === 0) {
    t.innerHTML = `<thead><tr>
      <th>IP Address</th><th>Count</th><th>Category</th><th>Score</th><th>Country</th><th>Actions</th>
    </tr></thead><tbody>
      <tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">
        No IPs checked yet — use Threat Check to populate
      </td></tr>
    </tbody>`;
    return;
  }

  t.innerHTML = `<thead><tr>
    <th>IP Address</th><th>Count</th><th>Category</th><th>Score</th><th>Country</th><th>Actions</th>
  </tr></thead><tbody>${
    topIps.map(r => {
      const col = r.score > 75 ? 'var(--red)' : r.score > 40 ? 'var(--orange)' : 'var(--green)';
      return `<tr>
        <td class="mono">${r.ip}</td>
        <td class="mono" style="color:var(--accent)">${r.count}</td>
        <td>${(window.catBadge && window.catBadge[r.cat]) || r.cat}</td>
        <td><span style="color:${col};font-family:'DM Mono',monospace;font-size:12px">${r.score}</span></td>
        <td>${r.country || '—'}</td>
        <td>
          <button onclick="blockIp('${r.ip}')" style="padding:4px 8px;font-size:11px;background:var(--red);color:white;border:none;border-radius:4px;cursor:pointer">Block</button>
          <button onclick="whitelistIp('${r.ip}')" style="padding:4px 8px;font-size:11px;background:var(--green);color:white;border:none;border-radius:4px;cursor:pointer;margin-left:4px">Allow</button>
        </td>
      </tr>`;
    }).join('')
  }</tbody>`;
}

function blockIp(ip) {
  logSys('t-warn', `IP ${ip} added to blocklist`);
  showToast('BLOCKED', `IP ${ip} blocked`, 'warning');
  if (dashWs && dashWs.readyState === WebSocket.OPEN) {
    dashWs.send(JSON.stringify({ action: 'block_ip', ip: ip }));
  }
}

function whitelistIp(ip) {
  logSys('t-ok', `IP ${ip} added to whitelist`);
  showToast('WHITELISTED', `IP ${ip} allowed`, 'success');
}

/* ══ SYSTEM LOG ══ */
const syslog = () => document.getElementById('syslog');

function logSys(cls, msg) {
  const t  = new Date().toTimeString().slice(0, 8);
  const el = syslog();
  if (!el) return;
  el.innerHTML += `<div><span class="t-time">[${t}]</span> <span class="${cls}">${msg}</span></div>`;
  el.scrollTop = el.scrollHeight;
}

/* ══ LOG FILTERING ══ */
function filterLogs(type) {
  const el = syslog();
  if (!el) return;
  const entries = el.querySelectorAll('div');
  entries.forEach(entry => {
    const span = entry.querySelector('span[class^="t-"]');
    if (!span) return;
    if (type === 'all' || span.classList.contains(type)) {
      entry.style.display = '';
    } else {
      entry.style.display = 'none';
    }
  });
}

function clearLogs() {
  const el = syslog();
  if (el) el.innerHTML = '';
}

/* ══ BUILD CHARTS ══ */
function buildCharts() {
  [distChart, timeChart, gaugeChart, sparklineChart].forEach(c => c && c.destroy());
  distChart = timeChart = gaugeChart = sparklineChart = null;

  const dc = document.getElementById('distChart');
  const tc = document.getElementById('timeChart');
  const gc = document.getElementById('gaugeChart');
  const sc = document.getElementById('sparklineChart');
  
  if (!dc || !tc) {
    requestAnimationFrame(buildCharts);
    return;
  }

  dc.style.display = 'block';
  tc.style.display = 'block';
  if (gc) gc.style.display = 'block';
  if (sc) sc.style.display = 'block';

  const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor  = isDarkMode ? '#8a9ab0' : '#4a5568';
  const gridColor  = isDarkMode ? '#2a3040' : '#dde2ea';

  distChart = new Chart(dc, {
    type: 'doughnut',
    data: {
      labels: ['Malware', 'Phishing', 'Suspicious', 'Safe', 'Unknown'],
      datasets: [{
        data: [
          threatCounts.malware,
          threatCounts.phishing,
          threatCounts.suspicious,
          threatCounts.safe,
          threatCounts.unknown
        ],
        backgroundColor: ['#ef4444','#f97316','#eab308','#22c55e','#a855f7'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: textColor,
            font: { family: 'DM Sans', size: 12 },
            padding: 10,
            boxWidth: 10
          }
        }
      }
    }
  });

  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  timeChart = new Chart(tc, {
    type: 'line',
    data: {
      labels: hours,
      datasets: [
        {
          label: 'Malware',
          data: [...timeData.malware],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.06)',
          borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true
        },
        {
          label: 'Phishing',
          data: [...timeData.phishing],
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.06)',
          borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: textColor,
            font: { family: 'DM Sans', size: 12 },
            boxWidth: 8
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 8 },
          grid:  { color: gridColor }
        },
        y: {
          ticks: { color: textColor, font: { size: 10 } },
          grid:  { color: gridColor }
        }
      }
    }
  });

  if (gc) {
    gaugeChart = new Chart(gc, {
      type: 'doughnut',
      data: {
        labels: ['Contained', 'At Risk'],
        datasets: [{
          data: [85, 15],
          backgroundColor: ['#22c55e', '#ef4444'],
          borderWidth: 0,
          cutout: '70%'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        circumference: 180,
        rotation: 270,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
  }

  if (sc) {
    sparklineChart = new Chart(sc, {
      type: 'line',
      data: {
        labels: Array(20).fill(''),
        datasets: [{
          data: Array(20).fill(0),
          borderColor: '#3b82f6',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  }

  dashChartsBuilt = true;
  console.log('✅ Dashboard charts built');
}

/* ══ UPDATE CHARTS ══ */
function updateDashboardCharts() {
  localStorage.setItem('sentraDashData', JSON.stringify({ 
    threatCounts, timeData, topIps, nodeHistory, dateRange 
  }));

  if (!dashChartsBuilt) return;

  const filtered = filterDataByRange();

  if (distChart) {
    distChart.data.datasets[0].data = [
      filtered.malware,
      filtered.phishing,
      filtered.suspicious,
      filtered.safe,
      filtered.unknown
    ];
    distChart.update();
  }

  if (timeChart) {
    timeChart.data.datasets[0].data = [...filtered.malwareSeries];
    timeChart.data.datasets[1].data = [...filtered.phishingSeries];
    timeChart.update();
  }

  if (sparklineChart) {
    const recent = sparklineChart.data.datasets[0].data;
    recent.shift();
    recent.push(filtered.malware + filtered.phishing);
    sparklineChart.update('none');
  }

  const total = filtered.malware + filtered.phishing + filtered.suspicious + filtered.safe + filtered.unknown;
  const totalEl    = document.querySelector('.stats-grid .stat-card:nth-child(1) .stat-value');
  const malwareEl  = document.querySelector('.stats-grid .stat-card:nth-child(2) .stat-value');
  const phishingEl = document.querySelector('.stats-grid .stat-card:nth-child(3) .stat-value');

  if (totalEl    && total > 0)                   totalEl.textContent    = (1847 + total).toLocaleString();
  if (malwareEl  && filtered.malware > 0)       malwareEl.textContent  = 342 + filtered.malware;
  if (phishingEl && filtered.phishing > 0)      phishingEl.textContent = 189 + filtered.phishing;
}

function updateGaugeChart(containmentScore) {
  if (!gaugeChart) return;
  gaugeChart.data.datasets[0].data = [containmentScore, 100 - containmentScore];
  gaugeChart.update();
}

function filterDataByRange() {
  if (dateRange === 'all') return { 
    malware: threatCounts.malware, phishing: threatCounts.phishing,
    suspicious: threatCounts.suspicious, safe: threatCounts.safe, unknown: threatCounts.unknown,
    malwareSeries: timeData.malware, phishingSeries: timeData.phishing
  };
  return { 
    malware: threatCounts.malware, phishing: threatCounts.phishing,
    suspicious: threatCounts.suspicious, safe: threatCounts.safe, unknown: threatCounts.unknown,
    malwareSeries: timeData.malware, phishingSeries: timeData.phishing
  };
}

/* ══ DATA EXPORT ══ */
function exportData(format = 'json') {
  const data = {
    exported_at: new Date().toISOString(),
    date_range: dateRange,
    threat_counts: threatCounts,
    time_series: timeData,
    top_ips: topIps,
    node_history: nodeHistory
  };
  
  if (format === 'json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `sentra-export-${Date.now()}.json`);
  } else if (format === 'csv') {
    const csv = convertToCsv(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, `sentra-export-${Date.now()}.csv`);
  }
  
  logSys('t-ok', `Data exported as ${format.toUpperCase()}`);
  showToast('EXPORT', `Data exported as ${format.toUpperCase()}`, 'success');
}

function convertToCsv(data) {
  let csv = 'Type,Category,Count,Timestamp\n';
  csv += `Threat,Malware,${data.threat_counts.malware},${data.exported_at}\n`;
  csv += `Threat,Phishing,${data.threat_counts.phishing},${data.exported_at}\n`;
  csv += `Threat,Suspicious,${data.threat_counts.suspicious},${data.exported_at}\n`;
  csv += `Threat,Safe,${data.threat_counts.safe},${data.exported_at}\n`;
  csv += `IP,Top Scored,,${data.exported_at}\n`;
  data.top_ips.forEach(ip => {
    csv += `IP,${ip.ip},${ip.score},${ip.cat}\n`;
  });
  return csv;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ══ SETTINGS PANEL ══ */
function toggleAutoRefresh() {
  autoRefresh = !autoRefresh;
  const btn = document.getElementById('autoRefreshBtn');
  if (btn) {
    btn.textContent = autoRefresh ? '⏸ Pause' : '▶ Resume';
    btn.style.background = autoRefresh ? 'var(--orange)' : 'var(--green)';
  }
  logSys('t-info', `Auto-refresh ${autoRefresh ? 'enabled' : 'disabled'}`);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('soundBtn');
  if (btn) {
    btn.textContent = soundEnabled ? '🔊 Sound On' : '🔇 Sound Off';
    btn.style.opacity = soundEnabled ? '1' : '0.6';
  }
  logSys('t-info', `Sound alerts ${soundEnabled ? 'enabled' : 'disabled'}`);
}

function setDateRange(range) {
  dateRange = range;
  const btn = document.getElementById('rangeBtn');
  if (btn) btn.textContent = `📅 ${range}`;
  updateDashboardCharts();
  logSys('t-info', `Date range set to ${range}`);
}

function setWebhook() {
  const url = prompt('Enter webhook URL (or clear to disable):', localStorage.getItem('sentraWebhookUrl') || '');
  if (url !== null) {
    if (url) {
      localStorage.setItem('sentraWebhookUrl', url);
      logSys('t-ok', 'Webhook configured');
      showToast('SETTINGS', 'Webhook configured', 'success');
    } else {
      localStorage.removeItem('sentraWebhookUrl');
      logSys('t-info', 'Webhook disabled');
    }
  }
}

/* ══ GEOLOCATION MAP ══ */
let mapMarkers = [];
function initGeoMap() {
  const mapEl = document.getElementById('geoMap');
  if (!mapEl || !window.L) return;
  
  const map = L.map('geoMap').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);
  
  window.sentraMap = map;
}

function addMapMarker(ip, lat, lon, score) {
  if (!window.sentraMap) return;
  const color = score > 75 ? 'red' : score > 40 ? 'orange' : 'yellow';
  const marker = L.circleMarker([lat, lon], {
    radius: 8,
    fillColor: color,
    color: '#fff',
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8
  }).addTo(window.sentraMap);
  marker.bindPopup(`<b>${ip}</b><br>Score: ${score}`);
  mapMarkers.push(marker);
}

/* ══ NODE DRILL-DOWN ══ */
function showNodeDetails(nodeId) {
  const history = nodeHistory[nodeId] || [];
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 10001; display: flex;
    align-items: center; justify-content: center;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: var(--bg, #1a1d23); padding: 24px; border-radius: 12px;
    max-width: 500px; max-height: 80vh; overflow-y: auto;
    font-family: 'DM Sans', sans-serif; color: var(--text, #e2e8f0);
  `;
  
  content.innerHTML = `
    <h3 style="margin-top:0">${nodeId} History</h3>
    ${history.length === 0 ? '<p>No events recorded</p>' : 
      `<ul style="list-style:none;padding:0">${history.map(h => `
        <li style="padding:8px 0;border-bottom:1px solid var(--border,#2a3040)">
          <span style="color:var(--muted,#8a9ab0);font-size:12px">${new Date(h.time).toLocaleString()}</span><br>
          <span style="color:${h.event === 'infected' ? 'var(--red)' : h.event === 'immune' ? 'var(--green)' : 'var(--orange)'}">
            ${h.event.toUpperCase()}
          </span>
          ${h.score ? `<span style="color:var(--muted)"> — score ${h.score}</span>` : ''}
        </li>
      `).join('')}</ul>`
    }
    <button onclick="this.closest('.modal').remove()" style="
      margin-top:16px;padding:8px 16px;background:var(--accent,#3b82f6);
      color:white;border:none;border-radius:6px;cursor:pointer
    ">Close</button>
  `;
  
  modal.className = 'modal';
  modal.appendChild(content);
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

/* ══ MULTI-TAB SYNC ══ */
window.addEventListener('storage', (e) => {
  if (e.key === 'sentraDashData') {
    try {
      const d = JSON.parse(e.newValue);
      threatCounts = d.threatCounts || threatCounts;
      timeData = d.timeData || timeData;
      topIps = d.topIps || topIps;
      nodeHistory = d.nodeHistory || nodeHistory;
      updateDashboardCharts();
      buildTopIpTable();
    } catch(err) {}
  }
});

/* ══ THEME AUTO-DETECT ══ */
function detectSystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', detectSystemTheme);

/* ══ INIT ══ */
function buildSyslog() {
  const saved = localStorage.getItem('sentraDashData');
  if (saved) {
    try {
      const d = JSON.parse(saved);
      threatCounts = d.threatCounts || threatCounts;
      timeData     = d.timeData     || timeData;
      topIps       = d.topIps       || topIps;
      nodeHistory  = d.nodeHistory  || nodeHistory;
      dateRange    = d.dateRange    || dateRange;
    } catch(e) {}
  }

  detectSystemTheme();
  buildTopIpTable();
  logSys('t-ok',   'SENTRA Dashboard live');
  logSys('t-info', 'Connecting to backend...');
  connectDashWS();
  initGeoMap();

  setTimeout(() => {
    buildCharts();
    updateDashboardCharts();
    buildTopIpTable();
  }, 60);
}

document.addEventListener('DOMContentLoaded', () => {
  const _origGoto = window.gotoPage;
  window.gotoPage = function(page, el) {
    if (typeof _origGoto === 'function') _origGoto(page, el);
    if (page === 'dashboard') {
      setTimeout(() => {
        buildCharts();
        updateDashboardCharts();
        buildTopIpTable();
      }, 60);
    }
  };
});
