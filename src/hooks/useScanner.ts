import { useCallback, useEffect, useRef, useState } from "react";
import { WATCHLIST, type Asset } from "@/lib/assets";
import { getCandles } from "@/lib/capital";
import {
  computeSeries,
  decide,
  snapshotAt,
  type StrategyParams,
  type Decision,
  type Snapshot,
  type SignalEvent,
  type StrategySeries,
} from "@/lib/signalEngine";

export interface ScanResult {
  asset: Asset;
  series: StrategySeries;
  decision: Decision;
  events: SignalEvent[];
  snap: Snapshot;
  price: number;
  changePct: number;
}

/** Higher = shown first: actionable & high-conviction, then liquidity. */
export function tradeScore(r: ScanResult): number {
  const conv = r.decision.bias !== "flat" ? r.decision.confidence : 0;
  return conv * 100 + r.asset.liquidity;
}

export function useScanner(
  connected: boolean,
  params: StrategyParams,
  intervalMs = 60000
) {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!connected || busy.current) return;
    busy.current = true;
    setScanning(true);
    const out: ScanResult[] = [];
    for (const asset of WATCHLIST) {
      try {
        const candles = await getCandles(asset.epic, "MINUTE_15", 300);
        if (candles.length < 90) continue; // enough for EMA50 + box + MACD on 15M
        const series = computeSeries(candles, params);
        const { current, events } = decide(series, params);
        const snap = snapshotAt(series, series.prices.length - 1, params);
        const last = candles[candles.length - 1].close;
        const dayAgo = candles[Math.max(0, candles.length - 96)].close;
        out.push({
          asset,
          series,
          decision: current,
          events,
          snap,
          price: last,
          changePct: ((last - dayAgo) / dayAgo) * 100,
        });
      } catch {
        /* skip assets that error (e.g. market closed / unknown epic) */
      }
    }
    out.sort((a, b) => tradeScore(b) - tradeScore(a));
    setResults(out);
    setScanning(false);
    busy.current = false;
  }, [connected, params]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { results, scanning, refresh };
}
