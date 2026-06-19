import { Bell, BellOff, Moon, Sun, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PriceTicker, type TickerInfo } from "@/components/PriceTicker";
import { DataSourceStatus, type SourceInfo } from "@/components/DataSourceStatus";
import type { MarketStatus } from "@/lib/market";

interface HeaderProps {
  ticker: TickerInfo;
  source: SourceInfo;
  market: MarketStatus;
  countdown: number;
  refreshSec: number;
  loading: boolean;
  alarmOn: boolean;
  theme: "dark" | "light";
  onRefresh: () => void;
  onToggleAlarm: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function Header({
  ticker,
  source,
  market,
  countdown,
  refreshSec,
  loading,
  alarmOn,
  theme,
  onRefresh,
  onToggleAlarm,
  onToggleTheme,
  onOpenSettings,
}: HeaderProps) {
  const pct = (countdown / refreshSec) * 100;

  return (
    <header className="shrink-0 border-b border-border bg-card/80 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-2">
        <div className="flex items-center gap-3">
          <div className="font-mono text-sm font-bold tracking-[0.18em]">
            <span className="text-primary [text-shadow:0_0_22px_hsl(var(--gold)/0.45)]">GOLD</span>
            <span className="text-muted-foreground">SIGNAL·PRO</span>
          </div>
          {market.open ? (
            <span className="flex items-center gap-1.5" title="Markt offen">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-live-dot rounded-full bg-up" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-up">Markt offen</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5" title={market.detail}>
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-gold">{market.label}</span>
              {market.detail && (
                <span className="hidden font-mono text-[10px] text-muted-foreground lg:inline">· {market.detail}</span>
              )}
            </span>
          )}
        </div>

        <div className="order-3 w-full sm:order-2 sm:w-auto">
          <PriceTicker ticker={ticker} />
        </div>

        <div className="order-2 flex items-center gap-1.5 sm:order-3">
          <button
            onClick={onRefresh}
            title="Jetzt aktualisieren (S)"
            className="relative grid h-9 w-9 place-items-center rounded-md border border-border bg-secondary/60 text-muted-foreground transition-colors hover:text-primary"
          >
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--border))" strokeWidth="2.5" />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="hsl(var(--gold))"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 15}
                strokeDashoffset={(2 * Math.PI * 15 * (100 - pct)) / 100}
                className="transition-[stroke-dashoffset] duration-1000 ease-linear"
              />
            </svg>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-primary")} />
          </button>
          <span className="mono w-6 text-center text-xs text-muted-foreground">{countdown}s</span>
          <Button variant="ghost" size="icon" onClick={onToggleAlarm} title="Alarm an/aus (A)" className={alarmOn ? "text-up" : "text-muted-foreground"}>
            {alarmOn ? <Bell /> : <BellOff />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onToggleTheme} title="Dark/Light">
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onOpenSettings} title="Einstellungen">
            <Settings2 />
          </Button>
        </div>
      </div>

      <div className="px-4 pb-1.5 pt-1">
        <DataSourceStatus info={source} />
      </div>
    </header>
  );
}
