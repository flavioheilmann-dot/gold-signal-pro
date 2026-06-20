import type { Candle, PaperTrade, TradeSignal } from "../types";

/** Spread/slippage drag applied per closed trade, in units of R. */
const COST_R = 0.02;

export interface CloseEvent {
  trade: PaperTrade;
  pnl: number;
  rMultiple: number;
}

/**
 * Paper-trading simulator. Opens simulated positions from signals and steps
 * them forward candle-by-candle: stop loss, TP1 (50% partial + move to
 * breakeven), then runner to TP2. Pure simulation — no real orders.
 *
 * Internal per-trade machine state is tracked in a side map so PaperTrade
 * stays a clean serialisable record.
 */
export class PaperBroker {
  open: PaperTrade[] = [];
  closed: PaperTrade[] = [];

  private machine = new Map<string, { R: number; remaining: number; realizedR: number; stop: number }>();

  constructor(open: PaperTrade[] = [], closed: PaperTrade[] = []) {
    this.open = open;
    this.closed = closed;
    // rebuild machine state for any re-hydrated open trades
    for (const t of open) {
      const R = Math.abs(t.entry - t.stopLoss);
      this.machine.set(t.id, {
        R,
        remaining: t.tookPartial ? 0.5 : 1,
        realizedR: t.tookPartial ? 0.5 : 0,
        stop: t.tookPartial ? t.entry : t.stopLoss,
      });
    }
  }

  hasOpenFor(symbol: string): boolean {
    return this.open.some((t) => t.symbol === symbol);
  }

  /** Open a simulated trade from a signal. `size`/`riskAmount` from RiskManager. */
  openTrade(sig: TradeSignal, size: number, riskAmount: number, atTime: number): PaperTrade {
    const t: PaperTrade = {
      id: `${sig.id}-${atTime}`,
      openedAt: atTime,
      closedAt: null,
      symbol: sig.symbol,
      direction: sig.direction,
      entry: sig.entry,
      stopLoss: sig.stopLoss,
      takeProfit1: sig.takeProfit1,
      takeProfit2: sig.takeProfit2,
      riskReward: sig.riskReward,
      size,
      riskAmount,
      reason: sig.reasons.join(", "),
      confidence: sig.confidence,
      status: "open",
      exit: null,
      pnl: 0,
      rMultiple: 0,
      tookPartial: false,
    };
    this.open.push(t);
    this.machine.set(t.id, { R: Math.abs(t.entry - t.stopLoss), remaining: 1, realizedR: 0, stop: t.stopLoss });
    return t;
  }

  /**
   * Step open trades with a new candle. If `symbol` is given, only trades for
   * that symbol advance (the engine watches one symbol at a time, so trades on
   * other symbols pause rather than being stepped with the wrong candles).
   * Returns trades that fully closed.
   */
  update(candle: Candle, symbol?: string): CloseEvent[] {
    const closedNow: CloseEvent[] = [];
    for (const t of [...this.open]) {
      if (symbol && t.symbol !== symbol) continue;
      const m = this.machine.get(t.id);
      if (!m || m.R <= 0) continue;
      const long = t.direction === "BUY";

      // 1) stop loss first (conservative)
      const hitStop = long ? candle.low <= m.stop : candle.high >= m.stop;
      if (hitStop) {
        const rOnExit = (long ? m.stop - t.entry : t.entry - m.stop) / m.R;
        m.realizedR += m.remaining * rOnExit;
        m.remaining = 0;
        this.finalize(t, m, m.stop, candle.time);
        closedNow.push({ trade: t, pnl: t.pnl, rMultiple: t.rMultiple });
        continue;
      }

      // 2) TP1 → realise 50%, move stop to breakeven
      if (!t.tookPartial) {
        const hitTp1 = long ? candle.high >= t.takeProfit1 : candle.low <= t.takeProfit1;
        if (hitTp1) {
          m.realizedR += 0.5 * ((long ? t.takeProfit1 - t.entry : t.entry - t.takeProfit1) / m.R);
          m.remaining = 0.5;
          m.stop = t.entry; // breakeven
          t.tookPartial = true;
          t.status = "partial";
        }
      }

      // 3) TP2 → close runner
      const hitTp2 = long ? candle.high >= t.takeProfit2 : candle.low <= t.takeProfit2;
      if (hitTp2) {
        m.realizedR += m.remaining * ((long ? t.takeProfit2 - t.entry : t.entry - t.takeProfit2) / m.R);
        m.remaining = 0;
        this.finalize(t, m, t.takeProfit2, candle.time);
        closedNow.push({ trade: t, pnl: t.pnl, rMultiple: t.rMultiple });
      }
    }
    return closedNow;
  }

  private finalize(t: PaperTrade, m: { realizedR: number }, exit: number, time: number) {
    const r = m.realizedR - COST_R;
    t.exit = +exit.toFixed(2);
    t.rMultiple = +r.toFixed(2);
    t.pnl = +(r * t.riskAmount).toFixed(2);
    t.closedAt = time;
    t.status = r > 0.05 ? "closed_win" : r < -0.05 ? "closed_loss" : "breakeven";
    this.open = this.open.filter((x) => x.id !== t.id);
    this.closed.push(t);
    this.machine.delete(t.id);
  }

  serialize(): { open: PaperTrade[]; closed: PaperTrade[] } {
    return { open: this.open, closed: this.closed };
  }
}
