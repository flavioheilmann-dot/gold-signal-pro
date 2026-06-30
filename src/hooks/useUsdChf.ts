import { useEffect, useState } from "react";
import { getQuote } from "@/lib/capital";

/**
 * USD→CHF rate (USDCHF mid = "CHF per 1 USD") for converting USD-quoted CFD
 * P/L into the CHF account currency. Polls every 5 min while connected; returns
 * null when the backend can't supply it (caller falls back to a 1:1 estimate).
 */
export function useUsdChf(enabled: boolean): number | null {
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRate(null);
      return;
    }
    let alive = true;
    // No document.hidden guard: this is a low-frequency (5-min) rate that the
    // sizing math needs whenever the user looks, even if the tab is backgrounded.
    const tick = async () => {
      const q = await getQuote("USDCHF");
      if (alive && q && q.mid > 0) setRate(q.mid);
    };
    tick();
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  return rate;
}
