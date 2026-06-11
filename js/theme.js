/* ── THEME ── */
let isDark = true;

function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const icon  = isDark ? '☀️' : '🌙';
  const label = isDark ? 'Light mode' : 'Dark mode';
  const ti = document.getElementById('themeIcon');
  const tl = document.getElementById('themeLabel');
  const ab = document.getElementById('authThemeBtn');
  if (ti) ti.textContent = icon;
  if (tl) tl.textContent = label;
  if (ab) ab.textContent = isDark ? '☀️' : '🌙';
  // redraw gossip canvas if active so colors update
  const gPage = document.getElementById('page-gossip');
  if (gPage && gPage.classList.contains('active')) drawGossip();
}
