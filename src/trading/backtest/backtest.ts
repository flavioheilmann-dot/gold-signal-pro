import type { Candle, RiskConfig, MarketContext, PaperTrade } from "../types";
import { analyze, DEFAULT_STRATEGY_OPTS, type StrategyOptions } from "../strategy/StrategyEngine";
import { MIN_PAPER_SCORE } from "../strategy/confidence";
import { indicesAligned, structureTrend } from "../strategy/tjr";
import { RiskManager } from "../risk/RiskManager";
import { PaperBroker } from "../paper/PaperBroker";

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface BacktestResult {
  trades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgRR: number;
  bestTrade: number;
  worstTrade: number;
  netPnl: number;
  equityCurve: EquityPoint[];
  closed: PaperTrade[];
  sufficientData: boolean; // >= 30 trades
  startEquity: number;
}

/**
 * Optional higher-fidelity inputs so the backtest exercises the SAME gates the
 * live engine/scanner use:
 *  • `ltf`     — 1-minute candles for the multi-timeframe entry (1m BOS).
 *  • `indices` — US100 × US500 series; when `isIndex`, each bar is gated on
 *                their alignment exactly like the live index-alignment filter.
 * All optional → calling runBacktest(candles, sym, risk) behaves as before.
 */
export interface BacktestInputs {
  ltf?: Candle[];
  indices?: { us100: Candle[]; us500: Candle[] };
  isIndex?: boolean;
  htf?: Candle[]; // 1H series for the higher-timeframe bias filter
}

/** Candles up to and including time `t` (series assumed time-ascending). */
function sliceUpTo(arr: Candle[], t: number, ptr: { i: number }): Candle[] {
  while (ptr.i < arr.length && arr[ptr.i].time <= t) ptr.i++;
  return arr.slice(0, ptr.i);
}

/**
 * Walk the strategy over historical candles. At each bar we re-analyze the
 * window up to that bar; when a ≥75 "ready" setup appears (and risk allows
 * and no position is open) we open a paper trade, then step open trades with
 * the bar. O(n²) in pivot work — intended for a manual, bounded backtest.
 *
 * No result is labelled "profitable"; we only report measured stats, and flag
 * when the sample is too small (<30 trades).
 */
export function runBacktest(
  candles: Candle[],
  symbol: string,
  risk: RiskConfig,
  opts: StrategyOptions = DEFAULT_STRATEGY_OPTS,
  inputs: BacktestInputs = {}
): BacktestResult {
  const rm = new RiskManager(risk);
  const paper = new PaperBroker();
  const equityCurve: EquityPoint[] = [{ time: candles[0]?.time ?? 0, equity: risk.accountStart }];

  const step = candles.length > 1 ? candles[1].time - candles[0].time : 300;
  const gateIndices = inputs.isIndex && inputs.indices;
  // moving pointers so per-bar slicing stays cheap and monotonic
  const pA = { i: 0 }, pB = { i: 0 }, pL = { i: 0 }, pH = { i: 0 };

  for (let i = 60; i < candles.length; i++) {
    const bar = candles[i];
    // step open trades with this bar first
    const closedNow = paper.update(bar, symbol);
    for (const ev of closedNow) {
      rm.registerResult(ev.pnl);
      equityCurve.push({ time: bar.time, equity: rm.state.equity });
    }

    if (paper.hasOpenFor(symbol)) continue;
    const ct = rm.canTrade();
    if (!ct.ok) continue;

    const window = candles.slice(0, i + 1);

    // index-alignment gate (US100 × US500) up to this bar's time
    let indexAligned: boolean | undefined;
    let aligned = false;
    if (gateIndices) {
      const a = sliceUpTo(inputs.indices!.us100, bar.time, pA);
      const b = sliceUpTo(inputs.indices!.us500, bar.time, pB);
      const al = a.length >= 30 && b.length >= 30 ? indicesAligned(a, b) : { aligned: false };
      aligned = al.aligned;
      indexAligned = aligned;
    }

    // 1m candles up to this bar's close for the MTF entry trigger
    const ltf = inputs.ltf ? sliceUpTo(inputs.ltf, bar.time + step, pL) : undefined;

    // higher-timeframe (1H) bias up to this bar
    let htfBias: "up" | "down" | "range" | undefined;
    if (inputs.htf) {
      const h = sliceUpTo(inputs.htf, bar.time, pH);
      htfBias = h.length >= 30 ? structureTrend(h) : "range";
    }

    const ctx: MarketContext = {
      symbol, spreadPct: 0.02, newsRisk: false,
      contextConfirms: aligned, choppy: false, indexAligned, htfBias,
    };
    const res = analyze(window, ctx, risk, opts, ltf);
    if (res.stage === "ready" && res.signal && res.signal.confidence >= MIN_PAPER_SCORE) {
      const v = rm.validateSignal(res.signal);
      if (!v.ok) continue;
      const { size, riskAmount } = rm.positionSize(res.signal.entry, res.signal.stopLoss);
      if (size <= 0) continue;
      paper.openTrade(res.signal, size, riskAmount, bar.time);
      rm.registerOpen();
    }
  }

  const closed = paper.closed;
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pnls = closed.map((t) => t.pnl);

  let peak = risk.accountStart, maxDd = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = ((peak - p.equity) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    trades: closed.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    maxDrawdownPct: +maxDd.toFixed(2),
    avgRR: closed.length ? +(closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length).toFixed(2) : 0,
    bestTrade: pnls.length ? +Math.max(...pnls).toFixed(2) : 0,
    worstTrade: pnls.length ? +Math.min(...pnls).toFixed(2) : 0,
    netPnl: +pnls.reduce((s, p) => s + p, 0).toFixed(2),
    equityCurve,
    closed,
    sufficientData: closed.length >= 30,
    startEquity: risk.accountStart,
  };
}
