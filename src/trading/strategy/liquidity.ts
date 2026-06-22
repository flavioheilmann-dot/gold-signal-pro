import type { Candle, LiquidityLevel } from "../types";
import { latestSessionRanges, previousDayRange, SESSION_LABEL } from "./sessions";
import { swingPivots } from "./structure";

/**
 * Build the set of liquidity levels (resting liquidity pools) from candles:
 * previous day H/L, session H/L, swing H/L, equal H/L, hourly H/L.
 * Levels are where stops cluster — the magnets price reaches for / sweeps.
 */
export function detectLiquidityLevels(candles: Candle[], k = 2): LiquidityLevel[] {
  if (candles.length < 10) return [];
  const out: LiquidityLevel[] = [];
  const lastIdx = candles.length - 1;

  // Previous day high/low
  const pdr = previousDayRange(candles);
  if (pdr) {
    out.push({ kind: "prev_day_high", side: "high", price: pdr.high, index: pdr.index, label: "Prev Day High" });
    out.push({ kind: "prev_day_low", side: "low", price: pdr.low, index: pdr.index, label: "Prev Day Low" });
  }

  // Session highs/lows
  const mapKind = (s: string, side: "high" | "low"): LiquidityLevel["kind"] => {
    if (s === "asia") return side === "high" ? "asia_high" : "asia_low";
    if (s === "london") return side === "high" ? "london_high" : "london_low";
    return side === "high" ? "ny_high" : "ny_low"; // newyork_am / newyork_pm
  };
  for (const sr of latestSessionRanges(candles)) {
    out.push({ kind: mapKind(sr.session, "high"), side: "high", price: sr.high, index: sr.lastIndex, label: `${SESSION_LABEL[sr.session]} High` });
    out.push({ kind: mapKind(sr.session, "low"), side: "low", price: sr.low, index: sr.lastIndex, label: `${SESSION_LABEL[sr.session]} Low` });
  }

  // Swing highs/lows (recent ones only — last ~40 candles)
  const pivots = swingPivots(candles, k).filter((p) => p.index >= lastIdx - 40);
  for (const p of pivots) {
    out.push({
      kind: p.side === "high" ? "swing_high" : "swing_low",
      side: p.side,
      price: p.price,
      index: p.index,
      label: p.side === "high" ? "Swing High" : "Swing Low",
    });
  }

  // Equal highs / equal lows — clusters of swings within tolerance (liquidity pools)
  const tol = (avgPrice(candles) || 1) * 0.0006; // ~0.06%
  out.push(...equalLevels(pivots.filter((p) => p.side === "high"), "high", tol));
  out.push(...equalLevels(pivots.filter((p) => p.side === "low"), "low", tol));

  // Hourly highs/lows (previous few completed UTC hours)
  out.push(...hourlyLevels(candles));

  return dedupe(out);
}

function avgPrice(candles: Candle[]): number {
  return candles.reduce((s, c) => s + c.close, 0) / Math.max(1, candles.length);
}

function equalLevels(
  pivots: { index: number; price: number }[],
  side: "high" | "low",
  tol: number
): LiquidityLevel[] {
  const res: LiquidityLevel[] = [];
  for (let i = 0; i < pivots.length; i++) {
    for (let j = i + 1; j < pivots.length; j++) {
      if (Math.abs(pivots[i].price - pivots[j].price) <= tol) {
        const price = (pivots[i].price + pivots[j].price) / 2;
        res.push({
          kind: side === "high" ? "equal_high" : "equal_low",
          side,
          price,
          index: Math.max(pivots[i].index, pivots[j].index),
          label: side === "high" ? "Equal Highs" : "Equal Lows",
        });
      }
    }
  }
  return res;
}

function hourlyLevels(candles: Candle[]): LiquidityLevel[] {
  const byHour = new Map<number, { high: number; low: number; lastIndex: number }>();
  const order: number[] = [];
  candles.forEach((c, i) => {
    const hk = Math.floor(c.time / 3600);
    const g = byHour.get(hk);
    if (!g) {
      byHour.set(hk, { high: c.high, low: c.low, lastIndex: i });
      order.push(hk);
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.lastIndex = i;
    }
  });
  const recent = order.slice(-4, -1); // last few completed hours
  const out: LiquidityLevel[] = [];
  for (const hk of recent) {
    const g = byHour.get(hk)!;
    out.push({ kind: "hourly_high", side: "high", price: g.high, index: g.lastIndex, label: "Hourly High" });
    out.push({ kind: "hourly_low", side: "low", price: g.low, index: g.lastIndex, label: "Hourly Low" });
  }
  return out;
}

/** Remove near-identical levels (keep the most recent), preserving side. */
function dedupe(levels: LiquidityLevel[]): LiquidityLevel[] {
  const sorted = [...levels].sort((a, b) => b.index - a.index);
  const kept: LiquidityLevel[] = [];
  for (const l of sorted) {
    const dup = kept.find((k) => k.side === l.side && Math.abs(k.price - l.price) / (l.price || 1) < 0.0004);
    if (!dup) kept.push(l);
  }
  return kept;
}

/** Nearest level strictly above / below a price, on the requested side. */
export function nearestLevel(
  levels: LiquidityLevel[],
  price: number,
  where: "above" | "below",
  side?: "high" | "low"
): LiquidityLevel | null {
  const cands = levels.filter(
    (l) => (side ? l.side === side : true) && (where === "above" ? l.price > price : l.price < price)
  );
  if (!cands.length) return null;
  return cands.reduce((best, l) =>
    Math.abs(l.price - price) < Math.abs(best.price - price) ? l : best
  );
}

/**
 * Liquidity draws in the trade direction, ordered nearest → farthest from
 * `price`. For a long these are highs above price (buy-side liquidity to draw
 * into); for a short, lows below. These are the natural take-profit targets.
 * Near-duplicate prices are collapsed so TP1 and TP2 land on distinct pools.
 */
export function drawsInDirection(levels: LiquidityLevel[], price: number, long: boolean): number[] {
  const side: "high" | "low" = long ? "high" : "low";
  const draws = levels
    .filter((l) => l.side === side && (long ? l.price > price : l.price < price))
    .map((l) => l.price)
    .sort((a, b) => (long ? a - b : b - a)); // nearest first
  const out: number[] = [];
  for (const p of draws) {
    if (out.length && Math.abs(p - out[out.length - 1]) / (price || 1) < 0.0004) continue;
    out.push(p);
  }
  return out;
}
