import { detectFVGs } from "./strategy/fvg";
import { detectSweepAt } from "./strategy/sweep";
import { detectStructureShift, swingPivots } from "./strategy/structure";
import { scoreSignal } from "./strategy/confidence";
import { RiskManager } from "./risk/RiskManager";
import { PaperBroker } from "./paper/PaperBroker";
import { analyze } from "./strategy/StrategyEngine";
import { MockDataProvider } from "./data/MockDataProvider";
import { runBacktest } from "./backtest/backtest";
import { structureTrend, indicesAligned, equilibrium, detectInverseFVGs, recentBOS, isIndexSymbol } from "./strategy/tjr";
import { drawsInDirection } from "./strategy/liquidity";
import { isKillzone } from "./strategy/sessions";
import { DEFAULT_RISK, type Candle, type LiquidityLevel, type TradeSignal } from "./types";

let pass = 0, fail = 0;
const check = (n: string, c: boolean, got?: unknown) =>
  c ? (pass++, console.log("  ok", n)) : (fail++, console.log("  XX", n, "->", JSON.stringify(got)));
const C = (o: number, h: number, l: number, cl: number, t = 0): Candle => ({ time: t, open: o, high: h, low: l, close: cl });

// ── FVG ──
{
  const cs = [C(6, 10, 5, 9), C(11, 13, 9, 12), C(13, 15, 12, 14)]; // A.high10 < C.low12 → bullish
  const f = detectFVGs(cs);
  console.log("FVG bullish:");
  check("one fvg", f.length === 1, f.length);
  check("dir bullish", f[0]?.dir === "bullish", f[0]?.dir);
  check("bottom 10 top 12 mid 11", f[0]?.bottom === 10 && f[0]?.top === 12 && f[0]?.mid === 11, f[0]);
  const cs2 = [C(24, 25, 20, 21), C(19, 19, 16, 17), C(17, 18, 15, 16)]; // A.low20 > C.high18 → bearish
  const g = detectFVGs(cs2);
  check("bearish dir", g[0]?.dir === "bearish" && g[0]?.top === 20 && g[0]?.bottom === 18, g[0]);
}

// ── Sweep ──
{
  const levels: LiquidityLevel[] = [{ kind: "swing_high", side: "high", price: 100, index: 0, label: "" }];
  const cs = [C(99, 100, 98, 99), C(99, 99.5, 98, 99), C(99, 101, 98, 99)]; // i2 wicks 101>100, closes 99<100
  const s = detectSweepAt(cs, levels, 2);
  console.log("Sweep:");
  check("bearish sweep of high", s?.dir === "bearish" && s?.level.price === 100, s);
  const lowLevels: LiquidityLevel[] = [{ kind: "swing_low", side: "low", price: 50, index: 0, label: "" }];
  const cs2 = [C(51, 52, 50.5, 51), C(51, 52, 50.5, 51), C(51, 52, 49, 51)]; // i2 low49<50, close51>50
  const s2 = detectSweepAt(cs2, lowLevels, 2);
  check("bullish sweep of low", s2?.dir === "bullish", s2);
}

// ── Structure shift ──
{
  const cs = [
    C(96, 100, 95, 97), C(99, 104, 98, 103), C(104, 110, 100, 108), // idx2 swing high 110
    C(106, 107, 99, 100), C(102, 103, 96, 98), C(98, 101, 94, 99),
    C(99, 102, 95, 100), C(101, 109, 100, 108), C(106, 112, 105, 111), // idx8 close 111 > 110
  ];
  console.log("Structure:");
  const piv = swingPivots(cs, 2);
  check("idx2 swing high found", piv.some((p) => p.index === 2 && p.side === "high" && p.price === 110), piv);
  const mss = detectStructureShift(cs, 6, "bullish", 2);
  check("MSS bullish broke 110 at idx8", mss?.dir === "bullish" && mss?.brokenLevel === 110 && mss?.index === 8, mss);
}

// ── Confidence ──
{
  console.log("Confidence:");
  const full = scoreSignal({ sweep: true, mss: true, cleanFVG: true, preferredSession: true, rrOk: true, contextConfirms: true, lowSpread: true, newsRisk: false, badSpread: false, choppy: false, noCorrelation: false });
  check("full = 100", full.score === 100, full.score);
  const news = scoreSignal({ sweep: true, mss: true, cleanFVG: true, preferredSession: true, rrOk: true, contextConfirms: true, lowSpread: true, newsRisk: true, badSpread: false, choppy: false, noCorrelation: false });
  check("news -20 = 80", news.score === 80, news.score);
}

// ── RiskManager ──
{
  console.log("Risk:");
  const rm = new RiskManager(DEFAULT_RISK);
  const ps = rm.positionSize(100, 99);
  check("riskAmount 2.5 (0.25% of 1000)", ps.riskAmount === 2.5, ps.riskAmount);
  check("size 2.5 (R=1)", ps.size === 2.5, ps.size);
  const rm2 = new RiskManager(DEFAULT_RISK);
  rm2.registerResult(-1); rm2.registerResult(-1);
  check("day stop after 2 losses", rm2.canTrade().ok === false, rm2.canTrade());
  const rm3 = new RiskManager(DEFAULT_RISK);
  rm3.registerResult(-12); // > 1% of 1000 = 10
  check("daily loss limit blocks", rm3.canTrade().ok === false, rm3.status().dayPnl);
}

// ── PaperBroker ──
{
  console.log("Paper:");
  const sig: TradeSignal = { id: "T", time: 0, symbol: "X", direction: "BUY", entryZone: { from: 99.9, to: 100.1 }, entry: 100, stopLoss: 99, takeProfit1: 101, takeProfit2: 102, riskReward: 2, confidence: 80, session: "london", reasons: [], warnings: [] };
  const pb = new PaperBroker();
  pb.openTrade(sig, 2.5, 2.5, 0);
  pb.update(C(100.2, 101.2, 100.3, 101, 1)); // TP1 hit → partial
  const afterTp1 = pb.open[0];
  check("partial after TP1", afterTp1?.tookPartial === true, afterTp1?.status);
  const closed = pb.update(C(101, 102.5, 101, 102, 2)); // TP2 hit → close
  check("closed win", closed.length === 1 && closed[0].trade.status === "closed_win", closed[0]?.trade.status);
  check("rMultiple ~1.48", Math.abs((closed[0]?.rMultiple ?? 0) - 1.48) < 0.001, closed[0]?.rMultiple);

  const pb2 = new PaperBroker();
  pb2.openTrade(sig, 2.5, 2.5, 0);
  const loss = pb2.update(C(99.5, 99.6, 98.5, 98.8, 1)); // SL hit
  check("closed loss", loss[0]?.trade.status === "closed_loss", loss[0]?.trade.status);
  check("loss rMultiple ~-1.02", Math.abs((loss[0]?.rMultiple ?? 0) + 1.02) < 0.001, loss[0]?.rMultiple);
}

// ── End-to-end: analyze + backtest don't throw, return valid shapes ──
{
  console.log("E2E:");
  const candles = new MockDataProvider(7, 2400).generate("GOLD", "5m", 300);
  const res = analyze(candles, { symbol: "GOLD", spreadPct: 0.02, newsRisk: false, contextConfirms: false, choppy: false }, DEFAULT_RISK);
  check("analyze returns a known stage", ["no_data", "waiting_sweep", "waiting_mss", "waiting_fvg", "waiting_retrace", "waiting_entry", "ready"].includes(res.stage), res.stage);
  check("levels detected", res.levels.length > 0, res.levels.length);
  // MTF: supplying 1m candles makes ltfConfirmed concrete (not null); none → null
  const ltf = new MockDataProvider(7, 2400).generate("GOLD", "1m", 600);
  const resMtf = analyze(candles, { symbol: "GOLD", spreadPct: 0.02, newsRisk: false, contextConfirms: false, choppy: false }, DEFAULT_RISK, undefined, ltf);
  check("HTF-only → ltfConfirmed null", res.ltfConfirmed === null, res.ltfConfirmed);
  check("MTF run does not throw, known stage", ["no_data","waiting_sweep","waiting_mss","waiting_fvg","waiting_retrace","waiting_entry","ready"].includes(resMtf.stage), resMtf.stage);
  const bt = runBacktest(candles, "GOLD", DEFAULT_RISK);
  check("backtest returns numeric trades", typeof bt.trades === "number" && bt.equityCurve.length >= 1, bt.trades);
  check("winRate in [0,1]", bt.winRate >= 0 && bt.winRate <= 1, bt.winRate);
  // TJR index-alignment: unaligned index still analyzes (soft gate via score, not hard block)
  const unaligned = analyze(candles, { symbol: "US100", spreadPct: 0.02, newsRisk: false, contextConfirms: false, choppy: false, indexAligned: false }, DEFAULT_RISK);
  check("indexAligned:false -> still analyzes (no hard block)", unaligned.stage !== "no_alignment", unaligned.stage);
  console.log(`     (backtest: ${bt.trades} trades, winRate ${(bt.winRate * 100).toFixed(0)}%, PF ${bt.profitFactor}, netPnl ${bt.netPnl})`);
}

// ── TJR V2 filters (from the "improved TJR" video) ──
{
  console.log("TJR V2:");
  const ctxBase = { spreadPct: 0.02, newsRisk: false, contextConfirms: false, choppy: false };
  // killzones: London open (08:00 UTC) in, Asia (02:00 UTC) out
  check("isKillzone 08:00 UTC", isKillzone(Date.UTC(2026, 5, 23, 8, 0, 0) / 1000) === true, true);
  check("isKillzone 02:00 UTC false", isKillzone(Date.UTC(2026, 5, 23, 2, 0, 0) / 1000) === false, false);
  // long-only: across seeds, a signal is NEVER a SELL
  let sawSell = false;
  for (let s = 1; s <= 8; s++) {
    const c = new MockDataProvider(s, 2400).generate("US100", "5m", 300);
    const r = analyze(c, { symbol: "US100", ...ctxBase }, DEFAULT_RISK, { sweepLookback: 10, k: 2, longOnly: true });
    if (r.signal && r.signal.direction === "SELL") sawSell = true;
  }
  check("longOnly never emits SELL", sawSell === false, sawSell);
  // htfBias present → still a known, non-crashing stage
  const cs = new MockDataProvider(7, 2400).generate("US100", "5m", 300);
  const rHtf = analyze(cs, { symbol: "US100", ...ctxBase, htfBias: "down" }, DEFAULT_RISK);
  check("htfBias set → string stage", typeof rHtf.stage === "string", rHtf.stage);
  // backtest with htf + longOnly + indices doesn't throw and returns numbers
  const htf = new MockDataProvider(7, 2400).generate("US100", "1h", 200);
  const bt2 = runBacktest(cs, "US100", DEFAULT_RISK, { sweepLookback: 10, k: 2, longOnly: true },
    { htf, isIndex: true, indices: { us100: cs, us500: cs } });
  check("backtest V2 numeric trades", typeof bt2.trades === "number" && bt2.equityCurve.length >= 1, bt2.trades);
  // long-only backtest: no closed trade is a SELL
  check("backtest longOnly: no SELL trades", bt2.closed.every((t) => t.direction === "BUY"), bt2.closed.map((t) => t.direction));
}

// ── V1 entry + exit modes (trailing / 1:1) ──
{
  console.log("V1 + Exits:");
  // V1: any emitted signal enters at the last close and carries an exitMode
  let v1ok = true, v1seen = false;
  for (let s = 1; s <= 8; s++) {
    const c = new MockDataProvider(s, 2400).generate("GOLD", "5m", 300);
    const r = analyze(c, { symbol: "GOLD", spreadPct: 0.02, newsRisk: false, contextConfirms: false, choppy: false },
      DEFAULT_RISK, { sweepLookback: 10, k: 2, mode: "v1", exitMode: "trail" });
    if (r.signal) {
      v1seen = true;
      if (r.signal.exitMode !== "trail" || r.signal.entry !== +c[c.length - 1].close.toFixed(2)) v1ok = false;
    }
  }
  check("V1 signal: entry=last close + exitMode", v1seen && v1ok, { v1seen, v1ok });

  const sigT: TradeSignal = { id: "T", time: 0, symbol: "X", direction: "BUY", entryZone: { from: 99.9, to: 100.1 }, entry: 100, stopLoss: 99, takeProfit1: 101, takeProfit2: 102, riskReward: 2, confidence: 80, session: "london", reasons: [], warnings: [], exitMode: "trail" };
  const pbT = new PaperBroker();
  pbT.openTrade(sigT, 1, 1, 0);
  pbT.update(C(100, 102, 100, 101, 1)); // +2R high → trail stop ratchets to +1R (101)
  const trailClose = pbT.update(C(101, 101.5, 100.9, 101, 2)); // retrace taps 101 → exit at +1R
  check("trail exits at +1R (~0.98R after cost)", trailClose[0]?.trade.status === "closed_win" && Math.abs((trailClose[0]?.rMultiple ?? 0) - 0.98) < 0.001, trailClose[0]?.rMultiple);

  const sigR: TradeSignal = { ...sigT, id: "R", exitMode: "rr1to1" };
  const pbW = new PaperBroker(); pbW.openTrade(sigR, 1, 1, 0);
  const rrWin = pbW.update(C(100, 101.2, 100, 101, 1)); // hits +1R
  check("rr1to1 win at +1R", rrWin[0]?.trade.status === "closed_win" && Math.abs((rrWin[0]?.rMultiple ?? 0) - 0.98) < 0.001, rrWin[0]?.rMultiple);
  const pbL = new PaperBroker(); pbL.openTrade(sigR, 1, 1, 0);
  const rrLoss = pbL.update(C(100, 100.5, 98.9, 99, 1)); // hits stop -1R
  check("rr1to1 loss at -1R", rrLoss[0]?.trade.status === "closed_loss" && Math.abs((rrLoss[0]?.rMultiple ?? 0) + 1.02) < 0.001, rrLoss[0]?.rMultiple);
}

// ── TJR building blocks ──
{
  console.log("TJR:");
  const Z = (hi: number, lo: number): Candle => ({ time: 0, open: (hi + lo) / 2, high: hi, low: lo, close: (hi + lo) / 2 });
  const up = [Z(100, 98), Z(106, 102), Z(103, 99), Z(110, 105), Z(107, 103), Z(116, 111), Z(113, 109)];
  const down = [Z(100, 98), Z(96, 92), Z(99, 95), Z(90, 86), Z(93, 89), Z(84, 80), Z(87, 83)];
  check("structureTrend up", structureTrend(up, 1) === "up", structureTrend(up, 1));
  check("structureTrend down", structureTrend(down, 1) === "down", structureTrend(down, 1));
  check("indices aligned (up,up)", indicesAligned(up, up, 1).aligned, true);
  check("indices NOT aligned (up,down)", !indicesAligned(up, down, 1).aligned, true);
  check("equilibrium(110,90)=100", equilibrium(110, 90) === 100, equilibrium(110, 90));
  const ifvg = detectInverseFVGs([Z(10, 5), Z(13, 9), Z(15, 12), { time: 0, open: 11, high: 12, low: 8, close: 9 }]);
  check("inverse FVG bearish @10", ifvg[0]?.dir === "bearish" && ifvg[0]?.level === 10, ifvg[0]);

  // recentBOS — close-through of the most recent swing (1m entry trigger)
  const bos = [Z(102, 100), Z(105, 103), Z(103, 101), Z(101, 99), Z(108, 106)];
  check("recentBOS bullish (close 107 > swing high 105)", recentBOS(bos, "bullish", 1) === true, recentBOS(bos, "bullish", 1));
  check("recentBOS bearish false here", recentBOS(bos, "bearish", 1) === false, recentBOS(bos, "bearish", 1));

  // isIndexSymbol — gate scope (trim + case-insensitive)
  check("isIndexSymbol US100/us500/' DE40 '", isIndexSymbol("US100") && isIndexSymbol("us500") && isIndexSymbol(" DE40 "), true);
  check("isIndexSymbol GOLD false", isIndexSymbol("GOLD") === false, isIndexSymbol("GOLD"));

  // drawsInDirection — TP targets nearest→farthest, near-dupes collapsed
  const lv: LiquidityLevel[] = [
    { kind: "swing_high", side: "high", price: 110, index: 0, label: "" },
    { kind: "swing_high", side: "high", price: 115, index: 0, label: "" },
    { kind: "equal_high", side: "high", price: 110.02, index: 0, label: "" },
    { kind: "swing_low", side: "low", price: 90, index: 0, label: "" },
  ];
  const dr = drawsInDirection(lv, 100, true);
  check("draws long = [110,115] (110.02 deduped)", dr.length === 2 && dr[0] === 110 && dr[1] === 115, dr);
  check("draws short below 100 = [90]", JSON.stringify(drawsInDirection(lv, 100, false)) === "[90]", drawsInDirection(lv, 100, false));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
