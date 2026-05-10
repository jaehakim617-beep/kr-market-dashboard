import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const MARKET_FILE = path.join(DATA_DIR, "market_latest.json");
const CHART_DIR = path.join(DATA_DIR, "charts");

const MARKETS = [
  { id: "0", code: "KOSPI", name: "코스피" },
  { id: "1", code: "KOSDAQ", name: "코스닥" },
];

const FIELD_IDS = [
  "amount",
  "market_sum",
  "sales",
  "operating_profit",
  "sales_increasing_rate",
  "operating_profit_increasing_rate",
  "frgn_rate",
  "per",
];

const COLUMN_MAP = {
  N: "rank",
  종목명: "name",
  현재가: "price",
  전일비: "change",
  등락률: "changeRate",
  액면가: "parValue",
  거래대금: "tradingValue",
  시가총액: "marketCap",
  매출액: "sales",
  영업이익: "operatingProfit",
  매출액증가율: "salesGrowth",
  영업이익증가율: "operatingProfitGrowth",
  외국인비율: "foreignRatio",
  PER: "per",
};

const NUMBER_KEYS = new Set([
  "rank",
  "price",
  "change",
  "changeRate",
  "parValue",
  "tradingValue",
  "marketCap",
  "sales",
  "operatingProfit",
  "salesGrowth",
  "operatingProfitGrowth",
  "foreignRatio",
  "per",
]);

const args = new Set(process.argv.slice(2));
const chartDaysArg = process.argv.find((arg) => arg.startsWith("--chart-days="));
const chartDays = chartDaysArg ? Number(chartDaysArg.split("=")[1]) : 260;

await mkdir(DATA_DIR, { recursive: true });

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: "Naver Finance",
  unitNotes: {
    tradingValue: "백만원",
    marketCap: "억원",
    sales: "억원",
    operatingProfit: "억원",
    changeRate: "%",
    salesGrowth: "%",
    operatingProfitGrowth: "%",
    foreignRatio: "%",
    per: "배",
  },
  rows: [],
  errors: [],
};

for (const market of MARKETS) {
  try {
    const rows = await fetchMarket(market);
    snapshot.rows.push(...rows);
    console.log(`${market.name}: ${rows.length}개 종목 수집`);
  } catch (error) {
    snapshot.errors.push({ market: market.code, message: error.message });
    console.error(`${market.name} 수집 실패: ${error.message}`);
  }
}

await writeFile(MARKET_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`저장 완료: ${MARKET_FILE}`);

if (args.has("--charts")) {
  await mkdir(CHART_DIR, { recursive: true });
  let done = 0;
  for (const row of snapshot.rows) {
    try {
      const chart = await fetchChart(row.symbol, chartDays);
      await writeFile(path.join(CHART_DIR, `${row.symbol}.json`), `${JSON.stringify(chart)}\n`, "utf8");
    } catch (error) {
      snapshot.errors.push({ symbol: row.symbol, chart: true, message: error.message });
    }
    done += 1;
    if (done % 50 === 0) console.log(`차트 ${done}/${snapshot.rows.length}개 수집`);
    await sleep(120);
  }
  await writeFile(MARKET_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`차트 저장 완료: ${CHART_DIR}`);
}

async function fetchMarket(market) {
  const cookie = await createFieldCookie(market.id);
  const rows = [];

  for (let page = 1; page <= 80; page += 1) {
    const url = `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${market.id}&page=${page}`;
    const html = await getEucKr(url, { cookie });
    const pageRows = parseMarketRows(html, market);
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    await sleep(80);
  }

  return rows;
}

async function createFieldCookie(sosok) {
  const params = new URLSearchParams({
    menu: "market_sum",
    sosok,
    returnUrl: `http://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=1`,
  });
  for (const field of FIELD_IDS) params.append("fieldIds", field);

  const response = await fetch(`https://finance.naver.com/sise/field_submit.naver?${params}`, {
    redirect: "manual",
    headers: browserHeaders("https://finance.naver.com/sise/sise_market_sum.naver"),
  });

  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("선택 필드 쿠키를 받지 못했습니다.");
  return cookie;
}

async function fetchChart(symbol, days) {
  const end = toYmd(new Date());
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Math.max(days * 2, 90));
  const start = toYmd(startDate);
  const url = `https://api.finance.naver.com/siseJson.naver?symbol=${symbol}&requestType=1&startTime=${start}&endTime=${end}&timeframe=day`;
  const text = await getUtf8(url, { referer: "https://finance.naver.com/" });
  const rows = parseNaverChart(text).slice(-days);
  return { symbol, generatedAt: new Date().toISOString(), rows };
}

function parseMarketRows(html, market) {
  const table = html.match(/<table[^>]+class="type_2"[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];

  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((match) => cleanText(match[1]))
    .filter((text) => text !== "토론")
    .map((label) => COLUMN_MAP[label] ?? label);

  const parsed = [];
  for (const rowHtml of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = rowHtml[1];
    const code = row.match(/\/item\/main\.naver\?code=(\d{6})/)?.[1];
    if (!code) continue;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => ({
      html: match[1],
      text: cleanText(match[1]),
    }));
    if (cells.length < 5) continue;

    const item = { market: market.code, marketName: market.name, symbol: code };
    for (let i = 0; i < Math.min(headers.length, cells.length); i += 1) {
      const key = headers[i];
      if (!key || key === "토론") continue;
      const cell = cells[i];
      item[key] = key === "change" ? toSignedChange(cell.html, cell.text) : NUMBER_KEYS.has(key) ? toNumber(cell.text) : cell.text;
    }
    parsed.push(item);
  }

  return parsed;
}

function parseNaverChart(text) {
  const rows = [];
  for (const match of text.matchAll(/\["(\d{8})",\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\]/g)) {
    rows.push({
      date: match[1],
      open: Number(match[2]),
      high: Number(match[3]),
      low: Number(match[4]),
      close: Number(match[5]),
      volume: Number(match[6]),
      foreignExhaustionRate: Number(match[7]),
    });
  }
  return rows;
}

async function getEucKr(url, extraHeaders = {}) {
  const response = await fetch(url, { headers: browserHeaders(extraHeaders.referer, extraHeaders.cookie) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return new TextDecoder("euc-kr").decode(buffer);
}

async function getUtf8(url, extraHeaders = {}) {
  const response = await fetch(url, { headers: browserHeaders(extraHeaders.referer, extraHeaders.cookie) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function browserHeaders(referer = "https://finance.naver.com/", cookie) {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    referer,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  const cleaned = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned || cleaned === "N/A") return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function toSignedChange(html, text) {
  const number = toNumber(text.replace(/[^\d,.-]/g, ""));
  if (number == null) return null;
  if (/하락|bu_pdn|nv01/.test(html)) return -Math.abs(number);
  if (/상승|bu_pup|red0/.test(html)) return Math.abs(number);
  return number;
}

function toYmd(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
