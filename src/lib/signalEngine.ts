import type { Candle } from "./api";

export type SignalState = "STRONG_BUY" | "BUY" | "WAIT" | "SELL" | "STRONG_SELL";
export type Side = "long" | "short" | "flat";
export type Trend = "up" | "down" | "range";
export type FactorLean = "bull" | "bear" | "neutral";
export type DayTrigger =
  | "box_breakout_long"
  | "box_breakout_short"
  | "rejection_long"
  | "rejection_short"
  | "none";

export interface StrategyParams {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  atrPeriod: number;
  strengthMin: number;
  confirmBars: number;
  atrSL: number;
  atrTP1: number;
  atrTP2: number;
  boxLookback: number;
  breakoutBufferAtr: number;
  rejectionWickMin: number;
}

export const DEFAULT_STRATEGY: StrategyParams = {
  emaFast: 9,
  emaSlow: 21,
  emaTrend: 50,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  atrPeriod: 14,
  // ── striktes "weniger, dafür hochwertiger" Day-Trading-Tuning ──
  strengthMin: 0.65, // höhere Trendstärke-Hürde → kein Handel in flachen Phasen
  confirmBars: 2,
  atrSL: 1.0, // etwas mehr Stop-Luft → weniger Premature-Stops
  atrTP1: 1.6,
  atrTP2: 2.6,
  boxLookback: 30, // längere Konsolidierung → bedeutsamerer Ausbruch
  breakoutBufferAtr: 0.18, // Preis muss die Box deutlicher überwinden (kein Fake-Breakout)
  rejectionWickMin: 0.55, // nur klare Rejections zählen
};

export function ema(data: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(data: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(data.length).fill(null);
  if (data.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface Macd {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

export function macd(data: number[], fast: number, slow: number, signalPeriod: number): Macd {
  const ef = ema(data, fast);
  const es = ema(data, slow);
  const line = data.map((_, i) =>
    ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null
  );
  const signal: (number | null)[] = new Array(data.length).fill(null);
  const first = line.findIndex((v) => v != null);
  if (first >= 0) {
    const sig = ema(line.slice(first).map((v) => v as number), signalPeriod);
    for (let i = 0; i < sig.length; i++) {
      if (sig[i] != null) signal[first + i] = sig[i];
    }
  }
  const hist = data.map((_, i) =>
    line[i] != null && signal[i] != null ? (line[i] as number) - (signal[i] as number) : null
  );
  return { macd: line, signal, hist };
}

export function atr(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(
          c.high - c.low,
          Math.abs(c.high - candles[i - 1].close),
          Math.abs(c.low - candles[i - 1].close)
        )
  );
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += tr[i];
    if (i > period) sum -= tr[i - period];
    if (i >= period) out[i] = sum / period;
  }
  return out;
}

function rollingBox(candles: Candle[], lookback: number) {
  const high: (number | null)[] = new Array(candles.length).fill(null);
  const low: (number | null)[] = new Array(candles.length).fill(null);
  const mid: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    if (i < lookback) continue;
    const prev = candles.slice(i - lookback, i);
    const hi = Math.max(...prev.map((c) => c.high));
    const lo = Math.min(...prev.map((c) => c.low));
    high[i] = hi;
    low[i] = lo;
    mid[i] = (hi + lo) / 2;
  }
  return { high, low, mid };
}

export interface StrategySeries {
  candles: Candle[];
  prices: number[];
  times: number[];
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  emaTrend: (number | null)[];
  rsi: (number | null)[];
  macd: Macd;
  atr: (number | null)[];
  boxHigh: (number | null)[];
  boxLow: (number | null)[];
  boxMid: (number | null)[];
}

export function computeSeries(candles: Candle[], p: StrategyParams): StrategySeries {
  const prices = candles.map((c) => c.close);
  const times = candles.map((c) => c.time);
  const box = rollingBox(candles, p.boxLookback);
  return {
    candles,
    prices,
    times,
    emaFast: ema(prices, p.emaFast),
    emaSlow: ema(prices, p.emaSlow),
    emaTrend: ema(prices, p.emaTrend),
    rsi: rsi(prices, p.rsiPeriod),
    macd: macd(prices, p.macdFast, p.macdSlow, p.macdSignal),
    atr: atr(candles, p.atrPeriod),
    boxHigh: box.high,
    boxLow: box.low,
    boxMid: box.mid,
  };
}

export interface Snapshot {
  price: number;
  trend: Trend;
  strength: number;
  rsi: number | null;
  macdHist: number | null;
  atr: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  emaTrend: number | null;
  boxHigh: number | null;
  boxLow: number | null;
  boxMid: number | null;
  trigger: DayTrigger;
  boxPosition: "above" | "inside" | "below";
}

function candleShape(c: Candle) {
  const range = Math.max(c.high - c.low, 0.000001);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;
  const body = Math.abs(c.close - c.open);
  return { range, upperPct: upper / range, lowerPct: lower / range, bodyPct: body / range };
}

export function snapshotAt(s: StrategySeries, i: number, p = DEFAULT_STRATEGY): Snapshot {
  const price = s.prices[i];
  const candle = s.candles[i];
  const ef = s.emaFast[i];
  const es = s.emaSlow[i];
  const et = s.emaTrend[i];
  const a = s.atr[i];
  const hi = s.boxHigh[i];
  const lo = s.boxLow[i];
  const mid = s.boxMid[i];
  const strength = ef != null && es != null && a ? Math.abs(ef - es) / a : 0;
  const trend: Trend =
    ef != null && es != null && et != null
      ? ef > es && es > et && price > et
        ? "up"
        : ef < es && es < et && price < et
          ? "down"
          : "range"
      : "range";

  let trigger: DayTrigger = "none";
  let boxPosition: Snapshot["boxPosition"] = "inside";
  if (hi != null && lo != null && a) {
    const buffer = a * p.breakoutBufferAtr;
    const shape = candleShape(candle);
    if (price > hi + buffer) {
      trigger = "box_breakout_long";
      boxPosition = "above";
    } else if (price < lo - buffer) {
      trigger = "box_breakout_short";
      boxPosition = "below";
    } else if (candle.low <= lo + buffer && candle.close > lo && shape.lowerPct >= p.rejectionWickMin) {
      trigger = "rejection_long";
      boxPosition = "inside";
    } else if (candle.high >= hi - buffer && candle.close < hi && shape.upperPct >= p.rejectionWickMin) {
      trigger = "rejection_short";
      boxPosition = "inside";
    } else {
      boxPosition = price > hi ? "above" : price < lo ? "below" : "inside";
    }
  }

  return {
    price,
    trend,
    strength,
    rsi: s.rsi[i],
    macdHist: s.macd.hist[i],
    atr: a,
    emaFast: ef,
    emaSlow: es,
    emaTrend: et,
    boxHigh: hi,
    boxLow: lo,
    boxMid: mid,
    trigger,
    boxPosition,
  };
}

export interface Factor {
  key: string;
  label: string;
  lean: FactorLean;
  detail: string;
  hint?: boolean;
}

export function factorsAt(snap: Snapshot, p: StrategyParams, newsLean?: FactorLean): Factor[] {
  const r = snap.rsi;
  const hist = snap.macdHist ?? 0;
  const boxLean =
    snap.trigger === "box_breakout_long" || snap.trigger === "rejection_long"
      ? "bull"
      : snap.trigger === "box_breakout_short" || snap.trigger === "rejection_short"
        ? "bear"
        : "neutral";
  const boxDetail =
    snap.boxHigh == null || snap.boxLow == null
      ? "noch keine Box"
      : snap.trigger === "box_breakout_long"
        ? `Breakout ueber Box ${snap.boxHigh.toFixed(2)}`
        : snap.trigger === "box_breakout_short"
          ? `Breakdown unter Box ${snap.boxLow.toFixed(2)}`
          : snap.trigger === "rejection_long"
            ? `Rejection an Box-Low ${snap.boxLow.toFixed(2)}`
            : snap.trigger === "rejection_short"
              ? `Rejection an Box-High ${snap.boxHigh.toFixed(2)}`
              : `in Box ${snap.boxLow.toFixed(2)}-${snap.boxHigh.toFixed(2)}`;

  const factors: Factor[] = [
    {
      key: "box",
      label: `Box-System (${p.boxLookback} Kerzen)`,
      lean: boxLean,
      detail: boxDetail,
    },
    {
      key: "ema",
      label: "Intraday-Trend (EMA 9/21/50)",
      lean: snap.trend === "up" ? "bull" : snap.trend === "down" ? "bear" : "neutral",
      detail:
        snap.trend === "up"
          ? "EMAs bullisch gestapelt"
          : snap.trend === "down"
            ? "EMAs baerisch gestapelt"
            : "kein sauberer Intraday-Trend",
    },
    {
      key: "macd",
      label: "Momentum (MACD)",
      lean: hist > 0 ? "bull" : hist < 0 ? "bear" : "neutral",
      detail: `Histogramm ${hist >= 0 ? "+" : ""}${hist.toFixed(2)}`,
    },
    {
      key: "rsi",
      label: "RSI (14)",
      lean: r != null && r > 52 && r < 72 ? "bull" : r != null && r < 48 && r > 28 ? "bear" : "neutral",
      detail: r == null ? "-" : `${r.toFixed(0)} ${r > 70 ? "hoch" : r < 30 ? "tief" : "normal"}`,
    },
    {
      key: "strength",
      label: "Volatilitaet / Trendstaerke",
      lean: snap.strength >= p.strengthMin ? (snap.trend === "down" ? "bear" : snap.trend === "up" ? "bull" : "neutral") : "neutral",
      detail: `${snap.strength.toFixed(2)} ${snap.strength >= p.strengthMin ? "handelbar" : "zu flach"}`,
    },
  ];

  if (newsLean) {
    factors.push({
      key: "news",
      label: "News / Makro",
      lean: newsLean,
      detail: "nur Kontext, kein Trigger",
      hint: true,
    });
  }

  return factors;
}

export interface RawDecision {
  state: SignalState;
  bias: Side;
  confidence: number;
  trend: Trend;
  reason: string;
}

export function rawBiasAt(s: StrategySeries, i: number, p: StrategyParams): RawDecision {
  const snap = snapshotAt(s, i, p);
  const { emaFast: ef, emaSlow: es, emaTrend: et, macdHist: hist, atr: a, rsi: r, trigger } = snap;

  if (ef == null || es == null || et == null || hist == null || !a || snap.boxHigh == null || snap.boxLow == null) {
    return { state: "WAIT", bias: "flat", confidence: 0, trend: "range", reason: "Noch zu wenig 15M-Daten" };
  }

  const longTrigger = trigger === "box_breakout_long" || trigger === "rejection_long";
  const shortTrigger = trigger === "box_breakout_short" || trigger === "rejection_short";
  const trendUp = snap.trend === "up";
  const trendDown = snap.trend === "down";
  const momentumUp = hist > 0;
  const momentumDown = hist < 0;
  const rsiLongOk = r == null || (r >= 45 && r <= 72);
  const rsiShortOk = r == null || (r >= 28 && r <= 55);
  const strengthOk = snap.strength >= p.strengthMin;

  if (longTrigger && trendUp && momentumUp && rsiLongOk && strengthOk) {
    let conf = 62;
    const reasons = [trigger === "box_breakout_long" ? "Box-Breakout" : "Box-Rejection", "Trend up", "MACD up"];
    if (trigger === "box_breakout_long") conf += 8;
    if (snap.strength >= p.strengthMin * 1.35) {
      conf += 8;
      reasons.push("Staerke ok");
    }
    if (r != null && r >= 52 && r <= 66) {
      conf += 7;
      reasons.push("RSI gesund");
    }
    if (ef > es && es > et) conf += 7;
    conf = Math.min(94, Math.round(conf));
    return {
      state: conf >= 82 ? "STRONG_BUY" : "BUY",
      bias: "long",
      confidence: conf,
      trend: snap.trend,
      reason: reasons.join(", "),
    };
  }

  if (shortTrigger && trendDown && momentumDown && rsiShortOk && strengthOk) {
    let conf = 62;
    const reasons = [trigger === "box_breakout_short" ? "Box-Breakdown" : "Box-Rejection", "Trend down", "MACD down"];
    if (trigger === "box_breakout_short") conf += 8;
    if (snap.strength >= p.strengthMin * 1.35) {
      conf += 8;
      reasons.push("Staerke ok");
    }
    if (r != null && r >= 34 && r <= 48) {
      conf += 7;
      reasons.push("RSI gesund");
    }
    if (ef < es && es < et) conf += 7;
    conf = Math.min(94, Math.round(conf));
    return {
      state: conf >= 82 ? "STRONG_SELL" : "SELL",
      bias: "short",
      confidence: conf,
      trend: snap.trend,
      reason: reasons.join(", "),
    };
  }

  const why =
    trigger === "none"
      ? "Kein Box-Trigger"
      : !strengthOk
        ? "Box-Trigger, aber zu wenig Trendstaerke"
        : longTrigger && !trendUp
          ? "Long-Trigger gegen Trend"
          : shortTrigger && !trendDown
            ? "Short-Trigger gegen Trend"
            : longTrigger && !momentumUp
              ? "Long-Trigger, aber MACD nicht positiv"
              : shortTrigger && !momentumDown
                ? "Short-Trigger, aber MACD nicht negativ"
                : longTrigger && !rsiLongOk
                  ? "Long-Trigger, aber RSI ueberkauft – nicht nachjagen"
                  : shortTrigger && !rsiShortOk
                    ? "Short-Trigger, aber RSI ueberverkauft – nicht nachjagen"
                    : "Setup noch nicht sauber";

  return {
    state: "WAIT",
    bias: "flat",
    confidence: trigger === "none" ? 20 : 48,
    trend: snap.trend,
    reason: why,
  };
}

export function sideOf(state: SignalState): Side {
  if (state === "BUY" || state === "STRONG_BUY") return "long";
  if (state === "SELL" || state === "STRONG_SELL") return "short";
  return "flat";
}

export interface Decision {
  state: SignalState;
  bias: Side;
  confidence: number;
  trend: Trend;
  reason: string;
}

export interface SignalEvent {
  index: number;
  time: number;
  price: number;
  state: SignalState;
  confidence: number;
}

export function decide(s: StrategySeries, p: StrategyParams): { current: Decision; events: SignalEvent[] } {
  const n = s.prices.length;
  const start = Math.max(p.emaTrend, p.macdSlow + p.macdSignal, p.rsiPeriod, p.atrPeriod, p.boxLookback) + 1;
  const events: SignalEvent[] = [];
  let current: Decision = { state: "WAIT", bias: "flat", confidence: 0, trend: "range", reason: "Warte auf Daten" };
  let lastActionSide: Side = "flat";
  let pendingSide: Side | null = null;
  let pendingCount = 0;

  for (let i = start; i < n; i++) {
    const raw = rawBiasAt(s, i, p);
    if (raw.bias === "flat") {
      pendingSide = null;
      pendingCount = 0;
    } else if (raw.bias === pendingSide) {
      pendingCount++;
    } else {
      pendingSide = raw.bias;
      pendingCount = 1;
    }

    const confirmed = raw.bias !== "flat" && pendingCount >= p.confirmBars;
    const displayed = confirmed ? raw.state : "WAIT";
    const side = sideOf(displayed);

    if (side !== "flat" && side !== lastActionSide) {
      events.push({ index: i, time: s.times[i], price: s.prices[i], state: displayed, confidence: raw.confidence });
      lastActionSide = side;
    }

    if (i === n - 1) {
      current = confirmed
        ? { state: displayed, bias: side, confidence: raw.confidence, trend: raw.trend, reason: raw.reason }
        : {
            state: "WAIT",
            bias: "flat",
            confidence: raw.confidence,
            trend: raw.trend,
            reason: raw.bias === "flat" ? raw.reason : `${raw.reason} (${pendingCount}/${p.confirmBars} bestaetigt)`,
          };
    }
  }

  return { current, events };
}

export interface TradeLevels {
  direction: Side;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  rr1: number;
  rr2: number;
  leverage: string;
  atr: number;
}

export function levelsFor(state: SignalState, entry: number, atrVal: number, p: StrategyParams): TradeLevels {
  const direction = sideOf(state);
  const long = direction === "long";
  const stopLoss = long ? entry - p.atrSL * atrVal : entry + p.atrSL * atrVal;
  const takeProfit1 = long ? entry + p.atrTP1 * atrVal : entry - p.atrTP1 * atrVal;
  const takeProfit2 = long ? entry + p.atrTP2 * atrVal : entry - p.atrTP2 * atrVal;
  const risk = Math.abs(entry - stopLoss);
  return {
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    rr1: risk > 0 ? Math.abs(takeProfit1 - entry) / risk : 0,
    rr2: risk > 0 ? Math.abs(takeProfit2 - entry) / risk : 0,
    leverage: "so niedrig wie moeglich",
    atr: atrVal,
  };
}

export interface SRZone {
  price: number;
  kind: "support" | "resistance";
}

export function supportResistance(candles: Candle[], lookback = 90, win = 3): SRZone[] {
  const n = candles.length;
  if (n < win * 2 + 2) return [];
  const start = Math.max(win, n - lookback);
  const pivots: SRZone[] = [];
  for (let i = start + win; i < n - win; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    let isHigh = true;
    let isLow = true;
    for (let j = i - win; j <= i + win; j++) {
      if (candles[j].high > h) isHigh = false;
      if (candles[j].low < l) isLow = false;
    }
    if (isHigh) pivots.push({ price: h, kind: "resistance" });
    if (isLow) pivots.push({ price: l, kind: "support" });
  }
  const cur = candles[n - 1].close;
  return [
    ...pivots.filter((p) => p.kind === "resistance" && p.price > cur).sort((a, b) => a.price - b.price).slice(0, 2),
    ...pivots.filter((p) => p.kind === "support" && p.price < cur).sort((a, b) => b.price - a.price).slice(0, 2),
  ];
}

export function stateLabel(state: SignalState): string {
  switch (state) {
    case "STRONG_BUY":
      return "STARKES KAUFSIGNAL";
    case "BUY":
      return "KAUFSIGNAL";
    case "WAIT":
      return "ABWARTEN";
    case "SELL":
      return "VERKAUFSIGNAL";
    case "STRONG_SELL":
      return "STARKES VERKAUFSIGNAL";
  }
}

export function stateEmoji(state: SignalState): string {
  switch (state) {
    case "STRONG_BUY":
      return "++";
    case "BUY":
      return "+";
    case "WAIT":
      return ".";
    case "SELL":
      return "-";
    case "STRONG_SELL":
      return "--";
  }
}

export function trendLabel(t: Trend): string {
  return t === "up" ? "Aufwaerts" : t === "down" ? "Abwaerts" : "Seitwaerts";
}

// ── Strategy analytics (Monte Carlo, Drawdown, Edge) ──────────

export interface TradeResult {
  entry: number;
  exit: number;
  side: "long" | "short";
  pnlPct: number;
  bars: number;
}

export function backtestSignals(
  s: StrategySeries,
  events: SignalEvent[],
  p: StrategyParams
): TradeResult[] {
  const results: TradeResult[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const side = sideOf(ev.state);
    if (side === "flat") continue;
    const entryPrice = ev.price;
    const entryIdx = ev.index;
    const atrVal = s.atr[entryIdx] ?? 0;
    if (!atrVal) continue;
    const sl = side === "long" ? entryPrice - p.atrSL * atrVal : entryPrice + p.atrSL * atrVal;
    const tp = side === "long" ? entryPrice + p.atrTP1 * atrVal : entryPrice - p.atrTP1 * atrVal;

    let exitPrice = entryPrice;
    let exitIdx = entryIdx;
    for (let j = entryIdx + 1; j < s.prices.length; j++) {
      const price = s.prices[j];
      if (side === "long") {
        if (price <= sl) { exitPrice = sl; exitIdx = j; break; }
        if (price >= tp) { exitPrice = tp; exitIdx = j; break; }
      } else {
        if (price >= sl) { exitPrice = sl; exitIdx = j; break; }
        if (price <= tp) { exitPrice = tp; exitIdx = j; break; }
      }
      if (i + 1 < events.length && j >= events[i + 1].index) {
        exitPrice = price;
        exitIdx = j;
        break;
      }
      if (j === s.prices.length - 1) {
        exitPrice = price;
        exitIdx = j;
      }
    }
    const pnlPct = side === "long"
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100;
    results.push({ entry: entryPrice, exit: exitPrice, side, pnlPct, bars: exitIdx - entryIdx });
  }
  return results;
}

export interface StrategyStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancy: number;
  maxDrawdownPct: number;
  avgBarsInTrade: number;
  profitFactor: number;
  monteCarlo: { ruinPct: number; medianReturnPct: number; worstPct: number };
}

export function computeStats(trades: TradeResult[]): StrategyStats {
  if (!trades.length) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      avgWinPct: 0, avgLossPct: 0, expectancy: 0,
      maxDrawdownPct: 0, avgBarsInTrade: 0, profitFactor: 0,
      monteCarlo: { ruinPct: 0, medianReturnPct: 0, worstPct: 0 },
    };
  }

  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const winRate = wins.length / trades.length;
  const avgWinPct = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const expectancy = winRate * avgWinPct + (1 - winRate) * avgLossPct;
  const totalWin = wins.reduce((s, t) => s + t.pnlPct, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 99 : 0;
  const avgBars = trades.reduce((s, t) => s + t.bars, 0) / trades.length;

  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.pnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }

  // simplified Monte Carlo: shuffle trades 500 times, measure outcomes
  const sims = 500;
  const outcomes: number[] = [];
  let ruinCount = 0;
  for (let sim = 0; sim < sims; sim++) {
    const shuffled = [...trades].sort(() => Math.random() - 0.5);
    let eq = 0;
    let minEq = 0;
    for (const t of shuffled) {
      eq += t.pnlPct;
      if (eq < minEq) minEq = eq;
    }
    outcomes.push(eq);
    if (minEq < -20) ruinCount++;
  }
  outcomes.sort((a, b) => a - b);
  const medianReturn = outcomes[Math.floor(sims / 2)];
  const worstReturn = outcomes[Math.floor(sims * 0.05)];

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWinPct,
    avgLossPct,
    expectancy,
    maxDrawdownPct: maxDd,
    avgBarsInTrade: avgBars,
    profitFactor,
    monteCarlo: {
      ruinPct: (ruinCount / sims) * 100,
      medianReturnPct: medianReturn,
      worstPct: worstReturn,
    },
  };
}

// ── Strategy Optimization ──────────

export interface StrategyGrade {
  sharpeRatio: number;
  calmarRatio: number;
  grade: "A" | "B" | "C" | "D" | "F";
  suggestions: OptSuggestion[];
}

export interface OptSuggestion {
  area: "sl" | "tp" | "filter" | "timing" | "risk";
  label: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

export function gradeStrategy(trades: TradeResult[], stats: StrategyStats, p: StrategyParams): StrategyGrade {
  const suggestions: OptSuggestion[] = [];

  // Sharpe ratio (annualized, assuming ~26 trades/day on 15M)
  const returns = trades.map((t) => t.pnlPct);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  // Calmar ratio (return / max drawdown)
  const totalReturn = returns.reduce((a, b) => a + b, 0);
  const calmar = stats.maxDrawdownPct > 0 ? totalReturn / stats.maxDrawdownPct : 0;

  // grade
  let score = 0;
  if (stats.winRate >= 0.55) score += 2; else if (stats.winRate >= 0.45) score += 1;
  if (stats.profitFactor >= 1.5) score += 2; else if (stats.profitFactor >= 1.0) score += 1;
  if (sharpe >= 1.0) score += 2; else if (sharpe >= 0.5) score += 1;
  if (stats.expectancy > 0) score += 2; else if (stats.expectancy > -0.1) score += 1;
  const grade: StrategyGrade["grade"] =
    score >= 7 ? "A" : score >= 5 ? "B" : score >= 3 ? "C" : score >= 1 ? "D" : "F";

  // suggestions based on weaknesses
  if (stats.winRate < 0.45 && trades.length >= 3) {
    suggestions.push({
      area: "filter",
      label: "Strengere Einstiegsfilter",
      detail: `Win-Rate nur ${(stats.winRate * 100).toFixed(0)}%. Höhere strengthMin (aktuell ${p.strengthMin}) oder längere Bestätigung (confirmBars: ${p.confirmBars}→${p.confirmBars + 1}) könnte Fehlsignale reduzieren.`,
      priority: "high",
    });
  }

  if (stats.avgLossPct < -0.5 && stats.avgWinPct < Math.abs(stats.avgLossPct) * 1.2) {
    suggestions.push({
      area: "sl",
      label: "Stop-Loss zu weit",
      detail: `Ø Verlust (${stats.avgLossPct.toFixed(2)}%) ist gross im Verhältnis zum Ø Gewinn (${stats.avgWinPct.toFixed(2)}%). Engeren SL testen (atrSL: ${p.atrSL}→${Math.max(0.6, p.atrSL - 0.2).toFixed(1)}).`,
      priority: "high",
    });
  }

  if (stats.profitFactor < 1.0 && trades.length >= 3) {
    suggestions.push({
      area: "tp",
      label: "Take-Profit optimieren",
      detail: `Profit-Faktor unter 1.0 — Verluste überwiegen. Grösseres TP1 (atrTP1: ${p.atrTP1}→${(p.atrTP1 + 0.3).toFixed(1)}) oder Teil-TP bei TP1 + Rest bis TP2.`,
      priority: "medium",
    });
  }

  if (stats.avgBarsInTrade > 20) {
    suggestions.push({
      area: "timing",
      label: "Trades zu lang gehalten",
      detail: `Ø ${Math.round(stats.avgBarsInTrade)} Kerzen (${Math.round(stats.avgBarsInTrade * 15)} Min). Day-Trades sollten kürzer sein. Tighter Trailing-Stop oder zeitbasierter Exit nach ~2h.`,
      priority: "medium",
    });
  }

  if (stats.monteCarlo.ruinPct > 10) {
    suggestions.push({
      area: "risk",
      label: "Ruin-Risiko hoch",
      detail: `${stats.monteCarlo.ruinPct.toFixed(0)}% Chance auf >20% Drawdown. Position-Size reduzieren (max 1-2% Risiko pro Trade).`,
      priority: "high",
    });
  }

  if (!suggestions.length && trades.length >= 2) {
    suggestions.push({
      area: "filter",
      label: "Strategie sieht solide aus",
      detail: "Keine offensichtlichen Schwächen. Weiter beobachten und mit mehr Daten validieren.",
      priority: "low",
    });
  }

  return { sharpeRatio: sharpe, calmarRatio: calmar, grade, suggestions };
}

export interface EdgeSignal {
  type: "divergence" | "volume_spike" | "structure_break" | "exhaustion";
  label: string;
  detail: string;
  lean: FactorLean;
}

export function detectEdges(s: StrategySeries, i: number): EdgeSignal[] {
  const edges: EdgeSignal[] = [];
  if (i < 20) return edges;

  const price = s.prices[i];
  const prevPrice = s.prices[i - 5];
  const rsiNow = s.rsi[i];
  const rsiPrev = s.rsi[i - 5];
  const macdNow = s.macd.hist[i];
  const macdPrev = s.macd.hist[i - 5];

  // RSI divergence
  if (rsiNow != null && rsiPrev != null && macdNow != null) {
    if (price > prevPrice && rsiNow < rsiPrev - 3) {
      edges.push({
        type: "divergence",
        label: "Bärische RSI-Divergenz",
        detail: `Preis steigt, RSI fällt (${rsiPrev.toFixed(0)}→${rsiNow.toFixed(0)})`,
        lean: "bear",
      });
    }
    if (price < prevPrice && rsiNow > rsiPrev + 3) {
      edges.push({
        type: "divergence",
        label: "Bullische RSI-Divergenz",
        detail: `Preis fällt, RSI steigt (${rsiPrev.toFixed(0)}→${rsiNow.toFixed(0)})`,
        lean: "bull",
      });
    }
  }

  // MACD divergence
  if (macdNow != null && macdPrev != null) {
    if (price > prevPrice && macdNow < macdPrev) {
      edges.push({
        type: "divergence",
        label: "MACD-Divergenz (bärisch)",
        detail: "Preis steigt, Momentum sinkt — Schwäche",
        lean: "bear",
      });
    }
    if (price < prevPrice && macdNow > macdPrev) {
      edges.push({
        type: "divergence",
        label: "MACD-Divergenz (bullisch)",
        detail: "Preis fällt, Momentum steigt — Boden?",
        lean: "bull",
      });
    }
  }

  // exhaustion candle
  const c = s.candles[i];
  const atrVal = s.atr[i];
  if (atrVal) {
    const range = c.high - c.low;
    if (range > atrVal * 2.0) {
      const bullCandle = c.close > c.open;
      edges.push({
        type: "exhaustion",
        label: bullCandle ? "Überdehnte Bullish-Kerze" : "Überdehnte Bearish-Kerze",
        detail: `Kerze ${(range / atrVal).toFixed(1)}× ATR — mögliche Erschöpfung`,
        lean: bullCandle ? "bear" : "bull",
      });
    }
  }

  // structure break (price crosses EMA50 from below/above)
  const et = s.emaTrend[i];
  const etPrev = s.emaTrend[i - 1];
  if (et != null && etPrev != null) {
    if (s.prices[i - 1] < etPrev && price > et) {
      edges.push({
        type: "structure_break",
        label: "Strukturbruch aufwärts",
        detail: "Preis durchbricht EMA50 nach oben",
        lean: "bull",
      });
    }
    if (s.prices[i - 1] > etPrev && price < et) {
      edges.push({
        type: "structure_break",
        label: "Strukturbruch abwärts",
        detail: "Preis durchbricht EMA50 nach unten",
        lean: "bear",
      });
    }
  }

  return edges;
}

// ── Overnight Drift Detection ──────────────────────────────

export interface OvernightSetup {
  asset: string;
  direction: "long" | "short";
  confidence: number; // 0–100
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasons: string[];
  contraReasons: string[];
  windowOpen: boolean;
  nextWindow: string;
}

export function detectOvernightDrift(
  snap: Snapshot,
  price: number,
  nowUtcHour: number,
  assetType: "index" | "metal" | "forex" | "crypto",
): OvernightSetup | null {
  if (assetType !== "index" && assetType !== "forex") return null;

  const a = snap.atr;
  if (!a) return null;
  const ef = snap.emaFast, es = snap.emaSlow, et = snap.emaTrend;
  const r = snap.rsi, hist = snap.macdHist;
  if (ef == null || es == null || et == null) return null;

  const windowOpen = nowUtcHour >= 20 || nowUtcHour < 1;

  // Score LONG and SHORT independently, pick the stronger one
  const longReasons: string[] = [];
  const longContra: string[] = [];
  let longScore = 0;

  const shortReasons: string[] = [];
  const shortContra: string[] = [];
  let shortScore = 0;

  // ── 1. EMA-Struktur (max 25 Punkte) ──
  if (ef > es && es > et) {
    longScore += 25;
    longReasons.push("EMAs bullisch gestapelt (9 > 21 > 50)");
    shortContra.push("EMAs bullisch — gegen Short");
  } else if (ef < es && es < et) {
    shortScore += 25;
    shortReasons.push("EMAs bärisch gestapelt (9 < 21 < 50)");
    longContra.push("EMAs bärisch — gegen Long");
  } else {
    longContra.push("EMAs nicht klar geordnet");
    shortContra.push("EMAs nicht klar geordnet");
  }

  // ── 2. Preis vs EMA50 (max 20 Punkte) ──
  if (price > et) {
    longScore += 20;
    longReasons.push(`Preis über EMA50 (${et.toFixed(1)})`);
    shortContra.push("Preis über EMA50");
  } else {
    shortScore += 20;
    shortReasons.push(`Preis unter EMA50 (${et.toFixed(1)})`);
    longContra.push("Preis unter EMA50");
  }

  // ── 3. MACD-Momentum (max 15 Punkte) ──
  if (hist != null) {
    if (hist > 0) {
      longScore += 15;
      longReasons.push(`MACD positiv (+${hist.toFixed(2)})`);
    } else if (hist < 0) {
      shortScore += 15;
      shortReasons.push(`MACD negativ (${hist.toFixed(2)})`);
    }
  }

  // ── 4. RSI (max 15 Punkte, Abzug bei Extrem) ──
  if (r != null) {
    if (r >= 40 && r <= 62) {
      longScore += 15;
      longReasons.push(`RSI ${r.toFixed(0)} — Raum nach oben`);
    } else if (r > 72) {
      longScore -= 15;
      longContra.push(`RSI ${r.toFixed(0)} — überkauft`);
    }
    if (r >= 38 && r <= 60) {
      shortScore += 15;
      shortReasons.push(`RSI ${r.toFixed(0)} — Raum nach unten`);
    } else if (r < 28) {
      shortScore -= 15;
      shortContra.push(`RSI ${r.toFixed(0)} — überverkauft`);
    }
  }

  // ── 5. Überdehnungs-Check (max 10 Punkte / Abzug 20) ──
  const dist = Math.abs(price - et) / a;
  if (dist < 2.0) {
    longScore += 10;
    shortScore += 10;
    const side = price > et ? "Long" : "Short";
    (price > et ? longReasons : shortReasons).push(`Nahe EMA50 (${dist.toFixed(1)}× ATR) — guter ${side}-Einstieg`);
  } else if (dist > 3.5) {
    if (price > et) {
      longScore -= 20;
      longContra.push(`Überdehnt nach oben (${dist.toFixed(1)}× ATR über EMA50)`);
      shortScore += 10;
      shortReasons.push(`Überdehnt nach oben — Pullback-Short möglich`);
    } else {
      shortScore -= 20;
      shortContra.push(`Überdehnt nach unten (${dist.toFixed(1)}× ATR unter EMA50)`);
      longScore += 10;
      longReasons.push(`Überdehnt nach unten — Bounce-Long möglich`);
    }
  }

  // ── 6. Day-Trend Bestätigung (max 15 Punkte) ──
  if (snap.trend === "up") {
    longScore += 15;
    longReasons.push("Intraday-Trend aufwärts bestätigt");
  } else if (snap.trend === "down") {
    shortScore += 15;
    shortReasons.push("Intraday-Trend abwärts bestätigt");
  }

  // ── 7. Box-Position als Kontext ──
  if (snap.boxPosition === "above") {
    longScore += 5;
    longReasons.push("Preis über der Box — bullische Struktur");
  } else if (snap.boxPosition === "below") {
    shortScore += 5;
    shortReasons.push("Preis unter der Box — bärische Struktur");
  }

  // ── Entscheidung: stärkere Seite gewinnt ──
  const longConf = Math.max(0, Math.min(100, longScore));
  const shortConf = Math.max(0, Math.min(100, shortScore));

  // Mindestens 50% Konfidenz UND mindestens 3 Gründe
  const longValid = longConf >= 50 && longReasons.length >= 3;
  const shortValid = shortConf >= 50 && shortReasons.length >= 3;

  if (!longValid && !shortValid) return null;

  // Kein Signal wenn beide Seiten fast gleich stark (unklar)
  if (longValid && shortValid && Math.abs(longConf - shortConf) < 15) return null;

  const goLong = longValid && (!shortValid || longConf > shortConf);
  const direction: "long" | "short" = goLong ? "long" : "short";
  const confidence = goLong ? longConf : shortConf;
  const reasons = goLong ? longReasons : shortReasons;
  const contraReasons = goLong ? longContra : shortContra;

  const sl = goLong ? price - a * 1.5 : price + a * 1.5;
  const tp = goLong ? price + a * 2.0 : price - a * 2.0;

  let nextWindow = "Heute 22:00 MESZ";
  if (windowOpen) nextWindow = "JETZT — Fenster offen";

  return {
    asset: "",
    direction,
    confidence,
    entry: price,
    stopLoss: sl,
    takeProfit: tp,
    reasons,
    contraReasons,
    windowOpen,
    nextWindow,
  };
}
