import { BarChart3, TrendingDown, TrendingUp, Percent, Timer, ShieldAlert, Target, Flame, Scale, AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_TRADES, tradesToCSV, type StrategyStats, type TradeResult, type WalkForward } from "@/lib/signalEngine";

function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  tone?: "up" | "down" | "gold" | "muted";
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border/50 bg-background/40 px-2.5 py-2">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "gold" ? "text-gold" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("mono text-sm font-bold", tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "gold" ? "text-gold" : "text-foreground")}>
          {value}
        </div>
        {sub && <div className="font-mono text-[9px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

function WfCell({ label, s }: { label: string; s: StrategyStats }) {
  const expTone = s.expectancy > 0 ? "text-up" : "text-down";
  return (
    <div className="flex-1 rounded-md border border-border/50 bg-background/40 px-2.5 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">Win</span>
        <span className="mono font-semibold">{(s.winRate * 100).toFixed(0)}%</span>
      </div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">Erw.</span>
        <span className={cn("mono font-semibold", expTone)}>{s.expectancy >= 0 ? "+" : ""}{s.expectancy.toFixed(2)}%</span>
      </div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">PF</span>
        <span className="mono font-semibold">{s.profitFactor >= 99 ? "∞" : s.profitFactor.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function StrategyStatsPanel({
  stats,
  trades,
  wf,
  assetName,
}: {
  stats: StrategyStats;
  trades: TradeResult[];
  wf: WalkForward | null;
  assetName: string;
}) {
  if (!stats.totalTrades) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5" />
        Noch keine Trades für {assetName} — warte auf Signale.
      </div>
    );
  }

  const wrTone = stats.winRate >= 0.55 ? "up" : stats.winRate >= 0.4 ? "gold" : "down";
  const expTone = stats.expectancy > 0 ? "up" : stats.expectancy < -0.1 ? "down" : "gold";
  const pfTone = stats.profitFactor >= 1.5 ? "up" : stats.profitFactor >= 1 ? "gold" : "down";
  const rrTone = stats.avgRR >= 0.3 ? "up" : stats.avgRR >= 0 ? "gold" : "down";
  const ruinTone = stats.monteCarlo.ruinPct <= 5 ? "up" : stats.monteCarlo.ruinPct <= 15 ? "gold" : "down";

  const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const safeName = assetName.replace(/[^\w]+/g, "_");
  const exportJSON = () => download(`Backtest_${safeName}_${ts}.json`, JSON.stringify({ assetName, stats, trades }, null, 2), "application/json");
  const exportCSV = () => download(`Backtest_${safeName}_${ts}.csv`, tradesToCSV(trades), "text/csv;charset=utf-8;");

  return (
    <div className="space-y-2">
      {!stats.sufficientData && (
        <div className="flex items-start gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] text-gold">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-bold">Statistisch zu wenig Daten</span> — nur {stats.totalTrades} Trades (Ziel ≥ {MIN_TRADES}).
            Kennzahlen sind unzuverlässig, nicht überbewerten.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <Stat icon={Percent} label="Win-Rate" value={`${(stats.winRate * 100).toFixed(0)}%`} tone={wrTone} sub={`${stats.wins}W / ${stats.losses}L`} />
        <Stat icon={Scale} label="Ø R:R" value={`${stats.avgRR >= 0 ? "+" : ""}${stats.avgRR.toFixed(2)}R`} tone={rrTone} sub="Ertrag ÷ Risiko" />
        <Stat icon={BarChart3} label="Profit-Faktor" value={stats.profitFactor >= 99 ? "∞" : stats.profitFactor.toFixed(2)} tone={pfTone} sub="Gewinn÷Verlust" />
        <Stat icon={TrendingUp} label="Erwartungswert" value={`${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}%`} tone={expTone} sub="pro Trade" />
        <Stat icon={Target} label="TP1-Quote" value={`${(stats.tp1Rate * 100).toFixed(0)}%`} tone="muted" sub="erreicht vor SL" />
        <Stat icon={Target} label="TP2-Quote" value={`${(stats.tp2Rate * 100).toFixed(0)}%`} tone="muted" sub="erreicht vor SL" />
        <Stat icon={TrendingDown} label="Max Drawdown" value={`-${stats.maxDrawdownPct.toFixed(1)}%`} tone="down" sub="grösster Rückgang" />
        <Stat icon={Flame} label="Max Verlustserie" value={`${stats.maxConsecLosses}`} tone={stats.maxConsecLosses >= 5 ? "down" : "muted"} sub="Verluste in Folge" />
        <Stat icon={Timer} label="Ø Haltedauer" value={`${Math.round(stats.avgBarsInTrade)}`} tone="muted" sub="Kerzen" />
        <Stat icon={ShieldAlert} label="Ruin-Risiko" value={`${stats.monteCarlo.ruinPct.toFixed(1)}%`} tone={ruinTone} sub="Monte Carlo (500×)" />
      </div>

      {/* gross vs net (cost drag) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded-md border border-border/50 bg-background/40 px-3 py-2 text-[11px]">
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Nach Kosten</span>
        <span>
          <span className="text-muted-foreground">Netto: </span>
          <span className={cn("mono font-semibold", stats.netReturnPct >= 0 ? "text-up" : "text-down")}>
            {stats.netReturnPct >= 0 ? "+" : ""}{stats.netReturnPct.toFixed(1)}%
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Brutto: </span>
          <span className="mono font-semibold">{stats.grossReturnPct >= 0 ? "+" : ""}{stats.grossReturnPct.toFixed(1)}%</span>
        </span>
        <span>
          <span className="text-muted-foreground">Kosten: </span>
          <span className="mono font-semibold text-down">−{stats.costPctTotal.toFixed(1)}%</span>
        </span>
        <span className="text-muted-foreground">(Annahme {stats.assumedCostPct.toFixed(2)}%/Trade, Spread+Slippage)</span>
      </div>

      {/* walk-forward */}
      {wf ? (
        <div className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Walk-Forward (70 / 30)</span>
            <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase", wf.consistent ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
              {wf.consistent ? "konsistent" : "inkonsistent"}
            </span>
          </div>
          <div className="flex gap-1.5">
            <WfCell label="In-Sample" s={wf.inSample} />
            <WfCell label="Out-of-Sample" s={wf.outSample} />
          </div>
          {!wf.consistent && (
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              Out-of-Sample bestätigt In-Sample nicht — mögliche Überanpassung.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/50 bg-background/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          Walk-Forward braucht ≥ {2 * MIN_TRADES} Trades — aktuell {stats.totalTrades}.
        </div>
      )}

      {/* Monte Carlo summary */}
      <div className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Monte Carlo Simulation</div>
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">Median: </span>
            <span className={cn("font-mono font-semibold", stats.monteCarlo.medianReturnPct >= 0 ? "text-up" : "text-down")}>
              {stats.monteCarlo.medianReturnPct >= 0 ? "+" : ""}{stats.monteCarlo.medianReturnPct.toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Worst 5%: </span>
            <span className="font-mono font-semibold text-down">{stats.monteCarlo.worstPct.toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">Trades: </span>
            <span className="font-mono font-semibold">{stats.totalTrades}</span>
          </div>
        </div>
      </div>

      {/* export */}
      <div className="flex items-center gap-1.5">
        <button onClick={exportCSV} className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary">
          <Download className="h-3 w-3" /> CSV
        </button>
        <button onClick={exportJSON} className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary">
          <Download className="h-3 w-3" /> JSON
        </button>
      </div>

      <p className="text-[9px] leading-snug text-muted-foreground">
        Close-basierter Backtest auf vorhandenen Kerzen — indikativ, keine Garantie für zukünftige Ergebnisse. Keine Anlageberatung.
      </p>
    </div>
  );
}
