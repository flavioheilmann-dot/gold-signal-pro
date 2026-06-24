// server/ict-worker.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// src/trading/strategy/sessions.ts
var WINDOWS = [
  { name: "asia", start: 0, end: 7 },
  { name: "london", start: 7, end: 12 },
  { name: "newyork_am", start: 12, end: 16 },
  { name: "newyork_pm", start: 16, end: 21 }
];
function sessionOf(timeSec) {
  const h = new Date(timeSec * 1e3).getUTCHours();
  for (const w of WINDOWS) if (h >= w.start && h < w.end) return w.name;
  return "off";
}
function isPreferredSession(s) {
  return s === "london" || s === "newyork_am" || s === "newyork_pm";
}
function isKillzone(timeSec) {
  const h = new Date(timeSec * 1e3).getUTCHours();
  return h >= 7 && h < 10 || h >= 12 && h < 15;
}
var SESSION_LABEL = {
  asia: "Asia",
  london: "London",
  newyork_am: "New York AM",
  newyork_pm: "New York PM",
  off: "Off-Session"
};
function dayKey(timeSec) {
  const d = new Date(timeSec * 1e3);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function latestSessionRanges(candles) {
  const groups = /* @__PURE__ */ new Map();
  candles.forEach((c, i) => {
    const s = sessionOf(c.time);
    if (s === "off") return;
    const key = `${dayKey(c.time)}:${s}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { session: s, high: c.high, low: c.low, day: dayKey(c.time), lastIndex: i });
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.lastIndex = i;
    }
  });
  const latest = /* @__PURE__ */ new Map();
  for (const g of groups.values()) {
    const prev = latest.get(g.session);
    if (!prev || g.lastIndex > prev.lastIndex) latest.set(g.session, g);
  }
  return [...latest.values()];
}
function previousDayRange(candles) {
  if (!candles.length) return null;
  const byDay = /* @__PURE__ */ new Map();
  const order = [];
  candles.forEach((c, i) => {
    const k = dayKey(c.time);
    const g = byDay.get(k);
    if (!g) {
      byDay.set(k, { high: c.high, low: c.low, lastIndex: i });
      order.push(k);
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.lastIndex = i;
    }
  });
  if (order.length < 2) return null;
  const prev = byDay.get(order[order.length - 2]);
  return { high: prev.high, low: prev.low, index: prev.lastIndex };
}

// src/trading/strategy/structure.ts
function swingPivots(candles, k = 2) {
  const out = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: candles[i].high, side: "high" });
    if (isLow) out.push({ index: i, price: candles[i].low, side: "low" });
  }
  return out;
}
function detectStructureShift(candles, sweepIndex, dir, k = 2, maxBars = 12) {
  const pivots = swingPivots(candles, k);
  const end = Math.min(candles.length - 1, sweepIndex + maxBars);
  if (dir === "bullish") {
    const ref = [...pivots].filter((p) => p.side === "high" && p.index <= sweepIndex).pop();
    if (!ref) return null;
    for (let i = sweepIndex + 1; i <= end; i++) {
      if (candles[i].close > ref.price) {
        return { dir: "bullish", brokenLevel: ref.price, index: i, kind: "MSS" };
      }
    }
  } else {
    const ref = [...pivots].filter((p) => p.side === "low" && p.index <= sweepIndex).pop();
    if (!ref) return null;
    for (let i = sweepIndex + 1; i <= end; i++) {
      if (candles[i].close < ref.price) {
        return { dir: "bearish", brokenLevel: ref.price, index: i, kind: "MSS" };
      }
    }
  }
  return null;
}

// src/trading/strategy/liquidity.ts
function detectLiquidityLevels(candles, k = 2) {
  if (candles.length < 10) return [];
  const out = [];
  const lastIdx = candles.length - 1;
  const pdr = previousDayRange(candles);
  if (pdr) {
    out.push({ kind: "prev_day_high", side: "high", price: pdr.high, index: pdr.index, label: "Prev Day High" });
    out.push({ kind: "prev_day_low", side: "low", price: pdr.low, index: pdr.index, label: "Prev Day Low" });
  }
  const mapKind = (s, side) => {
    if (s === "asia") return side === "high" ? "asia_high" : "asia_low";
    if (s === "london") return side === "high" ? "london_high" : "london_low";
    return side === "high" ? "ny_high" : "ny_low";
  };
  for (const sr of latestSessionRanges(candles)) {
    out.push({ kind: mapKind(sr.session, "high"), side: "high", price: sr.high, index: sr.lastIndex, label: `${SESSION_LABEL[sr.session]} High` });
    out.push({ kind: mapKind(sr.session, "low"), side: "low", price: sr.low, index: sr.lastIndex, label: `${SESSION_LABEL[sr.session]} Low` });
  }
  const pivots = swingPivots(candles, k).filter((p) => p.index >= lastIdx - 40);
  for (const p of pivots) {
    out.push({
      kind: p.side === "high" ? "swing_high" : "swing_low",
      side: p.side,
      price: p.price,
      index: p.index,
      label: p.side === "high" ? "Swing High" : "Swing Low"
    });
  }
  const tol = (avgPrice(candles) || 1) * 6e-4;
  out.push(...equalLevels(pivots.filter((p) => p.side === "high"), "high", tol));
  out.push(...equalLevels(pivots.filter((p) => p.side === "low"), "low", tol));
  out.push(...hourlyLevels(candles));
  return dedupe(out);
}
function avgPrice(candles) {
  return candles.reduce((s, c) => s + c.close, 0) / Math.max(1, candles.length);
}
function equalLevels(pivots, side, tol) {
  const res = [];
  for (let i = 0; i < pivots.length; i++) {
    for (let j = i + 1; j < pivots.length; j++) {
      if (Math.abs(pivots[i].price - pivots[j].price) <= tol) {
        const price = (pivots[i].price + pivots[j].price) / 2;
        res.push({
          kind: side === "high" ? "equal_high" : "equal_low",
          side,
          price,
          index: Math.max(pivots[i].index, pivots[j].index),
          label: side === "high" ? "Equal Highs" : "Equal Lows"
        });
      }
    }
  }
  return res;
}
function hourlyLevels(candles) {
  const byHour = /* @__PURE__ */ new Map();
  const order = [];
  candles.forEach((c, i) => {
    const hk = Math.floor(c.time / 3600);
    const g = byHour.get(hk);
    if (!g) {
      byHour.set(hk, { high: c.high, low: c.low, lastIndex: i });
      order.push(hk);
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.lastIndex = i;
    }
  });
  const recent = order.slice(-4, -1);
  const out = [];
  for (const hk of recent) {
    const g = byHour.get(hk);
    out.push({ kind: "hourly_high", side: "high", price: g.high, index: g.lastIndex, label: "Hourly High" });
    out.push({ kind: "hourly_low", side: "low", price: g.low, index: g.lastIndex, label: "Hourly Low" });
  }
  return out;
}
function dedupe(levels) {
  const sorted = [...levels].sort((a, b) => b.index - a.index);
  const kept = [];
  for (const l of sorted) {
    const dup = kept.find((k) => k.side === l.side && Math.abs(k.price - l.price) / (l.price || 1) < 4e-4);
    if (!dup) kept.push(l);
  }
  return kept;
}
function drawsInDirection(levels, price, long) {
  const side = long ? "high" : "low";
  const draws = levels.filter((l) => l.side === side && (long ? l.price > price : l.price < price)).map((l) => l.price).sort((a, b) => long ? a - b : b - a);
  const out = [];
  for (const p of draws) {
    if (out.length && Math.abs(p - out[out.length - 1]) / (price || 1) < 4e-4) continue;
    out.push(p);
  }
  return out;
}

// src/trading/strategy/sweep.ts
function detectSweepAt(candles, levels, i) {
  const c = candles[i];
  if (!c) return null;
  let best = null;
  let bestPierce = 0;
  for (const lvl of levels) {
    if (lvl.index >= i) continue;
    if (lvl.side === "high" && c.high > lvl.price && c.close < lvl.price) {
      const pierce = c.high - lvl.price;
      if (pierce > bestPierce) {
        bestPierce = pierce;
        best = { dir: "bearish", level: lvl, index: i, extreme: c.high, reclaim: c.close };
      }
    }
    if (lvl.side === "low" && c.low < lvl.price && c.close > lvl.price) {
      const pierce = lvl.price - c.low;
      if (pierce > bestPierce) {
        bestPierce = pierce;
        best = { dir: "bullish", level: lvl, index: i, extreme: c.low, reclaim: c.close };
      }
    }
  }
  return best;
}
function findRecentSweep(candles, levels, lookback = 8) {
  const last = candles.length - 1;
  for (let i = last; i >= Math.max(0, last - lookback); i--) {
    const s = detectSweepAt(candles, levels, i);
    if (s) return s;
  }
  return null;
}

// src/trading/strategy/fvg.ts
function detectFVGs(candles) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    if (a.high < c.low) {
      const bottom = a.high, top = c.low;
      const mid2 = (top + bottom) / 2;
      out.push({ dir: "bullish", top, bottom, mid: mid2, index: i - 1, filled: filled(candles, i, mid2, "bullish") });
    } else if (a.low > c.high) {
      const top = a.low, bottom = c.high;
      const mid2 = (top + bottom) / 2;
      out.push({ dir: "bearish", top, bottom, mid: mid2, index: i - 1, filled: filled(candles, i, mid2, "bearish") });
    }
  }
  return out;
}
function filled(candles, formedAt, mid2, dir) {
  for (let j = formedAt + 1; j < candles.length; j++) {
    if (dir === "bullish" && candles[j].low <= mid2) return true;
    if (dir === "bearish" && candles[j].high >= mid2) return true;
  }
  return false;
}
function findEntryFVG(candles, afterIndex, dir) {
  const fvgs = detectFVGs(candles).filter((f) => f.dir === dir && f.index >= afterIndex && !f.filled);
  if (!fvgs.length) return null;
  return fvgs[fvgs.length - 1];
}

// src/trading/strategy/confidence.ts
function scoreSignal(p) {
  let score = 0;
  const reasons = [];
  const warnings = [];
  if (p.sweep) {
    score += 20;
    reasons.push("Liquidity Sweep (+20)");
  }
  if (p.mss) {
    score += 20;
    reasons.push("Market Structure Shift (+20)");
  }
  if (p.ifvg) {
    score += 10;
    reasons.push("Inverse FVG Flip (+10)");
  }
  if (p.cleanFVG) {
    score += 15;
    reasons.push("Sauberer FVG (+15)");
  }
  if (p.ltfConfirmed) {
    score += 10;
    reasons.push("1m-BOS best\xE4tigt (+10)");
  }
  if (p.preferredSession) {
    score += 15;
    reasons.push("Session passt (+15)");
  }
  if (p.rrOk) {
    score += 10;
    reasons.push("RR \u2265 1:2 (+10)");
  }
  if (p.contextConfirms) {
    score += 10;
    reasons.push("Kontextmarkt/Indizes best\xE4tigt (+10)");
  }
  if (p.lowSpread) {
    score += 10;
    reasons.push("Niedriger Spread / saubere Volatilit\xE4t (+10)");
  }
  if (p.newsRisk) {
    score -= 20;
    warnings.push("News-Risiko (\u221220)");
  }
  if (p.badSpread) {
    score -= 15;
    warnings.push("Schlechter Spread (\u221215)");
  }
  if (p.choppy) {
    score -= 15;
    warnings.push("Choppy Market (\u221215)");
  }
  if (p.noCorrelation) {
    score -= 20;
    warnings.push("Fehlende Korrelation / unklarer Kontext (\u221220)");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons, warnings };
}
var MIN_SIGNAL_SCORE = 50;

// src/trading/strategy/tjr.ts
function structureTrend(candles, k = 2) {
  const piv = swingPivots(candles, k);
  const highs = piv.filter((p) => p.side === "high").slice(-2);
  const lows = piv.filter((p) => p.side === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return "range";
  const hh = highs[1].price > highs[0].price;
  const hl = lows[1].price > lows[0].price;
  const lh = highs[1].price < highs[0].price;
  const ll = lows[1].price < lows[0].price;
  if (hh && hl) return "up";
  if (lh && ll) return "down";
  return "range";
}
function indicesAligned(a, b, k = 2) {
  const ta = structureTrend(a, k);
  const tb = structureTrend(b, k);
  if (ta !== "range" && ta === tb) return { aligned: true, dir: ta };
  return { aligned: false, dir: "range" };
}
var INDEX_EPICS = /* @__PURE__ */ new Set([
  "US100",
  "US500",
  "US30",
  "US2000",
  "DE40",
  "FR40",
  "UK100",
  "J225",
  "HK50",
  "EU50",
  "ES35",
  "NL25",
  "AUS200",
  "NAS100",
  "SPX500",
  "SP500",
  "NASDAQ",
  "NDX",
  "SPX",
  "GER40",
  "DAX"
]);
function isIndexSymbol(sym) {
  return INDEX_EPICS.has(sym.trim().toUpperCase());
}
function recentBOS(candles, dir, k = 2, lookback = 30) {
  if (candles.length < 2 * k + 2) return false;
  const piv = swingPivots(candles, k);
  const last = candles.length - 1;
  const from = Math.max(0, last - lookback);
  if (dir === "bullish") {
    const ref2 = piv.filter((p) => p.side === "high" && p.index >= from && p.index < last).pop();
    if (!ref2) return false;
    for (let i = ref2.index + 1; i <= last; i++) if (candles[i].close > ref2.price) return true;
    return false;
  }
  const ref = piv.filter((p) => p.side === "low" && p.index >= from && p.index < last).pop();
  if (!ref) return false;
  for (let i = ref.index + 1; i <= last; i++) if (candles[i].close < ref.price) return true;
  return false;
}
function equilibrium(high, low) {
  return (high + low) / 2;
}
function detectInverseFVGs(candles) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    if (a.high < c.low) {
      const bottom = a.high;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].close < bottom) {
          out.push({ dir: "bearish", level: bottom, index: j });
          break;
        }
      }
    } else if (a.low > c.high) {
      const top = a.low;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].close > top) {
          out.push({ dir: "bullish", level: top, index: j });
          break;
        }
      }
    }
  }
  return out;
}
function recentInverseFVG(candles, afterIndex, dir) {
  const all = detectInverseFVGs(candles).filter((f) => f.dir === dir && f.index >= afterIndex);
  return all.length ? all[all.length - 1] : null;
}

// src/trading/strategy/StrategyEngine.ts
var STAGE_LABEL = {
  no_data: "Zu wenig Daten",
  no_alignment: "Indizes nicht aligned \u2014 kein Trade",
  long_only_skip: "Long-only (Index) \u2014 Short ignoriert",
  htf_conflict: "Gegen 1H-Bias \u2014 kein Trade",
  off_killzone: "Au\xDFerhalb der Killzone \u2014 kein Trade",
  waiting_sweep: "Warte auf Liquidity Sweep",
  waiting_mss: "Sweep erkannt \u2014 warte auf BOS / IFVG-Flip",
  waiting_fvg: "Struktur best\xE4tigt \u2014 warte auf FVG / Equilibrium",
  waiting_retrace: "Setup bereit \u2014 warte auf Retrace in die Zone",
  waiting_entry: "Preis in Zone \u2014 warte auf 1m-BOS (Entry)",
  ready: "Setup aktiv \u2014 Entry best\xE4tigt"
};
function isChoppy(candles, n = 14) {
  const seg = candles.slice(-n);
  if (seg.length < n) return false;
  const net = Math.abs(seg[seg.length - 1].close - seg[0].open);
  const path = seg.reduce((s, c) => s + (c.high - c.low), 0);
  return path > 0 && net / path < 0.18;
}
var DEFAULT_STRATEGY_OPTS = { sweepLookback: 10, k: 2 };
function analyze(candles, ctx, risk, opts = DEFAULT_STRATEGY_OPTS, ltf) {
  const base = (stage2, extra = {}) => ({
    stage: stage2,
    stageLabel: STAGE_LABEL[stage2],
    bias: "neutral",
    levels: [],
    sweep: null,
    mss: null,
    ifvg: null,
    fvg: null,
    entryVia: null,
    ltfConfirmed: null,
    signal: null,
    ...extra
  });
  if (candles.length < 60) return base("no_data");
  const levels = detectLiquidityLevels(candles, opts.k);
  const sweep = findRecentSweep(candles, levels, opts.sweepLookback);
  if (!sweep) return base("waiting_sweep", { levels });
  const dir = sweep.dir;
  const bias = dir;
  const long = dir === "bullish";
  const sign = long ? 1 : -1;
  if (opts.longOnly && !long) return base("long_only_skip", { levels, sweep, bias });
  if (ctx.htfBias && ctx.htfBias !== "range" && (long && ctx.htfBias !== "up" || !long && ctx.htfBias !== "down")) {
    return base("htf_conflict", { levels, sweep, bias });
  }
  if (opts.requireKillzone && !isKillzone(candles[candles.length - 1].time)) {
    return base("off_killzone", { levels, sweep, bias });
  }
  const mss = detectStructureShift(candles, sweep.index, dir, opts.k);
  const ifvg = recentInverseFVG(candles, sweep.index, dir);
  if (!mss && !ifvg) return base("waiting_mss", { levels, sweep, bias });
  if (opts.mode === "v1") {
    if (!mss || mss.index < candles.length - 1 - 3) return base("waiting_mss", { levels, sweep, mss, ifvg, bias });
    const last2 = candles[candles.length - 1];
    const entry2 = last2.close;
    const buffer2 = entry2 * 3e-4 + ctx.spreadPct / 100 * entry2;
    const stopLoss2 = long ? sweep.extreme - buffer2 : sweep.extreme + buffer2;
    const riskDist2 = Math.abs(entry2 - stopLoss2);
    if (riskDist2 <= 0) return base("waiting_mss", { levels, sweep, mss, ifvg, bias });
    const exitMode = opts.exitMode ?? "trail";
    const oneR = entry2 + sign * riskDist2;
    const takeProfit22 = exitMode === "rr1to1" ? oneR : entry2 + sign * 2 * riskDist2;
    const riskReward2 = exitMode === "rr1to1" ? 1 : 2;
    const stopPct2 = riskDist2 / entry2 * 100;
    const conf2 = scoreSignal({
      sweep: true,
      mss: true,
      ifvg: false,
      cleanFVG: false,
      ltfConfirmed: false,
      preferredSession: isPreferredSession(sessionOf(last2.time)),
      rrOk: riskReward2 >= risk.minRR,
      contextConfirms: ctx.contextConfirms,
      lowSpread: ctx.spreadPct <= risk.maxSpreadPct * 0.6,
      newsRisk: ctx.newsRisk,
      badSpread: ctx.spreadPct > risk.maxSpreadPct,
      choppy: ctx.choppy || isChoppy(candles),
      noCorrelation: false
    });
    const reasons2 = [...conf2.reasons, "V1: Sweep\u2192BOS-Entry", exitMode === "rr1to1" ? "Exit: 1:1" : "Exit: Trailing-Stop (1R-Schritte)"];
    const warnings2 = [...conf2.warnings];
    if (stopPct2 < risk.minStopPct) warnings2.push("Stop sehr eng");
    if (stopPct2 > risk.maxStopPct) warnings2.push("Stop sehr weit");
    const v1base = base("ready", { levels, sweep, mss, ifvg, bias });
    if (conf2.score < MIN_SIGNAL_SCORE) return { ...v1base, signal: null };
    const signal2 = {
      id: `${ctx.symbol}-${last2.time}-${dir}`,
      time: last2.time,
      symbol: ctx.symbol,
      direction: long ? "BUY" : "SELL",
      entryZone: { from: +(entry2 - buffer2).toFixed(2), to: +(entry2 + buffer2).toFixed(2) },
      entry: +entry2.toFixed(2),
      stopLoss: +stopLoss2.toFixed(2),
      takeProfit1: +oneR.toFixed(2),
      takeProfit2: +takeProfit22.toFixed(2),
      riskReward: riskReward2,
      confidence: conf2.score,
      session: sessionOf(last2.time),
      reasons: reasons2,
      warnings: warnings2,
      exitMode
    };
    return { ...v1base, signal: signal2 };
  }
  const anchorIndex = mss?.index ?? ifvg?.index ?? sweep.index;
  const last = candles[candles.length - 1];
  const price = last.close;
  const fvg = findEntryFVG(candles, anchorIndex, dir);
  let entry, zoneTop, zoneBottom;
  let entryVia;
  if (fvg) {
    entry = fvg.mid;
    zoneTop = fvg.top;
    zoneBottom = fvg.bottom;
    entryVia = "fvg";
  } else {
    const legSeg = candles.slice(sweep.index);
    const legHi = long ? Math.max(...legSeg.map((c) => c.high)) : sweep.extreme;
    const legLo = long ? sweep.extreme : Math.min(...legSeg.map((c) => c.low));
    if (!(legHi > legLo)) return base("waiting_fvg", { levels, sweep, mss, ifvg, bias });
    const eq = equilibrium(legHi, legLo);
    const tol = price * 6e-4;
    entry = eq;
    zoneTop = eq + tol;
    zoneBottom = eq - tol;
    entryVia = "equilibrium";
  }
  const buffer = price * 3e-4 + ctx.spreadPct / 100 * price;
  const seg = candles.slice(anchorIndex);
  const entrySwingExtreme = long ? Math.min(...seg.map((c) => c.low)) : Math.max(...seg.map((c) => c.high));
  const swingSL = long ? entrySwingExtreme - buffer : entrySwingExtreme + buffer;
  const sweepSL = long ? sweep.extreme - buffer : sweep.extreme + buffer;
  const validSide = (sl) => long ? sl < entry : sl > entry;
  const stopPctOf = (sl) => Math.abs(entry - sl) / price * 100;
  const stopLoss = validSide(swingSL) && stopPctOf(swingSL) >= risk.minStopPct ? swingSL : sweepSL;
  const riskDist = Math.abs(entry - stopLoss);
  if (riskDist <= 0) return base("waiting_fvg", { levels, sweep, mss, ifvg, fvg, bias });
  const draws = drawsInDirection(levels, entry, long);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const r = riskDist;
  const tp1 = draws[0] != null ? long ? clamp(draws[0], entry + r, entry + 2 * r) : clamp(draws[0], entry - 2 * r, entry - r) : entry + sign * r;
  const beyond = draws.find((d) => long ? d > tp1 + 1e-9 : d < tp1 - 1e-9);
  const tp2Floor = entry + sign * 2 * r;
  const takeProfit2 = beyond != null ? long ? Math.max(beyond, tp2Floor) : Math.min(beyond, tp2Floor) : tp2Floor;
  const takeProfit1 = tp1;
  const riskReward = Math.abs(takeProfit2 - entry) / riskDist;
  const tapped = last.low <= zoneTop && last.high >= zoneBottom;
  let ltfConfirmed = null;
  let stage;
  if (!tapped) {
    stage = "waiting_retrace";
  } else if (ltf && ltf.length >= 10) {
    ltfConfirmed = recentBOS(ltf, dir);
    stage = ltfConfirmed ? "ready" : "waiting_entry";
  } else {
    stage = "ready";
  }
  const stopPct = riskDist / price * 100;
  const conf = scoreSignal({
    sweep: true,
    mss: !!mss,
    ifvg: !!ifvg,
    cleanFVG: entryVia === "fvg" && !!fvg && !fvg.filled && (fvg.top - fvg.bottom) / price > 3e-4,
    ltfConfirmed: ltfConfirmed === true,
    preferredSession: isPreferredSession(sessionOf(last.time)),
    rrOk: riskReward >= risk.minRR,
    contextConfirms: ctx.contextConfirms,
    lowSpread: ctx.spreadPct <= risk.maxSpreadPct * 0.6,
    newsRisk: ctx.newsRisk,
    badSpread: ctx.spreadPct > risk.maxSpreadPct,
    choppy: ctx.choppy || isChoppy(candles),
    noCorrelation: false
  });
  const reasons = [...conf.reasons];
  if (entryVia === "equilibrium") reasons.push("Entry: Equilibrium (50%)");
  if (ltf && ltf.length >= 10) reasons.push(ltfConfirmed ? "1m-Entry getriggert" : "1m-BOS noch offen");
  const warnings = [...conf.warnings];
  if (riskReward < risk.minRR) warnings.push(`RR ${riskReward.toFixed(2)} < ${risk.minRR}`);
  if (stopPct < risk.minStopPct) warnings.push("Stop sehr eng");
  if (stopPct > risk.maxStopPct) warnings.push("Stop sehr weit");
  const partial = (extra) => ({ ...base(stage, { levels, sweep, mss, ifvg, fvg, entryVia, ltfConfirmed, bias }), ...extra });
  if (conf.score < MIN_SIGNAL_SCORE) return partial({ signal: null });
  const signal = {
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
    exitMode: opts.exitMode ?? "tp"
  };
  return partial({ signal });
}

// src/lib/assets.ts
var WATCHLIST = [
  // Indizes
  { epic: "EURUSD", name: "EUR/USD", kind: "forex", liquidity: 10 },
  { epic: "US500", name: "US 500", kind: "index", liquidity: 10 },
  { epic: "GOLD", name: "Gold", kind: "metal", liquidity: 10 },
  { epic: "US100", name: "US Tech 100", kind: "index", liquidity: 9 },
  { epic: "DE40", name: "Germany 40", kind: "index", liquidity: 9 },
  { epic: "FR40", name: "France 40", kind: "index", liquidity: 7 },
  { epic: "UK100", name: "UK 100", kind: "index", liquidity: 8 },
  { epic: "J225", name: "Japan 225", kind: "index", liquidity: 7 },
  { epic: "HK50", name: "Hong Kong 50", kind: "index", liquidity: 6 },
  { epic: "EU50", name: "EU Stocks 50", kind: "index", liquidity: 7 },
  // Forex
  { epic: "GBPUSD", name: "GBP/USD", kind: "forex", liquidity: 9 },
  { epic: "USDJPY", name: "USD/JPY", kind: "forex", liquidity: 9 },
  { epic: "USDCHF", name: "USD/CHF", kind: "forex", liquidity: 8 },
  { epic: "AUDUSD", name: "AUD/USD", kind: "forex", liquidity: 7 },
  { epic: "USDCAD", name: "USD/CAD", kind: "forex", liquidity: 7 },
  { epic: "EURGBP", name: "EUR/GBP", kind: "forex", liquidity: 7 },
  { epic: "EURJPY", name: "EUR/JPY", kind: "forex", liquidity: 6 },
  { epic: "EURCHF", name: "EUR/CHF", kind: "forex", liquidity: 6 },
  // Metalle & Rohstoffe
  { epic: "SILVER", name: "Silver", kind: "metal", liquidity: 7 },
  { epic: "PLATINUM", name: "Platinum", kind: "metal", liquidity: 5 },
  { epic: "OIL_CRUDE", name: "Crude Oil Spot", kind: "commodity", liquidity: 7 },
  { epic: "NATURALGAS", name: "Natural Gas", kind: "commodity", liquidity: 6 },
  // Krypto
  { epic: "BTCUSD", name: "Bitcoin/USD", kind: "crypto", liquidity: 8 },
  { epic: "ETHUSD", name: "Ethereum/USD", kind: "crypto", liquidity: 7 },
  { epic: "SOLUSD", name: "Solana/USD", kind: "crypto", liquidity: 5 },
  // Aktien
  { epic: "AAPL", name: "Apple Inc", kind: "stock", liquidity: 8 },
  { epic: "NVDA", name: "NVIDIA Corp", kind: "stock", liquidity: 8 },
  { epic: "MSFT", name: "Microsoft Corp", kind: "stock", liquidity: 8 },
  { epic: "TSLA", name: "Tesla Inc", kind: "stock", liquidity: 7 },
  { epic: "AMZN", name: "Amazon.com Inc", kind: "stock", liquidity: 7 },
  { epic: "GOOGL", name: "Alphabet Inc - A", kind: "stock", liquidity: 7 },
  { epic: "META", name: "Meta Platforms Inc", kind: "stock", liquidity: 7 },
  { epic: "AMD", name: "Advanced Micro Devices Inc", kind: "stock", liquidity: 6 },
  { epic: "NFLX", name: "Netflix Inc", kind: "stock", liquidity: 6 },
  { epic: "JPM", name: "JPMorgan Chase & Co", kind: "stock", liquidity: 6 },
  { epic: "V", name: "Visa Inc", kind: "stock", liquidity: 6 },
  { epic: "BA", name: "Boeing Co", kind: "stock", liquidity: 5 }
];
var TJR_PROFILES = {
  GOLD: { epic: "GOLD", timeframe: "5m", sessionFilter: false, longOnly: false, exit: "trail", riskPct: 0.5 },
  BTCUSD: { epic: "BTCUSD", timeframe: "1h", sessionFilter: false, longOnly: false, exit: "trail", riskPct: 2 },
  US500: { epic: "US500", timeframe: "15m", sessionFilter: true, longOnly: true, exit: "trail", riskPct: 1 },
  US100: { epic: "US100", timeframe: "15m", sessionFilter: true, longOnly: true, exit: "trail", riskPct: 1 },
  GBPUSD: { epic: "GBPUSD", timeframe: "15m", sessionFilter: true, longOnly: false, exit: "rr1to1", riskPct: 1 }
};
var TJR_EPICS = ["GOLD", "BTCUSD", "US500", "US100", "GBPUSD"];
var TJR_ASSETS = TJR_EPICS.map((e) => WATCHLIST.find((a) => a.epic === e));
var profileFor = (epic) => TJR_PROFILES[epic.toUpperCase()];

// src/trading/types/index.ts
var DEFAULT_RISK = {
  accountStart: 1e3,
  riskPctPerTrade: 0.25,
  maxDailyLossPct: 1,
  maxWeeklyLossPct: 3,
  maxTradesPerDay: 3,
  maxConsecutiveLosses: 2,
  minRR: 2,
  maxSpreadPct: 0.05,
  minStopPct: 0.05,
  maxStopPct: 1.5
};

// server/signal-journal.mjs
var COST_R = 0.02;
function newSignal({ strategy, epic, name, dir, entry, sl, tp1, tp2, confidence, time }) {
  return {
    id: `${strategy}:${epic}:${time}`,
    strategy,
    epic,
    name,
    dir,
    // "LONG" | "SHORT"
    entry,
    sl,
    tp1,
    tp2,
    confidence,
    openedAt: time,
    status: "open",
    // open | win | loss | breakeven
    rMultiple: null,
    hitTP1: false,
    closedAt: null,
    confluence: false
  };
}
function evaluateSignal(sig, candles) {
  if (sig.status !== "open") return sig;
  const after = candles.filter((c) => c.time > sig.openedAt).sort((a, b) => a.time - b.time);
  if (!after.length) return sig;
  const long = sig.dir === "LONG" || sig.dir === "BUY";
  const R = Math.abs(sig.entry - sig.sl);
  if (R <= 0) return sig;
  const r1dist = Math.abs(sig.tp1 - sig.entry) / R;
  const r2dist = Math.abs(sig.tp2 - sig.entry) / R;
  let hitTP1 = sig.hitTP1;
  let stop = hitTP1 ? sig.entry : sig.sl;
  for (const c of after) {
    const hitSL = long ? c.low <= stop : c.high >= stop;
    const hitT1 = long ? c.high >= sig.tp1 : c.low <= sig.tp1;
    const hitT2 = long ? c.high >= sig.tp2 : c.low <= sig.tp2;
    if (hitSL) {
      if (!hitTP1) return close(sig, "loss", -1 - COST_R, c.time, false);
      return close(sig, 0.5 * r1dist - COST_R > 0.05 ? "win" : "breakeven", +(0.5 * r1dist - COST_R).toFixed(2), c.time, true);
    }
    if (hitT1) hitTP1 = true;
    if (hitTP1) stop = sig.entry;
    if (hitT2) {
      const r = 0.5 * r1dist + 0.5 * r2dist - COST_R;
      return close(sig, "win", +r.toFixed(2), c.time, true);
    }
  }
  sig.hitTP1 = hitTP1;
  return sig;
}
function close(sig, status, r, time, tookPartial) {
  sig.status = status;
  sig.rMultiple = r;
  sig.closedAt = time;
  sig.hitTP1 = tookPartial;
  return sig;
}
async function evaluateOpen(log, fetchCandles2) {
  for (const sig of log) {
    if (sig.status !== "open") continue;
    try {
      const candles = await fetchCandles2(sig.epic);
      if (candles && candles.length) evaluateSignal(sig, candles);
    } catch {
    }
  }
  const now = Math.floor(Date.now() / 1e3);
  for (const sig of log) {
    if (sig.status === "open" && now - sig.openedAt > 3 * 86400) {
      sig.status = "breakeven";
      sig.rMultiple = 0;
      sig.closedAt = now;
    }
  }
  return log;
}
function trimLog(log, max = 400) {
  return log.slice(-max);
}
function hasConfluence(epic, dir, otherLog, windowSec = 3600) {
  const now = Math.floor(Date.now() / 1e3);
  return otherLog.some(
    (s) => s.epic === epic && s.dir === dir && now - s.openedAt <= windowSec
  );
}
function summarize(log) {
  const closed = log.filter((s) => s.status !== "open");
  const wins = closed.filter((s) => s.status === "win");
  const losses = closed.filter((s) => s.status === "loss");
  const sumR = closed.reduce((a, s) => a + (s.rMultiple ?? 0), 0);
  const byStrategy = {};
  for (const s of log) {
    const k = s.strategy;
    byStrategy[k] ??= { total: 0, open: 0, wins: 0, losses: 0, sumR: 0 };
    const b = byStrategy[k];
    b.total++;
    if (s.status === "open") b.open++;
    if (s.status === "win") b.wins++;
    if (s.status === "loss") b.losses++;
    if (s.status !== "open") b.sumR += s.rMultiple ?? 0;
  }
  for (const k of Object.keys(byStrategy)) {
    const b = byStrategy[k];
    const decided = b.wins + b.losses;
    b.winRate = decided ? +(b.wins / decided).toFixed(2) : 0;
    b.sumR = +b.sumR.toFixed(2);
    b.avgR = decided ? +(b.sumR / decided).toFixed(2) : 0;
  }
  return {
    total: log.length,
    open: log.filter((s) => s.status === "open").length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? +(wins.length / (wins.length + losses.length || 1)).toFixed(2) : 0,
    sumR: +sumR.toFixed(2),
    byStrategy,
    updatedAt: Date.now()
  };
}

// server/market-filter.mjs
function isWeekend(d = /* @__PURE__ */ new Date()) {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return true;
  if (day === 0 && h < 22) return true;
  if (day === 5 && h >= 21) return true;
  return false;
}
function inActiveSession(d = /* @__PURE__ */ new Date()) {
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= 7 && h < 21;
}
function isFirstFriday(d) {
  return d.getUTCDay() === 5 && d.getUTCDate() <= 7;
}
var FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];
function inNewsBlackout(d = /* @__PURE__ */ new Date()) {
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (isFirstFriday(d) && h >= 12.25 && h <= 13.75) return "NFP";
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (FOMC_2026.includes(ymd) && h >= 17.75 && h <= 20) return "FOMC";
  return null;
}
function isStale(lastCandleSec, tfSeconds2, now = Date.now()) {
  if (!lastCandleSec) return true;
  return now / 1e3 - lastCandleSec > tfSeconds2 * 3;
}
function tfSeconds(tf) {
  const m = String(tf).match(/^(\d+)\s*(m|h|d)$/i);
  if (!m) return 300;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  return u === "h" ? n * 3600 : u === "d" ? n * 86400 : n * 60;
}
function tradingGate(now = /* @__PURE__ */ new Date()) {
  if (isWeekend(now)) return { ok: false, reason: "Wochenende" };
  if (!inActiveSession(now)) return { ok: false, reason: "ausserhalb London/NY" };
  const news = inNewsBlackout(now);
  if (news) return { ok: false, reason: `News-Sperre (${news})` };
  return { ok: true, reason: null };
}

// server/ict-worker.ts
function loadLocalEnv() {
  const path = existsSync("server/.env") ? "server/.env" : existsSync(".env") ? ".env" : null;
  if (!path) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadLocalEnv();
var ENVN = (process.env.CAPITAL_ENV || "demo").toLowerCase();
var BASE = ENVN === "live" ? "https://api-capital.backend-capital.com" : "https://demo-api-capital.backend-capital.com";
var API_KEY = process.env.CAPITAL_API_KEY || "";
var IDENT = process.env.CAPITAL_IDENTIFIER || "";
var PASS = process.env.CAPITAL_API_PASSWORD || "";
var NTFY_TOPIC = process.env.NTFY_TOPIC || "";
var DRY_RUN = process.env.ICT_DRY_RUN === "true";
var TF = process.env.ICT_TIMEFRAME || "15m";
var RES_MAP = { "1m": "MINUTE", "5m": "MINUTE_5", "15m": "MINUTE_15", "1h": "HOUR" };
var RESOLUTION = RES_MAP[TF] ?? "MINUTE_15";
var resForTf = (tf) => RES_MAP[tf] ?? RESOLUTION;
var SYMBOLS = (process.env.ICT_SYMBOLS || "GOLD,BTCUSD,US500,US100,GBPUSD").split(",").map((s) => s.trim()).filter(Boolean);
if (!API_KEY || !IDENT || !PASS) {
  console.error("Missing Capital.com credentials");
  process.exit(1);
}
if (!NTFY_TOPIC && !DRY_RUN) {
  console.error("Missing NTFY_TOPIC");
  process.exit(1);
}
var session = { cst: "", token: "" };
var authBlocked = false;
async function login() {
  const res = await fetch(`${BASE}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: IDENT, password: PASS })
  });
  if (!res.ok) {
    authBlocked = true;
    throw new Error(`auth_failed ${res.status}`);
  }
  session = { cst: res.headers.get("CST") || "", token: res.headers.get("X-SECURITY-TOKEN") || "" };
}
async function cap(path) {
  if (authBlocked) throw new Error("auth_blocked");
  if (!session.cst) await login();
  const doFetch = () => fetch(`${BASE}${path}`, { headers: { CST: session.cst, "X-SECURITY-TOKEN": session.token } });
  let res = await doFetch();
  if (res.status === 401) {
    session.cst = "";
    await login();
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
function mid(x) {
  if (x == null) return NaN;
  if (typeof x === "number") return x;
  const b = x.bid, a = x.ask ?? x.offer;
  if (b != null && a != null) return (b + a) / 2;
  return b ?? a ?? NaN;
}
function toAscii(s) {
  return s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
}
function tsUTC(s) {
  if (!s) return NaN;
  let v = String(s).trim().replace(/\//g, "-").replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(v)) v += "Z";
  return Date.parse(v);
}
var CACHE_FILE = ".ict-cache.json";
var COOLDOWN = 30 * 60 * 1e3;
var cache = {};
try {
  cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
} catch {
  cache = {};
}
var wasPushed = (k) => cache[k] != null && Date.now() - cache[k] < COOLDOWN;
var markPushed = (k) => {
  cache[k] = Date.now();
};
function saveCache() {
  const now = Date.now();
  for (const k of Object.keys(cache)) if (now - cache[k] > COOLDOWN * 2) delete cache[k];
  writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
}
var TRACK_FILE = "track-ict.json";
var OTHER_TRACK = "track-box.json";
var loadJson = (p, fb) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fb;
  }
};
var candleMemo = /* @__PURE__ */ new Map();
function fetchCandlesRes(epic, resolution) {
  const key = `${epic}:${resolution}`;
  let p = candleMemo.get(key);
  if (!p) {
    p = cap(`/api/v1/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=500`).then(
      (d) => (d.prices || []).map((q) => ({
        time: Math.floor(tsUTC(q.snapshotTimeUTC || q.snapshotTime) / 1e3),
        open: mid(q.openPrice),
        high: mid(q.highPrice),
        low: mid(q.lowPrice),
        close: mid(q.closePrice)
      })).filter((c) => Number.isFinite(c.close))
    );
    candleMemo.set(key, p);
  }
  return p;
}
async function fetchCandles(epic) {
  return fetchCandlesRes(epic, RESOLUTION);
}
async function computeAlignment() {
  try {
    const [a, b] = await Promise.all([fetchCandlesRes("US100", "MINUTE_15"), fetchCandlesRes("US500", "MINUTE_15")]);
    if (a.length < 30 || b.length < 30) return { aligned: false, dir: "range" };
    return indicesAligned(a, b);
  } catch (e) {
    console.log(`[ict-worker] Alignment-Fetch fehlgeschlagen: ${e.message}`);
    return null;
  }
}
async function runScan() {
  console.log(`[ict-worker] env=${ENVN} tf=${TF} symbols=${SYMBOLS.join(",")}${DRY_RUN ? " (DRY RUN)" : ""}`);
  authBlocked = false;
  try {
    if (!session.cst) await login();
  } catch (e) {
    console.error(`[ict-worker] LOGIN FEHLGESCHLAGEN: ${e.message} \u2014 Capital-Zugangsdaten (Env-Variablen) pruefen`);
    return;
  }
  let found = 0, pushed = 0;
  const track = loadJson(TRACK_FILE, []);
  const otherTrack = existsSync(OTHER_TRACK) ? loadJson(OTHER_TRACK, []) : [];
  await evaluateOpen(track, fetchCandles);
  const gate = tradingGate();
  if (!gate.ok) console.log(`[ict-worker] push-gate zu: ${gate.reason}`);
  const align = await computeAlignment();
  console.log(`[ict-worker] Index-Alignment US100\xD7US500: ${align ? align.aligned ? align.dir.toUpperCase() : "nicht aligned" : "unbekannt"}`);
  for (const epic of SYMBOLS) {
    try {
      const prof = profileFor(epic);
      const symTf = prof ? prof.timeframe : TF;
      const candles = await fetchCandlesRes(epic, resForTf(symTf));
      if (candles.length < 80) {
        console.log(`  \xB7 ${epic}: zu wenig Daten (${candles.length})`);
        continue;
      }
      if (isStale(candles[candles.length - 1].time, tfSeconds(symTf))) {
        console.log(`  \xB7 ${epic}: Markt zu / Daten veraltet`);
        continue;
      }
      const idx = isIndexSymbol(epic);
      const ctx = {
        symbol: epic,
        spreadPct: 0.02,
        newsRisk: false,
        contextConfirms: idx && !!align?.aligned,
        // index alignment = context confirmation
        choppy: false,
        // gate active only when we actually know the alignment; fail open otherwise
        indexAligned: idx ? align ? align.aligned : void 0 : void 0,
        indexAlignDir: idx ? align?.dir : void 0
      };
      const opts = {
        ...DEFAULT_STRATEGY_OPTS,
        mode: "v1",
        exitMode: prof ? prof.exit : "trail",
        longOnly: prof ? prof.longOnly : idx,
        requireKillzone: prof ? prof.sessionFilter : false
      };
      const res = analyze(candles, ctx, DEFAULT_RISK, opts);
      if (!res.signal || res.signal.confidence < MIN_SIGNAL_SCORE) {
        console.log(`  \xB7 ${epic}: ${res.stageLabel}`);
        continue;
      }
      if (res.stage !== "ready" && res.stage !== "waiting_retrace" && res.stage !== "waiting_entry") continue;
      found++;
      const sig = res.signal;
      const key = `${epic}:${sig.direction}`;
      if (wasPushed(key)) {
        console.log(`  \u23ED ${epic}: ${sig.direction} (cooldown)`);
        continue;
      }
      if (!gate.ok) {
        console.log(`  \u23F8 ${epic}: ${sig.direction} \u2014 kein Push (${gate.reason})`);
        continue;
      }
      const long = sig.direction === "BUY";
      const ndir = long ? "LONG" : "SHORT";
      const conf = hasConfluence(epic, ndir, otherTrack);
      const trail = sig.exitMode === "trail";
      const exitLine = trail ? `SL: ${sig.stopLoss}  Exit: Trailing-Stop (ab +1R nachziehen, kein TP)` : `SL: ${sig.stopLoss}  TP (1:1): ${sig.takeProfit1}`;
      const title = conf ? `ICT+Box: ${epic} ${sig.direction}` : `ICT: ${epic} ${sig.direction}`;
      const lines = [
        `${sig.confidence}/100 \xB7 ${trail ? "Trailing-Exit" : "RR 1:1"} \xB7 V1 Sweep\u2192BOS-Entry`,
        ...conf ? ["KONFLUENZ: Box zeigt dieselbe Richtung"] : [],
        `Entry: \u2248${sig.entry}`,
        exitLine,
        `Grund: ${sig.reasons.join(", ")}`,
        ...sig.warnings.length ? [`Warnung: ${sig.warnings.join(", ")}`] : [],
        `Quelle: Capital.com \xB7 ${symTf} \xB7 ICT V1`,
        `Nur Analyse/Paper - kein Finanzrat, zuerst selbst pruefen.`
      ];
      if (DRY_RUN) {
        console.log(`  \u{1F514} [DRY] ${title}
${lines.join("\n")}`);
      } else {
        const tag = long ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
        await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
          method: "POST",
          headers: { Title: toAscii(title), Tags: conf ? `${tag},dart,star` : `${tag},dart`, Priority: "high" },
          body: toAscii(lines.join("\n"))
        });
        console.log(`  \u{1F514} PUSH ${epic} ${sig.direction} ${sig.confidence}/100${conf ? " +KONFLUENZ" : ""}`);
      }
      markPushed(key);
      pushed++;
      const rec = newSignal({ strategy: "ICT", epic, name: epic, dir: ndir, entry: sig.entry, sl: sig.stopLoss, tp1: sig.takeProfit1, tp2: sig.takeProfit2, confidence: sig.confidence, time: candles[candles.length - 1].time });
      rec.confluence = conf;
      track.push(rec);
    } catch (e) {
      console.log(`  ! ${epic}: ${e.message}`);
    }
  }
  if (!DRY_RUN) saveCache();
  writeFileSync(TRACK_FILE, JSON.stringify(trimLog(track)), "utf8");
  const sum = summarize(track);
  console.log(`[ict-worker] done \u2014 ${found} setup(s), ${pushed} push(es); track: ${sum.closed} closed (${sum.wins}W/${sum.losses}L, ${sum.sumR}R), ${sum.open} open`);
}
if (process.env.ICT_LIB !== "1") runScan().catch((e) => {
  console.error(e);
  process.exit(1);
});
export {
  runScan
};
