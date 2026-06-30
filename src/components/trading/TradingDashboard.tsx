import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Play, Square, Cpu, ShieldAlert, ListChecks, FlaskConical,
  TrendingUp, TrendingDown, AlertTriangle, Bell, Database, Maximize2, Minimize2, LineChart,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTradingEngine } from "@/trading/engine/useTradingEngine";
import { TJR_ASSETS } from "@/lib/assets";
import { ChartPanel, type ChartLevels, type ChartLayers, DEFAULT_LAYERS } from "@/components/ChartPanel";
import { TradeTicket } from "@/components/trading/TradeTicket";
import { requestNotifyPermission } from "@/trading/notifications/notify";
import { liveTradingEnabled } from "@/trading/broker/BrokerAdapter";
import type { EngineStatus } from "@/trading/engine/BackgroundEngine";
import type { BacktestResult } from "@/trading/backtest/backtest";
import type { PaperTrade, TradeSignal } from "@/trading/types";

function ago(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `vor ${s}s` : `vor ${Math.floor(s / 60)}min`;
}
const money = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

function Pill({ label, tone }: { label: string; tone: string }) {
  return <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider", tone)}>{label}</span>;
}

function SignalRow({ s }: { s: TradeSignal }) {
  const buy = s.direction === "BUY";
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span className={cn("flex items-center gap-1 font-bold", buy ? "text-up" : "text-down")}>
          {buy ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {s.direction} {s.symbol}
        </span>
        <span className="mono text-muted-foreground">{s.confidence}/100 · 1:{s.riskReward}</span>
      </div>
      <div className="mono mt-0.5 text-[10px] text-muted-foreground">
        Entry {s.entry} · SL {s.stopLoss} · TP {s.takeProfit1}/{s.takeProfit2}
      </div>
    </div>
  );
}

function TradeRow({ t }: { t: PaperTrade }) {
  const open = t.status === "open" || t.status === "partial";
  const tone = t.pnl > 0 ? "text-up" : t.pnl < 0 ? "text-down" : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5 text-[11px]">
      <span className={cn("font-bold", t.direction === "BUY" ? "text-up" : "text-down")}>{t.direction} {t.symbol}</span>
      <span className="mono text-[10px] text-muted-foreground">@{t.entry}</span>
      <span className="mono">
        {open ? <Pill label={t.status} tone="bg-info/15 text-info" /> : <span className={tone}>{money(t.pnl)} ({t.rMultiple}R)</span>}
      </span>
    </div>
  );
}

function EquityCurve({ bt }: { bt: BacktestResult }) {
  const pts = bt.equityCurve;
  if (pts.length < 2) return null;
  const eqs = pts.map((p) => p.equity);
  const min = Math.min(...eqs), max = Math.max(...eqs);
  const range = max - min || 1;
  const W = 240, H = 48;
  const d = pts
    .map((p, i) => `${(i / (pts.length - 1)) * W},${H - ((p.equity - min) / range) * H}`)
    .join(" ");
  const up = eqs[eqs.length - 1] >= bt.startEquity;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={up ? "hsl(var(--up))" : "hsl(var(--down))"} strokeWidth="1.5" />
    </svg>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mono text-sm font-bold", tone)}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function TradingDashboard({
  defaultNtfyTopic = "",
  theme = "dark",
  capital = 1000,
  riskPct = 1,
  usdChf = null,
  onSignal,
}: {
  defaultNtfyTopic?: string;
  theme?: "dark" | "light";
  capital?: number;
  riskPct?: number;
  usdChf?: number | null;
  onSignal?: (sig: TradeSignal | null, symbol: string) => void;
}) {
  const eng = useTradingEngine();
  const s: EngineStatus | null = eng.status;
  const [notifyOn, setNotifyOn] = useState(false);
  const [autoPaper, setAutoPaper] = useState(true);
  const [chartBig, setChartBig] = useState(false);
  const [layers, setLayers] = useState<ChartLayers>(DEFAULT_LAYERS);

  // keep status ticking for the "last check" relative time
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // memoised so the per-second "last check" re-render does NOT re-run the chart's
  // heavy setData effect — it only changes when the signal actually changes.
  const sig = s?.currentSignal ?? null;
  const chartLevels = useMemo<ChartLevels | null>(
    () => sig
      ? { direction: sig.direction === "BUY" ? "long" : "short", entry: sig.entry, stopLoss: sig.stopLoss, takeProfit1: sig.takeProfit1, takeProfit2: sig.takeProfit2 }
      : null,
    [sig]
  );

  // lift the live ICT signal to the parent (sidebar position-sizer) without
  // re-firing on every per-second status tick: only when the signal id changes.
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;
  const sigSymbol = eng.symbol;
  useEffect(() => {
    onSignalRef.current?.(sig, sigSymbol);
  }, [sig, sigSymbol]);

  if (!s) return <div className="skeleton h-40 w-full" />;

  const running = s.running;
  const live = liveTradingEnabled();

  const toggleNotify = async () => {
    const next = !notifyOn;
    setNotifyOn(next);
    if (next) await requestNotifyPermission();
    eng.setOptions({ notify: { browser: next, ntfy: next && !!defaultNtfyTopic, ntfyTopic: defaultNtfyTopic } });
  };
  const toggleAuto = () => {
    const next = !autoPaper;
    setAutoPaper(next);
    eng.setOptions({ autoPaper: next });
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-primary" /> Background Engine
          <Pill label={live ? "LIVE" : "PAPER"} tone={live ? "bg-down/15 text-down" : "bg-up/15 text-up"} />
          <span className="flex items-center gap-1 font-mono text-[9px] font-normal text-muted-foreground">
            <Database className="h-3 w-3" /> {s.dataSource}
          </span>
        </CardTitle>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => eng.setDataMode(eng.dataMode === "mock" ? "capital" : "mock")}
            className="rounded-md border border-border/60 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-primary"
            title="Datenquelle umschalten (Simulation / Capital.com)"
          >
            {eng.dataMode === "mock" ? "Sim-Daten" : "Live-Daten"}
          </button>
          <Button size="sm" variant={running ? "down" : "up"} onClick={() => (running ? eng.stop() : eng.start())}>
            {running ? <><Square className="mr-1 h-3 w-3" /> Stop</> : <><Play className="mr-1 h-3 w-3" /> Start</>}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* controls: symbol + poll cadence */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <label className="flex items-center gap-1">
            Symbol
            <select
              value={eng.symbol}
              onChange={(e) => eng.setSymbol(e.target.value)}
              className="rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] text-foreground"
            >
              {TJR_ASSETS.map((a) => (
                <option key={a.epic} value={a.epic}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            TF
            <select
              value={eng.timeframe}
              onChange={(e) => eng.setTimeframe(e.target.value)}
              className="rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] text-foreground"
            >
              {["5m", "15m", "1h"].map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Takt
            <select
              value={eng.intervalMs}
              onChange={(e) => eng.setIntervalMs(Number(e.target.value))}
              className="rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] text-foreground"
            >
              {[5000, 8000, 10000, 15000, 30000].map((ms) => (
                <option key={ms} value={ms}>{ms / 1000}s</option>
              ))}
            </select>
          </label>
        </div>

        {/* status strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border/50 bg-background/40 px-3 py-2 font-mono text-[10px]">
          <span className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-up animate-live-dot" : "bg-muted-foreground")} />
            {running ? "läuft" : "gestoppt"}
          </span>
          <span className="text-muted-foreground">Letzter Check: <span className="text-foreground">{ago(s.lastCheck)}</span></span>
          <span className="text-muted-foreground">Kerzen: <span className="text-foreground">{s.candleCount}</span></span>
          {s.indexAligned !== null && (
            <span className="text-muted-foreground">
              Indizes:{" "}
              <span className={s.indexAligned ? "text-up" : "text-down"}>
                {s.indexAligned
                  ? `aligned ${s.indexAlignDir === "up" ? "↑" : s.indexAlignDir === "down" ? "↓" : ""}`
                  : "nicht aligned"}
              </span>
            </span>
          )}
          {s.htfBias !== null && (
            <span className="text-muted-foreground">
              1H-Bias:{" "}
              <span className={s.htfBias === "up" ? "text-up" : s.htfBias === "down" ? "text-down" : "text-muted-foreground"}>
                {s.htfBias === "up" ? "↑ up" : s.htfBias === "down" ? "↓ down" : "range"}
              </span>
            </span>
          )}
          {s.ltfConfirmed !== null && (
            <span className="text-muted-foreground">
              1m-Entry: <span className={s.ltfConfirmed ? "text-up" : "text-gold"}>{s.ltfConfirmed ? "bestätigt" : "offen"}</span>
            </span>
          )}
          {s.error && <span className="text-down">⚠ {s.error}</span>}
        </div>

        {/* ★ HERO: the trade ticket — entry / SL / TP + account sizing */}
        <TradeTicket
          signal={sig}
          stage={s.stage}
          stageLabel={s.stageLabel}
          bias={s.bias}
          symbol={eng.symbol}
          timeframe={eng.timeframe}
          capital={capital}
          riskPct={riskPct}
          usdChf={usdChf}
          indexAligned={s.indexAligned}
        />

        {/* TJR V1 Strategie-Profil — automatisch je Asset (read-only) */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="uppercase tracking-wider">Strategie V1:</span>
          {([
            ["Exit", eng.exitMode === "rr1to1" ? "1:1" : eng.exitMode === "trail" ? "Trailing" : "TP", true],
            ["Long-Only", eng.longOnly ? "an" : "aus", eng.longOnly],
            ["1H-Bias", eng.htfBiasFilter ? "an" : "aus", eng.htfBiasFilter],
            ["Killzone", eng.requireKillzone ? "an" : "aus", eng.requireKillzone],
          ] as const).map(([label, val, on]) => (
            <span
              key={label}
              className={cn(
                "rounded px-1.5 py-0.5 uppercase tracking-wider border",
                on ? "border-up/40 bg-up/10 text-up" : "border-border/50 text-muted-foreground"
              )}
            >
              {label}: {val}
            </span>
          ))}
          <span className="text-[9px] italic text-muted-foreground/70">automatisch je Asset</span>
        </div>

        {/* ICT chart with overlays (zoom + pan, enlarge) */}
        <div className="rounded-lg border border-border/60 p-2">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <LineChart className="h-3 w-3" /> {eng.symbol} · {eng.timeframe} · ICT-Chart
            </span>
            <button
              onClick={() => setChartBig((v) => !v)}
              title={chartBig ? "Verkleinern" : "Vergrössern"}
              className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-primary"
            >
              {chartBig ? <><Minimize2 className="h-3 w-3" /> kleiner</> : <><Maximize2 className="h-3 w-3" /> grösser</>}
            </button>
          </div>
          {/* Strategie-Ebenen ein-/ausblenden (übersichtlich halten) */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1">
            {([["sessions", "Sessions"], ["daily", "PDH/PDL"], ["pools", "Pools"], ["setup", "Setup"]] as const).map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}
                title={`${lbl} ein-/ausblenden`}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider border transition-colors",
                  layers[k] ? "border-primary/50 bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground"
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className={cn("w-full transition-[height]", chartBig ? "h-[78vh]" : "h-[300px]")}>
            {s.candles.length >= 20 ? (
              <ChartPanel candles={s.candles} symbol={eng.symbol} theme={theme} levels={chartLevels} layers={layers} />
            ) : (
              <div className="grid h-full w-full place-items-center text-[11px] text-muted-foreground">
                {running ? "Lade Kerzen…" : "Engine starten für Chart"}
              </div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 px-1 font-mono text-[9px] text-muted-foreground">
            <span className="text-info">EMA21</span>
            <span style={{ color: "rgba(34,211,238,0.95)" }}>Asia</span>
            <span style={{ color: "rgba(251,146,60,0.95)" }}>London</span>
            <span style={{ color: "rgba(244,114,182,0.95)" }}>NY</span>
            <span style={{ color: "rgba(203,213,225,0.95)" }}>PDH/PDL</span>
            <span style={{ color: "rgba(148,163,184,0.9)" }}>Equal H/L</span>
            <span className="text-up">FVG</span>
            <span className="text-gold">Sweep</span>
            <span style={{ color: "rgba(168,130,255,0.95)" }}>MSS</span>
            <span style={{ color: "rgba(196,132,252,0.95)" }}>IFVG</span>
            <span style={{ color: "rgba(240,180,41,0.9)" }}>EQ/Entry/SL/TP</span>
            <span className="ml-auto">Mausrad = Zoom · Ziehen = Pan</span>
          </div>
        </div>

        {/* Risk status (Paper-Konto) */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="mb-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <ShieldAlert className="h-3 w-3" /> Risk Status · Paper-Konto
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Stat label="Equity" value={s.risk.equity.toFixed(2)} sub="Paper-Konto" />
            <Stat label="Daily PnL" value={`${money(s.risk.dayPnl)} (${s.risk.dayPnlPct}%)`} tone={s.risk.dayPnl >= 0 ? "text-up" : "text-down"} />
            <Stat label="Trades heute" value={`${s.risk.dayTrades}/${s.risk.maxTrades}`} sub={`${s.risk.consecLosses} Verluste i.F.`} />
            <Stat label="Daily-Loss-Budget" value={`${s.risk.dailyLossUsedPct}%`} tone={s.risk.dailyLossUsedPct >= 100 ? "text-down" : s.risk.dailyLossUsedPct >= 60 ? "text-gold" : "text-up"} sub={`Limit ${s.risk.dailyLossLimit}`} />
          </div>
          {!s.risk.canTrade && (
            <div className="mt-1.5 flex items-center gap-1 rounded border border-down/30 bg-down/10 px-2 py-1 text-[10px] text-down">
              <AlertTriangle className="h-3 w-3" /> Gesperrt: {s.risk.blockReason}
            </div>
          )}
        </div>

        {/* Paper trades */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <ListChecks className="h-3 w-3" /> Paper Trades
            </span>
            <button onClick={eng.resetPaper} className="font-mono text-[9px] uppercase text-muted-foreground hover:text-down">Reset</button>
          </div>
          {s.openTrades.length === 0 && eng.closed.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Noch keine Paper-Trades.</div>
          ) : (
            <div className="space-y-1">
              {s.openTrades.map((t) => <TradeRow key={t.id} t={t} />)}
              {eng.closed.slice(-4).reverse().map((t) => <TradeRow key={t.id} t={t} />)}
            </div>
          )}
        </div>

        {/* Signal feed */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="mb-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3 w-3" /> Signal Feed
          </div>
          {s.signalFeed.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Noch keine Signale.</div>
          ) : (
            <div className="space-y-1">{s.signalFeed.slice(0, 4).map((sg) => <SignalRow key={sg.id} s={sg} />)}</div>
          )}
        </div>

        {/* Backtest */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <FlaskConical className="h-3 w-3" /> Backtest Results
            </span>
            <Button size="sm" variant="ghost" onClick={eng.runBacktestNow} disabled={eng.backtesting}>
              {eng.backtesting ? "läuft…" : "Backtest starten"}
            </Button>
          </div>
          {eng.backtest ? (
            <div className="space-y-2">
              {!eng.backtest.sufficientData && (
                <div className="flex items-center gap-1 rounded border border-gold/40 bg-gold/10 px-2 py-1 text-[10px] text-gold">
                  <AlertTriangle className="h-3 w-3" /> Statistisch zu wenig Daten ({eng.backtest.trades} Trades, Ziel ≥ 30).
                </div>
              )}
              <EquityCurve bt={eng.backtest} />
              <div className="grid grid-cols-3 gap-1.5">
                <Stat label="Trades" value={`${eng.backtest.trades}`} />
                <Stat label="Win-Rate" value={`${(eng.backtest.winRate * 100).toFixed(0)}%`} />
                <Stat label="Profit-Faktor" value={eng.backtest.profitFactor >= 99 ? "∞" : eng.backtest.profitFactor.toFixed(2)} />
                <Stat label="Ø R" value={`${eng.backtest.avgRR}R`} />
                <Stat label="Max DD" value={`-${eng.backtest.maxDrawdownPct}%`} tone="text-down" />
                <Stat label="Net PnL" value={money(eng.backtest.netPnl)} tone={eng.backtest.netPnl >= 0 ? "text-up" : "text-down"} />
              </div>
              <div className="text-[9px] text-muted-foreground">
                Best {money(eng.backtest.bestTrade)} · Worst {money(eng.backtest.worstTrade)} · close-basiert, indikativ.
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">Noch kein Backtest gelaufen.</div>
          )}
        </div>

        {/* controls + disclaimer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
          <div className="flex items-center gap-3 font-mono text-[10px]">
            <button onClick={toggleNotify} className={cn("flex items-center gap-1", notifyOn ? "text-up" : "text-muted-foreground")}>
              <Bell className="h-3 w-3" /> Benachrichtigung {notifyOn ? "an" : "aus"}
            </button>
            <button onClick={toggleAuto} className={cn("flex items-center gap-1", autoPaper ? "text-up" : "text-muted-foreground")}>
              <Activity className="h-3 w-3" /> Auto-Paper {autoPaper ? "an" : "aus"}
            </button>
          </div>
          <span className="font-mono text-[9px] text-muted-foreground">For education &amp; paper trading only.</span>
        </div>
      </CardContent>
    </Card>
  );
}
