import { ArrowDownRight, ArrowUpRight, Clock, Info, Timer } from "lucide-react";
import { cn, fmtUsd } from "@/lib/utils";
import type { Decision, TradeLevels } from "@/lib/signalEngine";

function Cell({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "gold";
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mono mt-1 text-[15px] font-bold",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "gold" && "text-gold"
        )}
      >
        {value}
      </div>
      {hint && <div className="font-mono text-[9px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function holdEstimate(atr: number, entry: number, tp1: number): string {
  const dist = Math.abs(tp1 - entry);
  const barsEstimate = Math.max(2, Math.round(dist / (atr * 0.4)));
  const mins = barsEstimate * 15;
  if (mins < 60) return `~${mins} Min`;
  const hrs = Math.round(mins / 60);
  if (hrs <= 1) return "~1 Stunde";
  if (hrs <= 4) return `~${hrs} Stunden`;
  return `~${hrs}h (mehrere Stunden)`;
}

function simpleExplanation(decision: Decision, levels: TradeLevels): string {
  const long = levels.direction === "long";
  const action = long ? "KAUFEN" : "VERKAUFEN";
  const dir = long ? "nach oben" : "nach unten";

  const parts: string[] = [];

  if (decision.reason.includes("Box-Breakout")) {
    parts.push(`Der Preis ist aus der Konsolidierungsbox ${dir} ausgebrochen`);
  } else if (decision.reason.includes("Box-Rejection")) {
    parts.push(`Der Preis wurde am Boxrand abgewiesen und dreht ${dir}`);
  }

  if (decision.reason.includes("Trend")) {
    parts.push(long ? "der Trend zeigt aufwärts" : "der Trend zeigt abwärts");
  }
  if (decision.reason.includes("MACD")) {
    parts.push(long ? "das Momentum ist positiv" : "das Momentum ist negativ");
  }
  if (decision.reason.includes("RSI")) {
    parts.push("RSI ist in einem gesunden Bereich");
  }

  const explanation = parts.length
    ? parts[0] + (parts.length > 1 ? ", " + parts.slice(1).join(", ") : "") + "."
    : decision.reason + ".";

  return `${action}: ${explanation} Wenn der Trade gegen dich läuft, begrenzt der Stop-Loss den Verlust.`;
}

export function TradingSetup({
  decision,
  levels,
}: {
  decision: Decision;
  levels: TradeLevels | null;
}) {
  if (!levels || decision.bias === "flat") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/10 px-4 py-3">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Kein aktives Setup.</span> {decision.reason}.
          </div>
        </div>
        <Disclaimer />
      </div>
    );
  }

  const long = levels.direction === "long";
  const DirIcon = long ? ArrowUpRight : ArrowDownRight;
  const entryLo = long ? levels.entry - levels.atr * 0.25 : levels.entry;
  const entryHi = long ? levels.entry : levels.entry + levels.atr * 0.25;
  const hold = holdEstimate(levels.atr, levels.entry, levels.takeProfit1);
  const explanation = simpleExplanation(decision, levels);

  return (
    <div className="space-y-3">
      {/* explanation box */}
      <div className={cn(
        "rounded-lg border px-4 py-3",
        long ? "border-up/20 bg-up/5" : "border-down/20 bg-down/5"
      )}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={cn(
            "grid h-6 w-6 place-items-center rounded-md border",
            long ? "border-up/30 bg-up/10 text-up" : "border-down/30 bg-down/10 text-down"
          )}>
            <DirIcon className="h-3.5 w-3.5" />
          </span>
          <span className={cn("font-mono text-sm font-bold", long ? "text-up" : "text-down")}>
            {long ? "KAUFEN (Long)" : "VERKAUFEN (Short)"}
          </span>
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Timer className="h-3 w-3" />
            Haltezeit: <span className="font-semibold text-foreground">{hold}</span>
          </span>
        </div>
        <p className="text-xs leading-relaxed text-foreground/80">{explanation}</p>
      </div>

      {/* levels grid */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {long ? "Long" : "Short"} · ATR {fmtUsd(levels.atr, 1)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Hebel: <span className="font-semibold text-gold">{levels.leverage}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Cell label="Entry-Preis" value={`${fmtUsd(entryLo, 1)}–${fmtUsd(entryHi, 1)}`} tone="gold" hint="jetzt einsteigen" />
        <Cell label="Stop-Loss" value={fmtUsd(levels.stopLoss, 1)} tone="down" hint={`${fmtUsd(Math.abs(levels.entry - levels.stopLoss), 1)} Abstand`} />
        <Cell label="Take Profit 1" value={fmtUsd(levels.takeProfit1, 1)} tone="up" hint={`R:R 1:${levels.rr1.toFixed(1)}`} />
        <Cell label="Take Profit 2" value={fmtUsd(levels.takeProfit2, 1)} tone="up" hint={`R:R 1:${levels.rr2.toFixed(1)}`} />
        <Cell label="Haltezeit" value={hold} hint="15M Day-Trade" />
      </div>

      <Disclaimer />
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      <span>Keine Anlageberatung – rein technische Analyse. Handeln auf eigenes Risiko; CFDs sind hochriskant.</span>
    </div>
  );
}
