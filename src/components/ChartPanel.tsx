import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
  type LineData,
  type SeriesMarker,
} from "lightweight-charts";
import type { StrategySeries, SignalEvent, TradeLevels } from "@/lib/signalEngine";
import { detectFVGs } from "@/trading/strategy/fvg";
import { detectLiquidityLevels } from "@/trading/strategy/liquidity";
import { findRecentSweep } from "@/trading/strategy/sweep";
import { detectStructureShift } from "@/trading/strategy/structure";

interface Props {
  series: StrategySeries | null;
  events: SignalEvent[];
  theme: "dark" | "light";
  livePrice?: number;
  levels?: TradeLevels | null;
}

interface FvgBox { dir: "bullish" | "bearish"; top: number; bottom: number; time: number }

function lineData(times: number[], arr: (number | null)[]): LineData[] {
  const out: LineData[] = [];
  for (let i = 0; i < times.length; i++) {
    if (arr[i] != null) out.push({ time: times[i] as Time, value: arr[i] as number });
  }
  return out;
}

// Candlestick day-trading chart with ICT overlays drawn directly on it:
// filled Fair-Value-Gap boxes, the active Entry/SL/TP lines, the most recent
// liquidity sweep marker + market-structure-shift line, EMA21 and the box.
export function ChartPanel({ series, events, theme, livePrice, levels }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const boxHighRef = useRef<ISeriesApi<"Line"> | null>(null);
  const boxLowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const dynLinesRef = useRef<IPriceLine[]>([]);
  const fvgsRef = useRef<FvgBox[]>([]);

  function drawOverlay() {
    const svg = svgRef.current, chart = chartRef.current, candle = candleRef.current, el = containerRef.current;
    if (!svg || !chart || !candle || !el) return;
    const ts = chart.timeScale();
    const right = ts.width();
    svg.setAttribute("width", String(el.clientWidth));
    svg.setAttribute("height", String(el.clientHeight));
    let html = "";
    for (const f of fvgsRef.current) {
      const x1 = ts.timeToCoordinate(f.time as Time);
      const yT = candle.priceToCoordinate(f.top);
      const yB = candle.priceToCoordinate(f.bottom);
      if (x1 == null || yT == null || yB == null) continue;
      const x = Math.max(0, x1);
      const w = Math.max(2, right - x);
      const y = Math.min(yT, yB);
      const h = Math.max(1, Math.abs(yB - yT));
      const bull = f.dir === "bullish";
      const fill = bull ? "rgba(16,224,144,0.12)" : "rgba(255,61,90,0.12)";
      const stroke = bull ? "rgba(16,224,144,0.45)" : "rgba(255,61,90,0.45)";
      html += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3 3" rx="1"/>`;
    }
    svg.innerHTML = html;
  }

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
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(148,163,184,0.05)" } },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.1)" },
      timeScale: { borderColor: "rgba(148,163,184,0.1)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      handleScale: false,
      handleScroll: false,
    });
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor: "#10e090", downColor: "#ff3d5a",
      borderUpColor: "#10e090", borderDownColor: "#ff3d5a",
      wickUpColor: "rgba(16,224,144,0.7)", wickDownColor: "rgba(255,61,90,0.7)",
      priceLineColor: "rgba(240,180,41,0.6)",
    });
    emaRef.current = chart.addLineSeries({ color: "rgba(77,166,255,0.85)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    boxHighRef.current = chart.addLineSeries({ color: "rgba(240,180,41,0.55)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    boxLowRef.current = chart.addLineSeries({ color: "rgba(240,180,41,0.55)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    const ro = new ResizeObserver(() => requestAnimationFrame(drawOverlay));
    ro.observe(containerRef.current);
    chart.timeScale().subscribeVisibleTimeRangeChange(() => drawOverlay());

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null; candleRef.current = null; emaRef.current = null;
      boxHighRef.current = null; boxLowRef.current = null; dynLinesRef.current = []; fvgsRef.current = [];
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ layout: { textColor: theme === "dark" ? "rgba(148,163,184,0.7)" : "rgba(74,90,114,0.9)" } });
  }, [theme]);

  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || !series) return;

    candle.setData(series.candles.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    emaRef.current?.setData(lineData(series.times, series.emaSlow));
    boxHighRef.current?.setData(lineData(series.times, series.boxHigh));
    boxLowRef.current?.setData(lineData(series.times, series.boxLow));

    // ── ICT context: nearest unfilled FVGs, latest sweep + structure shift ──
    const last = series.candles[series.candles.length - 1]?.close ?? 0;
    fvgsRef.current = detectFVGs(series.candles)
      .filter((f) => !f.filled)
      .sort((a, b) => Math.abs(a.mid - last) - Math.abs(b.mid - last))
      .slice(0, 4)
      .map((f) => ({ dir: f.dir, top: f.top, bottom: f.bottom, time: series.candles[f.index]?.time ?? last }));

    const liq = detectLiquidityLevels(series.candles);
    const sweep = findRecentSweep(series.candles, liq, 14);
    const mss = sweep ? detectStructureShift(series.candles, sweep.index, sweep.dir) : null;

    // markers: confirmed BUY/SELL events + the sweep
    const markers: SeriesMarker<Time>[] = events.slice(-6).map((e) => {
      const buy = e.state === "BUY" || e.state === "STRONG_BUY";
      return { time: e.time as Time, position: buy ? "belowBar" : "aboveBar", color: buy ? "#10e090" : "#ff3d5a", shape: buy ? "arrowUp" : "arrowDown", text: buy ? "BUY" : "SELL" };
    });
    if (sweep) {
      const swc = series.candles[sweep.index];
      if (swc) markers.push({ time: swc.time as Time, position: sweep.dir === "bullish" ? "belowBar" : "aboveBar", color: "#f0b429", shape: "circle", text: "SWEEP" });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    candle.setMarkers(markers);

    // dynamic price lines: Entry / SL / TP1 / TP2 + MSS
    for (const pl of dynLinesRef.current) candle.removePriceLine(pl);
    dynLinesRef.current = [];
    if (levels && levels.direction !== "flat") {
      const add = (price: number, color: string, title: string, style = 0) =>
        dynLinesRef.current.push(candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style as 0, axisLabelVisible: true, title }));
      add(levels.entry, "rgba(240,180,41,0.95)", "Entry");
      add(levels.stopLoss, "rgba(255,61,90,0.95)", "SL");
      add(levels.takeProfit1, "rgba(16,224,144,0.9)", "TP1", 2);
      add(levels.takeProfit2, "rgba(16,224,144,0.95)", "TP2");
    }
    if (mss) {
      dynLinesRef.current.push(candle.createPriceLine({ price: mss.brokenLevel, color: "rgba(168,130,255,0.9)", lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: "MSS" }));
    }

    chartRef.current?.timeScale().fitContent();
    requestAnimationFrame(drawOverlay);
  }, [series, events, levels]);

  // live price → grow the forming candle + keep FVG boxes aligned
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || !series || livePrice == null || !series.candles.length) return;
    const lc = series.candles[series.candles.length - 1];
    candle.update({ time: lc.time as Time, open: lc.open, high: Math.max(lc.high, livePrice), low: Math.min(lc.low, livePrice), close: livePrice });
    requestAnimationFrame(drawOverlay);
  }, [livePrice, series]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-10" />
    </div>
  );
}
