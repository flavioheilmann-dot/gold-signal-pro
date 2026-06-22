import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type LineData,
} from "lightweight-charts";
import type { StrategySeries, SignalEvent } from "@/lib/signalEngine";
import { detectFVGs } from "@/trading/strategy/fvg";

interface Props {
  series: StrategySeries | null;
  events: SignalEvent[];
  theme: "dark" | "light";
}

function lineData(times: number[], arr: (number | null)[]): LineData[] {
  const out: LineData[] = [];
  for (let i = 0; i < times.length; i++) {
    if (arr[i] != null) out.push({ time: times[i] as Time, value: arr[i] as number });
  }
  return out;
}

// Real candlestick day-trading chart: candles + EMA21 + the active box high/low,
// plus the nearest unfilled Fair Value Gaps drawn as coloured zones (price-line
// bands) and BUY/SELL signal markers.
export function ChartPanel({ series, events, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const boxHighRef = useRef<ISeriesApi<"Line"> | null>(null);
  const boxLowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fvgLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(148,163,184,0.7)",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(148,163,184,0.05)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.1)" },
      timeScale: {
        borderColor: "rgba(148,163,184,0.1)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
      handleScale: false,
      handleScroll: false,
    });
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor: "#10e090",
      downColor: "#ff3d5a",
      borderUpColor: "#10e090",
      borderDownColor: "#ff3d5a",
      wickUpColor: "rgba(16,224,144,0.7)",
      wickDownColor: "rgba(255,61,90,0.7)",
      priceLineColor: "rgba(240,180,41,0.6)",
    });
    emaRef.current = chart.addLineSeries({
      color: "rgba(77,166,255,0.85)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    boxHighRef.current = chart.addLineSeries({
      color: "rgba(240,180,41,0.55)",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    boxLowRef.current = chart.addLineSeries({
      color: "rgba(240,180,41,0.55)",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      emaRef.current = null;
      boxHighRef.current = null;
      boxLowRef.current = null;
      fvgLinesRef.current = [];
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: theme === "dark" ? "rgba(148,163,184,0.7)" : "rgba(74,90,114,0.9)" },
    });
  }, [theme]);

  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || !series) return;

    candle.setData(
      series.candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    emaRef.current?.setData(lineData(series.times, series.emaSlow));
    boxHighRef.current?.setData(lineData(series.times, series.boxHigh));
    boxLowRef.current?.setData(lineData(series.times, series.boxLow));

    candle.setMarkers(
      events.slice(-6).map((e) => {
        const buy = e.state === "BUY" || e.state === "STRONG_BUY";
        return {
          time: e.time as Time,
          position: buy ? ("belowBar" as const) : ("aboveBar" as const),
          color: buy ? "#10e090" : "#ff3d5a",
          shape: buy ? ("arrowUp" as const) : ("arrowDown" as const),
          text: buy ? "BUY" : "SELL",
        };
      })
    );

    // ── Fair Value Gaps: draw the nearest unfilled ones as coloured bands ──
    for (const pl of fvgLinesRef.current) candle.removePriceLine(pl);
    fvgLinesRef.current = [];
    const last = series.candles[series.candles.length - 1]?.close ?? 0;
    const near = detectFVGs(series.candles)
      .filter((f) => !f.filled)
      .sort((a, b) => Math.abs(a.mid - last) - Math.abs(b.mid - last))
      .slice(0, 3);
    for (const f of near) {
      const bull = f.dir === "bullish";
      const col = bull ? "rgba(16,224,144,0.85)" : "rgba(255,61,90,0.85)";
      fvgLinesRef.current.push(
        candle.createPriceLine({ price: f.top, color: col, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: bull ? "FVG ↑" : "FVG ↓" }),
        candle.createPriceLine({ price: f.bottom, color: col, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" })
      );
    }

    chartRef.current?.timeScale().fitContent();
  }, [series, events]);

  return <div ref={containerRef} className="h-full w-full" />;
}
