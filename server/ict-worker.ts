// ─────────────────────────────────────────────────────────────
// Cloud ICT worker — runs the SAME pure strategy engine the app uses
// (src/trading/strategy) against live Capital.com candles, and pushes a
// phone notification (ntfy) when a qualified setup appears. Designed to run
// in GitHub Actions on a cron, so it works even with the laptop off.
//
// Runs once per invocation (stateless except a small cooldown cache).
// Bundled with esbuild (no node_modules needed — the strategy modules have
// no external deps) and executed with `node`.
//
// For education / paper analysis only. Sends notifications, never orders.
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { analyze, DEFAULT_STRATEGY_OPTS } from "../src/trading/strategy/StrategyEngine";
import { MIN_SIGNAL_SCORE } from "../src/trading/strategy/confidence";
import { indicesAligned, isIndexSymbol, type StructTrend } from "../src/trading/strategy/tjr";
import { profileFor } from "../src/lib/assets";
import { DEFAULT_RISK, type Candle, type MarketContext } from "../src/trading/types";
// shared cloud-scanner utilities (plain ESM, bundled by esbuild)
import { evaluateOpen, newSignal, hasConfluence, summarize, trimLog } from "./signal-journal.mjs";
import { tradingGate, isStale, tfSeconds } from "./market-filter.mjs";

// Load server/.env for LOCAL runs (gitignored). In CI the vars come from
// the workflow `env:` (GitHub Secrets) and this file does not exist.
function loadLocalEnv() {
  const path = existsSync("server/.env") ? "server/.env" : existsSync(".env") ? ".env" : null;
  if (!path) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadLocalEnv();

const ENVN = (process.env.CAPITAL_ENV || "demo").toLowerCase();
const BASE = ENVN === "live"
  ? "https://api-capital.backend-capital.com"
  : "https://demo-api-capital.backend-capital.com";
const API_KEY = process.env.CAPITAL_API_KEY || "";
const IDENT = process.env.CAPITAL_IDENTIFIER || "";
const PASS = process.env.CAPITAL_API_PASSWORD || "";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const DRY_RUN = process.env.ICT_DRY_RUN === "true";

const TF = process.env.ICT_TIMEFRAME || "15m";
const RES_MAP: Record<string, string> = { "1m": "MINUTE", "5m": "MINUTE_5", "15m": "MINUTE_15", "1h": "HOUR" };
const RESOLUTION = RES_MAP[TF] ?? "MINUTE_15";
const resForTf = (tf: string) => RES_MAP[tf] ?? RESOLUTION;
// TJR V2 "dream team" — each symbol uses its own profile (timeframe/exit/etc.).
const SYMBOLS = (process.env.ICT_SYMBOLS || "GOLD,BTCUSD,US500,US100,GBPUSD")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (!API_KEY || !IDENT || !PASS) { console.error("Missing Capital.com credentials"); process.exit(1); }
if (!NTFY_TOPIC && !DRY_RUN) { console.error("Missing NTFY_TOPIC"); process.exit(1); }

// ── Capital.com session ── (reused across loop runs)
let session = { cst: "", token: "" };
let authBlocked = false; // stop hammering Capital after an auth rejection
async function login() {
  const res = await fetch(`${BASE}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: IDENT, password: PASS }),
  });
  if (!res.ok) { authBlocked = true; throw new Error(`auth_failed ${res.status}`); }
  session = { cst: res.headers.get("CST") || "", token: res.headers.get("X-SECURITY-TOKEN") || "" };
}
async function cap(path: string): Promise<any> {
  if (authBlocked) throw new Error("auth_blocked");
  if (!session.cst) await login();
  const doFetch = () => fetch(`${BASE}${path}`, { headers: { CST: session.cst, "X-SECURITY-TOKEN": session.token } });
  let res = await doFetch();
  if (res.status === 401) { session.cst = ""; await login(); res = await doFetch(); }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function mid(x: any): number {
  if (x == null) return NaN;
  if (typeof x === "number") return x;
  const b = x.bid, a = x.ask ?? x.offer;
  if (b != null && a != null) return (b + a) / 2;
  return b ?? a ?? NaN;
}
function toAscii(s: string): string {
  // decompose accents, then drop everything non-ASCII (incl. combining marks)
  return s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
}
// Capital's snapshotTimeUTC has no zone designator → force UTC so candles
// aren't shifted by the local TZ offset (matters when run off a UTC machine).
function tsUTC(s: string): number {
  if (!s) return NaN;
  let v = String(s).trim().replace(/\//g, "-").replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(v)) v += "Z";
  return Date.parse(v);
}

// ── Cooldown cache (persisted across runs via GitHub Actions cache) ──
const CACHE_FILE = ".ict-cache.json";
const COOLDOWN = 30 * 60 * 1000;
let cache: Record<string, number> = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }
const wasPushed = (k: string) => cache[k] != null && Date.now() - cache[k] < COOLDOWN;
const markPushed = (k: string) => { cache[k] = Date.now(); };
function saveCache() {
  const now = Date.now();
  for (const k of Object.keys(cache)) if (now - cache[k] > COOLDOWN * 2) delete cache[k];
  writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
}

// ── Track record (own = ict, read-only other = box) ──
const TRACK_FILE = "track-ict.json";
const OTHER_TRACK = "track-box.json";
const loadJson = (p: string, fb: any) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; } };

// Per-run candle memo so alignment + LTF + loop don't refetch the same series.
const candleMemo = new Map<string, Promise<Candle[]>>();
function fetchCandlesRes(epic: string, resolution: string): Promise<Candle[]> {
  const key = `${epic}:${resolution}`;
  let p = candleMemo.get(key);
  if (!p) {
    p = cap(`/api/v1/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=500`).then((d: any) =>
      (d.prices || [])
        .map((q: any) => ({
          time: Math.floor(tsUTC(q.snapshotTimeUTC || q.snapshotTime) / 1000),
          open: mid(q.openPrice), high: mid(q.highPrice), low: mid(q.lowPrice), close: mid(q.closePrice),
        }))
        .filter((c: Candle) => Number.isFinite(c.close))
    );
    candleMemo.set(key, p);
  }
  return p;
}
async function fetchCandles(epic: string): Promise<Candle[]> {
  return fetchCandlesRes(epic, RESOLUTION);
}

// TJR index-alignment reference (US100 × US500) on the indices' 15m timeframe.
async function computeAlignment(): Promise<{ aligned: boolean; dir: StructTrend } | null> {
  try {
    const [a, b] = await Promise.all([fetchCandlesRes("US100", "MINUTE_15"), fetchCandlesRes("US500", "MINUTE_15")]);
    if (a.length < 30 || b.length < 30) return { aligned: false, dir: "range" };
    return indicesAligned(a, b);
  } catch (e) {
    console.log(`[ict-worker] Alignment-Fetch fehlgeschlagen: ${(e as Error).message}`);
    return null; // unknown → no gate (fail open rather than mute every index)
  }
}

export async function runScan() {
  console.log(`[ict-worker] env=${ENVN} tf=${TF} symbols=${SYMBOLS.join(",")}${DRY_RUN ? " (DRY RUN)" : ""}`);
  authBlocked = false; // give auth one fresh chance per run
  try {
    if (!session.cst) await login();
  } catch (e) {
    console.error(`[ict-worker] LOGIN FEHLGESCHLAGEN: ${(e as Error).message} — Capital-Zugangsdaten (Env-Variablen) pruefen`);
    return;
  }
  let found = 0, pushed = 0;

  const track = loadJson(TRACK_FILE, []) as any[];
  const otherTrack = (existsSync(OTHER_TRACK) ? loadJson(OTHER_TRACK, []) : []) as any[];
  await evaluateOpen(track, fetchCandles);
  const gate = tradingGate();
  if (!gate.ok) console.log(`[ict-worker] push-gate zu: ${gate.reason}`);

  // index-alignment gate, computed once per run from US100 × US500
  const align = await computeAlignment();
  console.log(`[ict-worker] Index-Alignment US100×US500: ${align ? (align.aligned ? align.dir.toUpperCase() : "nicht aligned") : "unbekannt"}`);

  for (const epic of SYMBOLS) {
    try {
      const prof = profileFor(epic);
      const symTf = prof ? prof.timeframe : TF;
      const candles: Candle[] = await fetchCandlesRes(epic, resForTf(symTf));
      if (candles.length < 80) { console.log(`  · ${epic}: zu wenig Daten (${candles.length})`); continue; }
      if (isStale(candles[candles.length - 1].time, tfSeconds(symTf))) { console.log(`  · ${epic}: Markt zu / Daten veraltet`); continue; }

      const idx = isIndexSymbol(epic);
      const ctx: MarketContext = {
        symbol: epic,
        spreadPct: 0.02,
        newsRisk: false,
        contextConfirms: idx && !!align?.aligned, // index alignment = context confirmation
        choppy: false,
        // gate active only when we actually know the alignment; fail open otherwise
        indexAligned: idx ? (align ? align.aligned : undefined) : undefined,
        indexAlignDir: idx ? align?.dir : undefined,
      };
      // TJR V2 (video): simple V1 entry, per-asset exit/long-only/session profile
      const opts = {
        ...DEFAULT_STRATEGY_OPTS,
        mode: "v1" as const,
        exitMode: prof ? prof.exit : ("trail" as const),
        longOnly: prof ? prof.longOnly : idx,
        requireKillzone: prof ? prof.sessionFilter : false,
      };
      const res = analyze(candles, ctx, DEFAULT_RISK, opts);

      // only actionable setups: a full sweep→(BOS/IFVG)→(FVG/EQ) plan, score ≥ 70
      if (!res.signal || res.signal.confidence < MIN_SIGNAL_SCORE) {
        console.log(`  · ${epic}: ${res.stageLabel}`);
        continue;
      }
      if (res.stage !== "ready" && res.stage !== "waiting_retrace" && res.stage !== "waiting_entry") continue;
      found++;

      const sig = res.signal;
      const key = `${epic}:${sig.direction}`;
      if (wasPushed(key)) { console.log(`  ⏭ ${epic}: ${sig.direction} (cooldown)`); continue; }
      if (!gate.ok) { console.log(`  ⏸ ${epic}: ${sig.direction} — kein Push (${gate.reason})`); continue; }

      const long = sig.direction === "BUY";
      const ndir = long ? "LONG" : "SHORT"; // normalised for cross-strategy confluence
      const conf = hasConfluence(epic, ndir, otherTrack);
      const trail = sig.exitMode === "trail";
      const exitLine = trail
        ? `SL: ${sig.stopLoss}  Exit: Trailing-Stop (ab +1R nachziehen, kein TP)`
        : `SL: ${sig.stopLoss}  TP (1:1): ${sig.takeProfit1}`;
      const title = conf ? `ICT+Box: ${epic} ${sig.direction}` : `ICT: ${epic} ${sig.direction}`;
      const lines = [
        `${sig.confidence}/100 · ${trail ? "Trailing-Exit" : "RR 1:1"} · V1 Sweep→BOS-Entry`,
        ...(conf ? ["KONFLUENZ: Box zeigt dieselbe Richtung"] : []),
        `Entry: ≈${sig.entry}`,
        exitLine,
        `Grund: ${sig.reasons.join(", ")}`,
        ...(sig.warnings.length ? [`Warnung: ${sig.warnings.join(", ")}`] : []),
        `Quelle: Capital.com · ${symTf} · ICT V1`,
        `Nur Analyse/Paper - kein Finanzrat, zuerst selbst pruefen.`,
      ];

      if (DRY_RUN) {
        console.log(`  🔔 [DRY] ${title}\n${lines.join("\n")}`);
      } else {
        const tag = long ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
        await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
          method: "POST",
          headers: { Title: toAscii(title), Tags: conf ? `${tag},dart,star` : `${tag},dart`, Priority: "high" },
          body: toAscii(lines.join("\n")),
        });
        console.log(`  🔔 PUSH ${epic} ${sig.direction} ${sig.confidence}/100${conf ? " +KONFLUENZ" : ""}`);
      }
      markPushed(key);
      pushed++;
      const rec = newSignal({ strategy: "ICT", epic, name: epic, dir: ndir, entry: sig.entry, sl: sig.stopLoss, tp1: sig.takeProfit1, tp2: sig.takeProfit2, confidence: sig.confidence, time: candles[candles.length - 1].time });
      rec.confluence = conf;
      track.push(rec);
    } catch (e) {
      console.log(`  ! ${epic}: ${(e as Error).message}`);
    }
  }

  if (!DRY_RUN) saveCache();
  writeFileSync(TRACK_FILE, JSON.stringify(trimLog(track)), "utf8");
  const sum = summarize(track);
  console.log(`[ict-worker] done — ${found} setup(s), ${pushed} push(es); track: ${sum.closed} closed (${sum.wins}W/${sum.losses}L, ${sum.sumR}R), ${sum.open} open`);
}

// Auto-run when executed directly (GitHub Actions). The always-on worker sets
// ICT_LIB=1 and imports runScan instead, so this guard skips the auto-run.
if (process.env.ICT_LIB !== "1") runScan().catch((e) => { console.error(e); process.exit(1); });
