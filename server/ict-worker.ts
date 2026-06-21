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
import { analyze } from "../src/trading/strategy/StrategyEngine";
import { MIN_SIGNAL_SCORE } from "../src/trading/strategy/confidence";
import { DEFAULT_RISK, type Candle, type MarketContext } from "../src/trading/types";

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

const TF = process.env.ICT_TIMEFRAME || "5m";
const RES_MAP: Record<string, string> = { "1m": "MINUTE", "5m": "MINUTE_5", "15m": "MINUTE_15" };
const RESOLUTION = RES_MAP[TF] ?? "MINUTE_5";
const SYMBOLS = (process.env.ICT_SYMBOLS || "GOLD,US100,US500,DE40,EURUSD,GBPUSD,USDJPY,BTCUSD")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (!API_KEY || !IDENT || !PASS) { console.error("Missing Capital.com credentials"); process.exit(1); }
if (!NTFY_TOPIC && !DRY_RUN) { console.error("Missing NTFY_TOPIC"); process.exit(1); }

// ── Capital.com session ──
let session = { cst: "", token: "" };
async function login() {
  const res = await fetch(`${BASE}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: IDENT, password: PASS }),
  });
  if (!res.ok) throw new Error(`auth_failed ${res.status}`);
  session = { cst: res.headers.get("CST") || "", token: res.headers.get("X-SECURITY-TOKEN") || "" };
}
async function cap(path: string): Promise<any> {
  if (!session.cst) await login();
  const doFetch = () => fetch(`${BASE}${path}`, { headers: { CST: session.cst, "X-SECURITY-TOKEN": session.token } });
  let res = await doFetch();
  if (res.status === 401) { await login(); res = await doFetch(); }
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

async function main() {
  console.log(`[ict-worker] env=${ENVN} tf=${TF} symbols=${SYMBOLS.join(",")}${DRY_RUN ? " (DRY RUN)" : ""}`);
  let found = 0, pushed = 0;

  for (const epic of SYMBOLS) {
    try {
      const d = await cap(`/api/v1/prices/${encodeURIComponent(epic)}?resolution=${RESOLUTION}&max=500`);
      const raw = d.prices || [];
      const candles: Candle[] = raw
        .map((p: any) => ({
          time: Math.floor(Date.parse(p.snapshotTimeUTC || p.snapshotTime) / 1000),
          open: mid(p.openPrice), high: mid(p.highPrice), low: mid(p.lowPrice), close: mid(p.closePrice),
        }))
        .filter((c: Candle) => Number.isFinite(c.close));
      if (candles.length < 80) { console.log(`  · ${epic}: zu wenig Daten (${candles.length})`); continue; }

      const ctx: MarketContext = { symbol: epic, spreadPct: 0.02, newsRisk: false, contextConfirms: false, choppy: false };
      const res = analyze(candles, ctx, DEFAULT_RISK);

      // only actionable setups: a full sweep→MSS→FVG plan, score ≥ 70
      if (!res.signal || res.signal.confidence < MIN_SIGNAL_SCORE) {
        console.log(`  · ${epic}: ${res.stageLabel}`);
        continue;
      }
      if (res.stage !== "ready" && res.stage !== "waiting_retrace") continue;
      found++;

      const sig = res.signal;
      const key = `${epic}:${sig.direction}`;
      if (wasPushed(key)) { console.log(`  ⏭ ${epic}: ${sig.direction} (cooldown)`); continue; }

      const long = sig.direction === "BUY";
      const stageNote = res.stage === "ready" ? "Preis in FVG-Zone" : "Retrace abwarten";
      const title = `ICT: ${epic} ${sig.direction}`;
      const lines = [
        `${sig.confidence}/100 · RR 1:${sig.riskReward} · ${stageNote}`,
        `Entry-Zone: ${sig.entryZone.from.toFixed(2)}–${sig.entryZone.to.toFixed(2)} (≈${sig.entry})`,
        `SL: ${sig.stopLoss}  TP1: ${sig.takeProfit1}  TP2: ${sig.takeProfit2}`,
        `Grund: ${sig.reasons.join(", ")}`,
        ...(sig.warnings.length ? [`Warnung: ${sig.warnings.join(", ")}`] : []),
        `Quelle: Capital.com · ${TF} · ICT`,
        `Nur Analyse/Paper - kein Finanzrat, zuerst selbst pruefen.`,
      ];

      if (DRY_RUN) {
        console.log(`  🔔 [DRY] ${title}\n${lines.join("\n")}`);
      } else {
        const tag = long ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
        await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
          method: "POST",
          headers: { Title: toAscii(title), Tags: `${tag},dart`, Priority: "high" },
          body: toAscii(lines.join("\n")),
        });
        console.log(`  🔔 PUSH ${epic} ${sig.direction} ${sig.confidence}/100`);
      }
      markPushed(key);
      pushed++;
    } catch (e) {
      console.log(`  ! ${epic}: ${(e as Error).message}`);
    }
  }

  if (!DRY_RUN) saveCache();
  console.log(`[ict-worker] done — ${found} setup(s), ${pushed} push(es)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
