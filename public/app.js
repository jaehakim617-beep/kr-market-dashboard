const NUMERIC_FILTERS = [
  { key: "price", label: "현재가", unit: "원" },
  { key: "changeRate", label: "등락률", unit: "%" },
  { key: "tradingValue", label: "거래대금", unit: "백만원" },
  { key: "sales", label: "매출액", unit: "억원" },
  { key: "operatingProfit", label: "영업이익", unit: "억원" },
  { key: "salesGrowth", label: "매출액 증가율", unit: "%" },
  { key: "operatingProfitGrowth", label: "영업이익 증가율", unit: "%" },
  { key: "foreignRatio", label: "외국인", unit: "%" },
  { key: "per", label: "PER", unit: "배" },
  { key: "marketCap", label: "시총", unit: "억원" },
];

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
  table: document.querySelector("#stock-table"),
  selectedMarket: document.querySelector("#selected-market"),
  selectedTitle: document.querySelector("#selected-title"),
  selectedCode: document.querySelector("#selected-code"),
  metrics: document.querySelector("#metric-pairs"),
  chart: document.querySelector("#price-chart"),
  chartState: document.querySelector("#chart-state"),
  theme: document.querySelector("#theme-toggle"),
  numericFilters: document.querySelector("#numeric-filters"),
  clearFilters: document.querySelector("#clear-filters"),
};

init();

async function init() {
  renderNumericFilters();

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
    els.table.innerHTML = `<tr><td class="empty" colspan="11">먼저 node scripts/update-data.mjs를 실행해 주세요.</td></tr>`;
  }
}

function bindEvents() {
  els.market.addEventListener("change", applyFilters);
  els.search.addEventListener("input", applyFilters);
  els.theme.addEventListener("click", () => document.body.classList.toggle("dark"));
  els.numericFilters.querySelectorAll("input").forEach((input) => input.addEventListener("input", applyFilters));
  els.numericFilters.querySelectorAll("select[data-percent-mode]").forEach((select) => select.addEventListener("change", applyFilters));
  els.numericFilters.querySelectorAll("select[data-sort]").forEach((select) => {
    select.addEventListener("change", () => {
      if (select.value) {
        els.numericFilters.querySelectorAll("select[data-sort]").forEach((other) => {
          if (other !== select) other.value = "";
        });
      }
      applyFilters();
    });
  });
  els.clearFilters.addEventListener("click", () => {
    els.numericFilters.querySelectorAll("input").forEach((input) => { input.value = ""; });
    els.numericFilters.querySelectorAll("select").forEach((select) => { select.value = ""; });
    applyFilters();
  });
}

function renderNumericFilters() {
  els.numericFilters.innerHTML = NUMERIC_FILTERS.map(
    (filter) => `
      <div class="filter-field">
        <div class="filter-label">
          <span>${filter.label}</span>
          <small>${filter.unit}</small>
        </div>
        <div class="range-inputs">
          <input data-filter="${filter.key}" data-bound="min" inputmode="decimal" placeholder="최소" />
          <input data-filter="${filter.key}" data-bound="max" inputmode="decimal" placeholder="최대" />
        </div>
        <select data-sort="${filter.key}" aria-label="${filter.label} 정렬">
          <option value="">정렬 없음</option>
          <option value="asc">오름차순</option>
          <option value="desc">내림차순</option>
        </select>
        <div class="percent-row">
          <select data-percent-mode="${filter.key}" aria-label="${filter.label} 상하위">
            <option value="">전체</option>
            <option value="top">상위</option>
            <option value="bottom">하위</option>
          </select>
          <input data-percent-value="${filter.key}" inputmode="decimal" placeholder="%" />
        </div>
      </div>
    `,
  ).join("");
}

function applyFilters() {
  const market = els.market.value;
  const query = els.search.value.trim().toLowerCase();
  const ranges = readRanges();
  const percentFilters = readPercentFilters();
  const sort = readSort();

  state.filtered = state.rows
    .filter((row) => market === "ALL" || row.market === market)
    .filter((row) => !query || row.name.toLowerCase().includes(query) || row.symbol.includes(query))
    .filter((row) => matchesRanges(row, ranges));

  state.filtered = applyPercentFilters(state.filtered, percentFilters);
  state.filtered = applySort(state.filtered, sort);

  renderSummary();
  renderTable();
  if (!state.filtered.includes(state.selected)) selectStock(state.filtered[0]);
}

function readRanges() {
  const ranges = {};
  els.numericFilters.querySelectorAll("input").forEach((input) => {
    const key = input.dataset.filter;
    const bound = input.dataset.bound;
    const value = parseFilterNumber(input.value);
    if (!ranges[key]) ranges[key] = {};
    ranges[key][bound] = value;
  });
  return ranges;
}

function matchesRanges(row, ranges) {
  return NUMERIC_FILTERS.every(({ key }) => {
    const value = row[key];
    const range = ranges[key] ?? {};
    if (range.min == null && range.max == null) return true;
    if (value == null) return false;
    if (range.min != null && value < range.min) return false;
    if (range.max != null && value > range.max) return false;
    return true;
  });
}

function readPercentFilters() {
  return NUMERIC_FILTERS.map(({ key }) => {
    const mode = els.numericFilters.querySelector(`select[data-percent-mode="${key}"]`)?.value ?? "";
    const percent = parseFilterNumber(els.numericFilters.querySelector(`input[data-percent-value="${key}"]`)?.value ?? "");
    return { key, mode, percent };
  }).filter((filter) => filter.mode && filter.percent != null && filter.percent > 0);
}

function readSort() {
  for (const { key } of NUMERIC_FILTERS) {
    const direction = els.numericFilters.querySelector(`select[data-sort="${key}"]`)?.value ?? "";
    if (direction) return { key, direction };
  }
  return null;
}

function applyPercentFilters(rows, filters) {
  return filters.reduce((currentRows, filter) => {
    const values = currentRows
      .map((row) => row[filter.key])
      .filter((value) => value != null && Number.isFinite(value))
      .sort((a, b) => a - b);

    if (!values.length) return [];

    const clampedPercent = Math.min(Math.max(filter.percent, 0), 100);
    const count = Math.max(1, Math.ceil(values.length * (clampedPercent / 100)));
    const threshold = filter.mode === "top" ? values[Math.max(values.length - count, 0)] : values[Math.min(count - 1, values.length - 1)];

    return currentRows.filter((row) => {
      const value = row[filter.key];
      if (value == null) return false;
      return filter.mode === "top" ? value >= threshold : value <= threshold;
    });
  }, rows);
}

function applySort(rows, sort) {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return sort.direction === "asc" ? left - right : right - left;
  });
}

function renderSummary() {
  const rows = state.filtered;
  const kospi = rows.filter((row) => row.market === "KOSPI").length;
  const kosdaq = rows.filter((row) => row.market === "KOSDAQ").length;
  const advancers = rows.filter((row) => row.changeRate > 0).length;
  const decliners = rows.filter((row) => row.changeRate < 0).length;

  const cards = [
    ["표시 종목", `${rows.length.toLocaleString()}개`],
    ["코스피 / 코스닥", `${kospi.toLocaleString()} / ${kosdaq.toLocaleString()}`],
    ["상승 / 하락", `${advancers.toLocaleString()} / ${decliners.toLocaleString()}`],
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
        <td>${formatPercent(row.salesGrowth)}</td>
        <td>${formatPercent(row.operatingProfitGrowth)}</td>
        <td>${formatPercent(row.foreignRatio)}</td>
        <td>${formatRatio(row.per)}</td>
        <td>${formatNumber(row.marketCap)}</td>
      </tr>`;
    })
    .join("");

  els.table.innerHTML = html || `<tr><td class="empty" colspan="11">조건에 맞는 종목이 없습니다.</td></tr>`;
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
    ["매출액 증가율", formatPercent(row.salesGrowth)],
    ["영업이익 증가율", formatPercent(row.operatingProfitGrowth)],
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

function parseFilterNumber(value) {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
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
