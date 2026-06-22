import type {
  Candle, Bias, LiquidityLevel, SweepEvent, StructureShift, FairValueGap,
  TradeSignal, MarketContext, RiskConfig,
} from "../types";
import { detectLiquidityLevels, nearestLevel } from "./liquidity";
import { findRecentSweep } from "./sweep";
import { detectStructureShift } from "./structure";
import { findEntryFVG } from "./fvg";
import { sessionOf, isPreferredSession } from "./sessions";
import { scoreSignal, MIN_SIGNAL_SCORE } from "./confidence";

export type SetupStage =
  | "no_data"
  | "no_alignment" // TJR: NASDAQ/ES disagree → stand aside
  | "waiting_sweep"
  | "waiting_mss"
  | "waiting_fvg"
  | "waiting_retrace" // full setup, price not yet in the FVG zone
  | "ready"; // price retraced into the FVG → eligible to execute

export interface AnalysisResult {
  stage: SetupStage;
  stageLabel: string;
  bias: Bias;
  levels: LiquidityLevel[];
  sweep: SweepEvent | null;
  mss: StructureShift | null;
  fvg: FairValueGap | null;
  signal: TradeSignal | null; // non-null once a ≥70 setup exists (sweep+MSS+FVG)
}

const STAGE_LABEL: Record<SetupStage, string> = {
  no_data: "Zu wenig Daten",
  no_alignment: "Indizes nicht aligned — kein Trade",
  waiting_sweep: "Warte auf Liquidity Sweep",
  waiting_mss: "Sweep erkannt — warte auf Structure Shift",
  waiting_fvg: "Structure Shift — warte auf FVG",
  waiting_retrace: "Setup bereit — warte auf Retrace in FVG",
  ready: "Setup aktiv — Preis in FVG-Zone",
};

/** Rough choppiness: net move vs total path over the last n candles. */
function isChoppy(candles: Candle[], n = 14): boolean {
  const seg = candles.slice(-n);
  if (seg.length < n) return false;
  const net = Math.abs(seg[seg.length - 1].close - seg[0].open);
  const path = seg.reduce((s, c) => s + (c.high - c.low), 0);
  return path > 0 && net / path < 0.18;
}

export interface StrategyOptions {
  sweepLookback: number; // how far back to look for the originating sweep
  k: number; // pivot strength
}
export const DEFAULT_STRATEGY_OPTS: StrategyOptions = { sweepLookback: 10, k: 2 };

export function analyze(
  candles: Candle[],
  ctx: MarketContext,
  risk: RiskConfig,
  opts: StrategyOptions = DEFAULT_STRATEGY_OPTS
): AnalysisResult {
  const base = (stage: SetupStage, extra: Partial<AnalysisResult> = {}): AnalysisResult => ({
    stage, stageLabel: STAGE_LABEL[stage], bias: "neutral",
    levels: [], sweep: null, mss: null, fvg: null, signal: null, ...extra,
  });

  if (candles.length < 60) return base("no_data");
  // TJR's top rule: don't trade indices when NASDAQ and ES disagree
  if (ctx.indexAligned === false) return base("no_alignment");
  const levels = detectLiquidityLevels(candles, opts.k);

  // A) + B) liquidity sweep
  const sweep = findRecentSweep(candles, levels, opts.sweepLookback);
  if (!sweep) return base("waiting_sweep", { levels });
  const dir: "bullish" | "bearish" = sweep.dir;
  const bias: Bias = dir;

  // C) market structure shift in the swept direction
  const mss = detectStructureShift(candles, sweep.index, dir, opts.k);
  if (!mss) return base("waiting_mss", { levels, sweep, bias });

  // D) fair value gap created by the displacement after the MSS
  const fvg = findEntryFVG(candles, mss.index, dir);
  if (!fvg) return base("waiting_fvg", { levels, sweep, mss, bias });

  // E) build the trade plan
  const last = candles[candles.length - 1];
  const price = last.close;
  const long = dir === "bullish";
  const sign = long ? 1 : -1;

  const buffer = price * 0.0003 + (ctx.spreadPct / 100) * price; // spread/slippage cushion
  const entry = fvg.mid;
  const stopLoss = long ? sweep.extreme - buffer : sweep.extreme + buffer;
  const riskDist = Math.abs(entry - stopLoss);
  if (riskDist <= 0) return base("waiting_fvg", { levels, sweep, mss, fvg, bias });

  // TP2 = next liquidity target in trade direction, but at least 2R
  const target = nearestLevel(levels, entry, long ? "above" : "below", long ? "high" : "low");
  const tp2Floor = entry + sign * 2 * riskDist;
  const takeProfit2 = target
    ? long ? Math.max(target.price, tp2Floor) : Math.min(target.price, tp2Floor)
    : tp2Floor;
  const takeProfit1 = entry + sign * 1 * riskDist; // 1R partial
  const riskReward = Math.abs(takeProfit2 - entry) / riskDist;

  // retrace check: did the latest candle tap the FVG zone?
  const tapped = last.low <= fvg.top && last.high >= fvg.bottom;
  const stage: SetupStage = tapped ? "ready" : "waiting_retrace";

  // 8) confidence score
  const stopPct = (riskDist / price) * 100;
  const conf = scoreSignal({
    sweep: true,
    mss: true,
    cleanFVG: !fvg.filled && (fvg.top - fvg.bottom) / price > 0.0003,
    preferredSession: isPreferredSession(sessionOf(last.time)),
    rrOk: riskReward >= risk.minRR,
    contextConfirms: ctx.contextConfirms,
    lowSpread: ctx.spreadPct <= risk.maxSpreadPct * 0.6,
    newsRisk: ctx.newsRisk,
    badSpread: ctx.spreadPct > risk.maxSpreadPct,
    choppy: ctx.choppy || isChoppy(candles),
    noCorrelation: false,
  });

  const warnings = [...conf.warnings];
  if (riskReward < risk.minRR) warnings.push(`RR ${riskReward.toFixed(2)} < ${risk.minRR}`);
  if (stopPct < risk.minStopPct) warnings.push("Stop sehr eng");
  if (stopPct > risk.maxStopPct) warnings.push("Stop sehr weit");

  // no signal below the display threshold — never show a low-quality setup
  if (conf.score < MIN_SIGNAL_SCORE) {
    return { ...base(stage, { levels, sweep, mss, fvg, bias }), signal: null };
  }

  const signal: TradeSignal = {
    id: `${ctx.symbol}-${last.time}-${dir}`,
    time: last.time,
    symbol: ctx.symbol,
    direction: long ? "BUY" : "SELL",
    entryZone: { from: fvg.bottom, to: fvg.top },
    entry: +entry.toFixed(2),
    stopLoss: +stopLoss.toFixed(2),
    takeProfit1: +takeProfit1.toFixed(2),
    takeProfit2: +takeProfit2.toFixed(2),
    riskReward: +riskReward.toFixed(2),
    confidence: conf.score,
    session: sessionOf(last.time),
    reasons: conf.reasons,
    warnings,
  };

  return { stage, stageLabel: STAGE_LABEL[stage], bias, levels, sweep, mss, fvg, signal };
}
