/* ── ROUTER ── */
const pageTitles = {
  dashboard : 'Dashboard',
  feed      : 'Threat Feed',
  check     : 'Threat Check',
  gossip    : 'Gossip Network',
  nodes     : 'Node Manager',
  chain     : 'Blockchain Ledger',
  packets   : 'Packet Monitor',
  crypto    : 'Crypto Tools',
  about     : 'Team Details'
};

async function loadAboutUs(element) {
    try {
        // 1. Fetch the content from the separate file
        const response = await fetch('about.html');
        const html = await response.text();

        // 2. Identify your main display area
        // In your system, this is likely where other pages (gossip, blockchain) render
        const container = document.getElementById('page-about'); 
        
        if (container) {
            container.innerHTML = html;
        }

        // 3. Use your existing routing logic to switch the view
        // This ensures the sidebar highlights correctly and other pages hide
        if (typeof gotoPage === 'function') {
            gotoPage('about', element);
        }
    } catch (error) {
        console.error('Error loading the About Us page:', error);
    }
}

function gotoPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  el.classList.add('active');
  document.getElementById('pageTitle').textContent = pageTitles[id] || id;

  if (id === 'gossip')  setTimeout(initGossipCanvas, 50);
  if (id === 'chain')   renderChain();
  if (id === 'nodes')   renderNodes();
  if (id === 'feed')    renderFeed();
}
