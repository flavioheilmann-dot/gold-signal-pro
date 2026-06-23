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
import type { Candle } from "@/trading/types";
import { detectFVGs } from "@/trading/strategy/fvg";
import { detectLiquidityLevels } from "@/trading/strategy/liquidity";
import { findRecentSweep } from "@/trading/strategy/sweep";
import { detectStructureShift } from "@/trading/strategy/structure";
import { latestSessionRanges } from "@/trading/strategy/sessions";

export interface ChartLevels {
  direction: "long" | "short";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
}

interface Props {
  candles: Candle[];
  theme: "dark" | "light";
  livePrice?: number;
  levels?: ChartLevels | null;
  /** Changing this resets the zoom/pan (fit to content); same value preserves it. */
  symbol?: string;
}

interface FvgBox { dir: "bullish" | "bearish"; top: number; bottom: number; time: number }

/** Simple EMA over closes, null until the period fills. */
function emaSeries(candles: Candle[], period: number): LineData[] {
  const k = 2 / (period + 1);
  const out: LineData[] = [];
  let prev: number | null = null;
  candles.forEach((c, i) => {
    prev = prev == null ? c.close : c.close * k + prev * (1 - k);
    if (i >= period - 1) out.push({ time: c.time as Time, value: +prev.toFixed(2) });
  });
  return out;
}

// ICT day-trading candlestick chart, zoomable/pannable. Draws the ICT context
// directly on it: filled Fair-Value-Gap boxes, the most recent liquidity sweep
// marker, the market-structure-shift line, EMA21 and the active Entry/SL/TP.
export function ChartPanel({ candles, theme, livePrice, levels, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const dynLinesRef = useRef<IPriceLine[]>([]);
  const fvgsRef = useRef<FvgBox[]>([]);
  const asiaRef = useRef<{ high: number; low: number } | null>(null);
  const lastSymbolRef = useRef<string | undefined>(undefined);

  function drawOverlay() {
    const svg = svgRef.current, chart = chartRef.current, candle = candleRef.current, el = containerRef.current;
    if (!svg || !chart || !candle || !el) return;
    const ts = chart.timeScale();
    const right = ts.width();
    svg.setAttribute("width", String(el.clientWidth));
    svg.setAttribute("height", String(el.clientHeight));
    let html = "";
    // Asia-Range-Zone (TJR: London/NY greifen die Asia-Liquidität ab)
    if (asiaRef.current) {
      const yH = candle.priceToCoordinate(asiaRef.current.high);
      const yL = candle.priceToCoordinate(asiaRef.current.low);
      if (yH != null && yL != null) {
        const y = Math.min(yH, yL);
        const h = Math.max(1, Math.abs(yL - yH));
        html += `<rect x="0" y="${y.toFixed(1)}" width="${el.clientWidth}" height="${h.toFixed(1)}" fill="rgba(34,211,238,0.06)" stroke="none"/>`;
      }
    }
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
      // zoom + pan enabled (wheel, pinch, drag)
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor: "#10e090", downColor: "#ff3d5a",
      borderUpColor: "#10e090", borderDownColor: "#ff3d5a",
      wickUpColor: "rgba(16,224,144,0.7)", wickDownColor: "rgba(255,61,90,0.7)",
      priceLineColor: "rgba(240,180,41,0.6)",
    });
    emaRef.current = chart.addLineSeries({ color: "rgba(77,166,255,0.85)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    const ro = new ResizeObserver(() => requestAnimationFrame(drawOverlay));
    ro.observe(containerRef.current);
    chart.timeScale().subscribeVisibleTimeRangeChange(() => drawOverlay());

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null; candleRef.current = null; emaRef.current = null;
      dynLinesRef.current = []; fvgsRef.current = []; asiaRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ layout: { textColor: theme === "dark" ? "rgba(148,163,184,0.7)" : "rgba(74,90,114,0.9)" } });
  }, [theme]);

  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || !candles.length) return;

    candle.setData(candles.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    emaRef.current?.setData(emaSeries(candles, 21));

    // ── ICT context: nearest unfilled FVGs, latest sweep + structure shift ──
    const last = candles[candles.length - 1]?.close ?? 0;
    fvgsRef.current = detectFVGs(candles)
      .filter((f) => !f.filled)
      .sort((a, b) => Math.abs(a.mid - last) - Math.abs(b.mid - last))
      .slice(0, 4)
      .map((f) => ({ dir: f.dir, top: f.top, bottom: f.bottom, time: candles[f.index]?.time ?? last }));

    const liq = detectLiquidityLevels(candles);
    const sweep = findRecentSweep(candles, liq, 14);
    const mss = sweep ? detectStructureShift(candles, sweep.index, sweep.dir) : null;

    // Asia session range — the key TJR liquidity that London/NY sweep
    const asia = latestSessionRanges(candles).find((r) => r.session === "asia");
    asiaRef.current = asia ? { high: asia.high, low: asia.low } : null;

    const markers: SeriesMarker<Time>[] = [];
    if (sweep) {
      const swc = candles[sweep.index];
      if (swc) markers.push({ time: swc.time as Time, position: sweep.dir === "bullish" ? "belowBar" : "aboveBar", color: "#f0b429", shape: "circle", text: "SWEEP" });
    }
    candle.setMarkers(markers);

    // dynamic price lines: Entry / SL / TP1 / TP2 + MSS
    for (const pl of dynLinesRef.current) candle.removePriceLine(pl);
    dynLinesRef.current = [];
    if (levels) {
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
    // Asia high/low liquidity lines
    if (asia) {
      dynLinesRef.current.push(candle.createPriceLine({ price: asia.high, color: "rgba(34,211,238,0.9)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Asia H" }));
      dynLinesRef.current.push(candle.createPriceLine({ price: asia.low, color: "rgba(34,211,238,0.9)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Asia L" }));
    }

    // fit the view only on first load or when the instrument changes — otherwise
    // preserve the user's manual zoom/pan across the polling updates.
    if (symbol !== lastSymbolRef.current) {
      lastSymbolRef.current = symbol;
      chartRef.current?.timeScale().fitContent();
    }
    requestAnimationFrame(drawOverlay);
  }, [candles, levels, symbol]);

  // live price → grow the forming candle + keep FVG boxes aligned
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || livePrice == null || !candles.length) return;
    const lc = candles[candles.length - 1];
    candle.update({ time: lc.time as Time, open: lc.open, high: Math.max(lc.high, livePrice), low: Math.min(lc.low, livePrice), close: livePrice });
    requestAnimationFrame(drawOverlay);
  }, [livePrice, candles]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-10" />
    </div>
  );
}
