export interface LiveNewsItem {
  title: string;
  description: string;
  pubDate: string;
  link: string;
  titleDe?: string;
  goldImpact?: { direction: "up" | "down" | "neutral"; hint: string };
}

// Phrases first (multi-word), then single words — order matters
const TRANSLATE: [RegExp, string][] = [
  // ── Phrases (must come before single-word rules) ──
  [/\bstock market\b/gi, "Aktienmarkt"],
  [/\bstock exchange\b/gi, "Boerse"],
  [/\bwall street\b/gi, "Wall Street"],
  [/\brate(?:s)? cut(?:s)?\b/gi, "Zinssenkung"],
  [/\brate(?:s)? hike(?:s)?\b/gi, "Zinserhoehung"],
  [/\binterest rate(?:s)?\b/gi, "Zinsen"],
  [/\btrade war\b/gi, "Handelskrieg"],
  [/\btrade deal\b/gi, "Handelsabkommen"],
  [/\btrade deficit\b/gi, "Handelsdefizit"],
  [/\bretail sales\b/gi, "Einzelhandelsumsaetze"],
  [/\bconsumer price(?:s)?\b/gi, "Verbraucherpreise"],
  [/\bconsumer spending\b/gi, "Konsumausgaben"],
  [/\bconsumer confidence\b/gi, "Verbrauchervertrauen"],
  [/\bconsumer sentiment\b/gi, "Verbraucherstimmung"],
  [/\bcrude oil\b/gi, "Rohoel"],
  [/\bnatural gas\b/gi, "Erdgas"],
  [/\breal estate\b/gi, "Immobilien"],
  [/\bhousing market\b/gi, "Immobilienmarkt"],
  [/\bhousing starts\b/gi, "Baubeginne"],
  [/\bbuilding permits\b/gi, "Baugenehmigungen"],
  [/\bjobless claims\b/gi, "Arbeitslosenmeldungen"],
  [/\bjob growth\b/gi, "Stellenwachstum"],
  [/\bjob market\b/gi, "Arbeitsmarkt"],
  [/\bnon-?farm payrolls?\b/gi, "US-Arbeitsmarktbericht"],
  [/\blabor market\b/gi, "Arbeitsmarkt"],
  [/\bcentral bank(?:s)?\b/gi, "Zentralbank"],
  [/\bfiscal policy\b/gi, "Fiskalpolitik"],
  [/\bmonetary policy\b/gi, "Geldpolitik"],
  [/\bquantitative easing\b/gi, "Quantitative Lockerung"],
  [/\bsupply chain(?:s)?\b/gi, "Lieferkette"],
  [/\bbig tech\b/gi, "Big Tech"],
  [/\btech stocks?\b/gi, "Tech-Aktien"],
  [/\bgrowth stocks?\b/gi, "Wachstumsaktien"],
  [/\bvalue stocks?\b/gi, "Substanzaktien"],
  [/\bblue chip(?:s)?\b/gi, "Blue Chips"],
  [/\bmarket cap\b/gi, "Marktkapitalisierung"],
  [/\bprofit margin(?:s)?\b/gi, "Gewinnmarge"],
  [/\bnet income\b/gi, "Nettogewinn"],
  [/\bgross domestic product\b/gi, "BIP"],
  [/\byear[\s-]over[\s-]year\b/gi, "im Jahresvergleich"],
  [/\bmonth[\s-]over[\s-]month\b/gi, "im Monatsvergleich"],
  [/\ball[\s-]time high\b/gi, "Allzeithoch"],
  [/\ball[\s-]time low\b/gi, "Allzeittief"],
  [/\bprice target(?:s)?\b/gi, "Kursziel"],
  [/\bshort selling\b/gi, "Leerverkauf"],
  [/\bshort squeeze\b/gi, "Short Squeeze"],
  [/\binsider trading\b/gi, "Insiderhandel"],
  [/\bmarket rally\b/gi, "Kursrally"],
  [/\bmarket crash\b/gi, "Markt-Crash"],
  [/\bmarket correction\b/gi, "Korrektur"],
  [/\bmarket volatility\b/gi, "Marktvolatilitaet"],
  [/\bmarket sentiment\b/gi, "Marktstimmung"],
  [/\bsafe haven\b/gi, "Sicherer Hafen"],
  [/\brisk appetite\b/gi, "Risikobereitschaft"],
  [/\brisk[\s-]off\b/gi, "risikoavers"],
  [/\brisk[\s-]on\b/gi, "risikofreudig"],
  [/\bdebt ceiling\b/gi, "Schuldenobergrenze"],
  [/\bnational debt\b/gi, "Staatsverschuldung"],
  [/\bgovernment shutdown\b/gi, "Regierungsstillstand"],
  [/\bemerging markets?\b/gi, "Schwellenlaender"],
  [/\bdeveloped markets?\b/gi, "Industrielaender"],
  [/\bforeign exchange\b/gi, "Devisenmarkt"],
  [/\bcurrency pair(?:s)?\b/gi, "Waehrungspaar"],
  [/\bbitcoin halving\b/gi, "Bitcoin-Halving"],
  [/\bon track\b/gi, "auf Kurs"],
  [/\bahead of\b/gi, "vor"],
  [/\bin the wake of\b/gi, "nach"],
  [/\bin response to\b/gi, "als Reaktion auf"],
  [/\bdue to\b/gi, "wegen"],
  [/\bdespite\b/gi, "trotz"],
  [/\bamid\b/gi, "inmitten"],
  [/\baccording to\b/gi, "laut"],
  [/\bas (?:the )?(?:U\.?S\.?|US)\b/gi, "waehrend die USA"],
  [/\bthis week\b/gi, "diese Woche"],
  [/\bnext week\b/gi, "naechste Woche"],
  [/\blast week\b/gi, "letzte Woche"],
  [/\bthis year\b/gi, "dieses Jahr"],
  [/\bnext year\b/gi, "naechstes Jahr"],
  [/\blast year\b/gi, "letztes Jahr"],
  [/\bfor the first time\b/gi, "zum ersten Mal"],
  [/\bmore than\b/gi, "mehr als"],
  [/\bless than\b/gi, "weniger als"],
  [/\bat least\b/gi, "mindestens"],
  [/\bso far\b/gi, "bisher"],
  // ── Verbs / actions ──
  [/\brises?\b/gi, "steigt"],
  [/\brose\b/gi, "stieg"],
  [/\brising\b/gi, "steigend"],
  [/\bfalls?\b/gi, "faellt"],
  [/\bfell\b/gi, "fiel"],
  [/\bfalling\b/gi, "fallend"],
  [/\bdrops?\b/gi, "faellt"],
  [/\bdropped\b/gi, "fiel"],
  [/\bsurges?\b/gi, "steigt stark"],
  [/\bsurged\b/gi, "stieg stark"],
  [/\bsurging\b/gi, "stark steigend"],
  [/\bslumps?\b/gi, "bricht ein"],
  [/\bslumped\b/gi, "brach ein"],
  [/\bsinks?\b/gi, "sinkt"],
  [/\bsank\b/gi, "sank"],
  [/\bsoars?\b/gi, "steigt stark"],
  [/\bsoared\b/gi, "stieg stark"],
  [/\bsoaring\b/gi, "stark steigend"],
  [/\bhits?\b/gi, "erreicht"],
  [/\bclimbs?\b/gi, "klettert"],
  [/\bclimbed\b/gi, "kletterte"],
  [/\bplunges?\b/gi, "stuerzt ab"],
  [/\bplunged\b/gi, "stuerzte ab"],
  [/\bplunging\b/gi, "abstuerzend"],
  [/\btumbles?\b/gi, "stuerzt"],
  [/\btumbled\b/gi, "stuerzte"],
  [/\bdips?\b/gi, "sackt ab"],
  [/\bdipped\b/gi, "sackte ab"],
  [/\bslides?\b/gi, "rutscht"],
  [/\bslid\b/gi, "rutschte"],
  [/\bsliding\b/gi, "rutschend"],
  [/\brebounds?\b/gi, "erholt sich"],
  [/\brebounded\b/gi, "erholte sich"],
  [/\brecovers?\b/gi, "erholt sich"],
  [/\brecovered\b/gi, "erholte sich"],
  [/\brecovery\b/gi, "Erholung"],
  [/\bstalls?\b/gi, "stagniert"],
  [/\bstalled\b/gi, "stagnierte"],
  [/\bsettles?\b/gi, "pendelt sich ein"],
  [/\bsettled\b/gi, "pendelte sich ein"],
  [/\beases?\b/gi, "entspannt sich"],
  [/\beased\b/gi, "entspannte sich"],
  [/\beasing\b/gi, "Lockerung"],
  [/\btightens?\b/gi, "verschaerft"],
  [/\btightened\b/gi, "verschaerfte"],
  [/\btightening\b/gi, "Verschaerfung"],
  [/\bboosts?\b/gi, "beflügelt"],
  [/\bboosted\b/gi, "befluegelte"],
  [/\bweighs? on\b/gi, "belastet"],
  [/\bweighed on\b/gi, "belastete"],
  [/\bcuts?\b/gi, "senkt"],
  [/\braised?\b/gi, "erhoeht"],
  [/\bexpects?\b/gi, "erwartet"],
  [/\bexpected\b/gi, "erwartet"],
  [/\bforecasts?\b/gi, "prognostiziert"],
  [/\breports?\b/gi, "berichtet"],
  [/\breported\b/gi, "berichtete"],
  [/\breporting\b/gi, "berichtet"],
  [/\bannounces?\b/gi, "kuendigt an"],
  [/\bannounced\b/gi, "kuendigte an"],
  [/\bwarns?\b/gi, "warnt"],
  [/\bwarned\b/gi, "warnte"],
  [/\bsays?\b/gi, "sagt"],
  [/\bsaid\b/gi, "sagte"],
  [/\bbets?\b/gi, "wettet auf"],
  [/\bbetting\b/gi, "wetten auf"],
  [/\bsignals?\b/gi, "signalisiert"],
  [/\bsignaled\b/gi, "signalisierte"],
  [/\bbeat(?:s|en)?\b/gi, "uebertrifft"],
  [/\bmissed?\b/gi, "verfehlt"],
  [/\bpledges?\b/gi, "verspricht"],
  [/\bpledged\b/gi, "versprach"],
  [/\bvows?\b/gi, "schwört"],
  [/\brules? out\b/gi, "schliesst aus"],
  [/\bholds?\b/gi, "haelt"],
  [/\bheld\b/gi, "hielt"],
  [/\bpauses?\b/gi, "pausiert"],
  [/\bpaused\b/gi, "pausierte"],
  [/\bdelays?\b/gi, "verzoegert"],
  [/\bdelayed\b/gi, "verzoegerte"],
  [/\btargets?\b/gi, "zielt auf"],
  [/\bseeks?\b/gi, "strebt an"],
  [/\bbuys?\b/gi, "kauft"],
  [/\bbought\b/gi, "kaufte"],
  [/\bsells?\b/gi, "verkauft"],
  [/\bsold\b/gi, "verkaufte"],
  [/\blaunches?\b/gi, "startet"],
  [/\blaunched\b/gi, "startete"],
  [/\breveals?\b/gi, "enthuellt"],
  [/\brevealed\b/gi, "enthuellte"],
  [/\bfaces?\b/gi, "steht vor"],
  [/\bfacing\b/gi, "steht vor"],
  // ── Nouns / finance ──
  [/\bstock(?:s)?\b/gi, "Aktien"],
  [/\bshare(?:s)?\b/gi, "Aktien"],
  [/\bmarket(?:s)?\b/gi, "Markt"],
  [/\bindex\b/gi, "Index"],
  [/\bindices\b/gi, "Indizes"],
  [/\bfuture(?:s)?\b/gi, "Futures"],
  [/\boption(?:s)?\b/gi, "Optionen"],
  [/\bhigh\b/gi, "Hoch"],
  [/\blow\b/gi, "Tief"],
  [/\brecord\b/gi, "Rekord"],
  [/\bearnings\b/gi, "Quartalszahlen"],
  [/\bprofit(?:s)?\b/gi, "Gewinn"],
  [/\brevenue\b/gi, "Umsatz"],
  [/\bsales\b/gi, "Umsatz"],
  [/\binflation\b/gi, "Inflation"],
  [/\bdeflation\b/gi, "Deflation"],
  [/\bstagflation\b/gi, "Stagflation"],
  [/\bFed\b/g, "Fed"],
  [/\bECB\b/g, "EZB"],
  [/\btreasury\b/gi, "Staatsanleihen"],
  [/\bbond(?:s)?\b/gi, "Anleihen"],
  [/\byield(?:s)?\b/gi, "Rendite"],
  [/\bspread(?:s)?\b/gi, "Spread"],
  [/\boil\b/gi, "Oel"],
  [/\bgold\b/gi, "Gold"],
  [/\bsilver\b/gi, "Silber"],
  [/\bcopper\b/gi, "Kupfer"],
  [/\bplatinum\b/gi, "Platin"],
  [/\bdollar\b/gi, "Dollar"],
  [/\beuro\b/gi, "Euro"],
  [/\byen\b/gi, "Yen"],
  [/\bpound\b/gi, "Pfund"],
  [/\byuan\b/gi, "Yuan"],
  [/\btariff(?:s)?\b/gi, "Zoelle"],
  [/\bsanction(?:s)?\b/gi, "Sanktionen"],
  [/\bjobs?\b/gi, "Arbeitsplaetze"],
  [/\bunemployment\b/gi, "Arbeitslosigkeit"],
  [/\bCPI\b/g, "Verbraucherpreise"],
  [/\bPPI\b/g, "Erzeugerpreise"],
  [/\bGDP\b/g, "BIP"],
  [/\bPMI\b/g, "Einkaufsmanagerindex"],
  [/\bhousing\b/gi, "Immobilien"],
  [/\brecession\b/gi, "Rezession"],
  [/\bdownturn\b/gi, "Abschwung"],
  [/\bupturn\b/gi, "Aufschwung"],
  [/\bboom\b/gi, "Boom"],
  [/\bbust\b/gi, "Absturz"],
  [/\brally\b/gi, "Rally"],
  [/\bbull(?:ish)?\b/gi, "bullisch"],
  [/\bbear(?:ish)?\b/gi, "baerisch"],
  [/\bwarning\b/gi, "Warnung"],
  [/\bcrisis\b/gi, "Krise"],
  [/\bdefault\b/gi, "Zahlungsausfall"],
  [/\bbankruptcy\b/gi, "Insolvenz"],
  [/\blayoff(?:s)?\b/gi, "Entlassungen"],
  [/\bhiring\b/gi, "Einstellungen"],
  [/\bmerger(?:s)?\b/gi, "Fusion"],
  [/\bacquisition(?:s)?\b/gi, "Uebernahme"],
  [/\bIPO\b/g, "Boersengang"],
  [/\bbuyback(?:s)?\b/gi, "Aktienrueckkauf"],
  [/\bdividend(?:s)?\b/gi, "Dividende"],
  [/\bguidance\b/gi, "Ausblick"],
  [/\boutlook\b/gi, "Ausblick"],
  [/\bforecast\b/gi, "Prognose"],
  [/\bestimate(?:s)?\b/gi, "Schaetzung"],
  [/\banalyst(?:s)?\b/gi, "Analyst"],
  [/\binvestor(?:s)?\b/gi, "Anleger"],
  [/\btrader(?:s)?\b/gi, "Haendler"],
  [/\bhedge fund(?:s)?\b/gi, "Hedgefonds"],
  [/\bmutual fund(?:s)?\b/gi, "Investmentfonds"],
  [/\bETF(?:s)?\b/g, "ETF"],
  [/\bcrypto(?:currency)?\b/gi, "Krypto"],
  [/\bbitcoin\b/gi, "Bitcoin"],
  [/\bethereum\b/gi, "Ethereum"],
  [/\bblockchain\b/gi, "Blockchain"],
  [/\bAI\b/g, "KI"],
  [/\bartificial intelligence\b/gi, "Kuenstliche Intelligenz"],
  [/\bchip(?:s)?\b/gi, "Chips"],
  [/\bsemiconductor(?:s)?\b/gi, "Halbleiter"],
  [/\bregulation(?:s)?\b/gi, "Regulierung"],
  [/\bpolicy\b/gi, "Politik"],
  [/\btrade\b/gi, "Handel"],
  [/\btrading\b/gi, "Handel"],
  [/\bgrowth\b/gi, "Wachstum"],
  [/\bdecline\b/gi, "Rueckgang"],
  [/\bgains?\b/gi, "Gewinne"],
  [/\blosse?s?\b/gi, "Verluste"],
  [/\bvolatility\b/gi, "Volatilitaet"],
  [/\buncertainty\b/gi, "Unsicherheit"],
  [/\bconfidence\b/gi, "Vertrauen"],
  [/\bdemand\b/gi, "Nachfrage"],
  [/\bsupply\b/gi, "Angebot"],
  [/\bshortage(?:s)?\b/gi, "Engpass"],
  [/\bsurplus\b/gi, "Ueberschuss"],
  [/\bdebt\b/gi, "Schulden"],
  [/\bspending\b/gi, "Ausgaben"],
  [/\bbudget\b/gi, "Haushalt"],
  [/\btax(?:es)?\b/gi, "Steuern"],
  [/\btax cut(?:s)?\b/gi, "Steuersenkung"],
  [/\bstimulus\b/gi, "Konjunkturpaket"],
  [/\bbailout\b/gi, "Rettungspaket"],
  [/\bsubsidy\b/gi, "Subvention"],
  [/\bsubsidies\b/gi, "Subventionen"],
  [/\binvestment(?:s)?\b/gi, "Investition"],
  [/\bcapital\b/gi, "Kapital"],
  [/\brisk(?:s)?\b/gi, "Risiko"],
  [/\bwar\b/gi, "Krieg"],
  [/\bconflict\b/gi, "Konflikt"],
  [/\btension(?:s)?\b/gi, "Spannungen"],
  [/\belection(?:s)?\b/gi, "Wahlen"],
  [/\bpresident\b/gi, "Praesident"],
  [/\bgovernment\b/gi, "Regierung"],
  [/\bCongress\b/gi, "Kongress"],
  [/\bSenate\b/gi, "Senat"],
  [/\bChina\b/g, "China"],
  [/\bEurope\b/gi, "Europa"],
  [/\bJapan\b/g, "Japan"],
  [/\bUK\b/g, "GB"],
  // ── Adjectives / adverbs (only content-relevant ones) ──
  [/\btoday\b/gi, "heute"],
  [/\btomorrow\b/gi, "morgen"],
  [/\byesterday\b/gi, "gestern"],
  [/\babove\b/gi, "ueber"],
  [/\bbelow\b/gi, "unter"],
  [/\bnear\b/gi, "nahe"],
  [/\bnew\b/gi, "neu"],
  [/\bstrong\b/gi, "stark"],
  [/\bweak\b/gi, "schwach"],
  [/\bsharp\b/gi, "scharf"],
  [/\bsteady\b/gi, "stabil"],
  [/\bglobal\b/gi, "global"],
  [/\bworst\b/gi, "schlechteste"],
  [/\bbest\b/gi, "beste"],
  [/\bbiggest\b/gi, "groesste"],
  [/\bhighest\b/gi, "hoechste"],
  [/\blowest\b/gi, "niedrigste"],
  [/\blargest\b/gi, "groesste"],
  [/\bwhy\b/gi, "warum"],
];

function roughTranslate(text: string): string {
  let out = text;
  for (const [re, de] of TRANSLATE) out = out.replace(re, de);
  return out;
}

interface GoldHint { direction: "up" | "down" | "neutral"; hint: string }

const GOLD_KEYWORDS: [RegExp, GoldHint][] = [
  [/rate.?cut|dovish|easing/i, { direction: "up", hint: "Zinssenkung → Dollar schwaecher → Gold steigt" }],
  [/rate.?hike|hawkish|tighten/i, { direction: "down", hint: "Zinserhoehung → Dollar staerker → Gold faellt" }],
  [/inflation.*(rise|surge|high|hot)/i, { direction: "up", hint: "Hohe Inflation → Gold als Schutz gefragt" }],
  [/inflation.*(cool|slow|low|ease)/i, { direction: "down", hint: "Sinkende Inflation → weniger Bedarf an Gold" }],
  [/recession|crisis|crash|fear|risk/i, { direction: "up", hint: "Unsicherheit/Krise → Flucht in Gold" }],
  [/strong.?dollar|dollar.*(rise|surge|rally)/i, { direction: "down", hint: "Starker Dollar → Gold wird teurer in anderen Waehrungen" }],
  [/weak.?dollar|dollar.*(fall|drop|sink)/i, { direction: "up", hint: "Schwacher Dollar → Gold steigt" }],
  [/war|conflict|geopolit|sanction|tension/i, { direction: "up", hint: "Geopolitische Spannungen → Safe-Haven Gold" }],
  [/tariff|trade.?war/i, { direction: "up", hint: "Handelskrieg → Unsicherheit → Gold profitiert" }],
  [/gold.*(rise|surge|rally|high|record)/i, { direction: "up", hint: "Gold direkt im Aufwaertstrend" }],
  [/gold.*(fall|drop|sink|low|slip)/i, { direction: "down", hint: "Gold direkt unter Druck" }],
  [/jobs.*(strong|beat|surge)|unemployment.*(fall|low)/i, { direction: "down", hint: "Starker Arbeitsmarkt → Fed bleibt hart → Gold unter Druck" }],
  [/jobs.*(weak|miss|disappoint)|unemployment.*(rise|high)/i, { direction: "up", hint: "Schwacher Arbeitsmarkt → Zinssenkung wahrscheinlicher → Gold steigt" }],
  [/retail.?sales.*(beat|strong|surge)/i, { direction: "down", hint: "Starker Konsum → weniger Zinssenkung → Gold faellt" }],
  [/retail.?sales.*(miss|weak|drop)/i, { direction: "up", hint: "Schwacher Konsum → Zinssenkung naeher → Gold steigt" }],
  [/treasury.*(rise|surge|yield)/i, { direction: "down", hint: "Steigende Anleiherenditen → Gold weniger attraktiv" }],
  [/treasury.*(fall|drop)/i, { direction: "up", hint: "Fallende Renditen → Gold attraktiver" }],
];

function assessGoldImpact(title: string, desc: string): GoldHint {
  const combined = `${title} ${desc}`;
  for (const [re, hint] of GOLD_KEYWORDS) {
    if (re.test(combined)) return hint;
  }
  return { direction: "neutral", hint: "Kein direkter Einfluss auf Gold erkennbar" };
}

export async function fetchLiveNews(): Promise<LiveNewsItem[]> {
  try {
    const res = await fetch("/api/capital/news");
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data.items || []) as LiveNewsItem[];
    return items.map((it) => ({
      ...it,
      titleDe: roughTranslate(it.title),
      goldImpact: assessGoldImpact(it.title, it.description),
    }));
  } catch {
    return [];
  }
}

// ── Economic Events Agenda ──────────────────────────────────

export interface EconEvent {
  date: string;     // "2026-06-18"
  time: string;     // "14:30 MESZ"
  name: string;
  nameDe: string;
  impact: "high" | "medium" | "low";
  goldEffect: string;
  country: "US" | "EU" | "UK" | "CH" | "JP" | "CN";
}

export function getWeeklyAgenda(): EconEvent[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay(); // 0=Sun

  // Calculate Monday of current week
  const mon = new Date(y, m, d - (dow === 0 ? 6 : dow - 1));
  const fmt = (offset: number) => {
    const dt = new Date(mon);
    dt.setDate(dt.getDate() + offset);
    return dt.toISOString().slice(0, 10);
  };

  // Static weekly recurring events + known schedule
  // These should be updated weekly, but common recurring ones:
  return [
    { date: fmt(0), time: "14:30", name: "NY Empire State Manufacturing", nameDe: "NY Produktionsindex", impact: "medium", goldEffect: "Schwach → Gold +, Stark → Gold -", country: "US" },
    { date: fmt(1), time: "14:30", name: "Retail Sales", nameDe: "Einzelhandelsumsaetze", impact: "high", goldEffect: "Schwach → Gold steigt (Zinssenkung naeher)", country: "US" },
    { date: fmt(1), time: "15:15", name: "Industrial Production", nameDe: "Industrieproduktion", impact: "medium", goldEffect: "Schwach → Gold +", country: "US" },
    { date: fmt(2), time: "14:30", name: "Building Permits", nameDe: "Baugenehmigungen", impact: "medium", goldEffect: "Indirekt — zeigt Wirtschaftslage", country: "US" },
    { date: fmt(2), time: "14:30", name: "Housing Starts", nameDe: "Baubeginne", impact: "medium", goldEffect: "Indirekt — Immobilienmarkt", country: "US" },
    { date: fmt(3), time: "14:30", name: "Initial Jobless Claims", nameDe: "Erstantraege Arbeitslosenhilfe", impact: "high", goldEffect: "Hoch → Gold steigt (schwacher Arbeitsmarkt)", country: "US" },
    { date: fmt(3), time: "14:30", name: "Philly Fed Manufacturing", nameDe: "Philly Fed Produktionsindex", impact: "medium", goldEffect: "Schwach → Gold +", country: "US" },
    { date: fmt(4), time: "09:30", name: "Flash PMI (EU)", nameDe: "Einkaufsmanagerindex EU", impact: "high", goldEffect: "Schwach → EUR faellt → Gold gemischt", country: "EU" },
    { date: fmt(4), time: "15:45", name: "Flash PMI (US)", nameDe: "Einkaufsmanagerindex US", impact: "high", goldEffect: "Schwach → Gold steigt, Stark → Gold faellt", country: "US" },
    { date: fmt(4), time: "16:00", name: "Existing Home Sales", nameDe: "Bestandsimmobilienverkaeufe", impact: "medium", goldEffect: "Indirekt — Wirtschaftsindikator", country: "US" },
  ];
}

export function isEventToday(event: EconEvent): boolean {
  return event.date === new Date().toISOString().slice(0, 10);
}

export function isEventPast(event: EconEvent): boolean {
  const now = new Date();
  const eventDate = new Date(event.date + "T" + event.time + ":00");
  return now > eventDate;
}
