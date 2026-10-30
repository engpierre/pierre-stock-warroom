// Overview Client Script
document.addEventListener('DOMContentLoaded', () => {
  // Fetch Health
  fetch('/api/health')
    .then(res => res.json())
    .then(data => {
      const el = document.getElementById('gateway-status');
      if (el) {
        el.textContent = `${data.status} [${Math.floor(data.uptime)}s]`;
      }
    })
    .catch(err => {
      const el = document.getElementById('gateway-status');
      if (el) {
        el.textContent = 'OFFLINE';
        el.style.color = '#ef4444';
      }
    });

  // Render D3 Clusters Bar Chart
  renderClusterChart();
});

function renderClusterChart() {
  const container = document.getElementById('radar-chart');
  if (!container || !window.d3) return;

  const clusterData = [
    { name: 'Defense & Gov', count: 5 },
    { name: 'Energy & Pipes', count: 6 },
    { name: 'Power & Util', count: 3 },
    { name: 'Healthcare', count: 6 },
    { name: 'Nuclear & U', count: 4 },
    { name: 'Big Tech', count: 6 },
    { name: 'Next-Gen & AI', count: 5 },
    { name: 'Crypto & Comm', count: 5 }
  ];

  const width = Math.min(container.clientWidth || 600, 700);
  const height = 240;
  const margin = { top: 20, right: 30, bottom: 40, left: 120 };

  const svg = d3.select('#radar-chart')
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  const x = d3.scaleLinear()
    .domain([0, 8])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(clusterData.map(d => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.2);

  svg.append('g')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8))
    .attr('color', '#64748b');

  svg.append('g')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y))
    .attr('color', '#94a3b8');

  svg.selectAll('rect')
    .data(clusterData)
    .enter()
    .append('rect')
    .attr('x', margin.left)
    .attr('y', d => y(d.name))
    .attr('width', d => x(d.count) - margin.left)
    .attr('height', y.bandwidth())
    .attr('fill', '#38bdf8')
    .attr('rx', 4)
    .attr('opacity', 0.85);

  svg.selectAll('.bar-label')
    .data(clusterData)
    .enter()
    .append('text')
    .attr('x', d => x(d.count) + 8)
    .attr('y', d => y(d.name) + y.bandwidth() / 2 + 4)
    .text(d => `${d.count} Assets`)
    .attr('fill', '#f1f5f9')
    .attr('font-size', '11px')
    .attr('font-family', 'monospace');
}
