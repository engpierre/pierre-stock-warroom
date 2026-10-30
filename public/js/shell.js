// Dashboard Shell Script
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  loadPlugins();
});

function initClock() {
  const clockEl = document.getElementById('live-clock');
  function update() {
    const now = new Date();
    clockEl.textContent = now.toISOString().substring(11, 19) + ' UTC';
  }
  update();
  setInterval(update, 1000);
}

async function loadPlugins() {
  const container = document.getElementById('plugin-tabs-container');
  const frame = document.getElementById('plugin-frame');

  try {
    const res = await fetch('/api/plugins');
    const data = await res.json();
    const plugins = data.plugins || [];

    container.innerHTML = '';
    plugins.forEach((plugin, index) => {
      const btn = document.createElement('button');
      btn.className = `plugin-tab-btn ${index === 0 ? 'active' : ''}`;
      btn.innerHTML = `<span class="tab-icon">⚡</span> ${plugin.name}`;
      btn.onclick = () => {
        document.querySelectorAll('.plugin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        frame.src = plugin.route;
      };
      container.appendChild(btn);

      if (index === 0) {
        frame.src = plugin.route;
      }
    });
  } catch (err) {
    console.error('Failed to load plugins:', err);
    container.innerHTML = '<span style="color:#ef4444;font-size:0.8rem;">Plugin Load Error</span>';
  }
}
