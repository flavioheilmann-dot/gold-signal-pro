// ─────────────────────────────────────────────────────────────
// Local Capital.com proxy. Holds credentials server-side (from .env),
// authenticates, and exposes a SMALL read-mostly API to the frontend.
//
// Safety:
//  • Order placement is OFF unless CAPITAL_TRADING_ENABLED=true AND the
//    request carries an explicit confirm flag (set by a human in the UI).
//  • This server never trades on its own.
// ─────────────────────────────────────────────────────────────
import express from "express";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { startScanner } from "./scanner.mjs";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const PORT = process.env.PORT || 8787;
const ENVN = (process.env.CAPITAL_ENV || "demo").toLowerCase();
const BASE =
  ENVN === "live"
    ? "https://api-capital.backend-capital.com"
    : "https://demo-api-capital.backend-capital.com";
const API_KEY = process.env.CAPITAL_API_KEY || "";
const IDENT = process.env.CAPITAL_IDENTIFIER || "";
const PASS = process.env.CAPITAL_API_PASSWORD || "";
const TRADING = String(process.env.CAPITAL_TRADING_ENABLED || "").toLowerCase() === "true";
const GOLD_EPIC = process.env.GOLD_EPIC || "GOLD";
const configured = Boolean(API_KEY && IDENT && PASS);

const app = express();
app.use(express.json());

let session = { cst: "", token: "", ts: 0 };

async function login() {
  const res = await fetch(`${BASE}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: IDENT, password: PASS }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`auth_failed ${res.status} ${t.slice(0, 180)}`);
  }
  session = {
    cst: res.headers.get("CST") || "",
    token: res.headers.get("X-SECURITY-TOKEN") || "",
    ts: Date.now(),
  };
}

async function ensureSession() {
  if (!configured) throw new Error("not_configured");
  if (session.cst && Date.now() - session.ts < 9 * 60 * 1000) return;
  await login();
}

async function cap(method, path, body) {
  await ensureSession();
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        CST: session.cst,
        "X-SECURITY-TOKEN": session.token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await doFetch();
  if (res.status === 401) {
    await login(); // re-auth once
    res = await doFetch();
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

app.get("/api/capital/status", async (_req, res) => {
  let connected = false;
  let error;
  if (configured) {
    try {
      await ensureSession();
      connected = true;
    } catch (e) {
      error = String(e.message || e);
    }
  }
  res.json({ configured, connected, env: ENVN, tradingEnabled: TRADING, goldEpic: GOLD_EPIC, error });
});

app.get("/api/capital/account", async (_req, res) => {
  try {
    const d = await cap("GET", "/api/v1/accounts");
    const a = (d.accounts || []).find((x) => x.preferred) || (d.accounts || [])[0] || {};
    const bal = a.balance || {};
    res.json({
      currency: a.currency || "",
      balance: bal.balance ?? null,
      available: bal.available ?? null,
      pnl: bal.profitLoss ?? null,
      deposit: bal.deposit ?? null,
      accountName: a.accountName || "",
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/api/capital/positions", async (_req, res) => {
  try {
    const d = await cap("GET", "/api/v1/positions");
    const positions = (d.positions || []).map((p) => ({
      epic: p.market?.epic || p.position?.epic || "",
      instrument: p.market?.instrumentName || "",
      direction: p.position?.direction || "",
      size: p.position?.size ?? null,
      level: p.position?.level ?? null,
      pnl: p.position?.upl ?? null,
    }));
    res.json({ positions });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/api/capital/market/:epic", async (req, res) => {
  try {
    const d = await cap("GET", `/api/v1/markets/${encodeURIComponent(req.params.epic)}`);
    const s = d.snapshot || {};
    const inst = d.instrument || {};
    const rules = d.dealingRules || {};
    const mf = inst.marginFactor != null ? Number(inst.marginFactor) : null;
    const leverage = mf && inst.marginFactorUnit === "PERCENTAGE" ? Math.round(100 / mf) : null;
    res.json({
      epic: req.params.epic,
      bid: s.bid ?? null,
      offer: s.offer ?? null,
      status: s.marketStatus ?? null,
      marginFactor: mf,
      marginFactorUnit: inst.marginFactorUnit ?? null,
      leverage,
      minDealSize: rules.minDealSize?.value ?? rules.minDealSize?.size ?? null,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

function mid(x) {
  if (x == null) return NaN;
  if (typeof x === "number") return x;
  const b = x.bid,
    a = x.ask ?? x.offer;
  if (b != null && a != null) return (b + a) / 2;
  return b ?? a ?? NaN;
}

// Capital's snapshotTimeUTC carries a UTC value but NO zone designator
// ("2026-06-23T06:45:00"). Plain Date.parse() treats that as the server's
// LOCAL time, so on a UTC+2 box every candle is shifted 2h into the past
// (stale chart + wrong session windows). Force UTC parsing.
function tsUTC(s) {
  if (!s) return NaN;
  let v = String(s).trim().replace(/\//g, "-").replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(v)) v += "Z";
  return Date.parse(v);
}

// Real Capital.com OHLC candles for any instrument (epic).
app.get("/api/capital/candles/:epic", async (req, res) => {
  try {
    const resolution = String(req.query.resolution || "HOUR_4");
    const max = Math.min(Number(req.query.max) || 200, 1000);
    const d = await cap(
      "GET",
      `/api/v1/prices/${encodeURIComponent(req.params.epic)}?resolution=${resolution}&max=${max}`
    );
    const candles = (d.prices || [])
      .map((p) => ({
        time: Math.floor(tsUTC(p.snapshotTimeUTC || p.snapshotTime) / 1000),
        open: mid(p.openPrice),
        high: mid(p.highPrice),
        low: mid(p.lowPrice),
        close: mid(p.closePrice),
      }))
      .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.time));
    res.json({ epic: req.params.epic, candles });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Search instruments to find valid epics.
app.get("/api/capital/search", async (req, res) => {
  try {
    const term = encodeURIComponent(String(req.query.q || ""));
    const d = await cap("GET", `/api/v1/markets?searchTerm=${term}`);
    const markets = (d.markets || []).slice(0, 15).map((m) => ({
      epic: m.epic,
      name: m.instrumentName,
      type: m.instrumentType,
      status: m.marketStatus,
    }));
    res.json({ markets });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Guarded order placement — human-confirmed only.
app.post("/api/capital/order", async (req, res) => {
  if (!TRADING) return res.status(403).json({ error: "trading_disabled" });
  const { epic, direction, size, stopLevel, profitLevel, confirm } = req.body || {};
  if (confirm !== true) return res.status(400).json({ error: "confirmation_required" });
  if (!epic || !["BUY", "SELL"].includes(direction) || !(size > 0))
    return res.status(400).json({ error: "invalid_order" });
  try {
    const payload = { epic, direction, size: Number(size), guaranteedStop: false };
    if (stopLevel) payload.stopLevel = Number(stopLevel);
    if (profitLevel) payload.profitLevel = Number(profitLevel);
    const d = await cap("POST", "/api/v1/positions", payload);
    res.json({ ok: true, dealReference: d.dealReference || null });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// ── Local trade tracker (polls positions, detects closes) ──
const TRADES_FILE = fileURLToPath(new URL("./trades.json", import.meta.url));

function loadLocalTrades() {
  try {
    if (existsSync(TRADES_FILE)) return JSON.parse(readFileSync(TRADES_FILE, "utf8"));
  } catch { /* corrupt file */ }
  return [];
}

function saveLocalTrades(trades) {
  writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), "utf8");
}

let prevPositions = new Map();
let localTrades = loadLocalTrades();
let trackerBooted = false;

async function trackPositions() {
  if (!configured) return;
  try {
    const d = await cap("GET", "/api/v1/positions");
    const current = new Map();
    for (const p of d.positions || []) {
      const epic = p.market?.epic || p.position?.epic || "";
      current.set(p.position?.dealId || epic, {
        epic,
        instrument: p.market?.instrumentName || "",
        direction: p.position?.direction || "",
        size: p.position?.size ?? null,
        level: p.position?.level ?? null,
        dealId: p.position?.dealId || "",
      });
    }
    if (trackerBooted) {
      for (const [id, prev] of prevPositions) {
        if (!current.has(id)) {
          const acct = await cap("GET", "/api/v1/accounts").catch(() => null);
          const bal = acct?.accounts?.[0]?.balance?.balance ?? null;
          const entry = {
            date: new Date().toISOString(),
            type: "TRADE",
            reference: prev.dealId,
            instrumentName: prev.instrument,
            direction: prev.direction,
            size: prev.size,
            openLevel: prev.level,
            closeLevel: null,
            profitAndLoss: "",
            currency: "CHF",
            balanceAfter: bal,
          };
          localTrades.unshift(entry);
          saveLocalTrades(localTrades);
          console.log(`[tracker] closed: ${prev.instrument} ${prev.direction} → saved`);
        }
      }
    }
    prevPositions = current;
    trackerBooted = true;
  } catch { /* skip on error */ }
}

if (configured) {
  trackPositions();
  setInterval(trackPositions, 30000);
}

// ── Trade history (API + local tracker) ──
app.get("/api/capital/history", async (req, res) => {
  try {
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString();
    const to = req.query.to || new Date().toISOString();
    // Capital.com requires: no Z suffix, no ms, to must be <= now
    const clean = (s) => s.replace(/\.\d+Z?$/, "").replace(/Z$/, "");
    const nowIso = clean(new Date(Date.now() - 60000).toISOString());
    const qFrom = clean(from);
    const qTo = clean(to) > nowIso ? nowIso : clean(to);
    const [activity, transactions] = await Promise.all([
      cap("GET", `/api/v1/history/activity?from=${qFrom}&to=${qTo}&detailed=true`).catch(() => ({ activities: [] })),
      cap("GET", `/api/v1/history/transactions?from=${qFrom}&to=${qTo}&type=ALL`).catch(() => ({ transactions: [] })),
    ]);
    const apiTx = (transactions.transactions || []).map((t) => ({
      date: t.date || t.dateUtc || "",
      type: t.type || "",
      reference: t.reference || "",
      instrumentName: t.instrumentName || "",
      size: t.size ?? null,
      openLevel: t.openLevel ?? null,
      closeLevel: t.closeLevel ?? null,
      profitAndLoss: t.profitAndLoss || t.cashTransaction || "",
      currency: t.currency || "",
    }));
    // Merge local tracked trades (dedupe by reference)
    const apiRefs = new Set(apiTx.map((t) => t.reference));
    const local = localTrades.filter((t) => !apiRefs.has(t.reference));
    const allTx = [...apiTx, ...local].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    res.json({
      activities: (activity.activities || []).map((a) => ({
        date: a.date || "",
        type: a.type || "",
        status: a.status || "",
        epic: a.epic || "",
        dealId: a.dealId || "",
        description: a.description || "",
        details: a.details || {},
        actions: a.actions || [],
      })),
      transactions: allTx,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// ── Live market news (Yahoo Finance RSS, no key needed) ──
let newsCache = { items: [], ts: 0 };
const NEWS_TTL = 5 * 60 * 1000; // 5min cache

function parseRssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/) || [])[1] ||
                  (block.match(/<title>(.*?)<\/title>/) || [])[1] || "";
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "";
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";
    const desc = (block.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/) || [])[1] ||
                 (block.match(/<description>(.*?)<\/description>/) || [])[1] || "";
    if (title) items.push({ title: title.replace(/<[^>]*>/g, "").trim(), link, pubDate, description: desc.replace(/<[^>]*>/g, "").slice(0, 200).trim() });
  }
  return items;
}

async function fetchNews() {
  if (Date.now() - newsCache.ts < NEWS_TTL && newsCache.items.length) return newsCache.items;
  const feeds = [
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC%3DF%2C%5EGSPC%2CEURUSD%3DX%2CBTC-USD%2CAAPL%2CNVDA&region=US&lang=en-US",
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US",
  ];
  const all = [];
  for (const url of feeds) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const xml = await r.text();
        all.push(...parseRssItems(xml));
      }
    } catch { /* skip failed feed */ }
  }
  const seen = new Set();
  const deduped = all.filter((it) => {
    if (seen.has(it.title)) return false;
    seen.add(it.title);
    return true;
  }).slice(0, 20);
  newsCache = { items: deduped, ts: Date.now() };
  return deduped;
}

app.get("/api/capital/news", async (_req, res) => {
  try {
    const items = await fetchNews();
    res.json({ items });
  } catch (e) {
    res.json({ items: [], error: String(e.message || e) });
  }
});

app.get("/api/capital/health", (_req, res) => res.json({ ok: true, env: ENVN, configured, v: 2 }));

app.post("/api/capital/history/import", (req, res) => {
  const trades = req.body;
  if (!Array.isArray(trades)) return res.status(400).json({ error: "expected array" });
  for (const t of trades) {
    if (!t.instrumentName || !t.date) continue;
    const exists = localTrades.some((x) => x.reference === t.reference && t.reference);
    if (!exists) localTrades.unshift({ type: "TRADE", currency: "CHF", ...t });
  }
  saveLocalTrades(localTrades);
  res.json({ ok: true, count: localTrades.length });
});

const NTFY_TOPIC = process.env.NTFY_TOPIC || "";

app.listen(PORT, () => {
  console.log(`[capital-proxy] ${ENVN.toUpperCase()} on :${PORT} · configured=${configured} · trading=${TRADING}`);
  if (configured) {
    startScanner(cap, NTFY_TOPIC);
  }
});
