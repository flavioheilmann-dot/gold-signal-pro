import type { Candle } from "../types";
import type { DataProvider } from "./DataProvider";

/**
 * Real-data adapter that reuses the existing Capital.com backend proxy
 * (`/api/capital/candles/:epic`). Read-only — it only fetches candles,
 * it never places orders. Degrades to [] when the backend is offline.
 *
 * VITE_API_BASE_URL is honoured so this also works against a remote proxy.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

const TF_MAP: Record<string, string> = {
  "1m": "MINUTE",
  "5m": "MINUTE_5",
  "15m": "MINUTE_15",
  "30m": "MINUTE_30",
  "1h": "HOUR",
  "4h": "HOUR_4",
  "1d": "DAY",
};

export class CapitalDataProvider implements DataProvider {
  readonly name = "Capital.com";
  readonly mode = "live" as const;

  async getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
    const resolution = TF_MAP[timeframe] ?? "MINUTE_5";
    try {
      const res = await fetch(
        `${API_BASE}/api/capital/candles/${encodeURIComponent(symbol)}?resolution=${resolution}&max=${limit}`
      );
      if (!res.ok) return [];
      const d = (await res.json()) as { candles?: Candle[] };
      return Array.isArray(d.candles) ? d.candles : [];
    } catch {
      return [];
    }
  }

  async getSpreadPct(symbol: string): Promise<number> {
    try {
      const res = await fetch(`${API_BASE}/api/capital/market/${encodeURIComponent(symbol)}`);
      if (!res.ok) return 0;
      const d = (await res.json()) as { bid?: number | null; offer?: number | null };
      if (d.bid == null || d.offer == null || !d.offer) return 0;
      return ((d.offer - d.bid) / d.offer) * 100;
    } catch {
      return 0;
    }
  }
}
