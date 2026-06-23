import { useCallback, useEffect, useRef, useState } from "react";
import { BackgroundEngine, type EngineStatus, type EngineOptions, type PersistedEngine } from "./BackgroundEngine";
import { MockDataProvider } from "../data/MockDataProvider";
import { CapitalDataProvider } from "../data/CapitalDataProvider";
import type { DataProvider } from "../data/DataProvider";
import { DEFAULT_RISK, type ExitMode, type PaperTrade, type RiskConfig } from "../types";
import { runBacktest, type BacktestResult } from "../backtest/backtest";
import { DEFAULT_STRATEGY_OPTS } from "../strategy/StrategyEngine";
import { isIndexSymbol } from "../strategy/tjr";
import { profileFor } from "@/lib/assets";

const LS_KEY = "gsp_trading_engine_v1";
const AUTORUN_KEY = "gsp_engine_autorun_v1";
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
  // symbol + timeframe + poll cadence survive a data-source rebuild via refs.
  // Defaults = US100's TJR V2 profile (15m, session filter, long-only, trailing).
  const [symbol, setSymbolUi] = useState("US100");
  const [timeframe, setTimeframeUi] = useState("15m");
  const [intervalMs, setIntervalUi] = useState(8000);
  const symbolRef = useRef("US100");
  const timeframeRef = useRef("15m");
  const intervalRef = useRef(8000);
  // TJR V2 toggles (mirror EngineOptions; refs so the backtest can read them)
  const [longOnly, setLongOnlyUi] = useState(true);
  const [htfBiasFilter, setHtfBiasUi] = useState(false);
  const [requireKillzone, setKillzoneUi] = useState(true);
  const [exitMode, setExitModeUi] = useState<ExitMode>("trail");
  const longOnlyRef = useRef(true);
  const htfBiasRef = useRef(false);
  const killzoneRef = useRef(true);
  const exitModeRef = useRef<ExitMode>("trail");
  const riskPctRef = useRef(1);

  // build the engine (once, and whenever the data source changes)
  const build = useCallback(
    (mode: DataMode) => {
      const persisted = load();
      const eng = new BackgroundEngine(
        makeProvider(mode),
        risk,
        {
          symbol: symbolRef.current, timeframe: timeframeRef.current, intervalMs: intervalRef.current,
          mode: "v1", exitMode: exitModeRef.current, longOnly: longOnlyRef.current,
          htfBiasFilter: htfBiasRef.current, requireKillzone: killzoneRef.current, riskPct: riskPctRef.current,
        },
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

  // auto-run preference: the engine should run continuously by default ("die
  // Daten durchgehend laufen lassen"). Persisted so an explicit Stop survives a
  // reload, but a fresh install / cleared storage defaults to ON.
  const autorun = () => localStorage.getItem(AUTORUN_KEY) !== "0";
  const setAutorun = (on: boolean) => localStorage.setItem(AUTORUN_KEY, on ? "1" : "0");

  useEffect(() => {
    const eng = build("capital");
    if (autorun()) eng.start(); // start immediately so data flows without a manual click
    return () => eng.stop();
  }, [build]);

  const start = useCallback(() => { setAutorun(true); engineRef.current?.start(); }, []);
  const stop = useCallback(() => { setAutorun(false); engineRef.current?.stop(); }, []);

  const setOptions = useCallback((opts: Partial<EngineOptions>) => {
    engineRef.current?.setOptions(opts);
    setStatus(engineRef.current?.status() ?? null);
  }, []);

  const setSymbol = useCallback((sym: string) => {
    symbolRef.current = sym;
    setSymbolUi(sym);
    const patch: Partial<EngineOptions> = { symbol: sym };
    // apply the asset's TJR V2 profile (timeframe, session filter, long-only,
    // exit style, per-trade risk) so each instrument trades as the video found best
    const p = profileFor(sym);
    if (p) {
      timeframeRef.current = p.timeframe; setTimeframeUi(p.timeframe);
      longOnlyRef.current = p.longOnly; setLongOnlyUi(p.longOnly);
      killzoneRef.current = p.sessionFilter; setKillzoneUi(p.sessionFilter);
      exitModeRef.current = p.exit; setExitModeUi(p.exit);
      riskPctRef.current = p.riskPct;
      patch.timeframe = p.timeframe;
      patch.longOnly = p.longOnly;
      patch.requireKillzone = p.sessionFilter;
      patch.exitMode = p.exit;
      patch.riskPct = p.riskPct;
    }
    engineRef.current?.setOptions(patch);
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

  const setLongOnly = useCallback((v: boolean) => {
    longOnlyRef.current = v; setLongOnlyUi(v);
    engineRef.current?.setOptions({ longOnly: v });
  }, []);
  const setHtfBiasFilter = useCallback((v: boolean) => {
    htfBiasRef.current = v; setHtfBiasUi(v);
    engineRef.current?.setOptions({ htfBiasFilter: v });
  }, []);
  const setRequireKillzone = useCallback((v: boolean) => {
    killzoneRef.current = v; setKillzoneUi(v);
    engineRef.current?.setOptions({ requireKillzone: v });
  }, []);

  const setDataMode = useCallback(
    (mode: DataMode) => {
      const wasRunning = engineRef.current?.isRunning();
      engineRef.current?.stop();
      const eng = build(mode);
      setDataModeState(mode);
      if (wasRunning || autorun()) eng.start();
    },
    [build]
  );

  const resetPaper = useCallback(() => {
    engineRef.current?.stop();
    localStorage.removeItem(LS_KEY);
    const eng = build(dataMode);
    if (autorun()) eng.start(); // keep running after a reset
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
      const p = profileFor(sym);
      const btTf = p ? p.timeframe : tf;
      const candles = await provider.getCandles(sym, btTf, 600);
      const us100 = indexSym ? await provider.getCandles("US100", btTf, 600) : [];
      const us500 = indexSym ? await provider.getCandles("US500", btTf, 600) : [];
      const htf = htfBiasRef.current ? await provider.getCandles(sym, "1h", 400) : undefined;
      const btRisk = p ? { ...risk, riskPctPerTrade: p.riskPct } : risk;
      // defer the heavy O(n²) pass so the UI thread can paint the spinner
      await new Promise((r) => setTimeout(r, 30));
      setBacktest(
        runBacktest(
          candles, sym, btRisk,
          {
            ...DEFAULT_STRATEGY_OPTS,
            mode: "v1",
            exitMode: p ? p.exit : exitModeRef.current,
            longOnly: (p ? p.longOnly : longOnlyRef.current) && indexSym,
            requireKillzone: p ? p.sessionFilter : killzoneRef.current,
          },
          {
            indices: indexSym ? { us100, us500 } : undefined,
            isIndex: indexSym,
            htf: htf && htf.length ? htf : undefined,
          }
        )
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
    longOnly,
    htfBiasFilter,
    requireKillzone,
    exitMode,
    backtest,
    backtesting,
    start,
    stop,
    setOptions,
    setSymbol,
    setTimeframe,
    setIntervalMs,
    setLongOnly,
    setHtfBiasFilter,
    setRequireKillzone,
    setDataMode,
    resetPaper,
    runBacktestNow,
  };
}
