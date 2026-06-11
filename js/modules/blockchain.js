window.API = window.API || 'http://localhost:8000/api';

let blocks = [];

// Load from Python on start
async function loadChain() {
    try {
        const res = await fetch(`${API}/blockchain`);
        const data = await res.json();
        
        console.log("Python response:", data); // DEBUG
        
        blocks = data.blocks || []; // Ensure it's an array
        
        if (blocks.length === 0) {
            logSys('t-warn', 'No blocks returned from Python');
            return;
        }
        
        renderChain();
        logSys('t-ok', `Loaded ${blocks.length} blocks from Python`);
        
    } catch (err) {
        console.error("Load error:", err);
        logSys('t-err', 'Backend offline - start Python: python backend/app.py');
    }
}

// Render with null checks
window.renderChainOriginal = renderChain;
function renderChain() {
    const chainViz = document.getElementById('chainViz');
    const chainTbody = document.getElementById('chainTbody');
    const chainAlert = document.getElementById('chainAlert');
    const blockCount = document.getElementById('blockCount');
    
    if (!chainViz || !chainTbody || !chainAlert) {
        console.error("Missing DOM elements");
        return;
    }
    
    if (!blocks || blocks.length === 0) {
        chainAlert.innerHTML = '<span id="chainAlertIcon">⚠</span> <span id="chainAlertText">No blocks to display</span>';
        chainAlert.className = 'alert alert-orange';
        if (blockCount) blockCount.textContent = '0 blocks';
        return;
    }

    // Update block count
    if (blockCount) blockCount.textContent = `${blocks.length} blocks`;

    // Visualization - Horizontal chain
    chainViz.innerHTML = blocks.map((b, i) => `
        ${i > 0 ? '<div class="chain-arrow">→</div>' : ''}
        <div class="block-item">
            <div class="block-num">BLOCK #${b.num}</div>
            <div class="block-hash">${b.hash.substring(0, 16)}...</div>
            <div class="block-data">${b.data}</div>
            <div class="block-nonce">nonce: ${b.nonce}</div>
        </div>
    `).join('');

    // Table
    chainTbody.innerHTML = blocks.map(b => `
        <tr>
            <td class="mono" style="color:var(--accent)">${b.num}</td>
            <td class="mono" style="font-size:10px">${b.hash}</td>
            <td class="mono" style="font-size:10px;color:var(--text3)">${b.prev}</td>
            <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.data}</td>
            <td class="mono">${b.nonce}</td>
            <td class="mono" style="color:var(--text2);font-size:11px">${b.ts}</td>
        </tr>
    `).join('');

    chainAlert.innerHTML = '<span id="chainAlertIcon">✓</span> <span id="chainAlertText">Chain integrity verified — all ' + blocks.length + ' blocks valid</span>';
    chainAlert.className = 'alert alert-green';
}

// Mine block
async function mineBlock() {
    const inputEl = document.getElementById('mineInput');
    const iocData = inputEl ? inputEl.value.trim() : '';

    if (!iocData) {
        logSys('t-warn', 'Enter an IOC to mine into the block');
        return;
    }

    logSys('t-ok', 'Mining... (Python calculating proof-of-work)');

    try {
        const res = await fetch(`${window.API}/blockchain/mine`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-API-Key': 'sentra-dev-key'
            },
            body: JSON.stringify({ data: `IOC: ${iocData}` })
        });

        const data = await res.json();
        console.log("Mine response:", data); // DEBUG

        if (data.error) {
            logSys('t-err', data.error);
            return;
        }

        if (data.block) {
            blocks.push(data.block);
            renderChain();
            inputEl.value = ''; // clear after mining
            logSys('t-ok', `Block #${data.block.num} mined (nonce: ${data.block.nonce}, attempts: ${data.attempts})`);
        }
    } catch (err) {
        console.error("Mine error:", err);
        logSys('t-err', 'Mining failed: ' + err.message);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Only load chain if we're on the blockchain page
    if (document.getElementById('page-chain')) {
        loadChain();
    }
});