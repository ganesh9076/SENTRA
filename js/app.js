/* ── APP INIT ── */
function initApp() {
  buildSyslog();
  buildTopIpTable();
  renderFeed();
  renderNodes();
  setTimeout(buildCharts, 100);
}
