// Confidence score 0–100. This is a TECHNICAL confluence score, NOT a
// win-probability or guarantee. Points per the strategy spec.

export interface ConfidenceInputs {
  sweep: boolean; // liquidity sweep present
  mss: boolean; // market structure shift present
  cleanFVG: boolean; // clean fair value gap
  preferredSession: boolean; // London / NY open / NY PM
  rrOk: boolean; // RR >= target (1:2)
  contextConfirms: boolean; // correlated context markets agree (incl. index alignment)
  lowSpread: boolean; // low spread / clean volatility
  newsRisk: boolean; // high-impact news imminent
  badSpread: boolean; // spread too wide
  choppy: boolean; // choppy / ranging market
  noCorrelation: boolean; // unclear / conflicting context
  ifvg?: boolean; // inverse-FVG flip confirming the reversal (TJR)
  ltfConfirmed?: boolean; // lower-timeframe (1m) BOS confirmed the entry
}

export interface ConfidenceResult {
  score: number; // clamped 0–100
  reasons: string[];
  warnings: string[];
}

export function scoreSignal(p: ConfidenceInputs): ConfidenceResult {
  let score = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (p.sweep) { score += 20; reasons.push("Liquidity Sweep (+20)"); }
  if (p.mss) { score += 20; reasons.push("Market Structure Shift (+20)"); }
  if (p.ifvg) { score += 10; reasons.push("Inverse FVG Flip (+10)"); }
  if (p.cleanFVG) { score += 15; reasons.push("Sauberer FVG (+15)"); }
  if (p.ltfConfirmed) { score += 10; reasons.push("1m-BOS bestätigt (+10)"); }
  if (p.preferredSession) { score += 15; reasons.push("Session passt (+15)"); }
  if (p.rrOk) { score += 10; reasons.push("RR ≥ 1:2 (+10)"); }
  if (p.contextConfirms) { score += 10; reasons.push("Kontextmarkt/Indizes bestätigt (+10)"); }
  if (p.lowSpread) { score += 10; reasons.push("Niedriger Spread / saubere Volatilität (+10)"); }

  if (p.newsRisk) { score -= 20; warnings.push("News-Risiko (−20)"); }
  if (p.badSpread) { score -= 15; warnings.push("Schlechter Spread (−15)"); }
  if (p.choppy) { score -= 15; warnings.push("Choppy Market (−15)"); }
  if (p.noCorrelation) { score -= 20; warnings.push("Fehlende Korrelation / unklarer Kontext (−20)"); }

  return { score: Math.max(0, Math.min(100, score)), reasons, warnings };
}

/** Only surface signals at/above this score. V1 has fewer confluence inputs
 *  (no FVG/IFVG/LTF) so the realistic ceiling is ~65; 50 lets valid setups through. */
export const MIN_SIGNAL_SCORE = 50;
/** Only auto-execute paper trades at/above this score. */
export const MIN_PAPER_SCORE = 55;
