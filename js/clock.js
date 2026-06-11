/* ── CLOCK ── */
setInterval(() => {
  const c = document.getElementById('clock');
  if (c) c.textContent = new Date().toTimeString().slice(0, 8);
}, 1000);
