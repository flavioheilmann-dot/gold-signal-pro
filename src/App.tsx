import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Header } from "@/components/Header";
import type { DataMode, SourceInfo } from "@/components/DataSourceStatus";
import { NewsBanner } from "@/components/NewsBanner";
import { StrongAlert, type StrongAlertData } from "@/components/StrongAlert";
import { PositionAlert, type PositionAlertData } from "@/components/PositionAlert";
import { Watchlist } from "@/components/Watchlist";
import { SignalCard } from "@/components/SignalCard";
import { StrategyCheck } from "@/components/StrategyCheck";
import { TradingSetup } from "@/components/TradingSetup";
import { Sessions } from "@/components/Sessions";

import { AccountPanel } from "@/components/AccountPanel";
import { SignalHistory } from "@/components/SignalHistory";
import { SettingsPanel } from "@/components/SettingsPanel";
import { BrokerPanel } from "@/components/BrokerPanel";
import { StrategyStatsPanel } from "@/components/StrategyStatsPanel";
import { StrategyOptPanel } from "@/components/StrategyOptPanel";
import { EdgeDetection } from "@/components/EdgeDetection";
import { OvernightDrift } from "@/components/OvernightDrift";
import { TradingJournal } from "@/components/TradingJournal";
import { TradingDashboard } from "@/components/trading/TradingDashboard";
import { TrackRecord } from "@/components/trading/TrackRecord";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { fmtDateTime } from "@/lib/utils";

import { fetchMarket, type MarketData } from "@/lib/api";
import { getMarketStatus } from "@/lib/market";
import {
  computeSeries,
  decide,
  snapshotAt,
  levelsFor,
  factorsAt,
  stateLabel,
  backtestSignals,
  computeStats,
  walkForward,
  gradeStrategy,
  detectEdges,
  detectOvernightDrift,
  type Decision,
  type SignalEvent,
  type Snapshot,
  type StrategySeries,
  type FactorLean,
} from "@/lib/signalEngine";
import { computeOutlook, combineOutlook } from "@/lib/outlook";
import { GOLD_NEWS, newsBias } from "@/lib/news";
import { DEFAULT_SETTINGS, LS_KEYS, type AppSettings, type HistoryEntry } from "@/lib/config";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useInterval } from "@/hooks/useInterval";
import { useBroker } from "@/hooks/useBroker";
import { useScanner } from "@/hooks/useScanner";
import { useLiveQuote } from "@/hooks/useLiveQuote";
import { beep, ensureNotificationPermission, notify } from "@/lib/alerts";

const FALLBACK: Decision = { state: "WAIT", bias: "flat", confidence: 0, trend: "range", reason: "Lade Daten …" };
const NEWS_BULL = newsBias(GOLD_NEWS).bullPct;
const NEWS_LEAN: FactorLean = NEWS_BULL >= 56 ? "bull" : NEWS_BULL <= 44 ? "bear" : "neutral";

interface Active {
  name: string;
  epic: string;
  kind: "metal" | "index" | "forex" | "crypto" | "stock" | "commodity";
  series: StrategySeries;
  decision: Decision;
  events: SignalEvent[];
  snap: Snapshot;
  price: number;
  changePct: number;
  sourceLabel: string;
  note?: string;
}

export default function App() {
  const [settings, setSettings] = useLocalStorage<AppSettings>(LS_KEYS.settings, DEFAULT_SETTINGS);
  const [theme, setTheme] = useLocalStorage<"dark" | "light">(LS_KEYS.theme, "dark");

  const [data, setData] = useState<MarketData | null>(null); // public gold fallback
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(settings.refreshSec);
  const [now, setNow] = useState(() => new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedEpic, setSelectedEpic] = useState("GOLD");
  const [scanAt, setScanAt] = useState<number | null>(null);
  const [strongAlert, setStrongAlert] = useState<StrongAlertData | null>(null);
  const [posAlert, setPosAlert] = useState<PositionAlertData | null>(null);

  const { status: broker, account, positions, refresh: refreshBroker } = useBroker();
  const connected = !!broker?.connected;
  const { results: scan, scanning, refresh: refreshScan } = useScanner(connected, settings.params, 60000);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  useEffect(() => {
    if (settings.alarmOn) ensureNotificationPermission();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (scan.length) setScanAt(Date.now());
  }, [scan]);

  // ── gold public fallback (only used when not connected) ──
  const goldFallback = useMemo<Active | null>(() => {
    if (!data) return null;
    const series = computeSeries(data.candles, settings.params);
    const { current, events } = decide(series, settings.params);
    const snap = snapshotAt(series, series.prices.length - 1, settings.params);
    return {
      name: "Gold (Proxy)",
      epic: "GOLD",
      kind: "metal" as const,
      series,
      decision: current,
      events,
      snap,
      price: data.xau ?? data.paxg,
      changePct: data.changePct,
      sourceLabel: data.candleSource,
      note: "XAU/USD ≠ PAXG/USD – PAXG kann leicht abweichen",
    };
  }, [data, settings.params]);

  const selectedScan = connected
    ? scan.find((r) => r.asset.epic === selectedEpic) ?? scan[0]
    : undefined;

  const active = useMemo<Active | null>(() => {
    if (selectedScan)
      return {
        name: selectedScan.asset.name,
        epic: selectedScan.asset.epic,
        kind: selectedScan.asset.kind,
        series: selectedScan.series,
        decision: selectedScan.decision,
        events: selectedScan.events,
        snap: selectedScan.snap,
        price: selectedScan.price,
        changePct: selectedScan.changePct,
        sourceLabel: "Capital.com",
      };
    return goldFallback;
  }, [selectedScan, goldFallback]);

  const decision = active?.decision ?? FALLBACK;
  const snap = active?.snap ?? null;
  const factors = useMemo(() => (snap ? factorsAt(snap, settings.params, NEWS_LEAN) : []), [snap, settings.params]);
  const outlook = useMemo(() => {
    if (!snap) return null;
    return combineOutlook(computeOutlook(snap, settings.params).bullPct, NEWS_BULL);
  }, [snap, settings.params]);

  const levels = useMemo(
    () =>
      snap?.atr && active && decision.bias !== "flat"
        ? levelsFor(decision.state, active.price, snap.atr, settings.params)
        : null,
    [snap, active, decision.bias, decision.state, settings.params]
  );
  // strategy backtest (trades + stats + walk-forward), computed once
  const backtest = useMemo(() => {
    if (!active) return null;
    const trades = backtestSignals(active.series, active.events, settings.params);
    return { trades, stats: computeStats(trades), wf: walkForward(trades) };
  }, [active, settings.params]);
  const stratStats = backtest?.stats ?? null;

  // strategy optimization grade
  const stratGrade = useMemo(() => {
    if (!backtest || backtest.stats.totalTrades < 1) return null;
    return gradeStrategy(backtest.trades, backtest.stats, settings.params);
  }, [backtest, settings.params]);

  // edge detection
  const edges = useMemo(() => {
    if (!active) return [];
    return detectEdges(active.series, active.series.prices.length - 1);
  }, [active]);

  // overnight drift detection
  const overnightSetup = useMemo(() => {
    if (!active || !snap) return null;
    const utcHour = new Date().getUTCHours();
    const setup = detectOvernightDrift(snap, active.price, utcHour, active.kind as "index" | "metal" | "forex" | "crypto");
    if (setup) setup.asset = active.name;
    return setup;
  }, [active, snap]);

  const sizingLevels = useMemo(
    () => levels ?? (snap?.atr && active ? levelsFor("BUY", active.price, snap.atr, settings.params) : null),
    [levels, snap, active, settings.params]
  );

  const marketStatus = useMemo(() => getMarketStatus(now), [now]);
  // near-real-time quote for the active asset → live price + forming candle
  const liveQuote = useLiveQuote(active?.epic, connected && marketStatus.open);
  const livePrice = liveQuote && active && Math.abs(liveQuote.mid - active.price) / active.price < 0.1 ? liveQuote.mid : undefined;

  // history = the active asset's confirmed signal events
  const histEntries = useMemo<HistoryEntry[]>(
    () =>
      active
        ? [...active.events]
            .reverse()
            .slice(0, 6)
            .map((e) => ({ time: e.time * 1000, state: e.state, price: e.price, confidence: e.confidence }))
        : [],
    [active]
  );

  // ── refresh ────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    if (connected) {
      await refreshScan();
      refreshBroker();
    } else {
      setData(await fetchMarket());
    }
    setCountdown(settings.refreshSec);
    setLoading(false);
  }, [connected, refreshScan, refreshBroker, settings.refreshSec]);

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    fetchMarket().then(setData); // baseline gold while broker status loads
  }, []);

  useInterval(() => {
    setNow(new Date());
    setCountdown((c) => {
      if (c <= 1) {
        refresh();
        return settings.refreshSec;
      }
      return c - 1;
    });
  }, 1000);

  // Box-Strategie-Alarme bewusst DEAKTIVIERT — der User will ausschließlich
  // ICT-Signale erhalten. Die Box-Panels bleiben als stille Referenz erhalten,
  // lösen aber keine Banner/Beeps/ntfy-Pushes mehr aus. ICT alarmiert über die
  // Background Engine (in-App) bzw. den ICT-Cloud-Scanner (Handy).

  // ── open position vs. current signal → conspicuous warning ──
  const positionConflict = useMemo<PositionAlertData | null>(() => {
    if (!positions.length || !scan.length) return null;
    for (const pos of positions) {
      const r = scan.find((x) => x.asset.epic === pos.epic);
      if (!r || r.decision.bias === "flat") continue;
      const posLong = pos.direction === "BUY";
      if ((posLong && r.decision.bias === "short") || (!posLong && r.decision.bias === "long")) {
        return {
          epic: pos.epic,
          name: r.asset.name,
          posDirection: posLong ? "BUY" : "SELL",
          signalState: r.decision.state,
          pnl: pos.pnl,
        };
      }
    }
    return null;
  }, [positions, scan]);

  const posAlertedRef = useRef("");
  useEffect(() => {
    if (!positionConflict) {
      if (posAlertedRef.current) {
        posAlertedRef.current = "";
        setPosAlert(null);
      }
      return;
    }
    const key = `${positionConflict.epic}:${positionConflict.signalState}`;
    if (key === posAlertedRef.current) return;
    posAlertedRef.current = key;
    setPosAlert(positionConflict);
    if (settings.alarmOn) {
      beep(false);
      setTimeout(() => beep(false), 250);
      notify(
        `⚠️ ${positionConflict.name}: Gegensignal zu deiner Position`,
        `${positionConflict.posDirection === "BUY" ? "Long" : "Short"} — jetzt ${stateLabel(positionConflict.signalState)}. Prüfen/schließen.`
      );
    }
  }, [positionConflict, settings.alarmOn]);

  // flashing tab title while an alert is open
  useEffect(() => {
    if (!strongAlert) {
      document.title = "Gold Signal Pro — Trading Terminal";
      return;
    }
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 ${strongAlert.name} — STARKES SIGNAL` : "Gold Signal Pro";
    }, 900);
    return () => {
      clearInterval(id);
      document.title = "Gold Signal Pro — Trading Terminal";
    };
  }, [strongAlert]);

  // ── shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.toLowerCase() === "s") refresh();
      if (e.key.toLowerCase() === "a") setSettings((s) => ({ ...s, alarmOn: !s.alarmOn }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, setSettings]);

  const toggleAlarm = () => {
    const next = !settings.alarmOn;
    setSettings({ ...settings, alarmOn: next });
    if (next) {
      ensureNotificationPermission();
      beep(true);
    }
  };

  const exportCSV = () => {
    if (!histEntries.length) return;
    const head = ["Zeit", "Signal", "Preis", "Konfidenz_%"];
    const rows = histEntries.map((h) => [fmtDateTime(h.time), stateLabel(h.state), h.price.toFixed(2), h.confidence]);
    const csv = [head, ...rows].map((r) => r.join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    a.download = `GoldSignalPro_${active?.epic ?? "signale"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const ticker = {
    name: active ? `${active.name}` : "—",
    price: livePrice ?? active?.price ?? null,
    changePct: active?.changePct ?? 0,
    sourceLabel: active?.sourceLabel ?? "—",
    note: active?.note,
  };
  const dataMode: DataMode = connected
    ? "LIVE_CAPITAL"
    : !data
      ? "OFFLINE"
      : data.candleState === "sim"
        ? "SIMULATION"
        : data.xauState === "live"
          ? "LIVE_XAUUSD"
          : "LIVE_PAXG_PROXY";

  const timeframe = connected ? "15M" : data?.timeframe ?? "—";

  const source: SourceInfo = {
    mode: dataMode,
    sourceLabel: connected ? "Capital.com" : data?.candleSource ?? "—",
    timeframe,
    fetchedAt: connected ? liveQuote?.at ?? scanAt : data?.fetchedAt ?? null,
    refreshSec: settings.refreshSec,
    proxyNote:
      dataMode === "SIMULATION"
        ? "Demodaten – keine echten Kurse"
        : dataMode === "LIVE_PAXG_PROXY"
          ? "PAXG-Proxy statt XAU/USD"
          : undefined,
  };

  return (
    <div className="flex h-full flex-col">
      <PositionAlert
        alert={posAlert}
        onShow={(epic) => {
          setSelectedEpic(epic);
          setPosAlert(null);
        }}
        onDismiss={() => setPosAlert(null)}
      />

      <StrongAlert
        alert={strongAlert}
        onShow={(epic) => {
          setSelectedEpic(epic);
          setStrongAlert(null);
        }}
        onDismiss={() => setStrongAlert(null)}
      />

      <Header
        ticker={ticker}
        source={source}
        market={marketStatus}
        countdown={countdown}
        refreshSec={settings.refreshSec}
        loading={loading || scanning}
        alarmOn={settings.alarmOn}
        theme={theme}
        onRefresh={refresh}
        onToggleAlarm={toggleAlarm}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <NewsBanner outlook={outlook} />

      <main className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* primary — ICT ist jetzt die Hauptstrategie */}
        <div className="flex flex-col gap-4">
          {!marketStatus.open && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/30 bg-gold/5 px-4 py-2.5 text-xs">
              <span className="font-medium text-gold">🔒 Markt geschlossen — Analyse läuft auf vorhandenen Daten. Trades erst nach Öffnung.</span>
              {marketStatus.detail && <span className="mono text-muted-foreground">{marketStatus.detail}</span>}
            </div>
          )}

          <TradingDashboard defaultNtfyTopic={settings.ntfyTopic} theme={theme} />

          {/* Box-Strategie: nur noch stille Referenz, klappbar */}
          <details className="rounded-lg border border-border/50 bg-card/40">
            <summary className="cursor-pointer select-none px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
              Box-Strategie · nur Referenz (keine Alarme)
            </summary>
            <div className="flex flex-col gap-4 p-4 pt-0">
              {snap ? <SignalCard decision={decision} factors={factors} timeframe={timeframe} /> : <div className="skeleton h-40 w-full" />}
              <Card>
                <CardHeader>
                  <CardTitle>Trading-Setup · {active?.name ?? "—"}</CardTitle>
                </CardHeader>
                <CardContent>
                  {snap ? <TradingSetup decision={decision} levels={levels} timeframe={timeframe} /> : <div className="skeleton h-24 w-full" />}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <SignalHistory entries={histEntries} onExport={exportCSV} />
                </CardContent>
              </Card>
            </div>
          </details>
        </div>

        {/* sidebar */}
        <aside className="flex flex-col gap-4">
          <TrackRecord />

          <Card>
            <CardHeader>
              <CardTitle>Capital.com Konto</CardTitle>
            </CardHeader>
            <CardContent>
              <BrokerPanel status={broker} account={account} positions={positions} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Markt &amp; Zeiten</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Sessions now={now} status={marketStatus} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Position Size (lokal)</CardTitle>
            </CardHeader>
            <CardContent>
              {sizingLevels ? (
                <AccountPanel
                  capital={settings.capital}
                  riskPct={settings.riskPct}
                  levels={sizingLevels}
                  onCapital={(v) => setSettings({ ...settings, capital: v })}
                  onRisk={(v) => setSettings({ ...settings, riskPct: v })}
                />
              ) : (
                <div className="skeleton h-36 w-full" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trading-Journal</CardTitle>
            </CardHeader>
            <CardContent>
              <TradingJournal connected={connected} />
            </CardContent>
          </Card>

          {/* Box-Analyse: stille Referenz, klappbar */}
          <details className="rounded-lg border border-border/50 bg-card/40">
            <summary className="cursor-pointer select-none px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
              Box-Analyse · Referenz
            </summary>
            <div className="flex flex-col gap-4 p-4 pt-0">
              <Card>
                <CardHeader><CardTitle>Märkte-Scanner</CardTitle></CardHeader>
                <CardContent>
                  <Watchlist results={scan} selectedEpic={active?.epic ?? selectedEpic} onSelect={setSelectedEpic} scanning={scanning} connected={connected} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Strategie-Check · {active?.name ?? "—"}</CardTitle></CardHeader>
                <CardContent>
                  {snap ? (
                    <StrategyCheck factors={factors} strength={snap.strength} strengthMin={settings.params.strengthMin} outlook={outlook} />
                  ) : (
                    <div className="skeleton h-40 w-full" />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Backtest &amp; Monte Carlo · {active?.name ?? "—"}</CardTitle></CardHeader>
                <CardContent>
                  {stratStats ? (
                    <StrategyStatsPanel stats={stratStats} trades={backtest?.trades ?? []} wf={backtest?.wf ?? null} assetName={active?.name ?? "—"} />
                  ) : (
                    <div className="skeleton h-40 w-full" />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Edge-Erkennung · {active?.name ?? "—"}</CardTitle></CardHeader>
                <CardContent><EdgeDetection edges={edges} assetName={active?.name ?? "—"} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Strategie-Optimierung · {active?.name ?? "—"}</CardTitle></CardHeader>
                <CardContent><StrategyOptPanel grade={stratGrade} assetName={active?.name ?? "—"} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Overnight Drift · {active?.name ?? "—"}</CardTitle></CardHeader>
                <CardContent><OvernightDrift setup={overnightSetup} assetName={active?.name ?? "—"} /></CardContent>
              </Card>
            </div>
          </details>
        </aside>
      </main>

      <div className="shrink-0 border-t border-border bg-card/60 px-4 py-1.5 text-center font-mono text-[10px] text-muted-foreground">
        ICT-Strategie (TJR) · US100 + US500 · 5m-Setup + 1m-Entry · <kbd className="text-foreground">S</kbd> Refresh ·{" "}
        <kbd className="text-foreground">A</kbd> Alarm · Keine Anlageberatung
      </div>

      <SettingsPanel open={settingsOpen} settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
