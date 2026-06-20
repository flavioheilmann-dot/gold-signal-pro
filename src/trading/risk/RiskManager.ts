import type { RiskConfig, TradeSignal } from "../types";

export interface RiskState {
  equity: number;
  dayKey: string;
  dayPnl: number;
  dayTrades: number;
  consecLosses: number;
  dayStopped: boolean;
  weekKey: string;
  weekPnl: number;
}

export interface RiskStatus {
  equity: number;
  dayPnl: number;
  dayPnlPct: number;
  weekPnl: number;
  weekPnlPct: number;
  dayTrades: number;
  maxTrades: number;
  consecLosses: number;
  dayStopped: boolean;
  dailyLossLimit: number; // negative number (account currency)
  dailyLossUsedPct: number; // 0–100 of the daily loss budget
  canTrade: boolean;
  blockReason: string | null;
}

function utcDayKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function utcWeekKey(d = new Date()): string {
  const onejan = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.floor((d.getTime() - onejan) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${week}`;
}

/**
 * Hard risk controls. The engine MUST call canTrade() before every entry and
 * registerResult() after every close. All limits are configurable; defaults
 * are conservative (0.25%/trade, 1% daily, 3% weekly, 3 trades, 2-loss stop).
 */
export class RiskManager {
  cfg: RiskConfig;
  state: RiskState;

  constructor(cfg: RiskConfig, state?: RiskState) {
    this.cfg = cfg;
    this.state = state ?? {
      equity: cfg.accountStart,
      dayKey: utcDayKey(),
      dayPnl: 0,
      dayTrades: 0,
      consecLosses: 0,
      dayStopped: false,
      weekKey: utcWeekKey(),
      weekPnl: 0,
    };
    this.rollover();
  }

  private rollover() {
    const dk = utcDayKey();
    const wk = utcWeekKey();
    if (this.state.dayKey !== dk) {
      this.state.dayKey = dk;
      this.state.dayPnl = 0;
      this.state.dayTrades = 0;
      this.state.consecLosses = 0;
      this.state.dayStopped = false;
    }
    if (this.state.weekKey !== wk) {
      this.state.weekKey = wk;
      this.state.weekPnl = 0;
    }
  }

  private dailyLossLimit(): number {
    return -(this.cfg.accountStart * this.cfg.maxDailyLossPct) / 100;
  }
  private weeklyLossLimit(): number {
    return -(this.cfg.accountStart * this.cfg.maxWeeklyLossPct) / 100;
  }

  canTrade(): { ok: boolean; reason: string | null } {
    this.rollover();
    const s = this.state;
    if (s.dayStopped) return { ok: false, reason: "Tag gestoppt (2 Verluste in Folge)" };
    if (s.dayTrades >= this.cfg.maxTradesPerDay) return { ok: false, reason: `Max ${this.cfg.maxTradesPerDay} Trades/Tag erreicht` };
    if (s.dayPnl <= this.dailyLossLimit()) return { ok: false, reason: "Tages-Verlustlimit erreicht" };
    if (s.weekPnl <= this.weeklyLossLimit()) return { ok: false, reason: "Wochen-Verlustlimit erreicht" };
    return { ok: true, reason: null };
  }

  /** Position size so that hitting the stop loses exactly riskPctPerTrade. */
  positionSize(entry: number, stopLoss: number): { size: number; riskAmount: number } {
    const riskAmount = (this.state.equity * this.cfg.riskPctPerTrade) / 100;
    const dist = Math.abs(entry - stopLoss);
    const size = dist > 0 ? riskAmount / dist : 0;
    return { size: +size.toFixed(4), riskAmount: +riskAmount.toFixed(2) };
  }

  /** Validate a signal against hard rules (RR, stop width). */
  validateSignal(sig: TradeSignal): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (sig.riskReward < this.cfg.minRR) reasons.push(`RR ${sig.riskReward} < ${this.cfg.minRR}`);
    const stopPct = (Math.abs(sig.entry - sig.stopLoss) / sig.entry) * 100;
    if (stopPct < this.cfg.minStopPct) reasons.push("Stop zu eng");
    if (stopPct > this.cfg.maxStopPct) reasons.push("Stop zu weit");
    return { ok: reasons.length === 0, reasons };
  }

  registerOpen() {
    this.rollover();
    this.state.dayTrades += 1;
  }

  registerResult(pnl: number) {
    this.rollover();
    this.state.equity += pnl;
    this.state.dayPnl += pnl;
    this.state.weekPnl += pnl;
    if (pnl < 0) {
      this.state.consecLosses += 1;
      if (this.state.consecLosses >= this.cfg.maxConsecutiveLosses) this.state.dayStopped = true;
    } else if (pnl > 0) {
      this.state.consecLosses = 0;
    }
  }

  status(): RiskStatus {
    this.rollover();
    const s = this.state;
    const limit = this.dailyLossLimit();
    const ct = this.canTrade();
    return {
      equity: +s.equity.toFixed(2),
      dayPnl: +s.dayPnl.toFixed(2),
      dayPnlPct: +((s.dayPnl / this.cfg.accountStart) * 100).toFixed(2),
      weekPnl: +s.weekPnl.toFixed(2),
      weekPnlPct: +((s.weekPnl / this.cfg.accountStart) * 100).toFixed(2),
      dayTrades: s.dayTrades,
      maxTrades: this.cfg.maxTradesPerDay,
      consecLosses: s.consecLosses,
      dayStopped: s.dayStopped,
      dailyLossLimit: +limit.toFixed(2),
      dailyLossUsedPct: limit < 0 ? +Math.min(100, Math.max(0, (s.dayPnl / limit) * 100)).toFixed(0) : 0,
      canTrade: ct.ok,
      blockReason: ct.reason,
    };
  }
}
