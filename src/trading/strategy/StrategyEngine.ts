import type {
  Candle, Bias, LiquidityLevel, SweepEvent, StructureShift, FairValueGap,
  TradeSignal, MarketContext, RiskConfig,
} from "../types";
import { detectLiquidityLevels, drawsInDirection } from "./liquidity";
import { findRecentSweep } from "./sweep";
import { detectStructureShift } from "./structure";
import { findEntryFVG } from "./fvg";
import { sessionOf, isPreferredSession, isKillzone } from "./sessions";
import { scoreSignal, MIN_SIGNAL_SCORE } from "./confidence";
import { recentInverseFVG, equilibrium, recentBOS, type InverseFvg } from "./tjr";

export type SetupStage =
  | "no_data"
  | "no_alignment" // TJR: NASDAQ/ES disagree → stand aside
  | "long_only_skip" // long-only mode (indices) → short setup ignored
  | "htf_conflict" // setup against the higher-timeframe bias → skip
  | "off_killzone" // outside the London/NY killzone → skip
  | "waiting_sweep"
  | "waiting_mss" // sweep found, no BOS/MSS and no IFVG flip yet
  | "waiting_fvg" // structure confirmed, no FVG / equilibrium entry yet
  | "waiting_retrace" // full setup, price not yet in the entry zone
  | "waiting_entry" // price in zone, awaiting the 1-minute BOS trigger (MTF)
  | "ready"; // entry confirmed (zone tapped + 1m BOS, or zone tapped if no LTF)

export interface AnalysisResult {
  stage: SetupStage;
  stageLabel: string;
  bias: Bias;
  levels: LiquidityLevel[];
  sweep: SweepEvent | null;
  mss: StructureShift | null;
  ifvg: InverseFvg | null; // inverse-FVG flip (alternative structure confirmation)
  fvg: FairValueGap | null;
  entryVia: "fvg" | "equilibrium" | null; // which confluence anchored the entry
  ltfConfirmed: boolean | null; // 1m BOS confirmed (null = no LTF supplied)
  signal: TradeSignal | null; // non-null once a ≥70 setup exists
}

const STAGE_LABEL: Record<SetupStage, string> = {
  no_data: "Zu wenig Daten",
  no_alignment: "Indizes nicht aligned — kein Trade",
  long_only_skip: "Long-only (Index) — Short ignoriert",
  htf_conflict: "Gegen 1H-Bias — kein Trade",
  off_killzone: "Außerhalb der Killzone — kein Trade",
  waiting_sweep: "Warte auf Liquidity Sweep",
  waiting_mss: "Sweep erkannt — warte auf BOS / IFVG-Flip",
  waiting_fvg: "Struktur bestätigt — warte auf FVG / Equilibrium",
  waiting_retrace: "Setup bereit — warte auf Retrace in die Zone",
  waiting_entry: "Preis in Zone — warte auf 1m-BOS (Entry)",
  ready: "Setup aktiv — Entry bestätigt",
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
  longOnly?: boolean; // indices drift up → only take longs (TJR V2 finding)
  requireKillzone?: boolean; // only enter inside the London/NY killzones
}
export const DEFAULT_STRATEGY_OPTS: StrategyOptions = { sweepLookback: 10, k: 2 };

/**
 * Full TJR/ICT analysis on the higher timeframe (`candles`, e.g. 5m):
 *   1) liquidity sweep → 2) structure confirmation (BOS/MSS **or** IFVG flip)
 *   → 3) entry zone (FVG **or** equilibrium) → 4) retrace into the zone
 *   → 5) (optional) a 1-minute BOS confirms the actual entry.
 *
 * `ltf` = lower-timeframe candles (1m). When supplied, a setup only reaches
 * "ready" once price both retraced into the zone AND printed a 1m BOS in the
 * trade direction; without it the model is HTF-only (ready on the retrace).
 */
export function analyze(
  candles: Candle[],
  ctx: MarketContext,
  risk: RiskConfig,
  opts: StrategyOptions = DEFAULT_STRATEGY_OPTS,
  ltf?: Candle[]
): AnalysisResult {
  const base = (stage: SetupStage, extra: Partial<AnalysisResult> = {}): AnalysisResult => ({
    stage, stageLabel: STAGE_LABEL[stage], bias: "neutral",
    levels: [], sweep: null, mss: null, ifvg: null, fvg: null,
    entryVia: null, ltfConfirmed: null, signal: null, ...extra,
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
  const long = dir === "bullish";
  const sign = long ? 1 : -1;

  // TJR V2 directional filters (from the "improved TJR" backtest):
  //  • long-only (indices drift up → shorts bleed)
  //  • higher-timeframe (1H) bias must agree with the setup
  //  • optionally only inside the London/NY killzones
  if (opts.longOnly && !long) return base("long_only_skip", { levels, sweep, bias });
  if (ctx.htfBias && ctx.htfBias !== "range" &&
      ((long && ctx.htfBias !== "up") || (!long && ctx.htfBias !== "down"))) {
    return base("htf_conflict", { levels, sweep, bias });
  }
  if (opts.requireKillzone && !isKillzone(candles[candles.length - 1].time)) {
    return base("off_killzone", { levels, sweep, bias });
  }

  // C) structure confirmation — BOS/MSS **or** an inverse-FVG flip (TJR)
  const mss = detectStructureShift(candles, sweep.index, dir, opts.k);
  const ifvg = recentInverseFVG(candles, sweep.index, dir);
  if (!mss && !ifvg) return base("waiting_mss", { levels, sweep, bias });
  const anchorIndex = mss?.index ?? ifvg?.index ?? sweep.index;

  // D) entry zone — a fresh FVG, else fall back to the leg's equilibrium (50%)
  const last = candles[candles.length - 1];
  const price = last.close;
  const fvg = findEntryFVG(candles, anchorIndex, dir);

  let entry: number, zoneTop: number, zoneBottom: number;
  let entryVia: "fvg" | "equilibrium";
  if (fvg) {
    entry = fvg.mid; zoneTop = fvg.top; zoneBottom = fvg.bottom; entryVia = "fvg";
  } else {
    // equilibrium of the displacement leg measured from the sweep extreme
    const legSeg = candles.slice(sweep.index);
    const legHi = long ? Math.max(...legSeg.map((c) => c.high)) : sweep.extreme;
    const legLo = long ? sweep.extreme : Math.min(...legSeg.map((c) => c.low));
    if (!(legHi > legLo)) return base("waiting_fvg", { levels, sweep, mss, ifvg, bias });
    const eq = equilibrium(legHi, legLo);
    const tol = price * 0.0006; // ~0.06% band around the 50%
    entry = eq; zoneTop = eq + tol; zoneBottom = eq - tol; entryVia = "equilibrium";
  }

  // E) protective stop — behind the ENTRY swing (tighter, better RR), with the
  // sweep extreme as a wider fallback when the swing stop would be too tight.
  const buffer = price * 0.0003 + (ctx.spreadPct / 100) * price; // spread/slippage cushion
  const seg = candles.slice(anchorIndex);
  const entrySwingExtreme = long ? Math.min(...seg.map((c) => c.low)) : Math.max(...seg.map((c) => c.high));
  const swingSL = long ? entrySwingExtreme - buffer : entrySwingExtreme + buffer;
  const sweepSL = long ? sweep.extreme - buffer : sweep.extreme + buffer;
  const validSide = (sl: number) => (long ? sl < entry : sl > entry);
  const stopPctOf = (sl: number) => (Math.abs(entry - sl) / price) * 100;
  const stopLoss =
    validSide(swingSL) && stopPctOf(swingSL) >= risk.minStopPct ? swingSL : sweepSL;

  const riskDist = Math.abs(entry - stopLoss);
  if (riskDist <= 0) return base("waiting_fvg", { levels, sweep, mss, ifvg, fvg, bias });

  // F) targets = the next liquidity DRAWS in the trade direction.
  //    TP1 (partial) = nearest draw, clamped to a sane 1R–2R band.
  //    TP2 (runner)  = the next draw beyond TP1, at least 2R.
  const draws = drawsInDirection(levels, entry, long);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const r = riskDist;
  const tp1 = draws[0] != null
    ? (long ? clamp(draws[0], entry + r, entry + 2 * r) : clamp(draws[0], entry - 2 * r, entry - r))
    : entry + sign * r;
  const beyond = draws.find((d) => (long ? d > tp1 + 1e-9 : d < tp1 - 1e-9));
  const tp2Floor = entry + sign * 2 * r;
  const takeProfit2 = beyond != null
    ? (long ? Math.max(beyond, tp2Floor) : Math.min(beyond, tp2Floor))
    : tp2Floor;
  const takeProfit1 = tp1;
  const riskReward = Math.abs(takeProfit2 - entry) / riskDist;

  // retrace + entry trigger
  const tapped = last.low <= zoneTop && last.high >= zoneBottom;
  let ltfConfirmed: boolean | null = null;
  let stage: SetupStage;
  if (!tapped) {
    stage = "waiting_retrace";
  } else if (ltf && ltf.length >= 10) {
    ltfConfirmed = recentBOS(ltf, dir);
    stage = ltfConfirmed ? "ready" : "waiting_entry";
  } else {
    stage = "ready";
  }

  // G) confidence score
  const stopPct = (riskDist / price) * 100;
  const conf = scoreSignal({
    sweep: true,
    mss: !!mss,
    ifvg: !!ifvg,
    cleanFVG: entryVia === "fvg" && !!fvg && !fvg.filled && (fvg.top - fvg.bottom) / price > 0.0003,
    ltfConfirmed: ltfConfirmed === true,
    preferredSession: isPreferredSession(sessionOf(last.time)),
    rrOk: riskReward >= risk.minRR,
    contextConfirms: ctx.contextConfirms,
    lowSpread: ctx.spreadPct <= risk.maxSpreadPct * 0.6,
    newsRisk: ctx.newsRisk,
    badSpread: ctx.spreadPct > risk.maxSpreadPct,
    choppy: ctx.choppy || isChoppy(candles),
    noCorrelation: false,
  });

  const reasons = [...conf.reasons];
  if (entryVia === "equilibrium") reasons.push("Entry: Equilibrium (50%)");
  if (ltf && ltf.length >= 10) reasons.push(ltfConfirmed ? "1m-Entry getriggert" : "1m-BOS noch offen");

  const warnings = [...conf.warnings];
  if (riskReward < risk.minRR) warnings.push(`RR ${riskReward.toFixed(2)} < ${risk.minRR}`);
  if (stopPct < risk.minStopPct) warnings.push("Stop sehr eng");
  if (stopPct > risk.maxStopPct) warnings.push("Stop sehr weit");

  const partial = (extra: Partial<AnalysisResult>) =>
    ({ ...base(stage, { levels, sweep, mss, ifvg, fvg, entryVia, ltfConfirmed, bias }), ...extra });

  // no signal below the display threshold — never show a low-quality setup
  if (conf.score < MIN_SIGNAL_SCORE) return partial({ signal: null });

  const signal: TradeSignal = {
    id: `${ctx.symbol}-${last.time}-${dir}`,
    time: last.time,
    symbol: ctx.symbol,
    direction: long ? "BUY" : "SELL",
    entryZone: { from: +zoneBottom.toFixed(2), to: +zoneTop.toFixed(2) },
    entry: +entry.toFixed(2),
    stopLoss: +stopLoss.toFixed(2),
    takeProfit1: +takeProfit1.toFixed(2),
    takeProfit2: +takeProfit2.toFixed(2),
    riskReward: +riskReward.toFixed(2),
    confidence: conf.score,
    session: sessionOf(last.time),
    reasons,
    warnings,
  };

  return partial({ signal });
}
