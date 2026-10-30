const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORTFOLIO_PATH = path.join(__dirname, '..', '..', 'data', 'portfolio_40.json');
const SCRAPER_DIR = 'C:\\Anti-Gravity-Core\\pierre_openclaw_sentiment_scraper';
const PYTHON_EXE = path.join(SCRAPER_DIR, '.venv', 'Scripts', 'python.exe');
const FORUM_SCRIPT = path.join(SCRAPER_DIR, 'synthesis', 'agent_forum.py');
const SENTIMENT_PATH = path.join(SCRAPER_DIR, 'shared_signals', 'crowd_sentiment.json');

// Julie OpenClaw Workspace Paths
const VAULT_DIR = 'C:\\Users\\Pierre\\.openclaw\\workspace\\vault';
const VAULT_RECONS_DIR = path.join(VAULT_DIR, 'Recons');
const VAULT_ARCHIVE_DIR = path.join(VAULT_RECONS_DIR, '_Archive');
const VAULT_INDEX_PATH = path.join(VAULT_DIR, 'VAULT-INDEX.md');
const WATCHLIST_PATH = path.join(SCRAPER_DIR, 'shared_signals', 'watchlist.txt');
const CHRONOS_INTEL_PATH = 'C:\\Users\\Pierre\\.openclaw\\workspace\\chronos_intel_buffer.json';
const SCOUT_INTEL_PATH = 'C:\\Users\\Pierre\\.openclaw\\workspace\\scout_intel_buffer.json';
const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'gemma4:26b';
const LOCAL_CHRONOS_BUFFER_PATH = path.join(__dirname, '..', '..', 'data', 'chronos_intel_buffer.json');

// Security & OPSEC Sanitization Helpers
function sanitizeTicker(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase().replace(/^\$/, '');
  // Disallow path traversal characters and enforce standard ticker format (1-10 alphanumeric, optional dot or dash)
  if (!/^[A-Z0-9]{1,6}([.-][A-Z0-9]{1,4})?$/.test(cleaned) || cleaned.includes('..') || cleaned.includes('/') || cleaned.includes('\\')) {
    return null;
  }
  return cleaned;
}

function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'Internal server error';
  // Strip Windows and POSIX absolute filesystem paths to prevent path fingerprinting
  return msg
    .replace(/[a-zA-Z]:\\[^:\n\r\t,"]+/g, '[REDACTED_PATH]')
    .replace(/\/(?:Users|home|Anti-Gravity-Core|var|etc)\/[^\s,"]+/g, '[REDACTED_PATH]');
}

// Dynamic Foundation Model (TimesFM / Chronos) Buffer Reader
function getChronosIntelBuffer() {
  const paths = [CHRONOS_INTEL_PATH, LOCAL_CHRONOS_BUFFER_PATH];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && (parsed.forecasts || parsed.active_ticker)) {
          return parsed;
        }
      }
    } catch (e) {}
  }
  return { forecasts: {} };
}

// Spawns scripts/run_gpu_forecasts.py asynchronously or awaited
function runGpuForecastsAsync(options = {}) {
  const { scope = 'owned', ticker = null } = options;
  const safeScope = ['owned', 'all', 'single'].includes(scope) ? scope : 'owned';
  const safeTicker = ticker ? sanitizeTicker(ticker) : null;
  const pythonExec = 'C:\\Users\\Pierre\\.openclaw\\workspace\\Julie-Core\\.venv\\Scripts\\python.exe';
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'run_gpu_forecasts.py');

  const args = [scriptPath];
  if (safeScope === 'owned') {
    args.push('--active-only');
  } else if (safeScope === 'all') {
    args.push('--all-universe');
  } else if (safeScope === 'single' && safeTicker) {
    args.push('--tickers', safeTicker);
  } else {
    args.push('--active-only');
  }

  return new Promise((resolve) => {
    const proc = spawn(pythonExec, args, {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      quantMetricsCache = {};
      resolve({ success: code === 0, code, stdout, stderr });
    });

    proc.on('error', err => {
      quantMetricsCache = {};
      resolve({ success: false, error: err.message });
    });
  });
}

// In-memory 60s RAM price cache
let priceCache = {
  timestamp: 0,
  quotes: {}
};

// In-memory active scan state
let activeScan = {
  isScanning: false,
  clusterId: null,
  clusterName: null,
  tickers: [],
  startedAt: null,
  lastCompletedAt: null,
  lastError: null
};

// Dynamic Universe Resolvers (100% Ticker-Agnostic)
function getUniverseData() {
  try {
    if (fs.existsSync(PORTFOLIO_PATH)) {
      return JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[WarRoom Universe] Failed to read portfolio_40.json:', e.message);
  }
  return { assets: [], clusters: [] };
}

function getUniverseAssets() {
  return getUniverseData().assets || [];
}

function getUniverseTickers() {
  return getUniverseAssets().map(a => a.ticker);
}

// Dynamic In-Memory Phonetic STT & Company-to-Ticker Normalization Map
let dynamicPhoneticMap = null;
let lastDynamicMapBuild = 0;

function getDynamicPhoneticMap() {
  const now = Date.now();
  if (dynamicPhoneticMap && (now - lastDynamicMapBuild < 60000)) {
    return dynamicPhoneticMap;
  }

  const baseMap = {
    // OpenClaw variations
    'open clara': 'OpenClaw',
    'open claude': 'OpenClaw',
    'open clock': 'OpenClaw',
    'open cloud': 'OpenClaw',
    'open claw': 'OpenClaw',
    'ask clara': 'OpenClaw',
    'ask claw': 'OpenClaw',
    'open clow': 'OpenClaw',
    'open clear': 'OpenClaw',
    'open close': 'OpenClaw',
    'open call': 'OpenClaw',
    'open clone': 'OpenClaw',
    'open cloth': 'OpenClaw',
    'open club': 'OpenClaw',
    'open clock swarm': 'OpenClaw Swarm',
    'julia': 'Julie',
    'war room': 'War Room',
    'time fm': 'TimesFM',
    'times fm': 'TimesFM',
    'kronos': 'Chronos',
    'chronos': 'Chronos'
  };

  const assets = getUniverseAssets();
  assets.forEach(a => {
    const t = a.ticker.toUpperCase();
    baseMap[t.toLowerCase()] = t;
    if (t === 'BTC-USD') {
      baseMap['bitcoin'] = 'BTC-USD';
      baseMap['btc'] = 'BTC-USD';
    }
    if (a.name) {
      const rawName = a.name.toLowerCase().trim();
      baseMap[rawName] = t;
      const stripped = rawName
        .replace(/[,.]/g, '')
        .replace(/\b(inc|corp|corporation|ltd|co|holdings|company|companies|plc|a\/s|etf|class [a-z])\b/gi, '')
        .trim();
      if (stripped && stripped.length > 2) {
        baseMap[stripped] = t;
      }
    }
  });

  dynamicPhoneticMap = baseMap;
  lastDynamicMapBuild = now;
  return dynamicPhoneticMap;
}

function rebuildDynamicUniverseMap() {
  dynamicPhoneticMap = null;
  getDynamicPhoneticMap();
}

// ========================================================
// PHASE 8: CROSS-SYSTEM OBSIDIAN & WATCHLIST SYNC ENGINE
// ========================================================

function syncWatchlistFile(portfolio) {
  try {
    let lines = ['# Pierre War Room Universe - Thematic Clusters', ''];
    (portfolio.clusters || []).forEach(c => {
      const clusterAssets = (portfolio.assets || []).filter(a => a.cluster_id === c.id);
      lines.push(`# Cluster ${c.id}: ${c.name} (${clusterAssets.length})`);
      clusterAssets.forEach(a => lines.push(a.ticker));
      lines.push('');
    });
    fs.writeFileSync(WATCHLIST_PATH, lines.join('\n'), 'utf8');
    console.log('[WarRoom Sync] Updated shared_signals/watchlist.txt with ' + portfolio.assets.length + ' assets');
  } catch (e) {
    console.warn('[WarRoom Sync] Failed to update watchlist.txt:', e.message);
  }
}

function pruneCrowdSentiment(ticker) {
  try {
    if (fs.existsSync(SENTIMENT_PATH)) {
      const data = JSON.parse(fs.readFileSync(SENTIMENT_PATH, 'utf8'));
      if (data.assets && data.assets[ticker]) {
        delete data.assets[ticker];
        data.timestamp = new Date().toISOString();
        fs.writeFileSync(SENTIMENT_PATH, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[WarRoom Sync] Pruned ${ticker} from crowd_sentiment.json`);
      }
    }
  } catch (e) {
    console.warn(`[WarRoom Sync] Error pruning sentiment for ${ticker}:`, e.message);
  }
}

function archiveObsidianVaultRecon(ticker) {
  try {
    const safeTicker = sanitizeTicker(ticker);
    if (!safeTicker) return;
    const reconFile = path.normalize(path.join(VAULT_RECONS_DIR, `${safeTicker}.md`));
    if (!reconFile.startsWith(path.normalize(VAULT_RECONS_DIR))) {
      console.warn(`[Vault Sync] Path traversal blocked: ${reconFile}`);
      return;
    }
    if (fs.existsSync(reconFile)) {
      if (!fs.existsSync(VAULT_ARCHIVE_DIR)) {
        fs.mkdirSync(VAULT_ARCHIVE_DIR, { recursive: true });
      }
      const archiveTarget = path.normalize(path.join(VAULT_ARCHIVE_DIR, `${safeTicker}.md`));
      if (!archiveTarget.startsWith(path.normalize(VAULT_ARCHIVE_DIR))) return;
      fs.copyFileSync(reconFile, archiveTarget);
      fs.unlinkSync(reconFile);
      console.log(`[Vault Sync] Archived ${safeTicker}.md into Recons/_Archive/`);
    }
    updateVaultIndex();
  } catch (e) {
    console.warn(`[Vault Sync] Error archiving ${ticker}:`, sanitizeErrorMessage(e.message));
  }
}

function syncObsidianVaultRecon(dossier) {
  try {
    if (!fs.existsSync(VAULT_RECONS_DIR)) {
      fs.mkdirSync(VAULT_RECONS_DIR, { recursive: true });
    }
    const safeTicker = sanitizeTicker(dossier.ticker);
    if (!safeTicker) {
      console.warn(`[Vault Sync] Invalid ticker symbol skipped for vault sync: ${dossier.ticker}`);
      return;
    }
    const filePath = path.normalize(path.join(VAULT_RECONS_DIR, `${safeTicker}.md`));
    if (!filePath.startsWith(path.normalize(VAULT_RECONS_DIR))) {
      console.warn(`[Vault Sync] Path traversal attempt blocked: ${filePath}`);
      return;
    }
    const ticker = safeTicker;

    const spot = dossier.spot_price || 0;
    const atr14 = dossier.atr_14 || parseFloat((spot * 0.025).toFixed(2));
    const atrPct = dossier.atr_14_pct || parseFloat(((atr14 / (spot || 1)) * 100).toFixed(2));
    const dynamicStop = dossier.dynamic_stop_2atr || parseFloat((spot - 2 * atr14).toFixed(2));
    const upsideTarget = dossier.upside_target_3atr || parseFloat((spot + 3 * atr14).toFixed(2));
    const expectedMove5d = dossier.expected_move_5d || parseFloat((atr14 * Math.sqrt(5)).toFixed(2));
    const coneUpper5d = dossier.cone_upper_5d || parseFloat((spot + expectedMove5d).toFixed(2));
    const coneLower5d = dossier.cone_lower_5d || parseFloat((spot - expectedMove5d).toFixed(2));
    const conePct = dossier.cone_pct || parseFloat(((expectedMove5d / (spot || 1)) * 100).toFixed(2));
    const sma20 = dossier.sma_20 || parseFloat((spot * 0.98).toFixed(2));
    const smaRegime = dossier.sma_regime || 'ABOVE_20SMA';
    const sentimentRegime = dossier.sentiment_regime || 'UNSCANNED';
    const riskMod = dossier.risk_modifier || 1.0;
    const shares = dossier.shares || 0;
    const name = dossier.name || ticker;
    const clusterName = dossier.cluster_name || 'Watchlist';
    const changePct = dossier.change_24h_pct || 0;
    const netBias = dossier.net_bias || (sentimentRegime.includes('BULLISH') ? 'BULLISH_CONFLUENCE' : 'STEADY_ACCUMULATION');

    const content = `---
ticker: "${ticker}"
name: "${name}"
cluster: "${clusterName}"
shares: ${shares}
spot_price: ${spot}
change_24h_pct: ${changePct}
atr_14: ${atr14}
atr_14_pct: ${atrPct}
invalidation_stop: ${dynamicStop}
dynamic_stop_2atr: ${dynamicStop}
upside_target_3atr: ${upsideTarget}
expected_move_5d: ${expectedMove5d}
cone_upper_5d: ${coneUpper5d}
cone_lower_5d: ${coneLower5d}
sma_20: ${sma20}
sma_regime: "${smaRegime}"
net_bias: "${netBias}"
sentiment_regime: "${sentimentRegime}"
risk_modifier: ${riskMod}
last_synced: "${new Date().toISOString()}"
---

# 🎯 Quantitative Recon Dossier: $${ticker} (${name})

| Metric | Level | Telemetry Details |
| :--- | :--- | :--- |
| **Spot Price** | $${spot.toFixed(2)} | 24h Change: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% |
| **14-Day ATR** | $${atr14.toFixed(2)} (${atrPct.toFixed(2)}%) | Volatility Dispersion Baseline |
| **Invalidation Stop** | $${dynamicStop.toFixed(2)} | 2.0x ATR Volatility Floor |
| **5-Day Expected Move** | ±$${expectedMove5d.toFixed(2)} (±${conePct.toFixed(2)}%) | Cone: $${coneLower5d.toFixed(2)} — $${coneUpper5d.toFixed(2)} |
| **Upside Swing Target** | $${upsideTarget.toFixed(2)} | 3.0x ATR Expansion Target |
| **20-Day SMA Trend** | $${sma20.toFixed(2)} | ${smaRegime.replace(/_/g, ' ')} |
| **CrowdSentinel Bias** | ${sentimentRegime} | ${riskMod}x Risk Allocation Sizing |

## Operational Portfolio Status
- Holding: ${shares > 0 ? `${shares} shares owned ($${(shares * spot).toFixed(2)})` : 'Watchlist (0 shares owned)'}
- Cluster: ${clusterName}
- Volatility Regime: ${netBias}
`;

    fs.writeFileSync(filePath, content, 'utf8');
    updateVaultIndex();
  } catch (e) {
    console.warn(`[Vault Sync] Error syncing recon for ${dossier.ticker}:`, e.message);
  }
}

function updateVaultIndex() {
  try {
    let p = null;
    if (fs.existsSync(PORTFOLIO_PATH)) {
      p = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
    }
    const assets = p?.assets || [];
    let lines = [
      '---',
      'title: "Obsidian Vault Master Recon Index"',
      `last_updated: "${new Date().toISOString()}"`,
      `universe_size: ${assets.length}`,
      '---',
      '',
      '# 🏛️ Active Quantitative War Room Index',
      '',
      '| Ticker | Company / Asset Name | Cluster | Shares Owned | Spot Price | 2x ATR Stop | 5-Day Cone (±) | Net Bias | Dossier |',
      '| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |'
    ];

    assets.forEach(a => {
      const reconPath = path.join(VAULT_RECONS_DIR, `${a.ticker}.md`);
      let stop = (a.spot_price && a.spot_price * 0.95) || 0;
      let cone = '±2.5%';
      if (fs.existsSync(reconPath)) {
        try {
          const txt = fs.readFileSync(reconPath, 'utf8');
          const stopM = txt.match(/dynamic_stop_2atr:\s*([\d.]+)/);
          if (stopM) stop = parseFloat(stopM[1]);
          const coneM = txt.match(/expected_move_5d:\s*([\d.]+)/);
          if (coneM) cone = `±$${parseFloat(coneM[1]).toFixed(2)}`;
        } catch(e) {}
      }
      lines.push(`| **$${a.ticker}** | ${a.name} | ${a.cluster_name} | ${a.shares} | $${(a.spot_price || 0).toFixed(2)} | $${stop.toFixed(2)} | ${cone} | ${a.sentiment_regime || 'UNSCANNED'} | [[Recons/${a.ticker}\\|📄 Recon]] |`);
    });

    lines.push('', '## System Architecture');
    lines.push('- `Recons/`: Active live dossiers updated automatically by Pierre Stock War Room.');
    lines.push('- `Recons/_Archive/`: Preserved historical recons for removed assets.');
    lines.push('');

    fs.writeFileSync(VAULT_INDEX_PATH, lines.join('\n'), 'utf8');
  } catch (e) {
    console.warn('[Vault Sync] Error updating VAULT-INDEX.md:', e.message);
  }
}

function normalizeSpeechInput(text) {
  if (!text) return '';
  let normalized = text;
  const map = getDynamicPhoneticMap();
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const pattern of keys) {
    const replacement = map[pattern];
    const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
    normalized = normalized.replace(regex, replacement);
  }
  return normalized;
}

// Fallback baseline prices in case of temporary network outage
const BASELINE_FALLBACKS = {
  'LDOS': 139.64, 'LHX': 225.40, 'HII': 275.50, 'TXT': 85.20, 'ACM': 98.40,
  'OXY': 62.73, 'DVN': 48.30, 'KMI': 20.10, 'WMB': 41.50, 'BKR': 36.80, 'ENB': 38.90,
  'ETR': 108.43, 'NEE': 78.50, 'VST': 125.60,
  'PFE': 29.80, 'EW': 72.10, 'BSX': 84.50, 'BMY': 49.30, 'NVO': 132.40, 'HIMS': 21.80,
  'CCJ': 82.41, 'NXE': 8.10, 'OKLO': 22.40, 'SMR': 24.30,
  'META': 620.19, 'GOOGL': 188.50, 'UBER': 76.40, 'GEN': 27.80, 'SOFI': 11.20, 'KWEB': 32.50,
  'IONQ': 32.95, 'JOBY': 6.80, 'EH': 19.50, 'RR': 3.10, 'CELH': 34.20,
  'BTC-USD': 80800.00, 'ABTC': 5.20, 'NEM': 44.80, 'FCX': 45.60, 'MOS': 28.90
};

// Batch fetch live prices from Yahoo Finance
async function fetchLiveQuotes(tickers) {
  const quotes = {};
  const fetchPromises = tickers.map(async (ticker) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const meta = data.chart?.result?.[0]?.meta;
      if (meta && typeof meta.regularMarketPrice === 'number') {
        const spot = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || spot;
        const changePct = prev !== 0 ? ((spot - prev) / prev) * 100 : 0;
        quotes[ticker] = {
          price: parseFloat(spot.toFixed(2)),
          change_24h_pct: parseFloat(changePct.toFixed(2))
        };
        return;
      }
    } catch (err) {
      // Quiet fallback
    }

    const prevCached = priceCache.quotes[ticker];
    if (prevCached) {
      quotes[ticker] = prevCached;
    } else {
      quotes[ticker] = {
        price: BASELINE_FALLBACKS[ticker] || 100.00,
        change_24h_pct: 0.00
      };
    }
  });

  await Promise.allSettled(fetchPromises);
  return quotes;
}

// Read CrowdSentinel sentiment
function readCrowdSentiment() {
  try {
    if (fs.existsSync(SENTIMENT_PATH)) {
      const content = fs.readFileSync(SENTIMENT_PATH, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[WarRoom API] Notice: Unable to read crowd_sentiment.json:', err.message);
  }
  return null;
}

// Trigger background sentiment scan
function triggerScanSubprocess(clusterId, clusterName, targetTickers) {
  if (activeScan.isScanning) {
    return { success: false, status: 'BUSY', activeScan };
  }

  const sanitizedTickers = (targetTickers || [])
    .map(t => sanitizeTicker(t))
    .filter(Boolean);

  if (sanitizedTickers.length === 0) {
    return { success: false, status: 'INVALID_TICKERS', error: 'No valid ticker symbols provided' };
  }

  activeScan.isScanning = true;
  activeScan.clusterId = clusterId ? parseInt(clusterId) : null;
  activeScan.clusterName = clusterName || (clusterId ? `Cluster #${clusterId}` : 'Custom Tickers');
  activeScan.tickers = sanitizedTickers;
  activeScan.startedAt = new Date().toISOString();
  activeScan.lastError = null;

  console.log(`[WarRoom API] Spawning background scan for ${sanitizedTickers.length} tickers: ${sanitizedTickers.join(', ')}`);

  const args = [FORUM_SCRIPT, '--tickers', ...sanitizedTickers, '--fast'];
  const child = spawn(PYTHON_EXE, args, {
    cwd: SCRAPER_DIR,
    windowsHide: true
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`[Scraper Engine] ${data}`);
  });

  child.on('close', (code) => {
    activeScan.isScanning = false;
    activeScan.lastCompletedAt = new Date().toISOString();
    if (code === 0) {
      console.log(`[WarRoom API] Scan finished cleanly for: ${sanitizedTickers.join(', ')}`);
      activeScan.lastError = null;
    } else {
      console.error(`[WarRoom API] Scan failed with code ${code}`);
      activeScan.lastError = `Scraper failed with code ${code}`;
    }
  });

  child.on('error', (err) => {
    activeScan.isScanning = false;
    activeScan.lastError = sanitizeErrorMessage(err.message);
    console.error(`[WarRoom API] Subprocess error:`, err);
  });

  return { success: true, status: 'STARTED', activeScan };
}

// Synchronous/Awaitable single-ticker scan execution bridge (25s timeout)
function runOpenClawScraperSingle(targetTicker, clusterId, clusterName) {
  const safeTicker = sanitizeTicker(targetTicker);
  if (!safeTicker) {
    return Promise.resolve({ success: false, error: 'INVALID_TICKER' });
  }

  return new Promise((resolve) => {
    activeScan.isScanning = true;
    activeScan.clusterId = clusterId ? parseInt(clusterId) : null;
    activeScan.clusterName = clusterName || (clusterId ? `Cluster #${clusterId}` : 'Single Asset');
    activeScan.tickers = [safeTicker];
    activeScan.startedAt = new Date().toISOString();
    activeScan.lastError = null;

    console.log(`[WarRoom API] Spawning awaitable live single-ticker scan for: ${safeTicker} (Cluster: ${activeScan.clusterName})`);

    const args = [FORUM_SCRIPT, '--tickers', safeTicker, '--fast'];
    const child = spawn(PYTHON_EXE, args, {
      cwd: SCRAPER_DIR,
      windowsHide: true
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (d) => { stdoutData += d.toString(); });
    child.stderr.on('data', (d) => {
      stderrData += d.toString();
      process.stderr.write(`[Scraper Engine] ${d}`);
    });

    let isResolved = false;
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        activeScan.isScanning = false;
        activeScan.lastCompletedAt = new Date().toISOString();
        activeScan.lastError = 'Safety timeout after 25s';
        try { child.kill(); } catch (e) {}
        console.warn(`[WarRoom API] Scraper timed out after 25s for ${targetTicker}`);
        resolve({ success: false, error: 'TIMEOUT' });
      }
    }, 25000);

    child.on('close', (code) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);
      activeScan.isScanning = false;
      activeScan.lastCompletedAt = new Date().toISOString();
      if (code === 0) {
        activeScan.lastError = null;
        console.log(`[WarRoom API] Live single-ticker scan for ${targetTicker} completed cleanly`);
        resolve({ success: true, code });
      } else {
        activeScan.lastError = `Scraper failed with exit code ${code}`;
        console.error(`[WarRoom API] Live single-ticker scan for ${targetTicker} failed with exit code ${code}`);
        resolve({ success: false, code, stderr: stderrData });
      }
    });

    child.on('error', (err) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);
      activeScan.isScanning = false;
      activeScan.lastError = err.message;
      console.error(`[WarRoom API] Live scan subprocess error for ${targetTicker}:`, err);
      resolve({ success: false, error: err.message });
    });
  });
}

// GET /api/plugins/war-room/portfolio
router.get('/portfolio', async (req, res) => {
  try {
    if (!fs.existsSync(PORTFOLIO_PATH)) {
      return res.status(500).json({ error: 'portfolio_40.json not found' });
    }

    const portfolioRaw = fs.readFileSync(PORTFOLIO_PATH, 'utf8');
    const portfolio = JSON.parse(portfolioRaw);

    const tickers = portfolio.assets.map(a => a.ticker);
    const now = Date.now();
    const cacheAgeSec = Math.round((now - priceCache.timestamp) / 1000);

    if (cacheAgeSec >= 60 || Object.keys(priceCache.quotes).length === 0) {
      const freshQuotes = await fetchLiveQuotes(tickers);
      priceCache = {
        timestamp: now,
        quotes: freshQuotes
      };
    }

    const sentimentData = readCrowdSentiment();
    const sentimentAssets = sentimentData?.assets || {};

    let totalEquity = 0;
    let ownedCount = 0;
    let watchlistCount = 0;

    const clusterStats = {};
    (portfolio.clusters || []).forEach(c => {
      clusterStats[c.id] = {
        id: c.id,
        name: c.name,
        total_value: 0,
        owned_count: 0,
        watchlist_count: 0,
        assets: []
      };
    });

    const enrichedAssets = portfolio.assets.map(asset => {
      const quote = priceCache.quotes[asset.ticker] || { price: asset.spot_price || 100.0, change_24h_pct: 0 };
      const spotPrice = quote.price;
      const change24h = quote.change_24h_pct;
      const shares = typeof asset.shares === 'number' ? asset.shares : 0;
      const isOwned = shares > 0;
      const positionVal = parseFloat((shares * spotPrice).toFixed(2));

      if (isOwned) {
        ownedCount++;
        totalEquity += positionVal;
      } else {
        watchlistCount++;
      }

      const sentiment = sentimentAssets[asset.ticker];
      const sentimentRegime = sentiment?.forum_synthesis?.consensus_regime || asset.sentiment_regime || 'UNSCANNED';
      const riskModifier = sentiment?.recommended_risk_modifier || asset.risk_modifier || 1.0;
      const sentimentScore = sentiment?.metrics?.reddit_stocktwits_sentiment ?? null;
      const sentimentSummary = sentiment?.forum_synthesis?.summary || null;
      const scannedAt = sentiment?.scanned_at || null;

      const enriched = {
        ...asset,
        shares,
        owned: isOwned,
        spot_price: spotPrice,
        change_24h_pct: change24h,
        position_value: positionVal,
        sentiment_regime: sentimentRegime,
        risk_modifier: riskModifier,
        sentiment_score: sentimentScore,
        sentiment_summary: sentimentSummary,
        scanned_at: scannedAt
      };

      if (clusterStats[asset.cluster_id]) {
        clusterStats[asset.cluster_id].assets.push(enriched);
        clusterStats[asset.cluster_id].total_value += positionVal;
        if (isOwned) clusterStats[asset.cluster_id].owned_count++;
        else clusterStats[asset.cluster_id].watchlist_count++;
      }

      return enriched;
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      cache_age_sec: Math.max(0, Math.round((Date.now() - priceCache.timestamp) / 1000)),
      total_equity: parseFloat(totalEquity.toFixed(2)),
      total_positions_owned: ownedCount,
      total_watchlist: watchlistCount,
      sentiment_source: sentimentData ? 'ONLINE' : 'OFFLINE',
      active_scan: activeScan,
      clusters: Object.values(clusterStats),
      assets: enrichedAssets
    });
  } catch (err) {
    console.error('[WarRoom API] Error processing /portfolio:', err);
    res.status(500).json({ error: 'Internal Server Error', details: sanitizeErrorMessage(err.message) });
  }
});

// GET /api/plugins/war-room/scan-status
router.get('/scan-status', (req, res) => {
  res.json({
    ...activeScan
  });
});

// POST /api/plugins/war-room/scan-sentiment
router.post('/scan-sentiment', (req, res) => {
  const { cluster_id, cluster_name, tickers } = req.body;

  let targetTickers = [];
  if (Array.isArray(tickers) && tickers.length > 0) {
    targetTickers = tickers.map(t => sanitizeTicker(t)).filter(Boolean);
  } else if (cluster_id) {
    try {
      const pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
      targetTickers = pData.assets
        .filter(a => a.cluster_id === parseInt(cluster_id))
        .map(a => sanitizeTicker(a.ticker))
        .filter(Boolean);
    } catch (e) {
      console.warn('[WarRoom API] Failed to resolve cluster tickers:', e);
    }
  }

  if (targetTickers.length === 0) {
    return res.status(400).json({ error: 'No valid tickers specified or resolved for scan' });
  }

  const result = triggerScanSubprocess(cluster_id, cluster_name, targetTickers);
  if (!result.success) {
    return res.status(409).json(result);
  }

  res.json({
    status: 'STARTED',
    message: `Scanning ${targetTickers.length} assets in ${activeScan.clusterName}`,
    activeScan
  });
});

// POST /api/plugins/war-room/update-shares
router.post('/update-shares', (req, res) => {
  try {
    const { ticker, shares } = req.body;
    const cleanTicker = sanitizeTicker(ticker);
    if (!cleanTicker) {
      return res.status(400).json({ error: 'Missing or invalid ticker symbol format' });
    }

    const sharesNum = Math.max(0, parseFloat(shares) || 0);

    if (!fs.existsSync(PORTFOLIO_PATH)) {
      return res.status(500).json({ error: 'portfolio_40.json not found' });
    }

    const portfolioRaw = fs.readFileSync(PORTFOLIO_PATH, 'utf8');
    const portfolio = JSON.parse(portfolioRaw);

    const target = portfolio.assets.find(a => a.ticker.toUpperCase() === cleanTicker);
    if (!target) {
      return res.status(404).json({ error: `Ticker ${cleanTicker} not in 40-asset universe` });
    }

    target.shares = sharesNum;
    target.owned = sharesNum > 0;
    portfolio.updated_at = new Date().toISOString();

    const tempFile = `${PORTFOLIO_PATH}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(portfolio, null, 2), 'utf8');
    fs.renameSync(tempFile, PORTFOLIO_PATH);

    console.log(`[WarRoom API] Updated ${cleanTicker}: shares=${sharesNum}, owned=${target.owned}`);

    const quote = priceCache.quotes[cleanTicker] || { price: 100.0, change_24h_pct: 0 };
    const positionVal = parseFloat((sharesNum * quote.price).toFixed(2));

    res.json({
      success: true,
      ticker: target.ticker,
      shares: target.shares,
      owned: target.owned,
      spot_price: quote.price,
      position_value: positionVal
    });
  } catch (err) {
    console.error('[WarRoom API] Error in /update-shares:', err);
    res.status(500).json({ error: 'Failed to update shares', details: sanitizeErrorMessage(err.message) });
  }
});

// POST /api/plugins/war-room/reset-shares (Clean all 40 assets back to 0 shares)

// POST /api/plugins/war-room/universe/add (Dynamic Universe Expansion)
router.post('/universe/add', async (req, res) => {
  try {
    const rawTicker = req.body.ticker;
    const cleanTicker = sanitizeTicker(rawTicker);
    const clusterId = parseInt(req.body.cluster_id, 10);
    const shares = Math.max(0, parseFloat(req.body.shares) || 0);

    if (!cleanTicker || isNaN(clusterId)) {
      return res.status(400).json({ error: 'Valid ticker symbol and cluster_id are required' });
    }

    if (!fs.existsSync(PORTFOLIO_PATH)) {
      return res.status(500).json({ error: 'portfolio_40.json not found' });
    }

    const portfolioRaw = fs.readFileSync(PORTFOLIO_PATH, 'utf8');
    const portfolio = JSON.parse(portfolioRaw);

    if (portfolio.assets.some(a => a.ticker === cleanTicker)) {
      return res.status(400).json({ error: `Ticker ${cleanTicker} already exists in universe` });
    }

    const cluster = portfolio.clusters.find(c => c.id === clusterId);
    if (!cluster) {
      return res.status(400).json({ error: `Invalid cluster_id: ${clusterId}. Must be 1 to 8.` });
    }

    let shortName = cleanTicker;
    let spotPrice = 100.0;
    let change24hPct = 0.0;

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanTicker)}?interval=1d&range=5d`;
      const yRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(5000)
      });
      if (yRes.ok) {
        const yData = await yRes.json();
        const meta = yData?.chart?.result?.[0]?.meta;
        if (meta) {
          shortName = meta.shortName || meta.longName || cleanTicker;
          spotPrice = meta.regularMarketPrice || meta.chartPreviousClose || 100.0;
          const prev = meta.chartPreviousClose || spotPrice;
          change24hPct = prev !== 0 ? ((spotPrice - prev) / prev) * 100 : 0;
        }
      }
    } catch (e) {
      console.warn(`[WarRoom Universe] Yahoo lookup notice for ${cleanTicker}:`, e.message);
    }

    const newAsset = {
      ticker: cleanTicker,
      name: shortName,
      cluster_id: clusterId,
      cluster_name: cluster.name,
      shares: shares,
      owned: shares > 0,
      avg_cost: 0,
      spot_price: parseFloat(spotPrice.toFixed(2)),
      change_24h_pct: parseFloat(change24hPct.toFixed(2)),
      position_value: parseFloat((shares * spotPrice).toFixed(2)),
      sentiment_regime: 'UNSCANNED',
      risk_modifier: 1.0
    };

    portfolio.assets.push(newAsset);
    portfolio.universe_size = portfolio.assets.length;
    cluster.asset_count = portfolio.assets.filter(a => a.cluster_id === clusterId).length;
    portfolio.updated_at = new Date().toISOString();

    const tempFile = `${PORTFOLIO_PATH}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(portfolio, null, 2), 'utf8');
    fs.renameSync(tempFile, PORTFOLIO_PATH);

    syncWatchlistFile(portfolio);
    await syncObsidianVaultRecon(newAsset);
    rebuildDynamicUniverseMap();

    console.log(`[WarRoom Universe] Successfully added ${cleanTicker} (${shortName}) to Cluster ${clusterId} (${cluster.name})`);

    res.json({
      success: true,
      message: `Asset ${cleanTicker} (${shortName}) added successfully`,
      asset: newAsset,
      universe_size: portfolio.universe_size
    });
  } catch (err) {
    console.error('[WarRoom API] Error in /universe/add:', err);
    res.status(500).json({ error: 'Failed to add asset', details: sanitizeErrorMessage(err.message) });
  }
});

// POST /api/plugins/war-room/universe/remove (Dynamic Universe Pruning & Vault Archive)
router.post('/universe/remove', async (req, res) => {
  try {
    const rawTicker = req.body.ticker;
    const cleanTicker = sanitizeTicker(rawTicker);
    if (!cleanTicker) {
      return res.status(400).json({ error: 'Valid ticker symbol is required' });
    }

    if (!fs.existsSync(PORTFOLIO_PATH)) {
      return res.status(500).json({ error: 'portfolio_40.json not found' });
    }

    const portfolioRaw = fs.readFileSync(PORTFOLIO_PATH, 'utf8');
    const portfolio = JSON.parse(portfolioRaw);

    const assetIdx = portfolio.assets.findIndex(a => a.ticker === cleanTicker);
    if (assetIdx === -1) {
      return res.status(404).json({ error: `Asset ${cleanTicker} not found in universe` });
    }

    const asset = portfolio.assets[assetIdx];
    if ((asset.shares || 0) > 0) {
      return res.status(400).json({
        error: `Cannot remove asset ${cleanTicker} with active position (${asset.shares} shares owned). Zero out shares first to archive.`
      });
    }

    const clusterId = asset.cluster_id;
    portfolio.assets.splice(assetIdx, 1);
    portfolio.universe_size = portfolio.assets.length;

    const cluster = portfolio.clusters.find(c => c.id === clusterId);
    if (cluster) {
      cluster.asset_count = portfolio.assets.filter(a => a.cluster_id === clusterId).length;
    }
    portfolio.updated_at = new Date().toISOString();

    const tempFile = `${PORTFOLIO_PATH}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(portfolio, null, 2), 'utf8');
    fs.renameSync(tempFile, PORTFOLIO_PATH);

    pruneCrowdSentiment(cleanTicker);
    archiveObsidianVaultRecon(cleanTicker);
    syncWatchlistFile(portfolio);
    rebuildDynamicUniverseMap();

    console.log(`[WarRoom Universe] Successfully removed ${cleanTicker} from universe and archived vault recon`);

    res.json({
      success: true,
      message: `Asset ${cleanTicker} removed and archived successfully`,
      removed_ticker: cleanTicker,
      universe_size: portfolio.universe_size
    });
  } catch (err) {
    console.error('[WarRoom API] Error in /universe/remove:', err);
    res.status(500).json({ error: 'Failed to remove asset', details: sanitizeErrorMessage(err.message) });
  }
});

router.post('/reset-shares', (req, res) => {
  try {
    if (!fs.existsSync(PORTFOLIO_PATH)) {
      return res.status(500).json({ error: 'portfolio_40.json not found' });
    }

    const portfolioRaw = fs.readFileSync(PORTFOLIO_PATH, 'utf8');
    const portfolio = JSON.parse(portfolioRaw);

    portfolio.assets.forEach(a => {
      a.shares = 0;
      a.owned = false;
      a.position_value = 0.0;
    });
    portfolio.updated_at = new Date().toISOString();

    const tempFile = `${PORTFOLIO_PATH}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(portfolio, null, 2), 'utf8');
    fs.renameSync(tempFile, PORTFOLIO_PATH);

    console.log('[WarRoom API] Reset all 40 asset share positions to 0');

    res.json({
      success: true,
      message: 'All 40 asset share positions reset to 0.',
      updated_at: portfolio.updated_at
    });
  } catch (err) {
    console.error('[WarRoom API] Error in /reset-shares:', err);
    res.status(500).json({ error: 'Failed to reset shares', details: sanitizeErrorMessage(err.message) });
  }
});

/* ========================================================
   JULIE ASSISTANT INTEGRATION ENGINE (Phase 6 & 7)
======================================================== */

// In-memory 5-minute RAM cache for quantitative volatility metrics
let quantMetricsCache = {};

// Helper: Live Quantitative ATR, Dynamic Stop, & 20-SMA Volatility Engine
async function fetchQuantReconMetrics(ticker) {
  const cleanTicker = String(ticker || '').toUpperCase().replace('$', '').trim();
  const now = Date.now();
  const cached = quantMetricsCache[cleanTicker];
  if (cached && (now - cached.timestamp < 300000)) {
    return cached.data;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanTicker)}?interval=1d&range=3mo`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) throw new Error(`Yahoo chart HTTP ${res.status}`);
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('No chart data returned');

    const meta = result.meta || {};
    const quote = result.indicators?.quote?.[0] || {};
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];

    const validCandles = [];
    for (let i = 0; i < closes.length; i++) {
      if (highs[i] != null && lows[i] != null && closes[i] != null) {
        validCandles.push({ high: highs[i], low: lows[i], close: closes[i] });
      }
    }

    if (validCandles.length < 5) throw new Error('Insufficient candles for quant metrics');

    const lastCandle = validCandles[validCandles.length - 1];
    const spotPrice = meta.regularMarketPrice || lastCandle.close;

    // Calculate True Range series: max(H-L, |H-Cp|, |L-Cp|)
    const trs = [];
    for (let i = 1; i < validCandles.length; i++) {
      const current = validCandles[i];
      const prevClose = validCandles[i - 1].close;
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prevClose),
        Math.abs(current.low - prevClose)
      );
      trs.push(tr);
    }

    // 14-day Average True Range (ATR)
    const last14Trs = trs.slice(-14);
    const atr14 = last14Trs.reduce((sum, v) => sum + v, 0) / (last14Trs.length || 1);
    const atrPct = (atr14 / spotPrice) * 100;

    // 20-day Simple Moving Average (SMA)
    const last20Closes = validCandles.slice(-20).map(c => c.close);
    const sma20 = last20Closes.reduce((sum, v) => sum + v, 0) / (last20Closes.length || 1);
    const smaRegime = spotPrice >= sma20 ? 'ABOVE_20SMA' : 'BELOW_20SMA';
    const smaDistancePct = ((spotPrice - sma20) / sma20) * 100;

    // Dynamic 2.0x ATR Stop & 3.0x ATR Upside Swing Target
    const dynamicStop2atr = spotPrice - (2 * atr14);
    const upsideTarget3atr = spotPrice + (3 * atr14);

    // 5-Day Foundation Model (TimesFM / Chronos) vs ATR Volatility Fallback
    const chronosBuffer = getChronosIntelBuffer();
    const gpuForecast = chronosBuffer?.forecasts?.[cleanTicker];

    let forecast5dP50 = null;
    let forecast5dP10 = null;
    let forecast5dP90 = null;
    let forecastReturnPct = 0.0;
    let directionalBias = smaRegime === 'ABOVE_20SMA' ? 'BULLISH_DRIFT' : 'BEARISH_DRIFT';
    let forecastSource = 'ATR_VOLATILITY_FALLBACK';
    let forecastSourceBadge = 'ATR FALLBACK';
    let coneUpper5d = spotPrice + (atr14 * Math.sqrt(5));
    let coneLower5d = spotPrice - (atr14 * Math.sqrt(5));
    let expectedMove5d = atr14 * Math.sqrt(5);

    if (gpuForecast && gpuForecast.forecast_5d_p50 != null) {
      forecast5dP50 = parseFloat(Number(gpuForecast.forecast_5d_p50).toFixed(2));
      forecast5dP10 = parseFloat(Number(gpuForecast.forecast_5d_p10).toFixed(2));
      forecast5dP90 = parseFloat(Number(gpuForecast.forecast_5d_p90).toFixed(2));
      forecastReturnPct = gpuForecast.forecast_return_pct != null
        ? parseFloat(Number(gpuForecast.forecast_return_pct).toFixed(2))
        : parseFloat((((forecast5dP50 - spotPrice) / spotPrice) * 100).toFixed(2));
      directionalBias = gpuForecast.directional_bias || directionalBias;
      forecastSource = gpuForecast.model_engine || 'TimesFM/Chronos GPU';
      forecastSourceBadge = (gpuForecast.model_engine && gpuForecast.model_engine.includes('Statistical')) ? 'ARIMA DRIFT' : 'GPU: CHRONOS/TIMESFM';
      coneUpper5d = forecast5dP90;
      coneLower5d = forecast5dP10;
      expectedMove5d = parseFloat(Math.abs(forecast5dP50 - spotPrice).toFixed(2));
    } else {
      forecast5dP50 = parseFloat(spotPrice.toFixed(2));
      forecast5dP10 = parseFloat(coneLower5d.toFixed(2));
      forecast5dP90 = parseFloat(coneUpper5d.toFixed(2));
    }

    const conePct = (expectedMove5d / (spotPrice || 1)) * 100;

    // 52-week High & Low
    const high52w = meta.fiftyTwoWeekHigh || spotPrice;
    const low52w = meta.fiftyTwoWeekLow || spotPrice;
    const pctFrom52wHigh = ((spotPrice - high52w) / high52w) * 100;
    const pctFrom52wLow = ((spotPrice - low52w) / low52w) * 100;

    const metrics = {
      ticker: cleanTicker,
      spot_price: parseFloat(spotPrice.toFixed(2)),
      atr_14: parseFloat(atr14.toFixed(2)),
      atr_14_pct: parseFloat(atrPct.toFixed(2)),
      dynamic_stop_2atr: parseFloat(dynamicStop2atr.toFixed(2)),
      upside_target_3atr: parseFloat(upsideTarget3atr.toFixed(2)),
      expected_move_5d: parseFloat(expectedMove5d.toFixed(2)),
      cone_upper_5d: parseFloat(coneUpper5d.toFixed(2)),
      cone_lower_5d: parseFloat(coneLower5d.toFixed(2)),
      cone_pct: parseFloat(conePct.toFixed(2)),
      forecast_5d_p50: forecast5dP50,
      forecast_5d_p10: forecast5dP10,
      forecast_5d_p90: forecast5dP90,
      forecast_return_pct: forecastReturnPct,
      directional_bias: directionalBias,
      forecast_source: forecastSource,
      forecast_source_badge: forecastSourceBadge,
      sma_20: parseFloat(sma20.toFixed(2)),
      sma_regime: smaRegime,
      sma_distance_pct: parseFloat(smaDistancePct.toFixed(2)),
      fifty_two_week_high: parseFloat(high52w.toFixed(2)),
      fifty_two_week_low: parseFloat(low52w.toFixed(2)),
      pct_from_52w_high: parseFloat(pctFrom52wHigh.toFixed(2)),
      pct_from_52w_low: parseFloat(pctFrom52wLow.toFixed(2)),
      timestamp: now,
      source: 'LIVE_YAHOO'
    };

    quantMetricsCache[cleanTicker] = { timestamp: now, data: metrics };
    return metrics;
  } catch (err) {
    console.warn(`[WarRoom Quant] Notice: Failed to fetch live quant metrics for ${cleanTicker} (${err.message}). Using fallback.`);
    if (cached) return cached.data;

    const spot = priceCache.quotes[cleanTicker]?.price || BASELINE_FALLBACKS[cleanTicker] || 100.0;
    const fallbackAtr = parseFloat((spot * 0.025).toFixed(2));
    const fallbackMetrics = {
      ticker: cleanTicker,
      spot_price: spot,
      atr_14: fallbackAtr,
      atr_14_pct: 2.50,
      dynamic_stop_2atr: parseFloat((spot - 2 * fallbackAtr).toFixed(2)),
      upside_target_3atr: parseFloat((spot + 3 * fallbackAtr).toFixed(2)),
      expected_move_5d: parseFloat((fallbackAtr * Math.sqrt(5)).toFixed(2)),
      cone_upper_5d: parseFloat((spot + fallbackAtr * Math.sqrt(5)).toFixed(2)),
      cone_lower_5d: parseFloat((spot - fallbackAtr * Math.sqrt(5)).toFixed(2)),
      cone_pct: parseFloat(((fallbackAtr * Math.sqrt(5) / spot) * 100).toFixed(2)),
      sma_20: parseFloat((spot * 0.98).toFixed(2)),
      sma_regime: 'ABOVE_20SMA',
      sma_distance_pct: 2.04,
      fifty_two_week_high: parseFloat((spot * 1.15).toFixed(2)),
      fifty_two_week_low: parseFloat((spot * 0.85).toFixed(2)),
      pct_from_52w_high: -13.04,
      pct_from_52w_low: 17.65,
      timestamp: now,
      source: 'FALLBACK_CALC'
    };
    return fallbackMetrics;
  }
}

// Helper: Live Quantitative ATR / Dynamic Stop Recon Dossier
async function getReconDossier(ticker) {
  const cleanTicker = sanitizeTicker(ticker);
  if (!cleanTicker) {
    throw new Error('Invalid ticker symbol format');
  }
  
  // 1. Fetch live quantitative volatility and trend metrics
  const quant = await fetchQuantReconMetrics(cleanTicker);

  // 2. Load portfolio asset data
  let asset = null;
  try {
    const pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
    asset = pData.assets.find(a => a.ticker.toUpperCase() === cleanTicker);
  } catch (e) {}

  const quote = priceCache.quotes[cleanTicker] || { price: quant?.spot_price || asset?.spot_price || 100.0, change_24h_pct: 0 };
  const spotPrice = quote.price || quant.spot_price;
  const changePct = quote.change_24h_pct;

  const sentimentData = readCrowdSentiment();
  const sentiment = sentimentData?.assets?.[cleanTicker] || null;
  const sentimentRegime = sentiment?.forum_synthesis?.consensus_regime || asset?.sentiment_regime || 'UNSCANNED';
  const riskModifier = sentiment?.recommended_risk_modifier || asset?.risk_modifier || 1.0;

  const atr14 = quant.atr_14;
  const dynamicStop = quant.dynamic_stop_2atr;
  const upsideTarget = quant.upside_target_3atr;
  const sma20 = quant.sma_20;
  const smaRegime = quant.sma_regime;
  const netBias = sentimentRegime.includes('BULLISH') ? 'BULLISH_CONFLUENCE' : (smaRegime === 'ABOVE_20SMA' ? 'BULLISH_MOMENTUM' : 'NEUTRAL_ACCUMULATION');

  const speech = `Tactical Recon for ${asset?.name || cleanTicker} ($${cleanTicker}). Spot price is $${spotPrice.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% 24h). 14-day ATR is $${atr14.toFixed(2)}, calibrating the dynamic 2.0x ATR invalidation stop to $${dynamicStop.toFixed(2)}. The 20-day SMA is $${sma20.toFixed(2)} (${smaRegime.replace(/_/g, ' ')}), with a 3.0x ATR upside target at $${upsideTarget.toFixed(2)}. CrowdSentinel signals a ${sentimentRegime.replace(/_/g, ' ')} regime with ${riskModifier}x risk allocation.`;

  const dossierResult = {
    success: true,
    ticker: cleanTicker,
    name: asset?.name || cleanTicker,
    source: quant.source || 'LIVE_QUANT_RECON',
    cluster_name: asset?.cluster_name || 'Tactical Watchlist',
    spot_price: spotPrice,
    change_24h_pct: changePct,
    atr_14: atr14,
    atr_14_pct: quant.atr_14_pct,
    invalidation_stop: dynamicStop,
    dynamic_stop_2atr: dynamicStop,
    timesfm_target: upsideTarget,
    upside_target_3atr: upsideTarget,
    expected_move_5d: quant.expected_move_5d || parseFloat((atr14 * Math.sqrt(5)).toFixed(2)),
    cone_upper_5d: quant.cone_upper_5d || parseFloat((spotPrice + atr14 * Math.sqrt(5)).toFixed(2)),
    cone_lower_5d: quant.cone_lower_5d || parseFloat((spotPrice - atr14 * Math.sqrt(5)).toFixed(2)),
    cone_pct: quant.cone_pct || parseFloat(((atr14 * Math.sqrt(5) / (spotPrice || 1)) * 100).toFixed(2)),
    forecast_5d_p50: quant.forecast_5d_p50,
    forecast_5d_p10: quant.forecast_5d_p10,
    forecast_5d_p90: quant.forecast_5d_p90,
    forecast_return_pct: quant.forecast_return_pct,
    directional_bias: quant.directional_bias,
    forecast_source: quant.forecast_source,
    forecast_source_badge: quant.forecast_source_badge,
    sma_20: sma20,
    sma_regime: smaRegime,
    sma_distance_pct: quant.sma_distance_pct,
    fifty_two_week_high: quant.fifty_two_week_high,
    fifty_two_week_low: quant.fifty_two_week_low,
    pct_from_52w_high: quant.pct_from_52w_high,
    net_bias: netBias,
    sentiment_regime: sentimentRegime,
    risk_modifier: riskModifier,
    shares: asset?.shares || 0,
    position_value: asset ? parseFloat(((asset.shares || 0) * spotPrice).toFixed(2)) : 0,
    last_synced: new Date().toISOString(),
    speech_summary: speech,
    spoken_summary: speech
  };
  syncObsidianVaultRecon(dossierResult);
  return dossierResult;
}

// GET /api/plugins/war-room/julie/recon/:ticker
router.get('/julie/recon/:ticker', async (req, res) => {
  try {
    const cleanTicker = sanitizeTicker(req.params.ticker);
    if (!cleanTicker) {
      return res.status(400).json({ error: 'Invalid ticker symbol format' });
    }
    const dossier = await getReconDossier(cleanTicker);
    res.json(dossier);
  } catch (err) {
    console.error(`[WarRoom API] Recon error for ${req.params.ticker}:`, err);
    res.status(500).json({ error: 'Failed to generate recon dossier', details: sanitizeErrorMessage(err.message) });
  }
});

// Helper: Query Ollama Chat API with safety timeout
async function queryOllama(messages, timeoutMs = 4000) {
  try {
    const res = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: messages,
        stream: false,
        options: { temperature: 0.2 }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content?.trim() || null;
  } catch (err) {
    console.warn(`[WarRoom Julie] Ollama query notice:`, err.message);
    return null;
  }
}

// POST /api/plugins/war-room/julie/morning-brief (Active Holdings Risk Audit)

// POST /api/plugins/war-room/julie/run-forecasts
router.post('/julie/run-forecasts', async (req, res) => {
  try {
    const { scope = 'owned', ticker = null } = req.body || {};
    const safeScope = ['owned', 'all', 'single'].includes(scope) ? scope : 'owned';
    const safeTicker = ticker ? sanitizeTicker(ticker) : null;
    if (scope === 'single' && !safeTicker) {
      return res.status(400).json({ error: 'Valid ticker symbol required for single forecast' });
    }
    console.log(`[WarRoom Forecasts] Triggering GPU TimesFM/Chronos forecast run (scope: ${safeScope}, ticker: ${safeTicker || 'ALL'})...`);
    const result = await runGpuForecastsAsync({ scope: safeScope, ticker: safeTicker });
    const buffer = getChronosIntelBuffer();
    const forecastCount = Object.keys(buffer.forecasts || {}).length;
    res.json({
      success: result.success,
      scope: safeScope,
      forecast_count: forecastCount,
      message: result.success
        ? `Successfully completed neural forecast generation for ${safeScope} scope.`
        : `Forecast run completed with exit code ${result.code || 'ERR'}`,
      details: sanitizeErrorMessage(result.stderr || result.stdout)
    });
  } catch (err) {
    console.error('[WarRoom Forecasts Error]:', err);
    res.status(500).json({ error: 'Failed to execute GPU forecasts', details: sanitizeErrorMessage(err.message) });
  }
});

router.post('/julie/morning-brief', async (req, res) => {
  try {
    let pData = { assets: [], clusters: [] };
    if (fs.existsSync(PORTFOLIO_PATH)) {
      pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
    }

    const ownedAssets = (pData.assets || []).filter(a => (a.shares || 0) > 0);
    const quotes = priceCache.quotes;
    const sentData = readCrowdSentiment();

    // 1. Parallel live quant telemetry audit for all owned assets
    const auditPromises = ownedAssets.map(async (asset) => {
      const q = quotes[asset.ticker] || { price: asset.spot_price || 100, change_24h_pct: asset.change_24h_pct || 0 };
      const quant = await fetchQuantReconMetrics(asset.ticker);
      const spot = q.price || quant.spot_price;
      const stop = quant.dynamic_stop_2atr;
      const cushionPct = ((spot - stop) / (spot || 1)) * 100;
      const dollarRisk = asset.shares * (spot - stop);
      const sentiment = sentData?.assets?.[asset.ticker];
      const riskMod = sentiment?.recommended_risk_modifier ?? asset.risk_modifier ?? 1.0;
      const regime = sentiment?.forum_synthesis?.consensus_regime || asset.sentiment_regime || 'UNSCANNED';

      const flags = [];
      if (cushionPct < 3.0) flags.push('STOP_PROXIMITY_ALERT');
      if (quant.sma_regime === 'BELOW_20SMA') flags.push('BELOW_TREND');
      if (riskMod < 1.0) flags.push('HYPE_WARNING');

      return {
        ticker: asset.ticker,
        name: asset.name,
        cluster_id: asset.cluster_id,
        cluster_name: asset.cluster_name,
        shares: asset.shares,
        spot_price: spot,
        change_24h_pct: q.change_24h_pct,
        dynamic_stop_2atr: stop,
        stop_cushion_pct: parseFloat(cushionPct.toFixed(2)),
        dollar_risk_to_stop: parseFloat(dollarRisk.toFixed(2)),
        position_value: parseFloat((asset.shares * spot).toFixed(2)),
        atr_14: quant.atr_14,
        atr_14_pct: quant.atr_14_pct,
        expected_move_5d: quant.expected_move_5d,
        cone_upper_5d: quant.cone_upper_5d,
        cone_lower_5d: quant.cone_lower_5d,
        forecast_5d_p50: quant.forecast_5d_p50,
        forecast_5d_p10: quant.forecast_5d_p10,
        forecast_5d_p90: quant.forecast_5d_p90,
        forecast_return_pct: quant.forecast_return_pct,
        directional_bias: quant.directional_bias,
        forecast_source: quant.forecast_source,
        forecast_source_badge: quant.forecast_source_badge,
        sma_20: quant.sma_20,
        sma_regime: quant.sma_regime,
        risk_modifier: riskMod,
        sentiment_regime: regime,
        flags: flags,
        is_flagged: flags.length > 0
      };
    });

    const holdingsMatrix = await Promise.all(auditPromises);

    // Sort flagged positions to the top, then by cushion percentage ascending
    holdingsMatrix.sort((a, b) => {
      if (a.is_flagged && !b.is_flagged) return -1;
      if (!a.is_flagged && b.is_flagged) return 1;
      return a.stop_cushion_pct - b.stop_cushion_pct;
    });

    // Aggregates
    const totalEquity = holdingsMatrix.reduce((sum, h) => sum + h.position_value, 0);
    const totalDollarRisk = holdingsMatrix.reduce((sum, h) => sum + (h.dollar_risk_to_stop > 0 ? h.dollar_risk_to_stop : 0), 0);
    const flaggedPositions = holdingsMatrix.filter(h => h.is_flagged);

    // Top Movers among owned
    const sortedMovers = [...holdingsMatrix].sort((a, b) => b.change_24h_pct - a.change_24h_pct);
    const topGainers = sortedMovers.slice(0, 2).map(m => `$${m.ticker} (${m.change_24h_pct >= 0 ? '+' : ''}${m.change_24h_pct.toFixed(2)}%)`).join(', ');
    const topLosers = sortedMovers.slice(-1).map(m => `$${m.ticker} (${m.change_24h_pct >= 0 ? '+' : ''}${m.change_24h_pct.toFixed(2)}%)`).join(', ');

    // 2. Synthesize concise 3-sentence executive speech
    let statusSentence = '';
    if (flaggedPositions.length === 0) {
      statusSentence = 'All active holdings maintain healthy volatility buffers above their dynamic 2.0x ATR stops and remain constructive above 20-day trend lines.';
    } else {
      const flagSummary = flaggedPositions.slice(0, 3).map(f => `$${f.ticker} (${f.flags.join(', ')})`).join(', ');
      statusSentence = `Risk telemetry flags ${flaggedPositions.length} active position${flaggedPositions.length > 1 ? 's' : ''} requiring attention: ${flagSummary}.`;
    }

    const finalBrief = `Good morning, Pierre. Executive risk audit compiled: Total active portfolio equity stands at $${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${ownedAssets.length} holdings, with a cumulative dynamic dollar risk to stops of $${totalDollarRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. ${statusSentence} Momentum is led by ${topGainers || 'nominal assets'}. Standing by for priority directive.`;

    res.json({
      success: true,
      brief: finalBrief,
      holdings_risk_matrix: holdingsMatrix,
      metrics: {
        total_equity: parseFloat(totalEquity.toFixed(2)),
        total_dollar_risk_to_stop: parseFloat(totalDollarRisk.toFixed(2)),
        total_owned: ownedAssets.length,
        flagged_count: flaggedPositions.length,
        top_gainers: topGainers,
        top_losers: topLosers,
        universe_size: (pData.assets || []).length
      }
    });
  } catch (err) {
    console.error('[WarRoom Morning Brief Error]:', err);
    res.status(500).json({ error: 'Failed to generate morning brief', details: sanitizeErrorMessage(err.message) });
  }
});

// POST /api/plugins/war-room/julie/chat
router.post('/julie/chat', async (req, res) => {
  try {
    const rawMessage = req.body.message || '';
    if (!rawMessage.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    const message = normalizeSpeechInput(rawMessage);
    const msgLower = message.toLowerCase();

    // 0. HIGH-PRIORITY INTENT: Live Single-Ticker OpenClaw Analysis
    const wordsClean = message.replace(/[^A-Za-z0-9\-\$]/g, ' ').split(/\s+/).map(w => w.replace(/^\$/, '').toUpperCase());
    // Phase 8: Dynamic Universe Matcher
    const universeTickers = getUniverseTickers();
    const matchedTicker = universeTickers.find(t => wordsClean.includes(t.toUpperCase())) || null;

    // Phase 8: Voice Directive - Add Ticker to Universe
    const addMatch = message.match(/(?:add|insert)\s+([A-Za-z0-9\-\$]+)\s+to\s+(?:the\s+)?(.+?)(?:\s+cluster)?$/i);
    if (addMatch) {
      const candidateSymbol = addMatch[1].replace(/\$/g, '').toUpperCase().trim();
      const clusterTarget = addMatch[2].toLowerCase().trim();
      let pData = getUniverseData();
      let matchedCluster = null;

      if (/defense|military|government/i.test(clusterTarget) || clusterTarget === '1') matchedCluster = pData.clusters.find(c => c.id === 1);
      else if (/energy|pipeline|midstream/i.test(clusterTarget) || clusterTarget === '2') matchedCluster = pData.clusters.find(c => c.id === 2);
      else if (/power|utilit/i.test(clusterTarget) || clusterTarget === '3') matchedCluster = pData.clusters.find(c => c.id === 3);
      else if (/health|bio|device|pharma/i.test(clusterTarget) || clusterTarget === '4') matchedCluster = pData.clusters.find(c => c.id === 4);
      else if (/nuclear|uranium/i.test(clusterTarget) || clusterTarget === '5') matchedCluster = pData.clusters.find(c => c.id === 5);
      else if (/next[- ]?gen|robot|ai/i.test(clusterTarget) || clusterTarget === '7') matchedCluster = pData.clusters.find(c => c.id === 7);
      else if (/tech|fintech|platform/i.test(clusterTarget) || clusterTarget === '6') matchedCluster = pData.clusters.find(c => c.id === 6);
      else if (/crypto|mining|commodit|bitcoin/i.test(clusterTarget) || clusterTarget === '8') matchedCluster = pData.clusters.find(c => c.id === 8);

      if (matchedCluster) {
        try {
          const addRes = await fetch('http://localhost:3888/api/plugins/war-room/universe/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: candidateSymbol, cluster_id: matchedCluster.id, shares: 0 })
          });
          const addData = await addRes.json();
          if (addData.success) {
            return res.json({
              reply: `Pierre, $${candidateSymbol} has been added to the ${matchedCluster.name} cluster and indexed across OpenClaw and the Obsidian Vault.`,
              state: 'speaking',
              action_triggered: 'UNIVERSE_ADD',
              refresh_portfolio: true
            });
          } else {
            return res.json({
              reply: `Pierre, could not add $${candidateSymbol}: ${addData.error || 'Validation error'}.`,
              state: 'speaking',
              action_triggered: 'UNIVERSE_ERROR'
            });
          }
        } catch (addErr) {
          return res.json({
            reply: `Pierre, an error occurred while adding $${candidateSymbol}: ${addErr.message}.`,
            state: 'speaking',
            action_triggered: 'UNIVERSE_ERROR'
          });
        }
      }
    }

    // Phase 8: Voice Directive - Remove Ticker from Watchlist
    const removeMatch = message.match(/(?:remove|delete|archive|drop)\s+([A-Za-z0-9\-\$]+)(?:\s+from\s+(?:the\s+)?(?:watchlist|universe|portfolio))?/i);
    if (removeMatch) {
      const candidateSymbol = removeMatch[1].replace(/\$/g, '').toUpperCase().trim();
      const pData = getUniverseData();
      const asset = pData.assets.find(a => a.ticker === candidateSymbol);
      if (asset) {
        if ((asset.shares || 0) > 0) {
          return res.json({
            reply: `Pierre, $${candidateSymbol} currently has ${asset.shares} active owned shares. Please zero out your position before removing it from the universe.`,
            state: 'speaking',
            action_triggered: 'UNIVERSE_REMOVE_BLOCKED'
          });
        }
        try {
          const remRes = await fetch('http://localhost:3888/api/plugins/war-room/universe/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: candidateSymbol })
          });
          const remData = await remRes.json();
          if (remData.success) {
            return res.json({
              reply: `Pierre, $${candidateSymbol} has been removed from your watchlist and its Recon dossier archived.`,
              state: 'speaking',
              action_triggered: 'UNIVERSE_REMOVE',
              refresh_portfolio: true
            });
          }
        } catch (remErr) {
          return res.json({
            reply: `Pierre, error removing $${candidateSymbol}: ${remErr.message}.`,
            state: 'speaking',
            action_triggered: 'UNIVERSE_ERROR'
          });
        }
      }
    }


    // Phase 9: GPU Forecast Directives
    const isForecastDirective = /(?:run\s+gpu\s+forecast|run\s+forecast|forecast|timesfm|chronos)/i.test(msgLower);
    if (isForecastDirective) {
      if (matchedTicker) {
        console.log(`[Julie Chat] Running live GPU forecast for single ticker: ${matchedTicker}`);
        await runGpuForecastsAsync({ scope: 'single', ticker: matchedTicker });
        const dossier = await getReconDossier(matchedTicker);
        const modelTarget = dossier.forecast_5d_p50 ? `$${dossier.forecast_5d_p50.toFixed(2)}` : `$${dossier.spot_price.toFixed(2)}`;
        const returnPct = dossier.forecast_return_pct != null ? `${dossier.forecast_return_pct >= 0 ? '+' : ''}${dossier.forecast_return_pct.toFixed(2)}%` : '0.00%';
        const p10 = dossier.cone_lower_5d ? `$${dossier.cone_lower_5d.toFixed(2)}` : 'N/A';
        const p90 = dossier.cone_upper_5d ? `$${dossier.cone_upper_5d.toFixed(2)}` : 'N/A';
        const speech = `Pierre, live foundation model forecast completed for $${matchedTicker}. 5-day median model target is ${modelTarget} (${returnPct}), within a quantile cone spanning ${p10} to ${p90}. Dynamic 2.0x ATR invalidation stop sits at $${dossier.dynamic_stop_2atr.toFixed(2)}, with CrowdSentinel model risk modifier calibrated at ${dossier.risk_modifier}x.`;
        return res.json({
          reply: speech,
          state: 'speaking',
          action_triggered: 'GPU_FORECAST',
          recon_data: dossier
        });
      } else if (/(?:holdings|portfolio|active|all|positions)/i.test(msgLower) || !matchedTicker) {
        console.log(`[Julie Chat] Running live GPU forecast across active holdings`);
        await runGpuForecastsAsync({ scope: 'owned' });
        const speech = `Pierre, local GPU foundation model forecast batch completed across all active holdings. 5-day quantile projections and Obsidian dossiers have been refreshed.`;
        return res.json({
          reply: speech,
          state: 'speaking',
          action_triggered: 'GPU_FORECAST_BATCH'
        });
      }
    }

    // Phase 8: Head-to-Head Asset Comparator Directive
    const isComparisonDirective = /(?:compare|versus|\bvs\b|\bvs\.\b)/i.test(msgLower);
    const candidateTickers = universeTickers.filter(t => wordsClean.includes(t.toUpperCase()));
    if (isComparisonDirective && candidateTickers.length >= 2) {
      const tickerA = candidateTickers[0];
      const tickerB = candidateTickers[1];
      console.log(`[Julie Chat] Executing Head-to-Head Comparison: ${tickerA} vs ${tickerB}`);

      const [dossierA, dossierB] = await Promise.all([
        getReconDossier(tickerA),
        getReconDossier(tickerB)
      ]);

      const trendComp = (dossierA.sma_regime === dossierB.sma_regime)
        ? `Both assets are trading ${dossierA.sma_regime.replace(/_/g, ' ')}.`
        : `$${tickerA} is ${dossierA.sma_regime.replace(/_/g, ' ')}, whereas $${tickerB} is ${dossierB.sma_regime.replace(/_/g, ' ')}.`;

      const volatilityComp = dossierA.atr_14_pct < dossierB.atr_14_pct
        ? `$${tickerA} demonstrates tighter volatility compression at ${dossierA.atr_14_pct.toFixed(2)}% ATR compared to ${dossierB.atr_14_pct.toFixed(2)}% on $${tickerB}.`
        : `$${tickerB} demonstrates tighter volatility compression at ${dossierB.atr_14_pct.toFixed(2)}% ATR compared to ${dossierA.atr_14_pct.toFixed(2)}% on $${tickerA}.`;

      const compSpeech = `Pierre, here is the quantitative head-to-head comparison between $${tickerA} and $${tickerB}. $${tickerA} is at $${dossierA.spot_price.toFixed(2)} with a 5-day expected move cone of ±$${dossierA.expected_move_5d.toFixed(2)}, while $${tickerB} trades at $${dossierB.spot_price.toFixed(2)} with a 5-day move cone of ±$${dossierB.expected_move_5d.toFixed(2)}. ${volatilityComp} ${trendComp} CrowdSentinel models risk modifiers at ${dossierA.risk_modifier}x for $${tickerA} versus ${dossierB.risk_modifier}x for $${tickerB}.`;

      return res.json({
        reply: compSpeech,
        state: 'speaking',
        action_triggered: 'HEAD_TO_HEAD_COMPARISON',
        comparator_data: {
          asset_a: dossierA,
          asset_b: dossierB
        }
      });
    }
    const isAnalysisDirective = /(?:analyze|analysis|openclaw|sentiment|scan|check|what do you think of|look at|evaluate|audit|run\s+a\s+scan|harvest)/i.test(msgLower);

    if (matchedTicker && isAnalysisDirective) {
      console.log(`[Julie Chat] Matched live single-ticker analysis directive for: ${matchedTicker}`);

      // Locate cluster for D3 constellation radar pulsing
      let pData = null;
      try { pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8')); } catch (e) {}
      const asset = pData?.assets?.find(a => a.ticker.toUpperCase() === matchedTicker.toUpperCase());
      const clusterId = asset?.cluster_id || null;
      const clusterName = asset?.cluster_name || null;

      // 1. Live Execution Bridge (Awaited with 25s safety timeout)
      const scanResult = await runOpenClawScraperSingle(matchedTicker, clusterId, clusterName);

      // 2. Real-Time Synthesis: Read freshly merged crowd_sentiment.json
      const freshSentimentData = readCrowdSentiment();
      const targetSentiment = freshSentimentData?.assets?.[matchedTicker] || null;

      // 3. Live spot price, 24h change, and Quantitative Volatility Recon
      const quant = await fetchQuantReconMetrics(matchedTicker);
      let spotPrice = quant.spot_price || asset?.spot_price || 100.0;
      let change24h = asset?.change_24h_pct || 0.0;
      try {
        const freshQuotes = await fetchLiveQuotes([matchedTicker]);
        if (freshQuotes[matchedTicker]) {
          spotPrice = freshQuotes[matchedTicker].price;
          change24h = freshQuotes[matchedTicker].change_24h_pct;
          priceCache.quotes[matchedTicker] = freshQuotes[matchedTicker];
        }
      } catch (qErr) {
        if (priceCache.quotes[matchedTicker]) {
          spotPrice = priceCache.quotes[matchedTicker].price;
          change24h = priceCache.quotes[matchedTicker].change_24h_pct;
        }
      }

      const atr14 = quant.atr_14;
      const dynamicStop = parseFloat((spotPrice - 2 * atr14).toFixed(2));
      const upsideTarget = parseFloat((spotPrice + 3 * atr14).toFixed(2));
      const sma20 = quant.sma_20;
      const smaRegime = spotPrice >= sma20 ? 'ABOVE_20SMA' : 'BELOW_20SMA';

      // 4. Recon Dossier if present
      let recon = null;
      try { recon = await getReconDossier(matchedTicker); } catch (e) {}

      // 5. Build rich natural-language fallback formatter
      const metrics = targetSentiment?.metrics || {};
      const synthesis = targetSentiment?.forum_synthesis || {};
      const consensusRegime = synthesis.consensus_regime || 'STEADY_ACCUMULATION';
      const regimeClean = consensusRegime.replace(/_/g, ' ');
      const riskMod = targetSentiment?.recommended_risk_modifier ?? 1.0;
      const voiceA_pct = (metrics.reddit_stocktwits_sentiment != null) ? Math.round(metrics.reddit_stocktwits_sentiment * 100) : 60;
      const voiceA_z = metrics.chatter_velocity_zscore != null ? metrics.chatter_velocity_zscore.toFixed(1) : '2.0';
      const voiceB_euphoria = metrics.retail_euphoria_risk || 'LOW';
      const voiceC_pct = (metrics.polymarket_macro_alignment != null) ? Math.round(metrics.polymarket_macro_alignment * 100) : 70;
      const divergence = synthesis.divergence_flag && synthesis.divergence_flag !== 'NONE' ? ` Note: ${synthesis.divergence_flag.replace(/_/g, ' ')} detected.` : '';
      const changeSign = change24h >= 0 ? '+' : '';
      const sharesOwned = asset?.shares || 0;
      const posNote = sharesOwned > 0 
        ? `You hold ${sharesOwned} shares valued at $${((sharesOwned * spotPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
        : `Currently on your Watchlist with 0 shares owned`;

      const fallbackReply = `OpenClaw 3-Voice analysis completed for ${asset?.name || matchedTicker} ($${matchedTicker}). Spot price is $${spotPrice.toFixed(2)} (${changeSign}${change24h.toFixed(2)}% 24h); ${posNote}. Volatility telemetry marks a 14-day ATR of $${atr14.toFixed(2)}, calibrating the dynamic 2.0x ATR invalidation stop to $${dynamicStop.toFixed(2)} (20-day SMA is $${sma20.toFixed(2)}, ${smaRegime.replace(/_/g, ' ')}). Consensus regime is classified as ${regimeClean} with a recommended risk modifier of ${riskMod}x baseline sizing. Voice A retail sentiment is at ${voiceA_pct}% positive accumulation (velocity z-score: ${voiceA_z}), Voice B video euphoria is ${voiceB_euphoria}, and Voice C institutional macro alignment is registering at ${voiceC_pct}%.${divergence}`;

      // 6. Query Ollama for natural language executive breakdown (with fallback)
      const telemetryContext = `
Asset: ${asset?.name || matchedTicker} ($${matchedTicker})
Cluster: ${asset?.cluster_name || 'Portfolio Universe'}
Live Spot Price: $${spotPrice.toFixed(2)} (${changeSign}${change24h.toFixed(2)}% 24h)
User Position: ${posNote}
Quantitative Volatility & Trend Recon:
- 14-day ATR: $${atr14.toFixed(2)} (${quant.atr_14_pct}% of spot)
- 2.0x ATR Dynamic Invalidation Stop: $${dynamicStop.toFixed(2)}
- 3.0x ATR Upside Swing Target: $${upsideTarget.toFixed(2)}
- 20-day SMA: $${sma20.toFixed(2)} (${smaRegime.replace(/_/g, ' ')})
- 52-week Range: High $${quant.fifty_two_week_high.toFixed(2)} / Low $${quant.fifty_two_week_low.toFixed(2)} (${quant.pct_from_52w_high >= 0 ? '+' : ''}${quant.pct_from_52w_high.toFixed(1)}% from high)
OpenClaw 3-Voice Synthesis:
- Consensus Regime: ${consensusRegime}
- Recommended Risk Modifier: ${riskMod}x
- Voice A (Retail Sentiment & Chatter): ${voiceA_pct}% positive (z-score: ${voiceA_z})
- Voice B (Video Hype Euphoria): ${voiceB_euphoria}
- Voice C (Macro / News Alignment): ${voiceC_pct}%
- Key Drivers: ${synthesis.key_drivers?.join('; ') || 'Balanced cross-tier signals'}
- Synthesis Summary: ${synthesis.summary || 'Constructive alignment'}
${recon?.speech_summary ? `Vault Recon Note: ${recon.speech_summary}` : ''}
`;

      const systemPrompt = `You are Julie, Pierre's autonomous, high-speed Jarvis-style tactical quant assistant.
Deliver a crisp, professional, spoken-ready executive breakdown of ${matchedTicker}.
CRITICAL RULES:
- Under NO circumstances mention weather or atmospheric conditions. Strictly financial and tactical quant only.
- Always address the user directly as Pierre.
- Cover 4 key points: 1) Live spot price and position; 2) Quantitative volatility telemetry (14-day ATR and the 2.0x ATR dynamic invalidation stop floor); 3) The 3-Voice OpenClaw Sentiment synthesis (Retail accumulation, Video hype, and Macro/Institutional alignment); 4) The consensus regime and recommended risk modifier for position sizing.
- Keep it to 3 to 4 punchy, quantitative sentences. No generic filler.`;

      let finalReply = null;
      try {
        finalReply = await queryOllama([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: telemetryContext }
        ], 4500);
      } catch (err) {
        console.warn('[WarRoom Julie] Ollama synthesis warning:', err.message);
      }

      if (!finalReply || finalReply.length < 30) {
        finalReply = fallbackReply;
      }

      return res.json({
        reply: finalReply,
        state: 'speaking',
        action_triggered: 'SINGLE_TICKER_ANALYSIS',
        ticker: matchedTicker,
        refresh_portfolio: true,
        sentiment: targetSentiment,
        scan_success: scanResult.success,
        quant_metrics: quant
      });
    }

    // 0.1 FAST-PATH INTENT: Protect Portfolio Shares from Accidental Reset
    if (/(?:reset|clear|zero)\s+(?:all\s+)?(?:portfolio|shares?|positions?)/i.test(msgLower)) {
      return res.json({
        reply: `Pierre, portfolio holdings are protected. Voice and chat reset directives are permanently disabled to safeguard your holdings. To adjust any position, update the share count directly in the cluster table.`,
        state: 'speaking',
        action_triggered: 'RESET_PROTECTED',
        refresh_portfolio: false
      });
    }

    // 1. FAST-PATH INTENT: Morning Brief / Flight Check / Position Risk Audit
    if (/morning brief|flight check|executive brief|daily status|audit.*positions?|check.*stops?|risk audit/i.test(msgLower)) {
      const briefRes = await fetch(`http://localhost:3888/api/plugins/war-room/julie/morning-brief`, { method: 'POST' });
      const briefData = await briefRes.json();
      return res.json({
        reply: briefData.brief,
        state: 'speaking',
        action_triggered: 'MORNING_BRIEF',
        brief_data: briefData,
        holdings_risk_matrix: briefData.holdings_risk_matrix,
        metrics: briefData.metrics
      });
    }

    // 2. FAST-PATH INTENT: Natural Greetings & Salutations
    if (/^(?:hey|hi|hello|good\s+morning|morning|good\s+day|greetings|bonjour)\b/i.test(msgLower)) {
      let pData = null;
      try { pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8')); } catch (e) {}
      let eq = 0;
      let ownedCount = 0;
      (pData?.assets || []).forEach(a => {
        const spot = priceCache.quotes[a.ticker]?.price || a.spot_price || 0;
        if (a.shares > 0) {
          eq += a.shares * spot;
          ownedCount++;
        }
      });

      const selectedGreeting = /morning/i.test(msgLower) 
        ? `Good morning, Pierre! Telemetry is active across your 40 assets and 8 clusters. Portfolio equity stands at $${eq.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} with ${ownedCount} active holdings. Ready for your flight check or sector scan.`
        : `Good day, Pierre! War Room telemetry is live across your 40 assets and 8 thematic clusters. Active equity is $${eq.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} with ${ownedCount} active positions. What is your priority directive?`;

      return res.json({
        reply: selectedGreeting,
        state: 'speaking',
        action_triggered: 'GREETING'
      });
    }

    // 3. FAST-PATH INTENT: Vault Recon Dossier
    if (/recon\b|dossier\b|vault\b/i.test(msgLower)) {
      let pData = null;
      try { pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8')); } catch (e) {}
      const universe = pData?.assets?.map(a => a.ticker) || [];

      const words = message.replace(/[^A-Za-z0-9\-]/g, ' ').split(/\s+/);
      const matchedTicker = words.find(w => universe.includes(w.toUpperCase())) || 'OKLO';

      const recon = await getReconDossier(matchedTicker);
      return res.json({
        reply: recon.speech_summary,
        state: 'speaking',
        action_triggered: 'VAULT_RECON',
        ticker: matchedTicker,
        recon_data: recon
      });
    }

    // 4. FAST-PATH INTENT: Ticker Position, Spot Price, or Status Query
    let pDataSnapshot = null;
    try { pDataSnapshot = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8')); } catch (e) {}
    const candidateTicker = wordsClean.find(w => universeTickers.includes(w.toUpperCase()));

    if (candidateTicker && /(?:position|shares?|holding|holdings?|owned|status|price|quote|how much|what is our|what is my|tell me about)/i.test(msgLower)) {
      const asset = pDataSnapshot.assets.find(a => a.ticker.toUpperCase() === candidateTicker.toUpperCase());
      if (asset) {
        const cluster = (pDataSnapshot.clusters || []).find(c => c.id === asset.cluster_id) || { name: 'Watchlist' };
        const quote = priceCache.quotes[asset.ticker] || { price: asset.spot_price || 100, change_24h_pct: asset.change_24h_pct || 0 };
        const spotFormatted = quote.price.toFixed(2);
        const changeFormatted = `${quote.change_24h_pct >= 0 ? '+' : ''}${quote.change_24h_pct.toFixed(2)}%`;
        const posValue = ((asset.shares || 0) * quote.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        let sentimentText = '';
        const sentData = readCrowdSentiment();
        const sentAsset = sentData?.assets?.[asset.ticker];
        if (sentAsset && sentAsset.forum_synthesis?.consensus_regime) {
          sentimentText = ` with a ${sentAsset.forum_synthesis.consensus_regime.replace(/_/g, ' ')} sentiment signal`;
        }

        let answer = '';
        if (asset.shares > 0) {
          answer = `Pierre, you currently hold ${asset.shares} shares of $${asset.ticker} valued at $${posValue} in the ${cluster.name} cluster. Spot price is $${spotFormatted} (${changeFormatted} 24h)${sentimentText}.`;
        } else {
          answer = `Pierre, $${asset.ticker} is currently on your Watchlist with 0 shares owned. Spot price is $${spotFormatted} (${changeFormatted} 24h) in the ${cluster.name} cluster${sentimentText}.`;
        }

        return res.json({
          reply: answer,
          state: 'speaking',
          action_triggered: 'TICKER_STATUS',
          ticker: asset.ticker,
          shares: asset.shares || 0,
          spot_price: quote.price
        });
      }
    }

    // 5. FAST-PATH INTENT: Cluster Sentiment Scan
    if (/scan\b|sentiment\b|harvester\b/i.test(msgLower)) {
      const clusters = pDataSnapshot?.clusters || [];

      let targetCluster = null;
      if (/defense|government|military/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 1);
      else if (/energy|pipeline|midstream/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 2);
      else if (/power|utilit/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 3);
      else if (/health|bio|pharma|device/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 4);
      else if (/nuclear|uranium/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 5);
      else if (/tech|fintech|platform/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 6);
      else if (/robot|next-gen|next gen|quantum/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 7);
      else if (/crypto|bitcoin|mining|commodit/i.test(msgLower)) targetCluster = clusters.find(c => c.id === 8);

      if (targetCluster) {
        const clusterTickers = pDataSnapshot.assets.filter(a => a.cluster_id === targetCluster.id).map(a => a.ticker);
        const scanRes = triggerScanSubprocess(targetCluster.id, targetCluster.name, clusterTickers);
        return res.json({
          reply: `Initiating CrowdSentinel sentiment harvest for ${targetCluster.name} now, Pierre. Constellation radar active across ${clusterTickers.join(', ')}.`,
          state: 'executing',
          action_triggered: 'SCAN_CLUSTER',
          cluster_id: targetCluster.id,
          scan_status: scanRes
        });
      }

      // Check if user specified a single ticker to scan
      if (candidateTicker) {
        const scanRes = triggerScanSubprocess(null, `Single Asset (${candidateTicker})`, [candidateTicker]);
        return res.json({
          reply: `Initiating sentiment harvest for $${candidateTicker}, Pierre. Results will merge into the matrix upon completion.`,
          state: 'executing',
          action_triggered: 'SCAN_TICKER',
          ticker: candidateTicker,
          scan_status: scanRes
        });
      }
    }

    // 6. FAST-PATH INTENT: Share Quantity Update
    const shareMatch = message.match(/(?:set|update|buy|own|shares?\s+of)\s+([A-Za-z0-9\-]+)\s+(?:shares?\s+to\s+)?(\d+(?:\.\d+)?)/i) ||
                       message.match(/([A-Za-z0-9\-]+)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s+shares?/i);
    if (shareMatch) {
      const tickerCandidate = shareMatch[1].toUpperCase();
      const sharesVal = parseFloat(shareMatch[2]);
      try {
        const pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
        const target = pData.assets.find(a => a.ticker.toUpperCase() === tickerCandidate);
        if (target) {
          target.shares = sharesVal;
          target.owned = sharesVal > 0;
          pData.updated_at = new Date().toISOString();
          fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(pData, null, 2), 'utf8');

          const quote = priceCache.quotes[tickerCandidate] || { price: target.spot_price || 100 };
          const posVal = (sharesVal * quote.price).toFixed(2);
          return res.json({
            reply: `Position updated, Pierre. ${target.ticker} is set to ${sharesVal} shares valued at $${posVal}.`,
            state: 'speaking',
            action_triggered: 'UPDATE_SHARES',
            ticker: target.ticker,
            shares: sharesVal,
            position_value: posVal
          });
        }
      } catch (e) {}
    }

    // 7. CONVERSATIONAL PATH: Local Ollama `gemma4:26b` with 18s timeout & context injection
    let pData = null;
    try { pData = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8')); } catch (e) {}
    const quotes = priceCache.quotes;

    let equity = 0;
    const owned = [];
    (pData?.assets || []).forEach(a => {
      const spot = quotes[a.ticker]?.price || a.spot_price || 0;
      if (a.shares > 0) {
        equity += a.shares * spot;
        owned.push(`${a.ticker}: ${a.shares} shs ($${(a.shares * spot).toFixed(2)})`);
      }
    });

    const contextSnippet = `
Pierre's Stock War Room Context:
- Active Equity: $${equity.toFixed(2)}
- Active Positions: ${owned.length > 0 ? owned.join(', ') : '0 owned (all 40 assets on watchlist)'}
- Universe: 40 Assets across 8 Clusters (Defense, Energy, Power, Healthcare, Nuclear, Tech, Next-Gen Robotics, Crypto)
`;

    const systemPrompt = `You are Julie, an authentic, high-speed Jarvis-style autonomous voice assistant and spatial HUD controller for Pierre.
Always address the user simply as Pierre.
You are fast, concise, direct, and actionable (1-3 sentences maximum per answer).
You have real-time access to Pierre's 40-asset Stock War Room across 8 thematic clusters.
Zero speculation: if data is missing or uncorroborated, flag the blindspot immediately.
Do NOT attempt to write or execute code blocks.`;

    const ollamaReply = await queryOllama([
      { role: 'system', content: `${systemPrompt}\n${contextSnippet}` },
      { role: 'user', content: message }
    ], 18000);

    const fallbackReplies = [
      `Understood, Pierre. I am monitoring your 40-asset matrix across all 8 clusters with real-time telemetry active. Active equity is $${equity.toFixed(2)}. Standing by for your directives.`,
      `Confirmed, Pierre. Tracking 40 assets across 8 clusters with ${owned.length} active positions. Feeds are nominal. How would you like to proceed?`,
      `Affirmative, Pierre. All quantitative streams and CrowdSentinel monitors are calibrated. Standing by for command.`
    ];

    const reply = ollamaReply || fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];

    res.json({
      reply,
      state: 'speaking',
      action_triggered: null
    });
  } catch (err) {
    console.error('[WarRoom Julie Chat Error]:', err);
    res.status(500).json({ error: 'Julie chat processing failure', details: sanitizeErrorMessage(err.message) });
  }
});

module.exports = router;
