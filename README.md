# Pierre Stock War Room (`pierre-stock-warroom`)

Tactical monitoring dashboard and execution matrix for Pierre's 40-asset investment universe across 8 thematic clusters. Built with Express and D3.js adhering to the OpenClaw pluggable micro-frontend dashboard architecture.

---

## Architecture Overview
- **Engine:** Express.js + D3.js (v7) dark-mode UI
- **Plugin System:** Dynamic auto-loader scanning `pages/`
- **Canonical Universe:** 40 assets across 8 thematic clusters defined in `data/portfolio_40.json`
- **Telemetry Bridge:** Read-only ingestion of crowd sentiment signals (`CrowdSentinel`) and OpenClaw agent buffers

## Quick Start
```bash
# Install dependencies
npm install

# Launch dashboard server
npm start
```
Default URL: `http://localhost:3888`

## Project Documentation
- [WARROOM_SPEC.md](WARROOM_SPEC.md) — Master Architecture & Plugin Contracts
- [PROGRESS.md](PROGRESS.md) — Implementation Milestones & Roadmap
- [data/portfolio_40.json](data/portfolio_40.json) — 40-Asset Thematic Cluster Registry
