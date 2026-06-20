import type { Candle, LiquidityLevel, SweepEvent } from "../types";

/**
 * A liquidity sweep: price wicks BEYOND a level but the candle CLOSES back
 * inside the range (stop-hunt / false break).
 *  • sweeping a HIGH → bearish sweep (buy-side liquidity taken, expect down)
 *  • sweeping a LOW  → bullish sweep (sell-side liquidity taken, expect up)
 * Returns the most significant sweep at candle `i`, or null.
 */
export function detectSweepAt(candles: Candle[], levels: LiquidityLevel[], i: number): SweepEvent | null {
  const c = candles[i];
  if (!c) return null;
  let best: SweepEvent | null = null;
  let bestPierce = 0;

  for (const lvl of levels) {
    if (lvl.index >= i) continue; // level must exist before it can be swept

    if (lvl.side === "high" && c.high > lvl.price && c.close < lvl.price) {
      const pierce = c.high - lvl.price;
      if (pierce > bestPierce) {
        bestPierce = pierce;
        best = { dir: "bearish", level: lvl, index: i, extreme: c.high, reclaim: c.close };
      }
    }
    if (lvl.side === "low" && c.low < lvl.price && c.close > lvl.price) {
      const pierce = lvl.price - c.low;
      if (pierce > bestPierce) {
        bestPierce = pierce;
        best = { dir: "bullish", level: lvl, index: i, extreme: c.low, reclaim: c.close };
      }
    }
  }
  return best;
}

/** Most recent sweep within the last `lookback` candles. */
export function findRecentSweep(candles: Candle[], levels: LiquidityLevel[], lookback = 8): SweepEvent | null {
  const last = candles.length - 1;
  for (let i = last; i >= Math.max(0, last - lookback); i--) {
    const s = detectSweepAt(candles, levels, i);
    if (s) return s;
  }
  return null;
}
