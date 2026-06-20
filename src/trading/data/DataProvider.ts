import type { Candle } from "../types";

/**
 * Modular market-data source. Implementations must fail gracefully and
 * never throw — return [] when data is unavailable so the engine can
 * label an OFFLINE / no-data state instead of crashing.
 */
export interface DataProvider {
  readonly name: string;
  readonly mode: "mock" | "live";
  /** Most recent `limit` candles for `symbol` at `timeframe` (e.g. "5m"). */
  getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]>;
  /** Best-effort current spread as % of price (0 if unknown). */
  getSpreadPct?(symbol: string): Promise<number>;
}
