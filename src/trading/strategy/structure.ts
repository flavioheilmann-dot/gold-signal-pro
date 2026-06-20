import type { Candle, StructureShift } from "../types";

export interface Pivot {
  index: number;
  price: number;
  side: "high" | "low";
}

/**
 * Fractal swing pivots: a swing high at i is the local max of high over
 * [i-k, i+k]; a swing low the local min of low. `k` = strength (default 2).
 */
export function swingPivots(candles: Candle[], k = 2): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: candles[i].high, side: "high" });
    if (isLow) out.push({ index: i, price: candles[i].low, side: "low" });
  }
  return out;
}

export function swingHighs(candles: Candle[], k = 2): Pivot[] {
  return swingPivots(candles, k).filter((p) => p.side === "high");
}
export function swingLows(candles: Candle[], k = 2): Pivot[] {
  return swingPivots(candles, k).filter((p) => p.side === "low");
}

/**
 * Market Structure Shift after a sweep.
 *  • bullish: after sweeping a low, price CLOSES above the most recent
 *    internal swing high formed at/around the sweep.
 *  • bearish: after sweeping a high, price CLOSES below the most recent
 *    internal swing low.
 * `dir` is the expected post-sweep direction. Scans candles AFTER the sweep
 * up to `maxBars` ahead. Returns the shift, or null if structure didn't break.
 */
export function detectStructureShift(
  candles: Candle[],
  sweepIndex: number,
  dir: "bullish" | "bearish",
  k = 2,
  maxBars = 12
): StructureShift | null {
  const pivots = swingPivots(candles, k);
  const end = Math.min(candles.length - 1, sweepIndex + maxBars);

  if (dir === "bullish") {
    // the swing high to break = most recent swing high at/before the sweep
    const ref = [...pivots].filter((p) => p.side === "high" && p.index <= sweepIndex).pop();
    if (!ref) return null;
    for (let i = sweepIndex + 1; i <= end; i++) {
      if (candles[i].close > ref.price) {
        return { dir: "bullish", brokenLevel: ref.price, index: i, kind: "MSS" };
      }
    }
  } else {
    const ref = [...pivots].filter((p) => p.side === "low" && p.index <= sweepIndex).pop();
    if (!ref) return null;
    for (let i = sweepIndex + 1; i <= end; i++) {
      if (candles[i].close < ref.price) {
        return { dir: "bearish", brokenLevel: ref.price, index: i, kind: "MSS" };
      }
    }
  }
  return null;
}
