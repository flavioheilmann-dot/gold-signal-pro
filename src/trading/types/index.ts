// ─────────────────────────────────────────────────────────────
// Core types for the ICT / liquidity day-trading engine.
// For education and paper trading only. No profit guarantees.
// All times are unix SECONDS (matching the rest of the app).
// ─────────────────────────────────────────────────────────────

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type Direction = "BUY" | "SELL";
export type Bias = "bullish" | "bearish" | "neutral";

/** Trading sessions (approximate UTC windows, configurable in sessions.ts). */
export type SessionName = "asia" | "london" | "newyork_am" | "newyork_pm" | "off";

export type LiquidityKind =
  | "prev_day_high" | "prev_day_low"
  | "asia_high" | "asia_low"
  | "london_high" | "london_low"
  | "ny_high" | "ny_low"
  | "equal_high" | "equal_low"
  | "swing_high" | "swing_low"
  | "hourly_high" | "hourly_low";

export interface LiquidityLevel {
  kind: LiquidityKind;
  side: "high" | "low";
  price: number;
  index: number; // candle index where the level formed (approx)
  label: string;
}

/** bullish sweep = a LOW was swept then reclaimed (expect up). */
export type SweepDir = "bullish" | "bearish";

export interface SweepEvent {
  dir: SweepDir;
  level: LiquidityLevel;
  index: number; // candle that performed the sweep
  extreme: number; // wick extreme beyond the level
  reclaim: number; // close back inside the range
}

export type StructureDir = "bullish" | "bearish";

export interface StructureShift {
  dir: StructureDir; // bullish = closed above internal swing high
  brokenLevel: number;
  index: number;
  kind: "MSS" | "BOS";
}

export interface FairValueGap {
  dir: "bullish" | "bearish";
  top: number; // upper bound of the gap
  bottom: number; // lower bound of the gap
  mid: number; // 50% (preferred entry)
  index: number; // index of the middle (2nd) candle of the 3
  filled: boolean;
}

export interface TradeSignal {
  id: string;
  time: number; // unix seconds
  symbol: string;
  direction: Direction;
  entryZone: { from: number; to: number };
  entry: number; // preferred entry (FVG 50%)
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number; // to TP2
  confidence: number; // 0–100 technical score (NOT win probability)
  session: SessionName;
  reasons: string[];
  warnings: string[];
}

export type TradeStatus =
  | "open"
  | "partial" // TP1 hit, runner active
  | "closed_win"
  | "closed_loss"
  | "breakeven"
  | "cancelled";

export interface PaperTrade {
  id: string;
  openedAt: number;
  closedAt: number | null;
  symbol: string;
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number;
  size: number; // units
  riskAmount: number; // account currency at risk (1R)
  reason: string;
  confidence: number;
  status: TradeStatus;
  exit: number | null;
  pnl: number; // net account currency
  rMultiple: number;
  tookPartial: boolean;
}

export interface RiskConfig {
  accountStart: number;
  riskPctPerTrade: number; // default 0.25
  maxDailyLossPct: number; // default 1
  maxWeeklyLossPct: number; // default 3
  maxTradesPerDay: number; // default 3
  maxConsecutiveLosses: number; // default 2 → stop for the day
  minRR: number; // default 2
  maxSpreadPct: number; // reject when spread too wide
  minStopPct: number; // SL not too tight (vs price)
  maxStopPct: number; // SL not too wide (vs price)
}

export const DEFAULT_RISK: RiskConfig = {
  accountStart: 1000,
  riskPctPerTrade: 0.25,
  maxDailyLossPct: 1,
  maxWeeklyLossPct: 3,
  maxTradesPerDay: 3,
  maxConsecutiveLosses: 2,
  minRR: 2,
  maxSpreadPct: 0.05,
  minStopPct: 0.05,
  maxStopPct: 1.5,
};

/** Context passed into the strategy on each evaluation. */
export interface MarketContext {
  symbol: string;
  spreadPct: number; // current spread as % of price
  newsRisk: boolean; // high-impact news imminent
  contextConfirms: boolean; // correlated context markets agree (DXY/indices)
  choppy: boolean; // low-quality, ranging conditions
  /**
   * TJR index-alignment filter: for index trades, false = NASDAQ/ES disagree
   * → no trade. undefined = not an index / unknown (no gate).
   */
  indexAligned?: boolean;
  /** Direction the indices agree on ("up"/"down") when indexAligned is true. */
  indexAlignDir?: "up" | "down" | "range";
  /**
   * Higher-timeframe (e.g. 1H) trend bias for this instrument. When set and not
   * "range", trades against it are skipped (TJR "trade with the HTF bias").
   */
  htfBias?: "up" | "down" | "range";
}

export const TRADING_DISCLAIMER = "For education and paper trading only. Not financial advice.";
