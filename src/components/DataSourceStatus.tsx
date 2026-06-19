import { cn, fmtDateTime } from "@/lib/utils";

export interface SourceInfo {
  sourceLabel: string;
  timeframe: string;
  fetchedAt: number | null;
  refreshSec: number;
  offline: boolean;
}

export function DataSourceStatus({ info }: { info: SourceInfo }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", info.offline ? "bg-down" : "bg-up")} />
        {info.offline ? "OFFLINE · Simulation" : "Live"}
      </span>
      <span>Quelle: {info.sourceLabel}</span>
      <span>· TF: {info.timeframe}</span>
      <span>· Stand: {info.fetchedAt ? fmtDateTime(info.fetchedAt) : "–"}</span>
      <span>· Refresh: {info.refreshSec}s</span>
    </div>
  );
}
