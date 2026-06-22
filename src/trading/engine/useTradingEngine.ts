import { useCallback, useEffect, useRef, useState } from "react";
import { BackgroundEngine, type EngineStatus, type EngineOptions, type PersistedEngine } from "./BackgroundEngine";
import { MockDataProvider } from "../data/MockDataProvider";
import { CapitalDataProvider } from "../data/CapitalDataProvider";
import type { DataProvider } from "../data/DataProvider";
import { DEFAULT_RISK, type PaperTrade, type RiskConfig } from "../types";
import { runBacktest, type BacktestResult } from "../backtest/backtest";
import { isIndexSymbol } from "../strategy/tjr";

const LS_KEY = "gsp_trading_engine_v1";
export type DataMode = "mock" | "capital";

function makeProvider(mode: DataMode): DataProvider {
  return mode === "capital" ? new CapitalDataProvider() : new MockDataProvider();
}

function load(): PersistedEngine {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") as PersistedEngine;
  } catch {
    return {};
  }
}

/**
 * React binding for the BackgroundEngine. Owns one engine instance, mirrors
 * its status into React state, and persists risk + paper state to localStorage.
 * Defaults to PAPER trading on simulated (mock) data — the safe mode.
 */
export function useTradingEngine(risk: RiskConfig = DEFAULT_RISK) {
  const engineRef = useRef<BackgroundEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [closed, setClosed] = useState<PaperTrade[]>([]);
  const [dataMode, setDataModeState] = useState<DataMode>("capital");
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtesting, setBacktesting] = useState(false);
  // symbol + timeframe + poll cadence survive a data-source rebuild via refs
  const [symbol, setSymbolUi] = useState("US100");
  const [timeframe, setTimeframeUi] = useState("5m");
  const [intervalMs, setIntervalUi] = useState(8000);
  const symbolRef = useRef("US100");
  const timeframeRef = useRef("5m");
  const intervalRef = useRef(8000);

  // build the engine (once, and whenever the data source changes)
  const build = useCallback(
    (mode: DataMode) => {
      const persisted = load();
      const eng = new BackgroundEngine(
        makeProvider(mode),
        risk,
        { symbol: symbolRef.current, timeframe: timeframeRef.current, intervalMs: intervalRef.current },
        persisted
      );
      eng.onUpdate = (s) => {
        setStatus(s);
        setClosed(eng.closedTrades());
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(eng.serialize()));
        } catch {
          /* ignore quota */
        }
      };
      engineRef.current = eng;
      setStatus(eng.status());
      setClosed(eng.closedTrades());
      return eng;
    },
    [risk]
  );

  useEffect(() => {
    const eng = build("capital");
    return () => eng.stop();
  }, [build]);

  const start = useCallback(() => engineRef.current?.start(), []);
  const stop = useCallback(() => engineRef.current?.stop(), []);

  const setOptions = useCallback((opts: Partial<EngineOptions>) => {
    engineRef.current?.setOptions(opts);
    setStatus(engineRef.current?.status() ?? null);
  }, []);

  const setSymbol = useCallback((sym: string) => {
    symbolRef.current = sym;
    setSymbolUi(sym);
    engineRef.current?.setOptions({ symbol: sym });
    setStatus(engineRef.current?.status() ?? null);
  }, []);

  const setTimeframe = useCallback((tf: string) => {
    timeframeRef.current = tf;
    setTimeframeUi(tf);
    engineRef.current?.setOptions({ timeframe: tf });
    setStatus(engineRef.current?.status() ?? null);
  }, []);

  const setIntervalMs = useCallback((ms: number) => {
    intervalRef.current = ms;
    setIntervalUi(ms);
    engineRef.current?.setOptions({ intervalMs: ms });
  }, []);

  const setDataMode = useCallback(
    (mode: DataMode) => {
      const wasRunning = engineRef.current?.isRunning();
      engineRef.current?.stop();
      const eng = build(mode);
      setDataModeState(mode);
      if (wasRunning) eng.start();
    },
    [build]
  );

  const resetPaper = useCallback(() => {
    engineRef.current?.stop();
    localStorage.removeItem(LS_KEY);
    const eng = build(dataMode);
    void eng;
  }, [build, dataMode]);

  const runBacktestNow = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    setBacktesting(true);
    try {
      const provider = makeProvider(dataMode);
      const sym = symbolRef.current;
      const tf = timeframeRef.current;
      const indexSym = isIndexSymbol(sym);
      const candles = await provider.getCandles(sym, tf, 600);
      const ltf = tf !== "1m" ? await provider.getCandles(sym, "1m", 1200) : undefined;
      const us100 = indexSym ? await provider.getCandles("US100", tf, 600) : [];
      const us500 = indexSym ? await provider.getCandles("US500", tf, 600) : [];
      // defer the heavy O(n²) pass so the UI thread can paint the spinner
      await new Promise((r) => setTimeout(r, 30));
      setBacktest(
        runBacktest(candles, sym, risk, undefined, {
          ltf: ltf && ltf.length ? ltf : undefined,
          indices: indexSym ? { us100, us500 } : undefined,
          isIndex: indexSym,
        })
      );
    } finally {
      setBacktesting(false);
    }
  }, [dataMode, risk]);

  return {
    status,
    closed,
    dataMode,
    symbol,
    timeframe,
    intervalMs,
    backtest,
    backtesting,
    start,
    stop,
    setOptions,
    setSymbol,
    setTimeframe,
    setIntervalMs,
    setDataMode,
    resetPaper,
    runBacktestNow,
  };
}
