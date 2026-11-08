"""
pierre_quant/runners/run_whale_scan.py
======================================
Executes Institutional Whale, Dark Pool, and Smart Money Flow Scan
leveraging Agent 10 (Smart Money Tracking) and Agent 13 (SEC Watchdog).
Outputs structured JSON for Julie's War Room HUD and voice synthesis.
"""
from __future__ import annotations
import argparse
import json
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

# Force UTF-8 on Windows
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.platform == "win32" and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Prioritize OpenClaw's complete pierre-quant package and avoid partial folder shadowing
PQ_ROOT = r"C:\Users\Pierre\.openclaw\workspace\pierre-quant"
sys.path = [PQ_ROOT] + [p for p in sys.path if not p.rstrip(r"\/").endswith("Anti-Gravity-Core")]

PORTFOLIO_PATHS = [
    Path(r"C:\Users\Pierre\Desktop\pierre_stock_warroom\data\portfolio_40.json"),
    Path(r"C:\Anti-Gravity-Core\data\portfolio_40.json")
]

try:
    from pierre_quant.analysis.smart_money import SmartMoneyAgent
    from pierre_quant.regulatory.sec_watchdog import SECWatchdogAgent
    from pierre_quant.core.agent_contract import AgentExecutionPayload
except Exception as e:
    print(json.dumps({"success": False, "error": f"Import failure: {e}"}))
    sys.exit(1)

logging.basicConfig(level=logging.WARNING, format="[%(asctime)s] [%(levelname)s] %(message)s")


def scan_single_asset(ticker: str) -> Dict[str, Any]:
    clean = ticker.strip().upper().lstrip("$")
    res = {
        "ticker": clean,
        "spot_price": 0.0,
        "flow_regime": "NEUTRAL_FLOW",
        "point_of_control": 0.0,
        "value_area_high": 0.0,
        "value_area_low": 0.0,
        "net_premium_flow": 0.0,
        "call_put_ratio": 1.0,
        "unusual_flow": False,
        "regulatory_state": "CLEAN_NEUTRAL",
        "insider_purchases": 0,
        "insider_sales": 0,
        "insider_net_shares": 0,
        "whale_bias": "NEUTRAL",
        "confidence": 50.0
    }

    try:
        p_money: AgentExecutionPayload = SmartMoneyAgent.analyze(clean)
        if p_money:
            res["spot_price"] = p_money.spot_price
            m = p_money.metrics or {}
            res["point_of_control"] = m.get("point_of_control", 0.0)
            res["value_area_high"] = m.get("value_area_high", 0.0)
            res["value_area_low"] = m.get("value_area_low", 0.0)
            res["flow_regime"] = m.get("flow_regime", "NEUTRAL_FLOW")
            res["net_premium_flow"] = m.get("net_premium_flow", 0.0)
            res["call_put_ratio"] = m.get("call_put_ratio", 1.0)
            res["unusual_flow"] = m.get("unusual_flow", False)
    except Exception as exc:
        logging.warning(f"SmartMoney scan error for {clean}: {exc}")

    try:
        p_sec = SECWatchdogAgent.evaluate(clean, as_dict=False)
        if p_sec:
            m = p_sec.metrics or {}
            res["regulatory_state"] = m.get("regulatory_state", "CLEAN_NEUTRAL")
            res["insider_purchases"] = m.get("purchase_count", 0)
            res["insider_sales"] = m.get("sale_count", 0)
            res["insider_net_shares"] = m.get("insider_net_shares", 0)
    except Exception as exc:
        logging.warning(f"SECWatchdog scan error for {clean}: {exc}")

    # Synthesize Whale Bias
    bull_pts = 0
    bear_pts = 0

    if res["flow_regime"] == "INSTITUTIONAL_ACCUMULATION":
        bull_pts += 2
    elif res["flow_regime"] == "INSTITUTIONAL_DISTRIBUTION":
        bear_pts += 2

    if "BUY" in res["regulatory_state"] or "ACCUMULATION" in res["regulatory_state"]:
        bull_pts += 2
    elif "DISTRIBUTION" in res["regulatory_state"]:
        bear_pts += 2

    if res["call_put_ratio"] >= 1.5:
        bull_pts += 1
    elif res["call_put_ratio"] <= 0.67:
        bear_pts += 1

    if bull_pts > bear_pts:
        res["whale_bias"] = "BULLISH"
        res["confidence"] = min(90.0, 60.0 + (bull_pts * 10))
    elif bear_pts > bull_pts:
        res["whale_bias"] = "BEARISH"
        res["confidence"] = min(90.0, 60.0 + (bear_pts * 10))
    else:
        res["whale_bias"] = "NEUTRAL"
        res["confidence"] = 55.0

    return res


def get_target_tickers(args: argparse.Namespace) -> List[str]:
    if args.tickers:
        return [t.strip().upper().lstrip("$") for t in args.tickers.split(",") if t.strip()]

    # If active-only, read owned positions from portfolio_40.json
    for p in PORTFOLIO_PATHS:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                owned = [a["ticker"] for a in data.get("assets", []) if a.get("shares", 0) > 0]
                if owned:
                    return owned
            except Exception:
                pass

    # Default fallback to active bellwethers
    return ["PFE", "LMT", "SOFI"]


def main():
    parser = argparse.ArgumentParser(description="Institutional Whale & Dark Pool Scan Runner")
    parser.add_argument("--tickers", type=str, default="", help="Comma-separated tickers to scan")
    parser.add_argument("--active-only", action="store_true", help="Scan only active holdings")
    parser.add_argument("--json", action="store_true", default=True, help="Output JSON format")
    args = parser.parse_args()

    targets = get_target_tickers(args)
    results: Dict[str, Any] = {}

    with ThreadPoolExecutor(max_workers=min(len(targets), 5)) as executor:
        futures = {executor.submit(scan_single_asset, sym): sym for sym in targets}
        for future in futures:
            sym = futures[future]
            try:
                results[sym] = future.result(timeout=20.0)
            except Exception as e:
                results[sym] = {"ticker": sym, "error": str(e), "whale_bias": "NEUTRAL"}

    # Overall Posture
    bulls = sum(1 for r in results.values() if r.get("whale_bias") == "BULLISH")
    bears = sum(1 for r in results.values() if r.get("whale_bias") == "BEARISH")
    if bulls > bears:
        posture = "INSTITUTIONAL_ACCUMULATION"
    elif bears > bulls:
        posture = "INSTITUTIONAL_DISTRIBUTION"
    else:
        posture = "NEUTRAL_FLOW"

    # Spoken summary for Julie
    summaries = []
    for sym, r in results.items():
        flow = r.get("flow_regime", "NEUTRAL").replace("_", " ")
        sec = r.get("regulatory_state", "NEUTRAL").replace("_", " ")
        poc = r.get("point_of_control", 0.0)
        summaries.append(f"${sym}: {flow} (POC ${poc:.2f}), SEC state: {sec}")

    summary_text = f"Pierre, institutional Whale & Smart Money scan completed across {len(results)} holdings. Overall posture: {posture.replace('_', ' ')}. " + "; ".join(summaries) + "."

    output = {
        "success": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "scanned_count": len(results),
        "overall_posture": posture,
        "speech_summary": summary_text,
        "assets": results
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
