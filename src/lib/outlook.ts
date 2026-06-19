// ─────────────────────────────────────────────────────────────
// Live "how is the chart likely to develop next" probability,
// derived purely from the strategy's own read of the data (trend,
// momentum, position vs EMA, conviction). Bounded to 8–92% so it
// never pretends to certainty. Updates on every refresh.
// ─────────────────────────────────────────────────────────────

import type { Snapshot, StrategyParams } from "./indicators";

export type OutlookTone = "up" | "down" | "neutral";

export interface Outlook {
  bullPct: number; // probability the next move is up (0..100)
  tone: OutlookTone;
  label: string;
  summary: string;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export interface BuyOutlook {
  buyPct: number; // blended probability the right move is to BUY
  sellPct: number;
  tone: OutlookTone;
  label: string;
  technicalBull: number; // chart-only contribution
  newsBull: number; // news-only contribution
}

/**
 * Blend the live technical chart probability with the news bias into a
 * single Kaufen/Verkaufen probability. Technik weighs more (0.65) than
 * the slower-moving news backdrop (0.35).
 */
export function combineOutlook(
  technicalBull: number,
  newsBull: number
): BuyOutlook {
  const buyPct = Math.round(0.65 * technicalBull + 0.35 * newsBull);
  const sellPct = 100 - buyPct;
  const tone: OutlookTone =
    buyPct >= 58 ? "up" : buyPct <= 42 ? "down" : "neutral";
  const label =
    tone === "up"
      ? "Kaufen wahrscheinlich"
      : tone === "down"
        ? "Verkaufen wahrscheinlich"
        : "Neutral – abwarten";
  return { buyPct, sellPct, tone, label, technicalBull, newsBull };
}

export function computeOutlook(snap: Snapshot, p: StrategyParams): Outlook {
  const atr = snap.atr && snap.atr > 0 ? snap.atr : 1;

  let score = 0;
  if (snap.trend === "up") score += 12;
  else if (snap.trend === "down") score -= 12;

  // momentum (MACD histogram normalized by ATR)
  const mom = (snap.macdHist ?? 0) / atr;
  score += clamp(mom * 8, -14, 14);

  // price position relative to fast EMA
  if (snap.emaFast != null) {
    const pos = (snap.price - snap.emaFast) / atr;
    score += clamp(pos * 5, -8, 8);
  }

  // conviction: a weak trend pulls the estimate back toward 50/50
  const conviction = clamp(snap.strength / (p.strengthMin * 1.4), 0, 1);
  const bull = 50 + score * (0.6 + 0.4 * conviction);
  const bullPct = Math.round(clamp(bull, 8, 92));

  const tone: OutlookTone =
    bullPct >= 58 ? "up" : bullPct <= 42 ? "down" : "neutral";
  const label =
    tone === "up"
      ? "Aufwärts wahrscheinlich"
      : tone === "down"
        ? "Abwärts wahrscheinlich"
        : "Richtungslos / unentschieden";

  const momWord =
    (snap.macdHist ?? 0) > 0 ? "Momentum positiv" : "Momentum negativ";
  const trendWord =
    snap.trend === "up"
      ? "Aufwärtstrend"
      : snap.trend === "down"
        ? "Abwärtstrend"
        : "Seitwärtsmarkt";
  const summary = `${trendWord}, ${momWord}${conviction > 0.7 ? ", klare Struktur" : conviction < 0.4 ? ", schwache Struktur" : ""}`;

  return { bullPct, tone, label, summary };
}
