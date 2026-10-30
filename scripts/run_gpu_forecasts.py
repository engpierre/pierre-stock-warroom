#!/usr/bin/env python3
"""
scripts/run_gpu_forecasts.py
====================================================================
Local GPU TimesFM / Amazon Chronos Zero-Shot Time-Series Forecast Runner.
Standardized CLI bridge for Pierre Stock War Room & Julie Reactive Core.

Accepts:
  --tickers <LIST>     : Space or comma-separated tickers
  --active-only        : Dynamically loads active holdings (shares > 0)
  --all-universe       : Dynamically loads all assets from portfolio_40.json
  --horizon 5          : Forecast steps (default: 5 days)
  --device <DEV>       : "auto", "cuda:0", "cuda:1", or "cpu"

Outputs:
  Atomically updates C:\\Users\\Pierre\\.openclaw\\workspace\\chronos_intel_buffer.json
  and data/chronos_intel_buffer.json.
====================================================================
"""

import sys
import os
import json
import argparse
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

# UTF-8 stdout protection for Windows CP1252 environments
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

# Path definitions
ROOT_DIR = Path(__file__).resolve().parent.parent
PORTFOLIO_PATH = ROOT_DIR / "data" / "portfolio_40.json"
LOCAL_BUFFER_PATH = ROOT_DIR / "data" / "chronos_intel_buffer.json"
WORKSPACE_BUFFER_PATH = Path(r"C:\Users\Pierre\.openclaw\workspace\chronos_intel_buffer.json")
VAULT_RECONS_DIR = Path(r"C:\Users\Pierre\.openclaw\workspace\vault\Recons")


def resolve_device(requested: str = "auto") -> str:
    """Detects available hardware (CUDA vs CPU)."""
    try:
        import torch
        if requested != "auto":
            return requested
        if torch.cuda.is_available():
            # If dual GPU, prefer cuda:0 or cuda:1
            return "cuda:0"
        return "cpu"
    except Exception:
        return "cpu"


def load_universe_tickers(mode: str) -> List[str]:
    """Dynamically reads tickers from data/portfolio_40.json."""
    if not PORTFOLIO_PATH.exists():
        print(f"[WARN] Portfolio path not found: {PORTFOLIO_PATH}", file=sys.stderr)
        return []

    try:
        with open(PORTFOLIO_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        assets = data.get("assets", [])
        if mode == "active":
            return [a["ticker"].upper() for a in assets if float(a.get("shares", 0)) > 0]
        else:
            return [a["ticker"].upper() for a in assets]
    except Exception as e:
        print(f"[ERROR] Failed to read portfolio: {e}", file=sys.stderr)
        return []


def fetch_historical_series(ticker: str, days: int = 90) -> Optional[List[float]]:
    """Fetches historical close series via yfinance or Yahoo Finance API fallback."""
    clean_ticker = ticker.strip().upper().replace("$", "")
    
    # Method 1: yfinance
    try:
        import yfinance as yf
        stock = yf.Ticker(clean_ticker)
        df = stock.history(period=f"{days}d", interval="1d")
        if not df.empty and len(df) >= 10:
            import pandas as pd
            close_series = df["Close"]
            if isinstance(close_series, pd.DataFrame):
                close_series = close_series.iloc[:, 0]
            vals = [float(x) for x in close_series.dropna().values]
            if len(vals) >= 10:
                return vals
    except Exception as exc:
        pass

    # Method 2: Direct Yahoo Finance Chart API v8
    try:
        import urllib.request
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{clean_ticker}?range=3mo&interval=1d"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = data.get("chart", {}).get("result", [{}])[0]
        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
        clean_closes = [float(c) for c in closes if c is not None]
        if len(clean_closes) >= 10:
            return clean_closes
    except Exception as exc:
        pass

    return None


class ForecastPipeline:
    """Encapsulates Chronos-Bolt / TimesFM / Statistical Drift pipelines."""
    def __init__(self, target_device: str):
        self.device = target_device
        self.engine_name = "UNINITIALIZED"
        self.pipeline = None
        self._init_pipeline()

    def _init_pipeline(self):
        try:
            import torch
            from chronos import BaseChronosPipeline
            model_id = "amazon/chronos-bolt-small"
            print(f"[GPU FORECAST] Loading foundation model '{model_id}' on {self.device}...", file=sys.stderr)
            self.pipeline = BaseChronosPipeline.from_pretrained(
                model_id,
                device_map=self.device,
                torch_dtype=torch.float32
            )
            self.engine_name = f"Chronos-Bolt ({model_id} on {self.device})"
            print(f"[GPU FORECAST] Foundation model ready: {self.engine_name}", file=sys.stderr)
            return
        except Exception as e:
            print(f"[WARN] Chronos-Bolt loading error ({e}). Trying Chronos-T5 / TimesFM fallback...", file=sys.stderr)

        # Candidate 2: TimesFM
        try:
            import timesfm
            if hasattr(timesfm, "TimesFM3Forecaster"):
                self.pipeline = timesfm.TimesFM3Forecaster.from_pretrained(
                    pretrained_model_name_or_path="google/timesfm-2.5-200m-pytorch",
                    device=self.device
                )
                self.engine_name = f"TimesFM-2.5 (google/timesfm-2.5-200m on {self.device})"
                return
        except Exception as e:
            pass

        # Candidate 3: Statistical Autoregressive Drift Fallback
        self.pipeline = "STATISTICAL_DRIFT"
        self.engine_name = f"Statistical-ARIMA-Drift (cpu)"
        print(f"[GPU FORECAST] Using statistical fallback pipeline: {self.engine_name}", file=sys.stderr)

    def forecast_5d(self, series: List[float], horizon: int = 5) -> Dict[str, Any]:
        """Generates 5-day probabilistic forecast distribution (p10, p50, p90)."""
        import numpy as np
        spot = series[-1]

        if hasattr(self.pipeline, "predict"):
            try:
                import torch
                context = torch.tensor(series, dtype=torch.float32)
                # Predict returns [batch, num_samples, horizon]
                forecast = self.pipeline.predict(context, prediction_length=horizon)
                # Forecast tensor quantile reduction
                quantiles = torch.quantile(forecast[0], torch.tensor([0.10, 0.50, 0.90]), dim=0)
                p10_vec = [round(float(x), 2) for x in quantiles[0]]
                p50_vec = [round(float(x), 2) for x in quantiles[1]]
                p90_vec = [round(float(x), 2) for x in quantiles[2]]

                target_p50 = p50_vec[-1]
                target_p10 = p10_vec[-1]
                target_p90 = p90_vec[-1]
                ret_pct = round(((target_p50 - spot) / spot) * 100.0, 2)
                bias = "BULLISH_DRIFT" if ret_pct >= 0.5 else ("BEARISH_DRIFT" if ret_pct <= -0.5 else "FLAT_CONSOLIDATION")

                return {
                    "spot_price": round(spot, 2),
                    "forecast_5d_p50": target_p50,
                    "forecast_5d_p10": target_p10,
                    "forecast_5d_p90": target_p90,
                    "forecast_return_pct": ret_pct,
                    "directional_bias": bias,
                    "trajectory_5d": p50_vec,
                    "p10_vector": p10_vec,
                    "p90_vector": p90_vec,
                    "model_engine": self.engine_name,
                    "device": self.device
                }
            except Exception as e:
                print(f"[WARN] Inference exception ({e}), falling back to momentum drift", file=sys.stderr)

        # Robust Mathematical Autoregressive Momentum Fallback
        n = min(14, len(series))
        recent = series[-n:]
        returns = [(recent[i] - recent[i-1]) / recent[i-1] for i in range(1, len(recent))]
        drift = float(np.mean(returns)) if returns else 0.001
        vol = float(np.std(returns)) if len(returns) > 1 else 0.015

        p50_vec = []
        p10_vec = []
        p90_vec = []
        curr_50 = spot
        for step in range(1, horizon + 1):
            curr_50 = curr_50 * (1.0 + drift)
            spread = curr_50 * vol * np.sqrt(step) * 1.28  # ~80% confidence interval (p10-p90)
            p50_vec.append(round(curr_50, 2))
            p10_vec.append(round(max(0.01, curr_50 - spread), 2))
            p90_vec.append(round(curr_50 + spread, 2))

        target_p50 = p50_vec[-1]
        ret_pct = round(((target_p50 - spot) / spot) * 100.0, 2)
        bias = "BULLISH_DRIFT" if ret_pct >= 0.5 else ("BEARISH_DRIFT" if ret_pct <= -0.5 else "FLAT_CONSOLIDATION")

        return {
            "spot_price": round(spot, 2),
            "forecast_5d_p50": target_p50,
            "forecast_5d_p10": p10_vec[-1],
            "forecast_5d_p90": p90_vec[-1],
            "forecast_return_pct": ret_pct,
            "directional_bias": bias,
            "trajectory_5d": p50_vec,
            "p10_vector": p10_vec,
            "p90_vector": p90_vec,
            "model_engine": "Statistical-Autoregressive-Drift (cpu)",
            "device": "cpu"
        }


def save_atomic_buffer(target_path: Path, new_data: Dict[str, Any]):
    """Atomically writes JSON buffer with existing entry preservation."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    if target_path.exists():
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = {}

    forecasts = existing.get("forecasts", {})
    if not isinstance(forecasts, dict):
        forecasts = {}

    # Merge new predictions
    for ticker, payload in new_data.items():
        forecasts[ticker] = payload

    combined = {
        "status": "ONLINE",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total_forecasts": len(forecasts),
        "forecasts": forecasts
    }

    # Write atomic tmp file
    tmp_path = target_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2)
    tmp_path.replace(target_path)


def update_vault_recon(ticker: str, forecast: Dict[str, Any]):
    """Appends/updates foundation model projection block inside Obsidian Vault Recon dossier."""
    recon_path = VAULT_RECONS_DIR / f"{ticker}.md"
    if not recon_path.exists():
        return

    try:
        with open(recon_path, "r", encoding="utf-8") as f:
            content = f.read()

        model_block = f"""## 🧠 Foundation Model 5-Day Projection ({forecast.get('model_engine', 'Chronos/TimesFM')})
- **5-Day Model Target (p50):** ${forecast.get('forecast_5d_p50', 0):.2f} ({forecast.get('forecast_return_pct', 0):+0.2f}%)
- **Quantile Cone (p10 – p90):** ${forecast.get('forecast_5d_p10', 0):.2f} — ${forecast.get('forecast_5d_p90', 0):.2f}
- **Directional Bias:** `{forecast.get('directional_bias', 'NEUTRAL')}`
- **Engine / Device:** `{forecast.get('model_engine', 'Chronos')}` | Last Run: {forecast.get('updated_at', '')}
"""

        # Replace existing projection block or append before footer
        if "## 🧠 Foundation Model 5-Day Projection" in content:
            import re
            content = re.sub(
                r"## 🧠 Foundation Model 5-Day Projection.*?(?=\n## |\Z)",
                model_block.strip() + "\n",
                content,
                flags=re.DOTALL
            )
        else:
            content = content.strip() + "\n\n" + model_block

        with open(recon_path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        print(f"[WARN] Failed to update vault recon for {ticker}: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Pierre Stock War Room - Local GPU TimesFM / Chronos Forecast Runner")
    parser.add_argument("--tickers", type=str, default="", help="Space or comma-separated tickers")
    parser.add_argument("--active-only", action="store_true", help="Forecast all active owned holdings (shares > 0)")
    parser.add_argument("--all-universe", action="store_true", help="Forecast all assets in portfolio_40.json")
    parser.add_argument("--horizon", type=int, default=5, help="Forecast horizon in days (default: 5)")
    parser.add_argument("--device", type=str, default="auto", help="Execution device: auto, cuda:0, cpu")
    parser.add_argument("--json-output", action="store_true", help="Output raw JSON to stdout")

    args = parser.parse_args()

    # Determine tickers to forecast
    target_tickers = []
    if args.active_only:
        target_tickers = load_universe_tickers("active")
    elif args.all_universe:
        target_tickers = load_universe_tickers("all")
    elif args.tickers:
        raw = args.tickers.replace(",", " ").split()
        target_tickers = [t.strip().upper().replace("$", "") for t in raw if t.strip()]

    if not target_tickers:
        print("[ERROR] No target tickers specified. Use --active-only, --all-universe, or --tickers <LIST>", file=sys.stderr)
        sys.exit(1)

    device = resolve_device(args.device)
    print(f"[GPU FORECAST] Initializing forecast run for {len(target_tickers)} assets on {device} (Horizon: {args.horizon}d)...", file=sys.stderr)

    pipeline = ForecastPipeline(target_device=device)

    results = {}
    t0 = time.time()
    for idx, ticker in enumerate(target_tickers, 1):
        print(f"[{idx}/{len(target_tickers)}] Processing ${ticker}...", file=sys.stderr)
        series = fetch_historical_series(ticker)
        if not series or len(series) < 10:
            print(f"  [WARN] Insufficient historical data for ${ticker}, skipping.", file=sys.stderr)
            continue

        res = pipeline.forecast_5d(series, horizon=args.horizon)
        res["ticker"] = ticker
        res["updated_at"] = datetime.now(timezone.utc).isoformat()
        results[ticker] = res

        # Sync to Obsidian dossier
        update_vault_recon(ticker, res)

    elapsed = time.time() - t0
    print(f"[GPU FORECAST] Completed {len(results)}/{len(target_tickers)} forecasts in {elapsed:.2f}s", file=sys.stderr)

    # Atomically write to both workspace buffer and local data mirror
    save_atomic_buffer(LOCAL_BUFFER_PATH, results)
    save_atomic_buffer(WORKSPACE_BUFFER_PATH, results)
    print(f"[GPU FORECAST] Intel buffers updated: {WORKSPACE_BUFFER_PATH} and {LOCAL_BUFFER_PATH}", file=sys.stderr)

    if args.json_output:
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
