
// /* ── THREAT CHECK ── */
// // change:  const API = ...
// window.API = window.API || 'http://localhost:8000/api';

// window.catBadge = window.catBadge || {
//   'malware':    '<span class="badge malware">MALWARE</span>',
//   'phishing':   '<span class="badge phishing">PHISHING</span>',
//   'suspicious': '<span class="badge suspicious">SUSPICIOUS</span>',
//   'safe':       '<span class="badge safe">SAFE</span>',
//   'unknown':    '<span class="badge unknown">UNKNOWN</span>'
// };

// let checkHistory = [];

// // Fill sample input (called from HTML onclick)
// function fillSample(v, t) {
//   document.getElementById('iVal').value = v;
//   document.getElementById('iType').value = t;
// }

// // Main check function (called from HTML onclick)
// async function runCheck() {
//   const val = document.getElementById('iVal').value.trim();
//   if (!val) return;

//   try {
//     const res = await fetch(`${API}/threat/check`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//        body: JSON.stringify({ 
//                 value: val,
//                 source_node: sourceNode  
//             })
//     });
    
//     const r = await res.json();
    
//     if (r.error) {
//       logSys('t-err', r.error);
//       return;
//     }
    
//    displayResult(val, r, sourceNode); 
//     addToHistory(val, r);
    
//     const status = r.reachable !== undefined ? (r.reachable ? ' [ONLINE]' : ' [OFFLINE]') : '';
//     logSys('t-ok', `Checked ${val} → ${r.cat.toUpperCase()} (${r.score})${status}`);
    
//   } catch (err) {
//     console.error('Threat check error:', err);
//     logSys('t-err', 'Backend not running - start Python: python backend/app.py');
//   }
// }

// function displayResult(val, r) {
//   const box = document.getElementById('checkResult');
//   if (!box) {
//     console.error('checkResult element not found');
//     return;
//   }
  
//   box.classList.add('show');
  
//   document.getElementById('res-val').textContent = val;
//   document.getElementById('res-badge').innerHTML = catBadge[r.cat] || catBadge['unknown'];
//   document.getElementById('res-reason').textContent = r.reason;
//   document.getElementById('res-score').textContent = r.score;

//   const col = r.score > 75 ? 'var(--red)' : r.score > 40 ? 'var(--orange)' : 'var(--green)';
//   const circle = document.getElementById('res-circle');
//   if (circle) {
//     circle.style.borderColor = col;
//     circle.style.color = col;
//   }

//   let meta = `
//     <div class="result-meta-item"><div class="result-meta-label">Country</div><div class="result-meta-val">${r.country || '??'}</div></div>
//     <div class="result-meta-item"><div class="result-meta-label">ASN</div><div class="result-meta-val">${r.asn || '—'}</div></div>
//     <div class="result-meta-item"><div class="result-meta-label">First Seen</div><div class="result-meta-val">${r.first || '—'}</div></div>
//     <div class="result-meta-item"><div class="result-meta-label">Last Seen</div><div class="result-meta-val">${r.last || 'today'}</div></div>
    
//         <div class="result-meta-item">
//             <div class="result-meta-label">Source Node</div>
//             <div class="result-meta-val" style="color:var(--accent)">${sourceNode}</div>
//         </div>
//         <!-- ... other meta ... -->
    
//   `;
  
//   if (r.reachable !== undefined) {
//     meta += `<div class="result-meta-item"><div class="result-meta-label">Status</div><div class="result-meta-val">${r.reachable ? '🟢 Online' : '🔴 Offline'}</div></div>`;
//   }
  
//   const metaEl = document.getElementById('res-meta');
//   if (metaEl) metaEl.innerHTML = meta;
// }

// window.addToHistoryOriginal = addToHistory;
// function addToHistory(val, r) {
//   checkHistory.unshift({ ind: val, cat: r.cat, score: r.score });
//   if (checkHistory.length > 8) checkHistory.pop();

//   const histEl = document.getElementById('checkHist');
//   if (!histEl) return;
  
//   histEl.innerHTML = checkHistory.map(h => `<tr>
//     <td class="mono" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.ind}</td>
//     <td>${catBadge[h.cat] || h.cat}</td>
//     <td class="mono">${h.score}</td>
//   </tr>`).join('');
// }

// // Verify loaded
// console.log("Threatcheck.js loaded - functions ready");


/* ── THREAT CHECK ── */
window.API = window.API || 'http://localhost:8000/api';
const API_KEY = 'sentra-dev-key';
let sourceNode = "N01";

window.catBadge = {
  'malware':    '<span class="badge malware">MALWARE</span>',
  'phishing':   '<span class="badge phishing">PHISHING</span>',
  'suspicious': '<span class="badge suspicious">SUSPICIOUS</span>',
  'safe':       '<span class="badge safe">SAFE</span>',
  'unknown':    '<span class="badge unknown">UNKNOWN</span>'
};

let checkHistory = [];

function fillSample(v, t) {
  document.getElementById('iVal').value = v;
  document.getElementById('iType').value = t;
}

async function runCheck() {
  const val = document.getElementById('iVal').value.trim();
  const nodeSelect = document.getElementById('sourceNode');
  sourceNode = nodeSelect ? nodeSelect.value : "N01";

  if (!val) return;

  try {
    const res = await fetch(`${window.API}/threat/check`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({ 
        value: val,
        source_node: sourceNode  
      })
    });

    const r = await res.json();

    if (!res.ok) {
      console.error("Backend error:", r);
      alert(r.detail || "Error from backend");
      return;
    }

    displayResult(val, r);
    addToHistory(val, r);

    const status = r.reachable !== undefined 
      ? (r.reachable ? ' [ONLINE]' : ' [OFFLINE]') 
      : '';

    console.log(`Checked ${val} → ${r.cat.toUpperCase()} (${r.score})${status}`);

  } catch (err) {
    console.error('Threat check error:', err);
    alert('Backend not running or CORS/API issue');
  }
}

function displayResult(val, r) {
  const box = document.getElementById('checkResult');
  if (!box) return;

  box.classList.add('show');

  document.getElementById('res-val').textContent = val;
  document.getElementById('res-badge').innerHTML = window.catBadge[r.cat?.toLowerCase()] || window.catBadge['unknown'];
  document.getElementById('res-reason').textContent = r.reason || '';
  document.getElementById('res-score').textContent = r.score;

  const col = r.score > 75 ? 'var(--red)' 
            : r.score > 40 ? 'var(--orange)' 
            : 'var(--green)';

  const circle = document.getElementById('res-circle');
  if (circle) {
    circle.style.borderColor = col;
    circle.style.color = col;
  }

  let meta = `
    <div class="result-meta-item">
      <div class="result-meta-label">Country</div>
      <div class="result-meta-val">${r.country || '??'}</div>
    </div>
    <div class="result-meta-item">
      <div class="result-meta-label">ASN</div>
      <div class="result-meta-val">${r.asn || '—'}</div>
    </div>
    <div class="result-meta-item">
      <div class="result-meta-label">First Seen</div>
      <div class="result-meta-val">${r.first || '—'}</div>
    </div>
    <div class="result-meta-item">
      <div class="result-meta-label">Last Seen</div>
      <div class="result-meta-val">${r.last || '—'}</div>
    </div>
    <div class="result-meta-item">
      <div class="result-meta-label">Source Node</div>
      <div class="result-meta-val" style="color:var(--accent)">${sourceNode}</div>
    </div>
  `;

  if (r.reachable !== undefined) {
    meta += `
      <div class="result-meta-item">
        <div class="result-meta-label">Status</div>
        <div class="result-meta-val">${r.reachable ? '🟢 Online' : '🔴 Offline'}</div>
      </div>
    `;
  }

  document.getElementById('res-meta').innerHTML = meta;
}
function addToHistory(val, r) {

  checkHistory.unshift({
    ind: val,
    cat: r.cat,
    score: r.score
  });

  const histEl = document.getElementById('checkHist');

  if (!histEl) {
    console.error('checkHist not found');
    return;
  }

  // clear old rows
  histEl.innerHTML = '';

  // create rows manually
  checkHistory.forEach(h => {

    const row = document.createElement('tr');

    row.innerHTML = `
      <td class="mono">${h.ind}</td>
      <td>${window.catBadge[h.cat?.toLowerCase()] || h.cat}</td>
      <td class="mono">${h.score}</td>
    `;

    histEl.appendChild(row);
    row.style.background = 'red';
  });

  console.log('History Updated:', checkHistory);
}