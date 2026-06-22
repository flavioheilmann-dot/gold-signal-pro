import { useEffect, useRef, useState } from "react";
import { getQuote, type Quote } from "@/lib/capital";

/**
 * Near-real-time price for the active instrument: polls the broker quote every
 * `intervalMs` while enabled and the tab is visible. Drives the live header
 * price and the forming candle so the chart feels second-accurate.
 */
export function useLiveQuote(epic: string | undefined, enabled: boolean, intervalMs = 1500) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const epicRef = useRef(epic);
  epicRef.current = epic;

  useEffect(() => {
    setQuote(null);
    if (!enabled || !epic) return;
    let alive = true;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const q = await getQuote(epicRef.current!);
      if (alive && q) setQuote(q);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [epic, enabled, intervalMs]);

  return quote;
}
