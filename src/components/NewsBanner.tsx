import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Newspaper, Calendar, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { GOLD_NEWS, newsBias, type NewsItem } from "@/lib/news";
import { fetchLiveNews, getWeeklyAgenda, isEventToday, isEventPast, type LiveNewsItem, type EconEvent } from "@/lib/newsApi";
import type { BuyOutlook } from "@/lib/outlook";

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vor ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `vor ${days}T`;
}

function CuratedItem({ item }: { item: NewsItem }) {
  const icon = item.lean === "bull" ? "▲" : item.lean === "bear" ? "▼" : "◆";
  const tone =
    item.lean === "bull" ? "text-up" : item.lean === "bear" ? "text-down" : "text-gold";
  return (
    <div className="flex gap-2.5 rounded-md border border-border/50 bg-background/40 px-3 py-2">
      <span className={cn("mt-0.5 font-mono text-sm", tone)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {item.tag}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/60">{item.date}</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">{item.text}</p>
        <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/50">{item.source}</p>
      </div>
    </div>
  );
}

function LiveItem({ item }: { item: LiveNewsItem }) {
  const gi = item.goldImpact;
  const impactTone = gi?.direction === "up" ? "text-up" : gi?.direction === "down" ? "text-down" : "text-muted-foreground";
  const impactIcon = gi?.direction === "up" ? "▲" : gi?.direction === "down" ? "▼" : "–";
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-2.5 rounded-md border border-border/50 bg-background/40 px-3 py-2 transition-colors hover:border-border hover:bg-muted/20"
    >
      <span className={cn("mt-0.5 font-mono text-sm", impactTone)}>{impactIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-info/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-info">
            LIVE
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/60">{timeAgo(item.pubDate)}</span>
          <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <p className="mt-0.5 text-xs font-medium leading-relaxed text-foreground/90">{item.titleDe || item.title}</p>
        <p className="text-[10px] leading-relaxed text-muted-foreground/50 italic">{item.title}</p>
        {gi && gi.direction !== "neutral" && (
          <p className={cn("mt-0.5 text-[10px] font-semibold", impactTone)}>
            Gold {impactIcon} {gi.hint}
          </p>
        )}
      </div>
    </a>
  );
}

function EventRow({ event }: { event: EconEvent }) {
  const today = isEventToday(event);
  const past = isEventPast(event);
  const impactColor = event.impact === "high" ? "bg-down" : event.impact === "medium" ? "bg-gold" : "bg-muted-foreground";
  const dayLabel = new Date(event.date).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" });

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
      today && !past ? "border-gold/30 bg-gold/5" : "border-border/50 bg-background/40",
      past && "opacity-50"
    )}>
      <div className={cn("h-2 w-2 shrink-0 rounded-full", impactColor)} />
      <div className="w-16 shrink-0 font-mono text-[9px] text-muted-foreground">
        {dayLabel} {event.time}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[8px] font-semibold uppercase">{event.country}</span>
          <span className="font-semibold truncate">{event.nameDe}</span>
          {today && !past && <AlertTriangle className="h-3 w-3 shrink-0 text-gold" />}
        </div>
        <p className="text-[10px] text-muted-foreground">{event.goldEffect}</p>
      </div>
      {past && <span className="font-mono text-[8px] text-muted-foreground">vorbei</span>}
    </div>
  );
}

export function NewsBanner({ outlook }: { outlook: BuyOutlook | null }) {
  const [expanded, setExpanded] = useState(false);
  const [liveNews, setLiveNews] = useState<LiveNewsItem[]>([]);

  const loadNews = useCallback(async () => {
    const items = await fetchLiveNews();
    if (items.length) setLiveNews(items);
  }, []);

  useEffect(() => {
    loadNews();
    const id = setInterval(loadNews, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadNews]);

  const bias = newsBias(GOLD_NEWS);
  const biasText =
    bias.bullPct >= 56 ? "bullisch" : bias.bullPct <= 44 ? "bärisch" : "neutral";
  const buyTone =
    outlook?.tone === "up" ? "text-up" : outlook?.tone === "down" ? "text-down" : "text-gold";

  return (
    <div className="border-b border-border bg-card/70 backdrop-blur">
      {/* compact header row — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/20"
      >
        <Newspaper className="h-4 w-4 shrink-0 text-muted-foreground" />

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="font-mono text-xs font-semibold text-foreground">
            News & Analyse
          </span>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            {bias.bull} bullisch · {bias.bear} bärisch · Tendenz{" "}
            <span className={cn(
              bias.bullPct >= 56 ? "text-up" : bias.bullPct <= 44 ? "text-down" : "text-gold"
            )}>
              {biasText}
            </span>
          </span>
          {liveNews.length > 0 && (
            <span className="rounded-full bg-info/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-info">
              {liveNews.length} live
            </span>
          )}
        </div>

        {outlook && (
          <div className="hidden items-center gap-2 sm:flex">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Kauf</span>
            <span className={cn("mono text-sm font-bold", buyTone)}>{outlook.buyPct}%</span>
            <div className="h-5 w-1 overflow-hidden rounded-full bg-down/50">
              <div className="w-full bg-up transition-all duration-500" style={{ height: `${outlook.buyPct}%` }} />
            </div>
          </div>
        )}

        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* expanded panel */}
      {expanded && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-border/50 px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {/* live news first */}
            {liveNews.map((item, i) => (
              <LiveItem key={`live-${i}`} item={item} />
            ))}
            {liveNews.length === 0 && (
              <div className="col-span-full rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-center font-mono text-[10px] text-muted-foreground">
                Keine Live-News geladen — Proxy läuft?
              </div>
            )}
          </div>

          {/* Economic Events Agenda */}
          <div className="mt-3 border-t border-border/30 pt-3">
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              <Calendar className="h-3 w-3" />
              Wirtschaftskalender — Diese Woche
            </div>
            <div className="mb-1 flex items-center gap-3 text-[9px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-down" /> Hoch</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-gold" /> Mittel</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" /> Niedrig</span>
            </div>
            <div className="grid gap-1.5">
              {getWeeklyAgenda().map((ev, i) => (
                <EventRow key={`ev-${i}`} event={ev} />
              ))}
            </div>
          </div>

          <div className="mt-3 border-t border-border/30 pt-3">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Kuratierte Analyse
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {GOLD_NEWS.map((item, i) => (
                <CuratedItem key={`cur-${i}`} item={item} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
