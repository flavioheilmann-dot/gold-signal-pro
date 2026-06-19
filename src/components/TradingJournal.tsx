import { useCallback, useEffect, useState } from "react";
import { BookOpen, RefreshCw, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTradeHistory, type TradeHistoryItem } from "@/lib/capital";
import { Button } from "@/components/ui/button";

function parsePnl(pnl: string): number | null {
  if (!pnl) return null;
  const neg = pnl.startsWith("-");
  const m = pnl.match(/[\d.]+/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return neg ? -v : v;
}

function fmtDate(d: string): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function TradeRow({ t }: { t: TradeHistoryItem }) {
  const pnl = parsePnl(t.profitAndLoss);
  const win = pnl !== null && pnl > 0;
  const loss = pnl !== null && pnl < 0;

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
      win ? "border-up/20 bg-up/5" : loss ? "border-down/20 bg-down/5" : "border-border/50 bg-background/40"
    )}>
      <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", win ? "bg-up/15" : loss ? "bg-down/15" : "bg-muted/20")}>
        {win ? <TrendingUp className="h-4 w-4 text-up" /> : loss ? <TrendingDown className="h-4 w-4 text-down" /> : <BookOpen className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{t.instrumentName || "—"}</span>
          <span className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[8px] uppercase">{t.type}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>{fmtDate(t.date)}</span>
          {t.openLevel != null && <span>Open: {t.openLevel}</span>}
          {t.closeLevel != null && <span>Close: {t.closeLevel}</span>}
          {t.size != null && <span>Size: {t.size}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className={cn("font-mono text-sm font-bold", win ? "text-up" : loss ? "text-down" : "text-foreground")}>
          {t.profitAndLoss || "—"}
        </div>
      </div>
    </div>
  );
}

export function TradingJournal({ connected }: { connected: boolean }) {
  const [trades, setTrades] = useState<TradeHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    const h = await getTradeHistory(days);
    setTrades(h.transactions.filter((t) => t.type === "TRADE" || t.instrumentName));
    setLoading(false);
  }, [connected, days]);

  useEffect(() => { load(); }, [load]);

  // stats
  const pnls = trades.map((t) => parsePnl(t.profitAndLoss)).filter((p): p is number => p !== null);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const winRate = pnls.length ? (wins.length / pnls.length) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const currency = trades[0]?.currency || "CHF";

  if (!connected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" />
        Verbinde Capital.com um dein Trading-Journal zu sehen.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setDays(d)}
            >
              {d}T
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>

      {/* stats summary */}
      {pnls.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5 text-center">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Total P&L</div>
            <div className={cn("font-mono text-sm font-bold", totalPnl >= 0 ? "text-up" : "text-down")}>
              {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5 text-center">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Win-Rate</div>
            <div className={cn("font-mono text-sm font-bold", winRate >= 50 ? "text-up" : "text-down")}>
              {winRate.toFixed(0)}%
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5 text-center">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Avg Win</div>
            <div className="font-mono text-sm font-bold text-up">
              +{avgWin.toFixed(2)}
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5 text-center">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Avg Loss</div>
            <div className="font-mono text-sm font-bold text-down">
              {avgLoss.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* equity curve mini */}
      {pnls.length > 1 && (
        <div className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Equity-Kurve ({currency})</div>
          <div className="flex items-end gap-px h-12">
            {(() => {
              const cumulative: number[] = [];
              let sum = 0;
              pnls.forEach((p) => { sum += p; cumulative.push(sum); });
              const max = Math.max(...cumulative.map(Math.abs), 1);
              return cumulative.map((v, i) => (
                <div
                  key={i}
                  className={cn("flex-1 min-w-[2px] rounded-sm", v >= 0 ? "bg-up" : "bg-down")}
                  style={{ height: `${Math.max(8, (Math.abs(v) / max) * 100)}%`, alignSelf: v >= 0 ? "flex-end" : "flex-end" }}
                />
              ));
            })()}
          </div>
        </div>
      )}

      {/* trade list */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {trades.length} Trades · letzte {days} Tage
        </div>
        {trades.length === 0 && !loading && (
          <div className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-4 text-center text-xs text-muted-foreground">
            Keine Trades in den letzten {days} Tagen gefunden.
          </div>
        )}
        {loading && (
          <div className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-4 text-center text-xs text-muted-foreground">
            Lade Trade-Historie...
          </div>
        )}
        <div className="max-h-[400px] space-y-1.5 overflow-y-auto">
          {trades.map((t, i) => (
            <TradeRow key={`${t.reference}-${i}`} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}
