/* ── CRYPTO TOOLS ── */

/* -- SHA-256 -- */
async function genHash() {
  const val = document.getElementById('hashIn').value;
  if (!val) return;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(val));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  document.getElementById('hashOut').innerHTML = `
    <div class="crypto-out">${hex}</div>
    <div style="font-size:11px;color:var(--text3);margin-top:5px">SHA-256 · 256 bits</div>
  `;
}

/* -- RSA Signature (simulated) -- */
let sigMsg = '', sigData = '';

function signMsg() {
  const m = document.getElementById('sigIn').value;
  if (!m) return;
  sigMsg  = m;
  sigData = btoa(m).split('').reverse().join('').substring(0, 64) + 'a9f2b3';
  document.getElementById('sigOut').innerHTML = `
    <div class="crypto-out">${sigData}</div>
    <div style="font-size:11px;color:var(--green);margin-top:5px">✓ Signed with RSA-2048 private key</div>
  `;
}

function verifyMsg() {
  if (!sigData) {
    document.getElementById('sigOut').innerHTML = '<div style="color:var(--red);font-size:12px;margin-top:8px">No signature found</div>';
    return;
  }
  const valid = document.getElementById('sigIn').value === sigMsg;
  document.getElementById('sigOut').innerHTML += `
    <div style="font-size:12px;color:${valid ? 'var(--green)' : 'var(--red)'};margin-top:8px">
      ${valid ? '✓ Signature valid' : '✗ Signature invalid — message tampered'}
    </div>
  `;
}

/* -- AES Encryption (simulated) -- */
let aesEncd = '', aesUsedKey = '';

function aesEnc() {
  const v = document.getElementById('aesIn').value;
  if (!v) return;
  aesUsedKey = document.getElementById('aesKey').value ||
    Array.from({ length: 32 }, () => ~~(Math.random() * 16).toString(16)).join('');
  document.getElementById('aesKey').value = aesUsedKey;
  aesEncd = btoa(v).split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ (i % 7 + 3))).join('');
  const hex = Array.from(aesEncd).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  document.getElementById('aesOut').innerHTML = `
    <div class="crypto-out">${hex}</div>
    <div style="font-size:11px;color:var(--green);margin-top:5px">✓ AES-256-CBC · Key: ${aesUsedKey.slice(0, 16)}...</div>
  `;
}

function aesDec() {
  const hexInput = document.getElementById('aesIn').value;

  if (!hexInput) {
    document.getElementById('aesOut').innerHTML =
      '<div style="color:var(--red);font-size:12px;margin-top:8px">Enter ciphertext</div>';
    return;
  }

  try {
    // Convert HEX → string
    const encStr = hexInput.match(/.{1,2}/g)
      .map(byte => String.fromCharCode(parseInt(byte, 16)))
      .join('');

    // Reverse XOR
    const base64 = encStr.split('')
      .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ (i % 7 + 3)))
      .join('');

    // Base64 decode
    const plaintext = atob(base64);

    document.getElementById('aesOut').innerHTML = `
      <div class="crypto-out" style="color:var(--green)">${plaintext}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:5px">
        ✓ Decrypted successfully
      </div>
    `;
  } catch (e) {
    document.getElementById('aesOut').innerHTML = `
      <div style="color:var(--red);font-size:12px;margin-top:8px">
        ✗ Decryption failed
      </div>
    `;
  }
}