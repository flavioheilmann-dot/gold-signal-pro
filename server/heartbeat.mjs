// ─────────────────────────────────────────────────────────────
// Daily heartbeat: confirms the scanners are alive and publishes a
// track-record snapshot the app can read. Reads the cached track logs
// (restored in the workflow), pushes a low-priority ntfy summary, and
// writes data/track-record.json (committed by the workflow).
//
// No Capital.com calls — just summarises what the scanners already logged.
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { summarize } from "./signal-journal.mjs";

const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const DRY_RUN = process.env.HEARTBEAT_DRY_RUN === "true";
const loadJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return []; } };
const toAscii = (s) => s.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

const box = existsSync("track-box.json") ? loadJson("track-box.json") : [];
const ict = existsSync("track-ict.json") ? loadJson("track-ict.json") : [];
const sBox = summarize(box);
const sIct = summarize(ict);

// recent signals across both strategies for the app's track-record panel
const recent = [...box, ...ict]
  .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
  .slice(0, 25);

const snapshot = { updatedAt: Date.now(), box: sBox, ict: sIct, recent };
mkdirSync("data", { recursive: true });
writeFileSync("data/track-record.json", JSON.stringify(snapshot, null, 2), "utf8");
console.log(`[heartbeat] snapshot: Box ${sBox.closed} closed/${sBox.open} open, ICT ${sIct.closed} closed/${sIct.open} open`);

const fmt = (name, s) =>
  `${name}: ${s.closed} zu (${s.wins}W/${s.losses}L, ${s.sumR >= 0 ? "+" : ""}${s.sumR}R), ${s.open} offen`;
const body = [
  "Scanner laufen. Track-Record:",
  fmt("Box", sBox),
  fmt("ICT", sIct),
  "Nur Analyse - kein Finanzrat.",
].join("\n");

if (DRY_RUN || !NTFY_TOPIC) {
  console.log("[heartbeat] (dry / no topic)\n" + body);
} else {
  await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
    method: "POST",
    headers: { Title: toAscii("Gold Signal Pro - Tages-Status"), Tags: "bar_chart", Priority: "low" },
    body: toAscii(body),
  });
  console.log("[heartbeat] pushed daily status");
}
