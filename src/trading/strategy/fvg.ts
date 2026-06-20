import type { Candle, FairValueGap } from "../types";

/**
 * Three-candle Fair Value Gap (imbalance):
 *  • bullish FVG: high of candle[i-2] < low of candle[i]
 *    → gap = [high_{i-2} .. low_i], price likely revisits it from above.
 *  • bearish FVG: low of candle[i-2]  > high of candle[i]
 *    → gap = [high_i .. low_{i-2}].
 * `index` is the middle candle (i-1). `filled` if later price traded
 * through the 50% midpoint.
 */
export function detectFVGs(candles: Candle[]): FairValueGap[] {
  const out: FairValueGap[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];

    if (a.high < c.low) {
      const bottom = a.high, top = c.low;
      const mid = (top + bottom) / 2;
      out.push({ dir: "bullish", top, bottom, mid, index: i - 1, filled: filled(candles, i, mid, "bullish") });
    } else if (a.low > c.high) {
      const top = a.low, bottom = c.high;
      const mid = (top + bottom) / 2;
      out.push({ dir: "bearish", top, bottom, mid, index: i - 1, filled: filled(candles, i, mid, "bearish") });
    }
  }
  return out;
}

function filled(candles: Candle[], formedAt: number, mid: number, dir: "bullish" | "bearish"): boolean {
  for (let j = formedAt + 1; j < candles.length; j++) {
    if (dir === "bullish" && candles[j].low <= mid) return true;
    if (dir === "bearish" && candles[j].high >= mid) return true;
  }
  return false;
}

/**
 * Most recent UNFILLED FVG in `dir` that formed at or after `afterIndex`
 * (i.e. created by the move that followed the structure shift).
 */
export function findEntryFVG(candles: Candle[], afterIndex: number, dir: "bullish" | "bearish"): FairValueGap | null {
  const fvgs = detectFVGs(candles).filter((f) => f.dir === dir && f.index >= afterIndex && !f.filled);
  if (!fvgs.length) return null;
  return fvgs[fvgs.length - 1];
}
