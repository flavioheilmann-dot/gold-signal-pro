import { Crosshair, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EdgeSignal } from "@/lib/signalEngine";

function EdgeChip({ edge }: { edge: EdgeSignal }) {
  const icon =
    edge.type === "divergence" ? "⇄" :
    edge.type === "exhaustion" ? "⚡" :
    edge.type === "structure_break" ? "↕" : "◈";
  const tone =
    edge.lean === "bull" ? "border-up/30 bg-up/5 text-up" :
    edge.lean === "bear" ? "border-down/30 bg-down/5 text-down" :
    "border-border bg-muted/20 text-muted-foreground";

  return (
    <div className={cn("rounded-md border px-3 py-2", tone)}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold">{edge.label}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/70">{edge.detail}</p>
    </div>
  );
}

export function EdgeDetection({ edges, assetName }: { edges: EdgeSignal[]; assetName: string }) {
  if (!edges.length) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <Crosshair className="h-3.5 w-3.5" />
        Keine besonderen Muster bei {assetName} erkannt.
      </div>
    );
  }

  const bullCount = edges.filter((e) => e.lean === "bull").length;
  const bearCount = edges.filter((e) => e.lean === "bear").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <AlertTriangle className="h-3 w-3" />
        <span>
          {edges.length} Muster erkannt ·{" "}
          {bullCount > 0 && <span className="text-up">{bullCount} bullisch</span>}
          {bullCount > 0 && bearCount > 0 && " · "}
          {bearCount > 0 && <span className="text-down">{bearCount} bärisch</span>}
        </span>
      </div>
      <div className="grid gap-1.5">
        {edges.map((e, i) => (
          <EdgeChip key={i} edge={e} />
        ))}
      </div>
    </div>
  );
}
