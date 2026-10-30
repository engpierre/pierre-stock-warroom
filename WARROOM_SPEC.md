# Pierre Stock War Room (`pierre-stock-warroom`)
## Master Architecture & Engineering Specification

---

### 1. Executive Summary & Core Mission
**Pierre Stock War Room** is a dedicated, pluggable Express + D3.js real-time monitoring and tactical execution interface for Pierre's 40-asset investment universe across 8 thematic clusters. Built on top of the OpenClaw dashboard architecture, it acts as an autonomous operations room combining real-time spot pricing, passive crowd sentiment telemetry, and dynamic portfolio position tracking.

---

### 2. Upstream OpenClaw Dashboard Plugin Architecture

The project leverages a decoupled, plugin-based architecture where each dashboard view is an isolated micro-frontend located under `pages/<plugin-name>/`:

```
pierre_stock_warroom/
├── server.js                   # Express Gateway & Dynamic Plugin Autoloader
├── package.json                # Dependencies (express, d3, cors, dotenv)
├── data/
│   └── portfolio_40.json       # Canonical 40-Asset / 8-Cluster State Store
├── public/                     # App Shell & Master Navigation Frame
│   ├── index.html              # Top bar, UTC clock, dynamic tab injector, iframe viewport
│   ├── css/style.css           # Global Cyber Dark-Mode Design System
│   └── js/shell.js             # Client router & plugin loader
├── pages/                      # Pluggable Feature Views
│   ├── overview/               # Reference System Telemetry Plugin
│   │   ├── plugin.json         # Metadata manifest (id, name, order, icon)
│   │   ├── index.html          # Sub-view DOM
│   │   ├── client.js           # Sub-view D3.js logic
│   │   └── style.css           # Sub-view styling
│   └── war-room/               # (Phase 3 & 4) 40-Stock Tactical War Room Plugin
│       ├── plugin.json
│       ├── index.html
│       ├── client.js
│       ├── style.css
│       └── routes.js           # Plugin-specific backend API endpoints
```

#### Plugin Discovery & Contract:
1. **Manifest Contract (`plugin.json`):**
   ```json
   {
     "id": "war-room",
     "name": "Stock War Room",
     "description": "40-Asset Thematic Cluster Matrix & Live Swarm Scene",
     "icon": "shield",
     "order": 1,
     "version": "1.0.0"
   }
   ```
2. **Mounting:** `server.js` scans `pages/` at startup:
   - Registers static assets at `/pages/<plugin-name>/`
   - Auto-mounts optional backend routes at `/api/plugins/<plugin-name>` if `routes.js` is present.
   - Exposes list of loaded plugins via `GET /api/plugins`.

---

### 3. Canonical 40-Asset Universe & 8 Thematic Clusters

The state is persisted in `data/portfolio_40.json`. Every asset is initialized in watchlist mode (`shares: 0`, `owned: false`):

| Cluster ID | Cluster Name | Asset Count | Tickers |
|---|---|---|---|
| **1** | Defense & Government Contracts | 5 | `LDOS`, `LHX`, `HII`, `TXT`, `ACM` |
| **2** | Energy, Midstream & Pipelines | 6 | `OXY`, `DVN`, `KMI`, `WMB`, `BKR`, `ENB` |
| **3** | Power & Utilities | 3 | `ETR`, `NEE`, `VST` |
| **4** | Healthcare, Bio & Devices | 6 | `PFE`, `EW`, `BSX`, `BMY`, `NVO`, `HIMS` |
| **5** | Nuclear & Uranium Infrastructure | 4 | `CCJ`, `NXE`, `OKLO`, `SMR` |
| **6** | Big Tech, Fintech & Platforms | 6 | `META`, `GOOGL`, `UBER`, `GEN`, `SOFI`, `KWEB` |
| **7** | Next-Gen Tech & Robotics | 5 | `IONQ`, `JOBY`, `EH`, `RR`, `CELH` |
| **8** | Crypto, Mining & Commodities | 5 | `BTC-USD`, `ABTC`, `NEM`, `FCX`, `MOS` |
| **TOTAL** | **8 Clusters** | **40 Stocks** | |

#### Schema Definition (`data/portfolio_40.json`):
```json
{
  "ticker": "LDOS",
  "name": "Leidos Holdings, Inc.",
  "cluster_id": 1,
  "cluster_name": "Defense & Government Contracts",
  "shares": 0,
  "owned": false,
  "avg_cost": 0.0,
  "spot_price": null,
  "change_24h_pct": null,
  "position_value": 0.0,
  "sentiment_regime": "UNSCANNED",
  "risk_modifier": 1.0
}
```

---

### 4. Inline Editable Shares Workflow (Phase 3 & 4)

- **Zero-Friction Editing:** The matrix view presents an inline editable input for `Shares Owned` on every asset card/row.
- **Dynamic State Transition:**
  - `shares == 0`: Displays a subtle cyan **[WATCHLIST]** badge.
  - `shares > 0`: Immediately flips `owned: true` and renders an emerald **[PORTFOLIO]** badge.
- **Auto-Calculations:**
  - `Position Value = shares * spot_price`
  - Total Portfolio Capital = $\sum (\text{shares}_i \times \text{spot\_price}_i)$
  - Top Portfolio Ribbon dynamically updates with aggregate capital, top gainer/loser, and cluster distribution.
- **Persistence:** Input `blur` or `Enter` emits a `POST /api/plugins/war-room/update-position` saving changes immediately to `data/portfolio_40.json`.

---

### 5. Telemetry Bridge & Read-Only Cross-Project Links

The War Room integrates external intelligence via strictly read-only bridges without modifying any upstream files:

1. **CrowdSentinel Sentiment Signals:**
   - Source: `C:\Anti-Gravity-Core\pierre_openclaw_sentiment_scraper\shared_signals\crowd_sentiment.json`
   - Ingests `regime` (`BULLISH`, `BEARISH`, `UNCERTAIN`), `composite_sentiment_score`, and risk indicators.
2. **OpenClaw Swarm Telemetry:**
   - Source: `~/.openclaw/workspace/` / `~/.openclaw/workspace-supervisor/`
   - Monitors active agent heartbeat logs, daemon execution status, and pipeline events.
3. **Price Ingestion Engine:**
   - Real-time batch quote fetcher querying Yahoo Finance / Twelve Data with local in-memory TTL caching (60s) to prevent API rate-limiting.

---

### 6. Isolation Rules
- **Parent Isolation:** `pierre_stock_warroom/` is ignored in parent `C:\Anti-Gravity-Core\.gitignore`.
- **Standalone Remote:** Backed exclusively by `https://github.com/engpierre/pierre-stock-warroom.git`.
- **Desktop Mirror:** Synced at `$env:USERPROFILE\Desktop\pierre_stock_warroom` without `node_modules` or `.git`.
