const state = {
  rows: [],
  filtered: [],
  selected: null,
  chartCache: new Map(),
};

const els = {
  meta: document.querySelector("#snapshot-meta"),
  summary: document.querySelector("#summary-grid"),
  market: document.querySelector("#market-filter"),
  search: document.querySelector("#search-input"),
  sort: document.querySelector("#sort-select"),
  table: document.querySelector("#stock-table"),
  selectedMarket: document.querySelector("#selected-market"),
  selectedTitle: document.querySelector("#selected-title"),
  selectedCode: document.querySelector("#selected-code"),
  metrics: document.querySelector("#metric-pairs"),
  chart: document.querySelector("#price-chart"),
  chartState: document.querySelector("#chart-state"),
  theme: document.querySelector("#theme-toggle"),
};

init();

async function init() {
  try {
    const response = await fetch("./data/market_latest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("data/market_latest.json 파일이 없습니다.");
    const data = await response.json();
    state.rows = data.rows ?? [];
    els.meta.textContent = `${formatDateTime(data.generatedAt)} 기준 · ${state.rows.length.toLocaleString()}개 종목`;
    bindEvents();
    applyFilters();
    selectStock(state.filtered[0]);
  } catch (error) {
    els.meta.textContent = error.message;
    els.table.innerHTML = `<tr><td class="empty" colspan="10">먼저 node scripts/update-data.mjs를 실행해 주세요.</td></tr>`;
  }
}

function bindEvents() {
  els.market.addEventListener("change", applyFilters);
  els.search.addEventListener("input", applyFilters);
  els.sort.addEventListener("change", applyFilters);
  els.theme.addEventListener("click", () => document.body.classList.toggle("dark"));
}

function applyFilters() {
  const market = els.market.value;
  const query = els.search.value.trim().toLowerCase();
  const [sortKey, sortDir] = els.sort.value.split(":");

  state.filtered = state.rows
    .filter((row) => market === "ALL" || row.market === market)
    .filter((row) => !query || row.name.toLowerCase().includes(query) || row.symbol.includes(query))
    .sort((a, b) => compareNullable(a[sortKey], b[sortKey], sortDir));

  renderSummary();
  renderTable();
  if (!state.filtered.includes(state.selected)) selectStock(state.filtered[0]);
}

function renderSummary() {
  const rows = state.filtered;
  const kospi = rows.filter((row) => row.market === "KOSPI").length;
  const kosdaq = rows.filter((row) => row.market === "KOSDAQ").length;
  const totalTradingValue = sum(rows, "tradingValue");
  const advancers = rows.filter((row) => row.changeRate > 0).length;
  const decliners = rows.filter((row) => row.changeRate < 0).length;
  const top = rows[0];

  const cards = [
    ["표시 종목", `${rows.length.toLocaleString()}개`],
    ["코스피 / 코스닥", `${kospi.toLocaleString()} / ${kosdaq.toLocaleString()}`],
    ["거래대금", `${formatNumber(totalTradingValue)} 백만원`],
    ["상승 / 하락", `${advancers.toLocaleString()} / ${decliners.toLocaleString()}`],
    ["정렬 1위", top ? `${top.name} ${formatPercent(top.changeRate)}` : "-"],
  ];

  els.summary.innerHTML = cards
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function renderTable() {
  const html = state.filtered
    .slice(0, 500)
    .map((row) => {
      const trend = trendClass(row.changeRate);
      const selected = row === state.selected ? " selected" : "";
      return `<tr class="${selected}" data-symbol="${row.symbol}">
        <td><div class="stock-name"><strong>${escapeHtml(row.name)}</strong><span>${row.market} · ${row.symbol}</span></div></td>
        <td>${formatPrice(row.price)}</td>
        <td class="${trend}">${formatPercent(row.changeRate)}</td>
        <td>${formatNumber(row.tradingValue)}</td>
        <td>${formatNumber(row.sales)}</td>
        <td>${formatNumber(row.operatingProfit)}</td>
        <td>${formatPercent(row.salesGrowth)} / ${formatPercent(row.operatingProfitGrowth)}</td>
        <td>${formatPercent(row.foreignRatio)}</td>
        <td>${formatRatio(row.per)}</td>
        <td>${formatNumber(row.marketCap)}</td>
      </tr>`;
    })
    .join("");

  els.table.innerHTML = html || `<tr><td class="empty" colspan="10">조건에 맞는 종목이 없습니다.</td></tr>`;
  els.table.querySelectorAll("tr[data-symbol]").forEach((tr) => {
    tr.addEventListener("click", () => selectStock(state.rows.find((row) => row.symbol === tr.dataset.symbol)));
  });
}

async function selectStock(row) {
  state.selected = row;
  renderTable();

  if (!row) {
    els.selectedTitle.textContent = "-";
    els.selectedCode.textContent = "------";
    els.metrics.innerHTML = "";
    drawEmptyChart("선택된 종목이 없습니다.");
    return;
  }

  els.selectedMarket.textContent = row.marketName;
  els.selectedTitle.textContent = row.name;
  els.selectedCode.textContent = row.symbol;
  els.metrics.innerHTML = [
    ["현재가", formatPrice(row.price)],
    ["전일비", formatSigned(row.change)],
    ["등락률", formatPercent(row.changeRate)],
    ["거래대금", `${formatNumber(row.tradingValue)} 백만원`],
    ["매출액", `${formatNumber(row.sales)} 억원`],
    ["영업이익", `${formatNumber(row.operatingProfit)} 억원`],
    ["외국인비율", formatPercent(row.foreignRatio)],
    ["PER", formatRatio(row.per)],
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  await renderChart(row.symbol);
}

async function renderChart(symbol) {
  els.chartState.textContent = "차트 로딩";
  try {
    let chart = state.chartCache.get(symbol);
    if (!chart) {
      const response = await fetch(`./data/charts/${symbol}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error("차트 캐시 없음");
      chart = await response.json();
      state.chartCache.set(symbol, chart);
    }
    drawChart(chart.rows ?? []);
    els.chartState.textContent = `${(chart.rows ?? []).length}거래일`;
  } catch {
    drawEmptyChart("node scripts/update-data.mjs --charts 실행 후 표시됩니다.");
    els.chartState.textContent = "차트 없음";
  }
}

function drawChart(rows) {
  if (!rows.length) {
    drawEmptyChart("표시할 차트 데이터가 없습니다.");
    return;
  }

  const width = 720;
  const height = 300;
  const pad = 28;
  const values = rows.map((row) => row.close).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = rows.map((row, index) => {
    const x = pad + (index / Math.max(rows.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((row.close - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  els.chart.innerHTML = `
    <line class="axis" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"></line>
    <line class="axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"></line>
    <polyline class="price-line" points="${points.join(" ")}"></polyline>
    <text x="${pad}" y="20" fill="currentColor" font-size="13">${formatPrice(max)}</text>
    <text x="${pad}" y="${height - 6}" fill="currentColor" font-size="13">${formatPrice(min)}</text>
  `;
}

function drawEmptyChart(message) {
  els.chart.innerHTML = `<text x="360" y="150" text-anchor="middle" fill="currentColor" font-size="16">${escapeHtml(message)}</text>`;
}

function compareNullable(a, b, direction) {
  const left = a ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  const right = b ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  return direction === "asc" ? left - right : right - left;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function trendClass(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "";
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatPrice(value) {
  return value == null ? "-" : `${Number(value).toLocaleString()}원`;
}

function formatNumber(value) {
  return value == null ? "-" : Number(value).toLocaleString();
}

function formatPercent(value) {
  return value == null ? "-" : `${Number(value).toFixed(2)}%`;
}

function formatRatio(value) {
  return value == null ? "-" : Number(value).toFixed(2);
}

function formatSigned(value) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${Number(value).toLocaleString()}원`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
