// ─────────────────────────────────────────────────────────────
// Signal track-record journal. Records every pushed signal and, on later
// runs, evaluates its outcome against fresh candles: did TP1/TP2 or SL hit
// first? Same model as the paper engine — 50% at TP1 then breakeven runner
// to TP2 — so the R-multiple is comparable.
//
// Pure functions (candle fetching is injected). For analysis only.
// ─────────────────────────────────────────────────────────────

const COST_R = 0.02; // spread/slippage drag per closed trade, in R

export function newSignal({ strategy, epic, name, dir, entry, sl, tp1, tp2, confidence, time }) {
  return {
    id: `${strategy}:${epic}:${time}`,
    strategy, epic, name,
    dir, // "LONG" | "SHORT"
    entry, sl, tp1, tp2, confidence,
    openedAt: time,
    status: "open", // open | win | loss | breakeven
    rMultiple: null,
    hitTP1: false,
    closedAt: null,
    confluence: false,
  };
}

/** Step one open signal through candles that occurred after it opened. */
export function evaluateSignal(sig, candles) {
  if (sig.status !== "open") return sig;
  const after = candles.filter((c) => c.time > sig.openedAt).sort((a, b) => a.time - b.time);
  if (!after.length) return sig;

  const long = sig.dir === "LONG" || sig.dir === "BUY";
  const R = Math.abs(sig.entry - sig.sl);
  if (R <= 0) return sig;
  const r1dist = Math.abs(sig.tp1 - sig.entry) / R; // TP1 in R (~1)
  const r2dist = Math.abs(sig.tp2 - sig.entry) / R; // TP2 in R (~2)

  let hitTP1 = sig.hitTP1;
  let stop = hitTP1 ? sig.entry : sig.sl; // breakeven after TP1

  for (const c of after) {
    const hitSL = long ? c.low <= stop : c.high >= stop;
    const hitT1 = long ? c.high >= sig.tp1 : c.low <= sig.tp1;
    const hitT2 = long ? c.high >= sig.tp2 : c.low <= sig.tp2;

    if (hitSL) {
      if (!hitTP1) return close(sig, "loss", -1 - COST_R, c.time, false);
      // runner stopped at breakeven after the TP1 partial
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
  return sig; // still open
}

function close(sig, status, r, time, tookPartial) {
  sig.status = status;
  sig.rMultiple = r;
  sig.closedAt = time;
  sig.hitTP1 = tookPartial;
  return sig;
}

/** Re-evaluate all open signals using `fetchCandles(epic) -> [{time,high,low,...}]`. */
export async function evaluateOpen(log, fetchCandles) {
  for (const sig of log) {
    if (sig.status !== "open") continue;
    try {
      const candles = await fetchCandles(sig.epic);
      if (candles && candles.length) evaluateSignal(sig, candles);
    } catch { /* keep open, retry next run */ }
  }
  // expire stale opens (never resolved within ~3 days) as breakeven-ish
  const now = Math.floor(Date.now() / 1000);
  for (const sig of log) {
    if (sig.status === "open" && now - sig.openedAt > 3 * 86400) {
      sig.status = "breakeven";
      sig.rMultiple = 0;
      sig.closedAt = now;
    }
  }
  return log;
}

/** Cap the log so it can't grow unbounded (keep most recent). */
export function trimLog(log, max = 400) {
  return log.slice(-max);
}

/** Confluence: another strategy has a recent open same-epic same-dir signal. */
export function hasConfluence(epic, dir, otherLog, windowSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return otherLog.some(
    (s) => s.epic === epic && s.dir === dir && now - s.openedAt <= windowSec
  );
}

export function summarize(log) {
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
    updatedAt: Date.now(),
  };
}
