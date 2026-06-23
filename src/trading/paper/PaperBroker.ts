import type { Candle, ExitMode, PaperTrade, TradeSignal } from "../types";

/** Spread/slippage drag applied per closed trade, in units of R. */
const COST_R = 0.02;

export interface CloseEvent {
  trade: PaperTrade;
  pnl: number;
  rMultiple: number;
}

interface Machine {
  R: number;
  remaining: number;
  realizedR: number;
  stop: number;
  maxR: number; // best favourable excursion in R (for the trailing exit)
  mode: ExitMode;
}

/**
 * Paper-trading simulator. Opens simulated positions from signals and steps
 * them forward candle-by-candle. Exit handling depends on the signal's
 * `exitMode`:
 *  • "trail"  — no take-profit; once price reaches +1R the stop ratchets to
 *               break-even, +2R → +1R, … (the TJR V2 trailing exit). No partials.
 *  • "rr1to1" — fixed 1:1: exits at +1R or the stop, no partial.
 *  • "tp"     — legacy: TP1 (50% partial → breakeven) then TP2 runner.
 * Pure simulation — no real orders.
 */
export class PaperBroker {
  open: PaperTrade[] = [];
  closed: PaperTrade[] = [];

  private machine = new Map<string, Machine>();

  constructor(open: PaperTrade[] = [], closed: PaperTrade[] = []) {
    this.open = open;
    this.closed = closed;
    for (const t of open) {
      const R = Math.abs(t.entry - t.stopLoss);
      this.machine.set(t.id, {
        R,
        remaining: t.tookPartial ? 0.5 : 1,
        realizedR: t.tookPartial ? 0.5 : 0,
        stop: t.tookPartial ? t.entry : t.stopLoss,
        maxR: 0,
        mode: t.exitMode ?? "tp",
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
      exitMode: sig.exitMode ?? "tp",
    };
    this.open.push(t);
    this.machine.set(t.id, { R: Math.abs(t.entry - t.stopLoss), remaining: 1, realizedR: 0, stop: t.stopLoss, maxR: 0, mode: t.exitMode ?? "tp" });
    return t;
  }

  /**
   * Step open trades with a new candle. If `symbol` is given, only trades for
   * that symbol advance. Returns trades that fully closed.
   */
  update(candle: Candle, symbol?: string): CloseEvent[] {
    const closedNow: CloseEvent[] = [];
    for (const t of [...this.open]) {
      if (symbol && t.symbol !== symbol) continue;
      const m = this.machine.get(t.id);
      if (!m || m.R <= 0) continue;
      const long = t.direction === "BUY";
      const sign = long ? 1 : -1;

      // ── Trailing-stop exit (no take-profit, no partials) ──
      if (m.mode === "trail") {
        if (long ? candle.low <= m.stop : candle.high >= m.stop) {
          this.closeAt(t, m, m.stop, candle.time, closedNow);
          continue;
        }
        // ratchet the trail with this bar's favourable extreme
        const ext = long ? candle.high : candle.low;
        const rNow = (sign * (ext - t.entry)) / m.R;
        if (rNow > m.maxR) m.maxR = rNow;
        const level = Math.floor(m.maxR); // +1R → BE, +2R → +1R, …
        if (level >= 1) {
          const newStop = t.entry + sign * (level - 1) * m.R;
          m.stop = long ? Math.max(m.stop, newStop) : Math.min(m.stop, newStop);
          if (level >= 1) { t.tookPartial = true; t.status = "partial"; } // "in profit / risk-free"
        }
        continue;
      }

      // ── Fixed 1:1 exit (no partials) ──
      if (m.mode === "rr1to1") {
        if (long ? candle.low <= m.stop : candle.high >= m.stop) {
          this.closeAt(t, m, m.stop, candle.time, closedNow);
          continue;
        }
        if (long ? candle.high >= t.takeProfit1 : candle.low <= t.takeProfit1) {
          this.closeAt(t, m, t.takeProfit1, candle.time, closedNow);
          continue;
        }
        continue;
      }

      // ── Legacy "tp": stop → TP1 (50% partial + breakeven) → TP2 runner ──
      const hitStop = long ? candle.low <= m.stop : candle.high >= m.stop;
      if (hitStop) {
        const rOnExit = (long ? m.stop - t.entry : t.entry - m.stop) / m.R;
        m.realizedR += m.remaining * rOnExit;
        m.remaining = 0;
        this.finalize(t, m, m.stop, candle.time);
        closedNow.push({ trade: t, pnl: t.pnl, rMultiple: t.rMultiple });
        continue;
      }
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

  /** Close a single-exit trade (trail / 1:1) entirely at `exit`. */
  private closeAt(t: PaperTrade, m: Machine, exit: number, time: number, out: CloseEvent[]) {
    const long = t.direction === "BUY";
    m.realizedR = (long ? exit - t.entry : t.entry - exit) / m.R;
    m.remaining = 0;
    this.finalize(t, m, exit, time);
    out.push({ trade: t, pnl: t.pnl, rMultiple: t.rMultiple });
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
