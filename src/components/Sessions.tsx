import { cn } from "@/lib/utils";
import type { MarketStatus } from "@/lib/market";

interface Sess {
  name: string;
  active: boolean;
  hours: string;
}

/** Trading sessions in UTC windows; only active while the market is open. */
function computeSessions(
  now: Date,
  open: boolean
): { sessions: Sess[]; overlap: boolean } {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const london = open && h >= 7 && h < 16;
  const newyork = open && h >= 12.5 && h < 21;
  const tokyo = open && h >= 0 && h < 9;
  return {
    sessions: [
      { name: "Tokio", active: tokyo, hours: "01–10 MESZ" },
      { name: "London", active: london, hours: "08–17 MESZ" },
      { name: "New York", active: newyork, hours: "14–23 MESZ" },
    ],
    overlap: london && newyork,
  };
}

export function Sessions({
  now,
  status,
}: {
  now: Date;
  status: MarketStatus;
}) {
  const { sessions, overlap } = computeSessions(now, status.open);
  return (
    <div className="space-y-1.5">
      {sessions.map((s) => (
        <div
          key={s.name}
          className="flex items-center justify-between text-xs"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                s.active ? "bg-up shadow-[0_0_8px_hsl(var(--up))]" : "bg-muted"
              )}
            />
            <span
              className={s.active ? "text-foreground" : "text-muted-foreground"}
            >
              {s.name}
            </span>
          </div>
          <span className="mono text-[10px] text-muted-foreground">
            {s.hours}
          </span>
        </div>
      ))}

      {!status.open ? (
        <div className="mt-2 rounded-md border border-down/40 bg-down/10 px-2.5 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-down">
          🔴 Börse geschlossen
          {status.detail && (
            <div className="mt-0.5 normal-case tracking-normal text-muted-foreground">
              {status.detail}
            </div>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "mt-2 rounded-md border px-2.5 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider transition-colors",
            overlap
              ? "border-up/40 bg-up/10 text-up"
              : "border-border bg-muted/30 text-muted-foreground"
          )}
        >
          {overlap ? "⚡ London × NY Overlap aktiv" : "Kein Overlap"}
        </div>
      )}
    </div>
  );
}
