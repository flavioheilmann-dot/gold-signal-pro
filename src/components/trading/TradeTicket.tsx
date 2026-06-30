// ─────────────────────────────────────────────────────────────
// TradeTicket — the flagship signal card. Turns a raw TradeSignal into an
// unmistakable, broker-grade trade plan: direction, Entry / SL / TP with
// point + % distances, a visual risk:reward bar, a confidence meter, the
// confluence reasons, an explicit management plan per exit mode, and — for
// the user's REAL account — the position size, money-at-risk and potential
// reward. One-click copy of the levels for manual entry on Capital.com.
//
// Display + decision-support only. No orders are placed from here.
// ─────────────────────────────────────────────────────────────
import { useState, type ReactNode } from "react";
import {
  ArrowUpRight, ArrowDownRight, Copy, Check, Target, ShieldX,
  Crosshair, Gauge, Hourglass, AlertTriangle, Info,
} from "lucide-react";
import { cn, fmtFr } from "@/lib/utils";
import type { Bias, TradeSignal, ExitMode } from "@/trading/types";
import type { SetupStage } from "@/trading/strategy/StrategyEngine";

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

interface Props {
  signal: TradeSignal | null;
  stage: SetupStage;
  stageLabel: string;
  bias: Bias;
  symbol: string;
  timeframe: string;
  capital: number;
  riskPct: number;
}

export function TradeTicket({ signal, stage, stageLabel, bias, symbol, timeframe, capital, riskPct }: Props) {
  const [copied, setCopied] = useState(false);

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
        <div className="mt-3 rounded-lg border border-gold/25 bg-gold/5 px-3 py-2 text-[11px] text-gold">
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

  // ── real-account sizing (same convention as the risk manager) ──
  const riskAmount = (capital * riskPct) / 100;
  const units = riskDist > 0 ? riskAmount / riskDist : 0;
  const notional = units * entry;
  const rewardTP1 = units * Math.abs(takeProfit1 - entry);
  const rewardFinal = units * rewardDist;

  const ct = confTone(signal.confidence);

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
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border-2 p-4 shadow-lg",
        long ? "border-up/50 bg-up/[0.04]" : "border-down/50 bg-down/[0.04]"
      )}
    >
      {/* glow */}
      <div className={cn("pointer-events-none absolute -top-16 right-0 h-32 w-32 rounded-full blur-3xl", long ? "bg-up/20" : "bg-down/20")} />

      {/* header: direction + confidence + copy */}
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
        <button
          onClick={copyLevels}
          className="flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
          title="Entry / SL / TP in die Zwischenablage kopieren"
        >
          {copied ? <><Check className="h-3.5 w-3.5 text-up" /> kopiert</> : <><Copy className="h-3.5 w-3.5" /> Levels kopieren</>}
        </button>
      </div>

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
        {/* entry marker + TP1 tick */}
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

      {/* real-account sizing */}
      <div className="relative mt-3 rounded-lg border border-border/60 bg-background/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Für dein Konto · {fmtFr(capital)} · Risiko {riskPct}%</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Risiko (1R)" value={fmtFr(riskAmount)} tone="down" />
          <Metric label="CFD-Größe" value={units >= 1 ? units.toFixed(2) : units.toFixed(4)} tone="gold" sub="Einheiten" />
          <Metric label={singleTarget ? "Gewinn @Ziel" : "Gewinn @TP1"} value={fmtFr(singleTarget ? rewardFinal : rewardTP1)} tone="up" />
          <Metric label={exit === "trail" ? "Gewinn ~2R" : "Gewinn @TP2"} value={fmtFr(rewardFinal)} tone="up" sub={exit === "trail" ? "Richtwert" : undefined} />
        </div>
        <div className="mt-1.5 flex items-start gap-1 text-[9px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span>Positionswert ~{fmtFr(notional)}. Größe = Risiko ÷ SL-Abstand (1 Einheit ≈ 1 Fr/Punkt). Auf Capital.com Punktwert &amp; CHF/USD-Umrechnung prüfen.</span>
        </div>
      </div>

      {/* management plan */}
      <div className="relative mt-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-primary">Trade-Management</div>
        <p className="mt-1 text-xs leading-relaxed text-foreground/85">
          {managementPlan(exit, fmtPrice(takeProfit1), fmtPrice(takeProfit2), fmtPrice(stopLoss))}
        </p>
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
