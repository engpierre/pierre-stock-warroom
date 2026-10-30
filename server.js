const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3888;
const HOST = process.env.HOST || '127.0.0.1';

// Security Headers & OPSEC Hardening
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Restrict CORS strictly to local origins
const allowedOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:3888',
  'http://127.0.0.1:3888'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

// CSRF & Cross-Origin Validation for state-changing endpoints
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Forbidden: Cross-origin state modification rejected' });
    }
    if (referer) {
      const isLocalReferer = allowedOrigins.some(ao => referer.startsWith(ao));
      if (!isLocalReferer) {
        return res.status(403).json({ error: 'Forbidden: Invalid referer for state modification' });
      }
    }
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/d3', express.static(path.join(__dirname, 'node_modules', 'd3', 'dist')));

// Plugin Discovery System
const PAGES_DIR = path.join(__dirname, 'pages');

function discoverPlugins() {
  const plugins = [];
  if (!fs.existsSync(PAGES_DIR)) {
    return plugins;
  }

  const entries = fs.readdirSync(PAGES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pagePath = path.join(PAGES_DIR, entry.name);
      const pluginJsonPath = path.join(pagePath, 'plugin.json');
      let manifest = {
        id: entry.name,
        name: entry.name.charAt(0).toUpperCase() + entry.name.slice(1).replace(/-/g, ' '),
        description: 'Dashboard Page Plugin',
        icon: 'terminal',
        version: '1.0.0',
        order: 99
      };

      if (fs.existsSync(pluginJsonPath)) {
        try {
          const raw = fs.readFileSync(pluginJsonPath, 'utf8');
          manifest = { ...manifest, ...JSON.parse(raw) };
        } catch (err) {
          console.warn(`[Plugins] Warning: Failed to parse plugin.json for ${entry.name}:`, err.message);
        }
      }

      manifest.route = `/pages/${entry.name}`;
      plugins.push(manifest);

      // Mount static assets for each plugin page
      app.use(`/pages/${entry.name}`, express.static(pagePath));

      // Optional backend router for plugin
      const routerFile = path.join(pagePath, 'routes.js');
      if (fs.existsSync(routerFile)) {
        try {
          const pluginRouter = require(routerFile);
          app.use(`/api/plugins/${entry.name}`, pluginRouter);
          console.log(`[Plugins] Loaded API routes for plugin: ${entry.name}`);
        } catch (err) {
          console.error(`[Plugins] Error loading routes for ${entry.name}:`, err.message);
        }
      }
    }
  }

  // Sort by order
  plugins.sort((a, b) => (a.order || 99) - (b.order || 99));
  return plugins;
}

// Initialize plugins
const activePlugins = discoverPlugins();
console.log(`[Plugins] Discovered ${activePlugins.length} active page plugins:`, activePlugins.map(p => p.id));

// Core API Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    project: 'pierre-stock-warroom',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/plugins', (req, res) => {
  res.json({
    count: activePlugins.length,
    plugins: activePlugins
  });
});

// Global Error Handler — Redacts stack traces & prevents path fingerprinting
app.use((err, req, res, next) => {
  console.error('[WarRoom Server Error]:', err.message);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: err.message ? err.message.replace(/[a-zA-Z]:\\[^:\n\r\t,"]+/g, '[REDACTED_PATH]') : 'Unexpected error'
  });
});

// Start Server (Strict Localhost Binding)
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`\n======================================================`);
    console.log(`  PIERRE STOCK WAR ROOM — CORE GATEWAY ONLINE`);
    console.log(`  Bound Host: ${HOST} (Strict Localhost Isolation)`);
    console.log(`  Local URL : http://${HOST}:${PORT}`);
    console.log(`  Health API: http://${HOST}:${PORT}/api/health`);
    console.log(`  Plugins   : http://${HOST}:${PORT}/api/plugins`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
