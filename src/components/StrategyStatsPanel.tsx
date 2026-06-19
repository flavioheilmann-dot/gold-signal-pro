import { BarChart3, TrendingDown, TrendingUp, Percent, Timer, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StrategyStats } from "@/lib/signalEngine";

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

export function StrategyStatsPanel({ stats, assetName }: { stats: StrategyStats; assetName: string }) {
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
  const ruinTone = stats.monteCarlo.ruinPct <= 5 ? "up" : stats.monteCarlo.ruinPct <= 15 ? "gold" : "down";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Stat icon={Percent} label="Win-Rate" value={`${(stats.winRate * 100).toFixed(0)}%`} tone={wrTone} sub={`${stats.wins}W / ${stats.losses}L`} />
        <Stat icon={TrendingUp} label="Erwartungswert" value={`${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}%`} tone={expTone} sub="pro Trade" />
        <Stat icon={BarChart3} label="Profit-Faktor" value={stats.profitFactor >= 99 ? "∞" : stats.profitFactor.toFixed(2)} tone={pfTone} sub="Gewinn÷Verlust" />
        <Stat icon={TrendingDown} label="Max Drawdown" value={`-${stats.maxDrawdownPct.toFixed(1)}%`} tone="down" sub="grösster Rückgang" />
        <Stat icon={Timer} label="Ø Haltedauer" value={`${Math.round(stats.avgBarsInTrade)} Kerzen`} tone="muted" sub={`~${Math.round(stats.avgBarsInTrade * 15)} Min`} />
        <Stat icon={ShieldAlert} label="Ruin-Risiko" value={`${stats.monteCarlo.ruinPct.toFixed(1)}%`} tone={ruinTone} sub="Monte Carlo (500×)" />
      </div>

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
            <span className="font-mono font-semibold text-down">
              {stats.monteCarlo.worstPct.toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Trades: </span>
            <span className="font-mono font-semibold">{stats.totalTrades}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
