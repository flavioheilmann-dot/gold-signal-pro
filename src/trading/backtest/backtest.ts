import type { Candle, RiskConfig, MarketContext, PaperTrade } from "../types";
import { analyze, DEFAULT_STRATEGY_OPTS, type StrategyOptions } from "../strategy/StrategyEngine";
import { MIN_PAPER_SCORE } from "../strategy/confidence";
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
  opts: StrategyOptions = DEFAULT_STRATEGY_OPTS
): BacktestResult {
  const rm = new RiskManager(risk);
  const paper = new PaperBroker();
  const equityCurve: EquityPoint[] = [{ time: candles[0]?.time ?? 0, equity: risk.accountStart }];

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
    const ctx: MarketContext = { symbol, spreadPct: 0.02, newsRisk: false, contextConfirms: false, choppy: false };
    const res = analyze(window, ctx, risk, opts);
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
