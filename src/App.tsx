import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "lucide-react";

import { Header } from "@/components/Header";
import type { DataMode, SourceInfo } from "@/components/DataSourceStatus";
import { NewsBanner } from "@/components/NewsBanner";
import { StrongAlert, type StrongAlertData } from "@/components/StrongAlert";
import { PositionAlert, type PositionAlertData } from "@/components/PositionAlert";
import { Watchlist } from "@/components/Watchlist";
import { SignalCard } from "@/components/SignalCard";
import { StrategyCheck } from "@/components/StrategyCheck";
import { ChartPanel } from "@/components/ChartPanel";
import { TradingSetup } from "@/components/TradingSetup";
import { HotSetupAlert } from "@/components/HotSetupAlert";
import { Sessions } from "@/components/Sessions";

import { AccountPanel } from "@/components/AccountPanel";
import { SignalHistory } from "@/components/SignalHistory";
import { SettingsPanel } from "@/components/SettingsPanel";
import { BrokerPanel } from "@/components/BrokerPanel";
import { OrderTicket } from "@/components/OrderTicket";
import { StrategyStatsPanel } from "@/components/StrategyStatsPanel";
import { StrategyOptPanel } from "@/components/StrategyOptPanel";
import { EdgeDetection } from "@/components/EdgeDetection";
import { OvernightDrift } from "@/components/OvernightDrift";
import { TradingJournal } from "@/components/TradingJournal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
import { beep, ensureNotificationPermission, notify, pushNtfy } from "@/lib/alerts";

const FALLBACK: Decision = { state: "WAIT", bias: "flat", confidence: 0, trend: "range", reason: "Lade Daten …" };
const NEWS_BULL = newsBias(GOLD_NEWS).bullPct;
const NEWS_LEAN: FactorLean = NEWS_BULL >= 56 ? "bull" : NEWS_BULL <= 44 ? "bear" : "neutral";
const HOT_MIN_CONF = 78;

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
  const [orderOpen, setOrderOpen] = useState(false);
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
  // strategy stats (backtest + Monte Carlo)
  const stratStats = useMemo(() => {
    if (!active) return null;
    const trades = backtestSignals(active.series, active.events, settings.params);
    return computeStats(trades);
  }, [active, settings.params]);

  // strategy optimization grade
  const stratGrade = useMemo(() => {
    if (!active || !stratStats || stratStats.totalTrades < 1) return null;
    const trades = backtestSignals(active.series, active.events, settings.params);
    return gradeStrategy(trades, stratStats, settings.params);
  }, [active, stratStats, settings.params]);

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
  const hot = decision.bias !== "flat" && decision.confidence >= HOT_MIN_CONF && !!levels;
  const canOrder = !!(broker?.connected && broker?.tradingEnabled && active);
  const orderDefaults =
    canOrder && active
      ? {
          epic: active.epic,
          direction: (decision.bias === "short" ? "SELL" : "BUY") as "BUY" | "SELL",
          size: 0.1,
          stopLevel: levels ? Math.round(levels.stopLoss) : snap?.atr ? Math.round(active.price - 1.5 * snap.atr) : 0,
          profitLevel: levels ? Math.round(levels.takeProfit1) : snap?.atr ? Math.round(active.price + 3 * snap.atr) : 0,
        }
      : null;

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

  // ── strong-setup detection → unmissable push ───────────
  const alertedRef = useRef("");
  useEffect(() => {
    if (!connected) return;
    const strong = scan.find((r) => r.decision.state === "STRONG_BUY" || r.decision.state === "STRONG_SELL");
    if (!strong) return;
    const key = `${strong.asset.epic}:${strong.decision.state}`;
    if (key === alertedRef.current) return;
    alertedRef.current = key;
    setStrongAlert({
      epic: strong.asset.epic,
      name: strong.asset.name,
      state: strong.decision.state,
      confidence: strong.decision.confidence,
    });
    if (settings.alarmOn) {
      const buy = strong.decision.state === "STRONG_BUY";
      beep(buy);
      setTimeout(() => beep(buy), 260);
      notify(`🔔 ${strong.asset.name}: ${stateLabel(strong.decision.state)}`, `${strong.decision.confidence}% Konfidenz · jetzt prüfen`);
    }
    if (settings.ntfyTopic) {
      const dir = strong.decision.state === "STRONG_BUY" ? "LONG" : "SHORT";
      const snap = snapshotAt(strong.series, strong.series.prices.length - 1, settings.params);
      const lvl = snap.atr ? levelsFor(strong.decision.state, strong.price, snap.atr, settings.params) : null;
      const lines = [
        `${dir} · ${strong.decision.confidence}% Konfidenz`,
        `Entry: ${strong.price.toFixed(2)}`,
        ...(lvl ? [
          `SL: ${lvl.stopLoss.toFixed(2)}`,
          `TP1: ${lvl.takeProfit1.toFixed(2)} (R:R 1:${lvl.rr1.toFixed(1)})`,
          `TP2: ${lvl.takeProfit2.toFixed(2)} (R:R 1:${lvl.rr2.toFixed(1)})`,
        ] : []),
        "Quelle: Capital.com · 15M",
        "Kein Finanzrat – zuerst selbst prüfen.",
      ];
      const tag = strong.decision.state === "STRONG_BUY" ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
      pushNtfy(settings.ntfyTopic, `🔔 ${strong.asset.name}: ${dir}`, lines.join("\n"), [tag, "rotating_light"]);
    }
  }, [scan, connected, settings.alarmOn, settings.ntfyTopic]);

  // ── overnight drift push notification ─────────────────────
  const overnightPushedRef = useRef("");
  useEffect(() => {
    if (!settings.ntfyTopic || !overnightSetup || !overnightSetup.windowOpen) return;
    if (overnightSetup.confidence < 60) return;
    const key = `overnight:${overnightSetup.asset}:${new Date().toDateString()}`;
    if (key === overnightPushedRef.current) return;
    overnightPushedRef.current = key;
    const dir = overnightSetup.direction === "long" ? "LONG" : "SHORT";
    const lines = [
      `${dir} · ${overnightSetup.confidence}% Konfidenz`,
      `Entry: ${overnightSetup.entry.toFixed(2)}`,
      `SL: ${overnightSetup.stopLoss.toFixed(2)}`,
      `TP: ${overnightSetup.takeProfit.toFixed(2)}`,
      "",
      overnightSetup.reasons.join("\n"),
      "",
      "⏰ Einstiegsfenster: 22:00–01:00 MESZ",
    ];
    const tag = overnightSetup.direction === "long" ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
    pushNtfy(settings.ntfyTopic, `🌙 Overnight ${dir}: ${overnightSetup.asset}`, lines.join("\n"), ["crescent_moon", tag]);
    if (settings.alarmOn) {
      notify(`🌙 Overnight Drift: ${overnightSetup.asset}`, `${overnightSetup.confidence}% Konfidenz — Fenster offen`);
    }
  }, [overnightSetup, settings.ntfyTopic, settings.alarmOn]);

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
    price: active?.price ?? null,
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
    fetchedAt: connected ? scanAt : data?.fetchedAt ?? null,
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
        {/* primary */}
        <div className="flex flex-col gap-4">
          {hot && levels && <HotSetupAlert decision={decision} levels={levels} marketOpen={marketStatus.open} />}

          {snap ? <SignalCard decision={decision} factors={factors} /> : <div className="skeleton h-40 w-full" />}

          {!marketStatus.open && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/30 bg-gold/5 px-4 py-2.5 text-xs">
              <span className="font-medium text-gold">🔒 Markt geschlossen — Analyse läuft auf vorhandenen Daten. Trades erst nach Öffnung.</span>
              {marketStatus.detail && <span className="mono text-muted-foreground">{marketStatus.detail}</span>}
            </div>
          )}

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-1.5">
                <LineChart className="h-3.5 w-3.5" /> {active?.name ?? "—"} · {timeframe} {connected ? "Day-Chart" : "Proxy-Chart"}
              </CardTitle>
              <div className="hidden items-center gap-3 font-mono text-[10px] text-muted-foreground sm:flex">
                <span className="text-gold">Preis</span>
                <span className="text-info">EMA21</span>
                <span className="text-gold">Box</span>
                <span>▲▼ Signale</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative h-[300px] w-full sm:h-[340px]">
                {active ? (
                  <ChartPanel series={active.series} events={active.events} theme={theme} />
                ) : (
                  <div className="skeleton h-full w-full" />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Trading-Setup · {active?.name ?? "—"}</CardTitle>
              {canOrder ? (
                <Button size="sm" variant={decision.bias === "short" ? "down" : "up"} onClick={() => setOrderOpen(true)}>
                  {levels ? "Order vorbereiten →" : "Order manuell →"}
                </Button>
              ) : broker?.connected && !broker?.tradingEnabled ? (
                <span className="font-mono text-[10px] text-muted-foreground">Orders aus (.env)</span>
              ) : null}
            </CardHeader>
            <CardContent>
              {snap ? <TradingSetup decision={decision} levels={levels} /> : <div className="skeleton h-24 w-full" />}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <SignalHistory entries={histEntries} onExport={exportCSV} />
            </CardContent>
          </Card>
        </div>

        {/* sidebar */}
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Märkte-Scanner</CardTitle>
            </CardHeader>
            <CardContent>
              <Watchlist results={scan} selectedEpic={active?.epic ?? selectedEpic} onSelect={setSelectedEpic} scanning={scanning} connected={connected} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strategie-Check · {active?.name ?? "—"}</CardTitle>
            </CardHeader>
            <CardContent>
              {snap ? (
                <StrategyCheck factors={factors} strength={snap.strength} strengthMin={settings.params.strengthMin} outlook={outlook} />
              ) : (
                <div className="skeleton h-40 w-full" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Backtest &amp; Monte Carlo · {active?.name ?? "—"}</CardTitle>
            </CardHeader>
            <CardContent>
              {stratStats ? (
                <StrategyStatsPanel stats={stratStats} assetName={active?.name ?? "—"} />
              ) : (
                <div className="skeleton h-40 w-full" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Edge-Erkennung · {active?.name ?? "—"}</CardTitle>
            </CardHeader>
            <CardContent>
              <EdgeDetection edges={edges} assetName={active?.name ?? "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strategie-Optimierung · {active?.name ?? "—"}</CardTitle>
            </CardHeader>
            <CardContent>
              <StrategyOptPanel grade={stratGrade} assetName={active?.name ?? "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Overnight Drift · {active?.name ?? "—"}</CardTitle>
            </CardHeader>
            <CardContent>
              <OvernightDrift setup={overnightSetup} assetName={active?.name ?? "—"} />
            </CardContent>
          </Card>

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
              <CardTitle>Trading-Journal</CardTitle>
            </CardHeader>
            <CardContent>
              <TradingJournal connected={connected} />
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
        </aside>
      </main>

      <div className="shrink-0 border-t border-border bg-card/60 px-4 py-1.5 text-center font-mono text-[10px] text-muted-foreground">
        Multi-Asset Day-Trading · {timeframe} Box-System + EMA 9/21/50 + MACD + RSI · <kbd className="text-foreground">S</kbd> Refresh ·{" "}
        <kbd className="text-foreground">A</kbd> Alarm · Keine Anlageberatung
      </div>

      <SettingsPanel open={settingsOpen} settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />

      {orderDefaults && (
        <OrderTicket
          open={orderOpen}
          env={broker?.env ?? "demo"}
          defaults={orderDefaults}
          onClose={() => setOrderOpen(false)}
          onPlaced={() => {
            refreshBroker();
            setTimeout(() => setOrderOpen(false), 1500);
          }}
        />
      )}
    </div>
  );
}
