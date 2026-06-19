import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type LineData,
} from "lightweight-charts";
import type { StrategySeries, SignalEvent } from "@/lib/signalEngine";

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

// Deliberately simple day-trading chart: price area + EMA21 + the active
// box high/low. It keeps the chart calm while still showing the trigger zone.
export function ChartPanel({ series, events, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const boxHighRef = useRef<ISeriesApi<"Line"> | null>(null);
  const boxLowRef = useRef<ISeriesApi<"Line"> | null>(null);

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

    areaRef.current = chart.addAreaSeries({
      lineColor: "#f0b429",
      topColor: "rgba(240,180,41,0.25)",
      bottomColor: "rgba(240,180,41,0.02)",
      lineWidth: 2,
      priceLineColor: "rgba(240,180,41,0.5)",
    });
    emaRef.current = chart.addLineSeries({
      color: "rgba(77,166,255,0.8)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    boxHighRef.current = chart.addLineSeries({
      color: "rgba(240,180,41,0.65)",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    boxLowRef.current = chart.addLineSeries({
      color: "rgba(240,180,41,0.65)",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      areaRef.current = null;
      emaRef.current = null;
      boxHighRef.current = null;
      boxLowRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: theme === "dark" ? "rgba(148,163,184,0.7)" : "rgba(74,90,114,0.9)" },
    });
  }, [theme]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area || !series) return;
    area.setData(
      series.times.map((t, i) => ({ time: t as Time, value: series.prices[i] }))
    );
    emaRef.current?.setData(lineData(series.times, series.emaSlow));
    boxHighRef.current?.setData(lineData(series.times, series.boxHigh));
    boxLowRef.current?.setData(lineData(series.times, series.boxLow));
    area.setMarkers(
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
    chartRef.current?.timeScale().fitContent();
  }, [series, events]);

  return <div ref={containerRef} className="h-full w-full" />;
}
