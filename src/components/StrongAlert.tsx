import { Zap, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { stateLabel, type SignalState } from "@/lib/signalEngine";

export interface StrongAlertData {
  epic: string;
  name: string;
  state: SignalState;
  confidence: number;
}

export function StrongAlert({
  alert,
  onShow,
  onDismiss,
}: {
  alert: StrongAlertData | null;
  onShow: (epic: string) => void;
  onDismiss: () => void;
}) {
  if (!alert) return null;
  const buy = alert.state === "STRONG_BUY" || alert.state === "BUY";

  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b-2 px-4 py-2.5",
        buy ? "border-up bg-up/15 animate-glow-up" : "border-down bg-down/15 animate-glow-down"
      )}
    >
      <span className={cn("flex items-center gap-2 font-mono text-sm font-bold", buy ? "text-up" : "text-down")}>
        <Zap className="h-5 w-5 animate-pulse" />
        SEHR GUTES DAY-SETUP
      </span>
      <span className="text-sm">
        <span className="font-bold">{alert.name}</span> —{" "}
        <span className={cn("font-semibold", buy ? "text-up" : "text-down")}>
          {stateLabel(alert.state)}
        </span>{" "}
        <span className="text-muted-foreground">· {alert.confidence}% · 15M Box-System</span>
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onShow(alert.epic)}
          className={cn(
            "rounded-md px-3 py-1 font-mono text-xs font-semibold text-black",
            buy ? "bg-up" : "bg-down"
          )}
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
