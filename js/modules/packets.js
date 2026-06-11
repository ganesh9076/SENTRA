/* ── PACKET MONITOR ── */
let pCapture = null, pt = 0, pu = 0, pw = 0, ps = 0;

const pktSamples = [
  { src: '192.168.1.10', dst: '185.220.101.45',  proto: 'TCP',   info: 'SYN → known C2 server',        cls: 'unsafe' },
  { src: '10.0.0.5',     dst: '8.8.8.8',          proto: 'DNS',   info: 'Query: google.com',             cls: ''       },
  { src: '192.168.1.12', dst: '91.108.4.0',        proto: 'UDP',   info: 'Outbound on port 4444',        cls: 'warn'   },
  { src: '10.0.0.5',     dst: '172.217.14.196',    proto: 'HTTPS', info: 'TLS 1.3 session',              cls: ''       },
  { src: '192.168.1.10', dst: '198.51.100.77',     proto: 'HTTP',  info: 'GET /payload.exe — PLAINTEXT', cls: 'unsafe' },
  { src: '10.0.0.8',     dst: '1.1.1.1',           proto: 'DNS',   info: 'Query: safe-site.org',         cls: ''       },
  { src: '192.168.1.15', dst: '103.224.182.250',   proto: 'TCP',   info: 'Data exfiltration pattern',    cls: 'unsafe' },
  { src: '10.0.0.2',     dst: '142.250.0.1',       proto: 'HTTPS', info: 'Normal HTTPS traffic',         cls: ''       },
];

function startCapture() {
  document.getElementById('captureBtn').disabled = true;
  document.getElementById('stopBtn').disabled    = false;
  pCapture = setInterval(() => {
    const p    = pktSamples[~~(Math.random() * pktSamples.length)];
    const t    = new Date().toTimeString().slice(0, 8);
    pt++;
    if      (p.cls === 'unsafe') pu++;
    else if (p.cls === 'warn')   pw++;
    else                         ps++;
    const feed = document.getElementById('pktFeed');
    const pcls = `proto-${p.proto.toLowerCase()}`;
    const icol = p.cls === 'unsafe' ? 'var(--red)' : p.cls === 'warn' ? 'var(--orange)' : 'var(--text)';
    feed.innerHTML += `<div class="pkt-row ${p.cls}">
      <span class="t-time">${t}</span>
      <span>${p.src}</span>
      <span>${p.dst}</span>
      <span class="proto ${pcls}">${p.proto}</span>
      <span style="color:${icol}">${p.info}</span>
    </div>`;
    feed.scrollTop = feed.scrollHeight;
    document.getElementById('pt').textContent = pt;
    document.getElementById('pu').textContent = pu;
    document.getElementById('pw').textContent = pw;
    document.getElementById('ps').textContent = ps;
  }, 700);
}

function stopCapture() {
  clearInterval(pCapture);
  document.getElementById('captureBtn').disabled = false;
  document.getElementById('stopBtn').disabled    = true;
}

function clearPkts() {
  document.getElementById('pktFeed').innerHTML = '';
  pt = pu = pw = ps = 0;
  ['pt', 'pu', 'pw', 'ps'].forEach(id => document.getElementById(id).textContent = 0);
}
