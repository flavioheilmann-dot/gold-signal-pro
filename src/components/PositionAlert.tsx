import { AlertTriangle, X } from "lucide-react";
import { cn, fmtUsd } from "@/lib/utils";
import { stateLabel, type SignalState } from "@/lib/signalEngine";

export interface PositionAlertData {
  epic: string;
  name: string;
  posDirection: "BUY" | "SELL";
  signalState: SignalState;
  pnl: number | null;
}

export function PositionAlert({
  alert,
  onShow,
  onDismiss,
}: {
  alert: PositionAlertData | null;
  onShow: (epic: string) => void;
  onDismiss: () => void;
}) {
  if (!alert) return null;
  const posLabel = alert.posDirection === "BUY" ? "LONG" : "SHORT";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b-2 border-gold bg-gold/15 px-4 py-2.5 animate-glow-warn">
      <span className="flex items-center gap-2 font-mono text-sm font-bold text-gold">
        <AlertTriangle className="h-5 w-5 animate-pulse" />
        POSITION-WARNUNG
      </span>
      <span className="text-sm">
        Deine <span className="font-bold">{alert.name}</span>{" "}
        <span className={cn("font-semibold", alert.posDirection === "BUY" ? "text-up" : "text-down")}>
          {posLabel}
        </span>
        -Position — jetzt{" "}
        <span className="font-semibold text-gold">{stateLabel(alert.signalState)}</span>{" "}
        <span className="text-muted-foreground">
          (Gegensignal – schließen/prüfen)
        </span>
        {alert.pnl != null && (
          <span className={cn("ml-2 mono", alert.pnl >= 0 ? "text-up" : "text-down")}>
            P&L {fmtUsd(alert.pnl, 2)}
          </span>
        )}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onShow(alert.epic)}
          className="rounded-md bg-gold px-3 py-1 font-mono text-xs font-semibold text-black"
        >
          Anzeigen →
        </button>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground" title="Ausblenden">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
