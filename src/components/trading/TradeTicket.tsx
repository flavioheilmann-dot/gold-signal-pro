// ─────────────────────────────────────────────────────────────
// TradeTicket — the flagship signal card. Turns a raw TradeSignal into an
// unmistakable, broker-grade trade plan: direction, Entry / SL / TP with
// point + % distances, a visual risk:reward bar, a confidence meter, the
// confluence reasons, an explicit management plan per exit mode, and — for
// the user's REAL CHF account — the exact position size, money-at-risk and
// potential reward (FX-converted). Plus a high-impact-news gate, a pre-trade
// checklist, and a beep/notification when a fresh setup goes ready.
//
// Display + decision-support only. No orders are placed from here.
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight, ArrowDownRight, Copy, Check, Target, ShieldX,
  Crosshair, Gauge, Hourglass, AlertTriangle, Info, Bell, BellOff,
  CalendarClock, CheckCircle2, Circle, XCircle, ListChecks,
} from "lucide-react";
import { cn, fmtFr } from "@/lib/utils";
import type { Bias, TradeSignal, ExitMode } from "@/trading/types";
import type { SetupStage } from "@/trading/strategy/StrategyEngine";
import { sizeTrade } from "@/lib/sizing";
import { newsBlackout, nextEvent, minutesUntil } from "@/trading/strategy/calendar";
import { isIndexSymbol } from "@/trading/strategy/tjr";
import { beep, notify, ensureNotificationPermission } from "@/lib/alerts";

/** Sensible price precision by magnitude (indices/gold/BTC → 1, forex → 4). */
function priceDecimals(p: number): number {
  const a = Math.abs(p);
  return a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 2 : 4;
}
function fmtPrice(p: number): string {
  const d = priceDecimals(p);
  return p.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPts(p: number): string {
  const d = p >= 100 ? 0 : p >= 1 ? 1 : 4;
  return p.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtMin(m: number): string {
  if (m <= 0) return "jetzt";
  if (m < 60) return `${m} Min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

function confTone(c: number): { label: string; cls: string; bar: string } {
  if (c >= 75) return { label: "sehr stark", cls: "text-up", bar: "bg-up" };
  if (c >= 65) return { label: "stark", cls: "text-up", bar: "bg-up" };
  if (c >= 55) return { label: "solide", cls: "text-gold", bar: "bg-gold" };
  return { label: "ausreichend", cls: "text-gold", bar: "bg-gold" };
}

/** Plain-German management plan for the chosen exit style. */
function managementPlan(exit: ExitMode, tp1: string, tp2: string, sl: string): string {
  switch (exit) {
    case "trail":
      return `Stop-Loss bei ${sl}. Erreicht der Kurs +1R (${tp1}), Stop auf Break-Even ziehen — ` +
        `danach in 1R-Schritten nachziehen. Kein fixes Ziel: der Gewinn läuft, bis der Trailing-Stop greift.`;
    case "rr1to1":
      return `Fixes Ziel 1:1 bei ${tp1}. Kein Teilverkauf — es endet entweder am Ziel oder am Stop-Loss (${sl}).`;
    default:
      return `Bei TP1 (${tp1}) die Hälfte schließen und den Stop auf Break-Even ziehen. ` +
        `Der Rest läuft bis TP2 (${tp2}). Stop-Loss anfänglich bei ${sl}.`;
  }
}

const STAGE_HINT: Partial<Record<SetupStage, string>> = {
  no_data: "Zu wenig Kerzen — die Engine sammelt noch Daten.",
  no_alignment: "NASDAQ und S&P laufen auseinander — bei Indizes wird dann nicht gehandelt.",
  long_only_skip: "Nur Long erlaubt (Index driftet langfristig hoch) — ein Short-Setup wird ignoriert.",
  htf_conflict: "Das Setup läuft gegen den übergeordneten 1H-Trend — übersprungen.",
  off_killzone: "Außerhalb der London-/NY-Killzone — kein Einstieg.",
  waiting_sweep: "Die Engine wartet auf einen Liquidity-Sweep (Stop-Hunt über/unter ein Level).",
  waiting_mss: "Sweep erkannt — jetzt fehlt die Struktur-Bestätigung (BOS / IFVG-Flip).",
  waiting_fvg: "Struktur bestätigt — es fehlt eine saubere Einstiegszone (FVG / Equilibrium).",
  waiting_retrace: "Setup steht — der Kurs muss noch in die Einstiegszone zurücklaufen.",
  waiting_entry: "Kurs in der Zone — warte auf den 1m-Trigger (BOS) für den Einstieg.",
  ready: "Setup steht, aber die Konfidenz liegt unter der Schwelle — noch kein qualifiziertes Signal.",
};

const ALARM_KEY = "gsp_ticket_alarm_v1";

interface Props {
  signal: TradeSignal | null;
  stage: SetupStage;
  stageLabel: string;
  bias: Bias;
  symbol: string;
  timeframe: string;
  capital: number;
  riskPct: number;
  usdChf: number | null;
  indexAligned: boolean | null;
}

/** Compact high-impact-news strip — shared by both states. */
function NewsStrip() {
  const bl = newsBlackout();
  if (bl.active && bl.event) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-down/50 bg-down/10 px-3 py-2 text-[11px] font-medium text-down">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        News-Sperre: {bl.event.title} — kein Trade ins Event hinein.
      </div>
    );
  }
  const nx = nextEvent();
  if (nx) {
    const m = minutesUntil(nx);
    if (m > 0 && m <= 90) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-[11px] text-gold">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          Achtung: {nx.title} in {fmtMin(m)} — Volatilität erwartet.
        </div>
      );
    }
  }
  return null;
}

export function TradeTicket({ signal, stage, stageLabel, bias, symbol, timeframe, capital, riskPct, usdChf, indexAligned }: Props) {
  const [copied, setCopied] = useState(false);
  const [alarmOn, setAlarmOn] = useState(() => {
    try { return localStorage.getItem(ALARM_KEY) !== "0"; } catch { return true; }
  });
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [fresh, setFresh] = useState(false);
  const lastAlarmId = useRef("");
  const alarmOnRef = useRef(alarmOn);
  alarmOnRef.current = alarmOn;
  const sigId = signal?.id ?? null;

  // new qualified signal → reset checklist, pulse, and beep/notify (once per id)
  useEffect(() => {
    if (!signal) return;
    setDone({});
    if (signal.id === lastAlarmId.current) return;
    lastAlarmId.current = signal.id;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), 6000);
    if (alarmOnRef.current) {
      beep(signal.direction === "BUY");
      notify(
        `${signal.direction === "BUY" ? "🟢 KAUFEN" : "🔴 VERKAUFEN"} ${signal.symbol}`,
        `Entry ${signal.entry} · SL ${signal.stopLoss} · TP ${signal.takeProfit1} · ${signal.confidence}/100`
      );
    }
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigId]);

  const toggleAlarm = () => {
    const next = !alarmOn;
    setAlarmOn(next);
    try { localStorage.setItem(ALARM_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (next) { ensureNotificationPermission(); beep(true); }
  };

  // ── waiting / no qualified signal ─────────────────────────
  if (!signal) {
    const biasCls = bias === "bullish" ? "text-up" : bias === "bearish" ? "text-down" : "text-muted-foreground";
    const biasLbl = bias === "bullish" ? "aufwärts" : bias === "bearish" ? "abwärts" : "neutral";
    return (
      <div className="rounded-xl border border-border/70 bg-background/40 p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <Crosshair className="h-3.5 w-3.5" /> Trade-Ticket · {symbol} · {timeframe}
          </span>
          <span className={cn("font-mono text-[10px] font-bold uppercase", biasCls)}>Bias {biasLbl}</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/10 text-muted-foreground">
            <Hourglass className="h-5 w-5" />
          </span>
          <div>
            <div className="text-base font-semibold text-foreground">{stageLabel}</div>
            <div className="text-xs text-muted-foreground">{STAGE_HINT[stage] ?? "Kein qualifiziertes Setup — die Engine analysiert."}</div>
          </div>
        </div>
        <div className="mt-3"><NewsStrip /></div>
        <div className="mt-2 rounded-lg border border-gold/25 bg-gold/5 px-3 py-2 text-[11px] text-gold">
          Kein Trade — abwarten. Die Strategie handelt nur bei hoher Konfidenz; Geduld ist Teil des Edges.
        </div>
      </div>
    );
  }

  // ── live signal ───────────────────────────────────────────
  const long = signal.direction === "BUY";
  const exit: ExitMode = signal.exitMode ?? "tp";
  const DirIcon = long ? ArrowUpRight : ArrowDownRight;

  const { entry, stopLoss, takeProfit1, takeProfit2 } = signal;
  const singleTarget = exit === "rr1to1" || Math.abs(takeProfit2 - takeProfit1) < 1e-9;
  const finalTarget = singleTarget ? takeProfit1 : takeProfit2;

  const riskDist = Math.abs(entry - stopLoss);
  const rewardDist = Math.abs(finalTarget - entry);
  const total = riskDist + rewardDist || 1;
  const riskW = (riskDist / total) * 100;
  const tp1W = (Math.abs(takeProfit1 - entry) / total) * 100; // for the TP1 tick inside the reward zone

  const pctOf = (lvl: number) => (Math.abs(lvl - entry) / entry) * 100;

  // ── real-account sizing (FX-converted to CHF) ──
  const sz = sizeTrade({ epic: symbol, entry, stopLoss, takeProfit1, finalTarget, capital, riskPct, usdChf });

  const ct = confTone(signal.confidence);
  const bl = newsBlackout();

  // ── pre-trade checklist ──
  const hasReason = (re: RegExp) => signal.reasons.some((r) => re.test(r));
  const noWarn = (re: RegExp) => !signal.warnings.some((r) => re.test(r));
  const preferredSession = ["london", "newyork_am", "newyork_pm"].includes(signal.session);
  const isIdx = isIndexSymbol(symbol);
  type Chk = { label: string; status: "ok" | "warn" | "na" };
  const autoChecks: Chk[] = [
    { label: "Liquidity Sweep + Struktur", status: hasReason(/Sweep/) && hasReason(/Structure|BOS|IFVG/) ? "ok" : "warn" },
    { label: "Session aktiv (London/NY)", status: preferredSession ? "ok" : "warn" },
    { label: "Indizes aligned (NASDAQ×S&P)", status: isIdx ? (indexAligned ? "ok" : "warn") : "na" },
    { label: `Chance-Risiko ≥ 1:2`, status: signal.riskReward >= 2 ? "ok" : "warn" },
    { label: "Spread / Markt sauber", status: noWarn(/Spread|Choppy/) ? "ok" : "warn" },
    { label: "Kein High-Impact-News-Fenster", status: bl.active ? "warn" : "ok" },
  ];
  const manualItems = ["Größe auf Capital.com gesetzt", "SL & TP eingetragen", "Order platziert"];
  const allAuto = autoChecks.every((c) => c.status !== "warn");
  const allManual = manualItems.every((_, i) => done[`m${i}`]);
  const readyToGo = allAuto && allManual && !bl.active;

  const copyLevels = async () => {
    const lines = [
      `${symbol} ${signal.direction}  (${timeframe})`,
      `Entry:  ${fmtPrice(entry)}`,
      `Stop:   ${fmtPrice(stopLoss)}`,
      `TP1:    ${fmtPrice(takeProfit1)}`,
      ...(singleTarget ? [] : [`TP2:    ${fmtPrice(takeProfit2)}`]),
      `R:R 1:${signal.riskReward}  ·  Konfidenz ${signal.confidence}/100`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — ignore */ }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border-2 p-4 shadow-lg transition-shadow",
        long ? "border-up/50 bg-up/[0.04]" : "border-down/50 bg-down/[0.04]",
        fresh && (long ? "ring-2 ring-up/60 animate-pulse" : "ring-2 ring-down/60 animate-pulse")
      )}
    >
      {/* glow */}
      <div className={cn("pointer-events-none absolute -top-16 right-0 h-32 w-32 rounded-full blur-3xl", long ? "bg-up/20" : "bg-down/20")} />

      {/* header: direction + alarm + copy */}
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={cn("grid h-10 w-10 place-items-center rounded-lg border", long ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down")}>
            <DirIcon className="h-6 w-6" />
          </span>
          <div>
            <div className={cn("text-xl font-extrabold leading-none", long ? "text-up" : "text-down")}>
              {long ? "KAUFEN" : "VERKAUFEN"} <span className="text-foreground">{symbol}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{timeframe}</span><span>·</span><span>R:R 1:{signal.riskReward}</span><span>·</span><span>{signal.session}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleAlarm}
            title={alarmOn ? "Alarm bei neuem Signal: an" : "Alarm bei neuem Signal: aus"}
            className={cn("flex items-center gap-1 rounded-md border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
              alarmOn ? "border-up/40 bg-up/10 text-up" : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground")}
          >
            {alarmOn ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />} Alarm
          </button>
          <button
            onClick={copyLevels}
            className="flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
            title="Entry / SL / TP in die Zwischenablage kopieren"
          >
            {copied ? <><Check className="h-3.5 w-3.5 text-up" /> kopiert</> : <><Copy className="h-3.5 w-3.5" /> Levels kopieren</>}
          </button>
        </div>
      </div>

      {/* news gate (most important — right under the header) */}
      <div className="relative mt-3"><NewsStrip /></div>

      {/* confidence meter */}
      <div className="relative mt-3">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> Konfidenz</span>
          <span className={ct.cls}>{signal.confidence}/100 · {ct.label}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
          <div className={cn("h-full rounded-full transition-all", ct.bar)} style={{ width: `${signal.confidence}%` }} />
        </div>
        <div className="mt-0.5 text-[9px] text-muted-foreground">Technischer Konfluenz-Score — keine Gewinnwahrscheinlichkeit.</div>
      </div>

      {/* level cards */}
      <div className="relative mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <LevelCard icon={<Crosshair className="h-3 w-3" />} label="Entry" value={fmtPrice(entry)} tone="gold" sub="Einstieg" />
        <LevelCard icon={<ShieldX className="h-3 w-3" />} label="Stop-Loss" value={fmtPrice(stopLoss)} tone="down"
          sub={`−${fmtPts(riskDist)} (${pctOf(stopLoss).toFixed(2)}%)`} />
        <LevelCard icon={<Target className="h-3 w-3" />} label={singleTarget ? "Ziel (1:1)" : "Take Profit 1"} value={fmtPrice(takeProfit1)} tone="up"
          sub={`+${fmtPts(Math.abs(takeProfit1 - entry))} (${pctOf(takeProfit1).toFixed(2)}%)`} />
        {singleTarget ? (
          <LevelCard icon={<Hourglass className="h-3 w-3" />} label="Halteart" value={exit === "rr1to1" ? "1:1 fix" : "Trailing"} tone="muted" sub="Exit-Stil" />
        ) : (
          <LevelCard icon={<Target className="h-3 w-3" />} label={exit === "trail" ? "Ziel ~2R" : "Take Profit 2"} value={fmtPrice(takeProfit2)} tone="up"
            sub={exit === "trail" ? "Trailing (offen)" : `+${fmtPts(Math.abs(takeProfit2 - entry))} (${pctOf(takeProfit2).toFixed(2)}%)`} />
        )}
      </div>

      {/* risk : reward bar */}
      <div className="relative mt-3">
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          <div className="h-full bg-down/70" style={{ width: `${riskW}%` }} />
          <div className="h-full bg-up/70" style={{ width: `${100 - riskW}%` }} />
        </div>
        <div className="relative h-0">
          <div className="absolute -top-3 h-3 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${riskW}%` }} title="Entry" />
          {!singleTarget && (
            <div className="absolute -top-3 h-3 w-px -translate-x-1/2 bg-up" style={{ left: `${riskW + tp1W}%` }} title="TP1" />
          )}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span className="text-down">Risiko {fmtPts(riskDist)}</span>
          <span className="text-foreground">Entry</span>
          <span className="text-up">Gewinn {fmtPts(rewardDist)}{exit === "trail" ? "+" : ""}</span>
        </div>
      </div>

      {/* real-account sizing (FX → CHF) */}
      <div className="relative mt-3 rounded-lg border border-border/60 bg-background/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Für dein Konto · {fmtFr(capital)} · Risiko {riskPct}%</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Risiko (1R)" value={fmtFr(sz.riskAmount)} tone="down" />
          <Metric label="CFD-Größe" value={sz.size >= 1 ? sz.size.toFixed(2) : sz.size.toFixed(4)} tone="gold" sub="Einheiten" />
          <Metric label={singleTarget ? "Gewinn @Ziel" : "Gewinn @TP1"} value={fmtFr(singleTarget ? sz.rewardFinal : sz.rewardTP1)} tone="up" />
          <Metric label={exit === "trail" ? "Gewinn ~2R" : "Gewinn @TP2"} value={fmtFr(sz.rewardFinal)} tone="up" sub={exit === "trail" ? "Richtwert" : undefined} />
        </div>
        <div className="mt-1.5 flex items-start gap-1 text-[9px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span>
            Positionswert ~{fmtFr(sz.notional)}.{" "}
            {sz.exact
              ? `Exakt in CHF gerechnet (USD→CHF ${usdChf?.toFixed(4)}).`
              : "FX-Kurs offline → 1:1-Schätzung; auf Capital.com Punktwert prüfen."}
          </span>
        </div>
      </div>

      {/* management plan */}
      <div className="relative mt-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-primary">Trade-Management</div>
        <p className="mt-1 text-xs leading-relaxed text-foreground/85">
          {managementPlan(exit, fmtPrice(takeProfit1), fmtPrice(takeProfit2), fmtPrice(stopLoss))}
        </p>
      </div>

      {/* pre-trade checklist */}
      <div className="relative mt-3 rounded-lg border border-border/60 bg-background/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <ListChecks className="h-3 w-3" /> Pre-Trade-Checkliste
          </span>
          {readyToGo && <span className="rounded bg-up/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-up">bereit</span>}
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          {autoChecks.map((c) => (
            <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
              {c.status === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-up" />
                : c.status === "warn" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-down" />
                : <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
              <span className={c.status === "warn" ? "text-down" : c.status === "na" ? "text-muted-foreground/60" : "text-foreground/80"}>{c.label}</span>
            </div>
          ))}
          {manualItems.map((label, i) => (
            <button key={label} onClick={() => setDone((d) => ({ ...d, [`m${i}`]: !d[`m${i}`] }))}
              className="flex items-center gap-1.5 text-left text-[11px]">
              {done[`m${i}`] ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-up" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className={done[`m${i}`] ? "text-foreground/80" : "text-muted-foreground"}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* reasons + warnings */}
      {!!signal.reasons.length && (
        <div className="relative mt-2 flex flex-wrap gap-1">
          {signal.reasons.map((r, i) => (
            <span key={i} className="rounded border border-up/30 bg-up/10 px-1.5 py-0.5 font-mono text-[9px] text-up">{r}</span>
          ))}
        </div>
      )}
      {!!signal.warnings.length && (
        <div className="relative mt-1.5 flex items-start gap-1 text-[10px] text-gold">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {signal.warnings.join(" · ")}
        </div>
      )}

      {/* manual-order reminder */}
      <div className="relative mt-2 border-t border-border/50 pt-2 text-[9px] text-muted-foreground">
        Order <span className="font-semibold text-foreground">manuell auf Capital.com</span> platzieren — die App löst nie automatisch aus. Keine Anlageberatung; CFDs sind hochriskant.
      </div>
    </div>
  );
}

function LevelCard({ icon, label, value, tone, sub }: { icon: ReactNode; label: string; value: string; tone: "up" | "down" | "gold" | "muted"; sub?: string }) {
  const toneCls = tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "gold" ? "text-gold" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
      <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className={cn("mono mt-1 text-lg font-bold leading-none", toneCls)}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Metric({ label, value, tone, sub }: { label: string; value: string; tone?: "up" | "down" | "gold"; sub?: string }) {
  const toneCls = tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "gold" ? "text-gold" : "text-foreground";
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mono text-sm font-bold", toneCls)}>{value}</div>
      {sub && <div className="font-mono text-[8px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
