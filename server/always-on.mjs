// ─────────────────────────────────────────────────────────────
// Always-on worker — runs the Box + ICT scanners on a tight internal loop,
// independent of GitHub's (throttled) cron. Meant to run 24/7 on a small
// host (e.g. a free Render web service) so phone signals keep coming with
// the laptop closed.
//
// Drives the existing scanners' runScan() exports. We set BOX_LIB/ICT_LIB
// BEFORE importing them so their direct-run guards stay quiet and we control
// the cadence. A tiny HTTP health endpoint lets a free uptime pinger keep
// the host awake and reports last-run status.
//
// Credentials come from the host's environment (CAPITAL_*, NTFY_TOPIC) —
// never hard-coded. For analysis/paper only; never places orders.
// ─────────────────────────────────────────────────────────────
import http from "node:http";

process.env.BOX_LIB = "1";
process.env.ICT_LIB = "1";

const PORT = Number(process.env.PORT || 3000);
const BOX_EVERY = Number(process.env.BOX_INTERVAL_SEC || 120) * 1000; // 2 min
const ICT_EVERY = Number(process.env.ICT_INTERVAL_SEC || 180) * 1000; // 3 min

// dynamic import AFTER the env flags are set
const { runScan: runBox } = await import("./gh-scanner.mjs");
const { runScan: runIct } = await import("./ict-worker.bundle.mjs");

const state = { started: Date.now(), box: null, ict: null, boxErr: null, ictErr: null, boxRuns: 0, ictRuns: 0 };

async function loopBox() {
  try { await runBox(); state.box = Date.now(); state.boxErr = null; state.boxRuns++; }
  catch (e) { state.boxErr = String(e?.message || e); console.error("[box]", state.boxErr); }
  finally { setTimeout(loopBox, BOX_EVERY); }
}
async function loopIct() {
  try { await runIct(); state.ict = Date.now(); state.ictErr = null; state.ictRuns++; }
  catch (e) { state.ictErr = String(e?.message || e); console.error("[ict]", state.ictErr); }
  finally { setTimeout(loopIct, ICT_EVERY); }
}

http
  .createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.end(JSON.stringify({
      ok: true,
      uptimeSec: Math.round((Date.now() - state.started) / 1000),
      box: { lastRun: state.box, runs: state.boxRuns, error: state.boxErr, everySec: BOX_EVERY / 1000 },
      ict: { lastRun: state.ict, runs: state.ictRuns, error: state.ictErr, everySec: ICT_EVERY / 1000 },
    }));
  })
  .listen(PORT, () => console.log(`[always-on] health on :${PORT} — Box/${BOX_EVERY / 1000}s, ICT/${ICT_EVERY / 1000}s`));

loopBox();
setTimeout(loopIct, 5000); // stagger the two so they don't hammer the API at once
