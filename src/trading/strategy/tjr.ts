// ─────────────────────────────────────────────────────────────
// TJR-style liquidity strategy building blocks:
//  • Inverse Fair Value Gap (IFVG) — a FVG that price CLOSES THROUGH
//    (disrespected), flipping its bias. Used as the reversal/entry confluence.
//  • Equilibrium — the 50% of a leg, a continuation confluence.
//  • Structure trend + index alignment — only trade when NASDAQ and ES agree.
// For education / paper analysis only.
// ─────────────────────────────────────────────────────────────
import type { Candle } from "../types";
import { swingPivots } from "./structure";

export type StructTrend = "up" | "down" | "range";

/** 5m structure trend from the last two swing highs/lows (HH+HL up / LH+LL down). */
export function structureTrend(candles: Candle[], k = 2): StructTrend {
  const piv = swingPivots(candles, k);
  const highs = piv.filter((p) => p.side === "high").slice(-2);
  const lows = piv.filter((p) => p.side === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return "range";
  const hh = highs[1].price > highs[0].price;
  const hl = lows[1].price > lows[0].price;
  const lh = highs[1].price < highs[0].price;
  const ll = lows[1].price < lows[0].price;
  if (hh && hl) return "up";
  if (lh && ll) return "down";
  return "range";
}

/** Index-alignment filter: both series must trend the same (non-range) way. */
export function indicesAligned(a: Candle[], b: Candle[], k = 2): { aligned: boolean; dir: StructTrend } {
  const ta = structureTrend(a, k);
  const tb = structureTrend(b, k);
  if (ta !== "range" && ta === tb) return { aligned: true, dir: ta };
  return { aligned: false, dir: "range" };
}

/** 50% of a high/low range — TJR's equilibrium continuation level. */
export function equilibrium(high: number, low: number): number {
  return (high + low) / 2;
}

export interface InverseFvg {
  dir: "bullish" | "bearish"; // SIGNAL direction after the gap was disrespected
  level: number; // the broken gap boundary (now acts as S/R)
  index: number; // candle that closed through it
}

/**
 * Inverse FVGs: a bullish 3-candle gap that a later candle CLOSES BELOW becomes
 * a bearish signal; a bearish gap closed ABOVE becomes bullish. Only the first
 * close-through per gap counts.
 */
export function detectInverseFVGs(candles: Candle[]): InverseFvg[] {
  const out: InverseFvg[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    if (a.high < c.low) {
      const bottom = a.high; // bullish gap floor
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].close < bottom) { out.push({ dir: "bearish", level: bottom, index: j }); break; }
      }
    } else if (a.low > c.high) {
      const top = a.low; // bearish gap ceiling
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].close > top) { out.push({ dir: "bullish", level: top, index: j }); break; }
      }
    }
  }
  return out;
}

/** Most recent IFVG in `dir` at/after `afterIndex` (the reversal confirmation). */
export function recentInverseFVG(candles: Candle[], afterIndex: number, dir: "bullish" | "bearish"): InverseFvg | null {
  const all = detectInverseFVGs(candles).filter((f) => f.dir === dir && f.index >= afterIndex);
  return all.length ? all[all.length - 1] : null;
}
