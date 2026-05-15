const NUMERIC_FILTERS = [
  { key: "price", label: "현재가" },
  { key: "changeRate", label: "등락률" },
  { key: "tradingValue", label: "거래대금" },
  { key: "sales", label: "매출액" },
  { key: "operatingProfit", label: "영업익" },
  { key: "salesGrowth", label: "매출증가" },
  { key: "operatingProfitGrowth", label: "영익증가" },
  { key: "foreignRatio", label: "외국인" },
  { key: "per", label: "PER" },
  { key: "marketCap", label: "시총" },
];

const state = {
  rows: [],
  filtered: [],
  selected: null,
  sort: null,
  chartCache: new Map(),
  chartPeriod: "day",
  chartWindow: 90,
};

const els = {
  meta: document.querySelector("#snapshot-meta"),
  market: document.querySelector("#market-filter"),
  search: document.querySelector("#search-input"),
  table: document.querySelector("#stock-table"),
  chart: document.querySelector("#price-chart"),
  chartTitle: document.querySelector("#chart-title"),
  chartState: document.querySelector("#chart-state"),
  theme: document.querySelector("#theme-toggle"),
  clearFilters: document.querySelector("#clear-filters"),
};

init();

async function init() {
  renderColumnFilters();
  bindStaticEvents();

  try {
    const response = await fetch("./data/market_latest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("data/market_latest.json 파일이 없습니다.");
    const data = await response.json();
    state.rows = data.rows ?? [];
    els.meta.textContent = `${formatDateTime(data.generatedAt)} 기준`;
    applyFilters();
    selectStock(state.filtered[0]);
  } catch (error) {
    els.meta.textContent = error.message;
    els.table.innerHTML = `<tr><td class="empty" colspan="11">먼저 node scripts/update-data.mjs를 실행해 주세요.</td></tr>`;
  }
}

function bindStaticEvents() {
  els.market.addEventListener("change", applyFilters);
  els.search.addEventListener("input", applyFilters);
  els.theme.addEventListener("click", () => document.body.classList.toggle("dark"));
  els.clearFilters.addEventListener("click", () => {
    document.querySelectorAll(".filter-row input").forEach((input) => { input.value = ""; });
    document.querySelectorAll(".filter-row select").forEach((select) => { select.value = ""; });
    applyFilters();
  });

  document.querySelectorAll(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      state.sort = state.sort?.key === key
        ? { key, direction: state.sort.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" };
      updateSortIndicators();
      applyFilters();
    });
  });

  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartPeriod = button.dataset.period;
      document.querySelectorAll(".period-button").forEach((item) => item.classList.toggle("active", item === button));
      drawSelectedChart();
    });
  });

  els.chart.addEventListener("wheel", (event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 : -1;
    const step = state.chartPeriod === "day" ? 12 : state.chartPeriod === "week" ? 8 : 4;
    state.chartWindow = clamp(state.chartWindow + direction * step, 20, 260);
    drawSelectedChart();
  }, { passive: false });
}

function renderColumnFilters() {
  NUMERIC_FILTERS.forEach((filter) => {
    const cell = document.querySelector(`[data-filter-cell="${filter.key}"]`);
    if (!cell) return;
    cell.innerHTML = `
      <div class="column-filter">
        <div class="range-inputs">
          <input data-filter="${filter.key}" data-bound="min" inputmode="decimal" placeholder="최소" />
          <input data-filter="${filter.key}" data-bound="max" inputmode="decimal" placeholder="최대" />
        </div>
        <div class="percent-row">
          <select data-percent-mode="${filter.key}" aria-label="${filter.label} 상하위">
            <option value="">전체</option>
            <option value="top">상위</option>
            <option value="bottom">하위</option>
          </select>
          <input data-percent-value="${filter.key}" inputmode="decimal" placeholder="%" />
        </div>
      </div>
    `;
  });

  document.querySelectorAll(".filter-row input, .filter-row select").forEach((control) => {
    control.addEventListener("input", applyFilters);
    control.addEventListener("change", applyFilters);
  });
}

function applyFilters() {
  const market = els.market.value;
  const query = els.search.value.trim().toLowerCase();
  const ranges = readRanges();
  const percentFilters = readPercentFilters();

  state.filtered = state.rows
    .filter((row) => market === "ALL" || row.market === market)
    .filter((row) => !query || row.name.toLowerCase().includes(query) || row.symbol.includes(query))
    .filter((row) => matchesRanges(row, ranges));

  state.filtered = applyPercentFilters(state.filtered, percentFilters);
  state.filtered = applySort(state.filtered, state.sort);

  renderTable();
  if (!state.filtered.includes(state.selected)) selectStock(state.filtered[0]);
}

function readRanges() {
  const ranges = {};
  document.querySelectorAll("input[data-filter]").forEach((input) => {
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
    const mode = document.querySelector(`select[data-percent-mode="${key}"]`)?.value ?? "";
    const percent = parseFilterNumber(document.querySelector(`input[data-percent-value="${key}"]`)?.value ?? "");
    return { key, mode, percent };
  }).filter((filter) => filter.mode && filter.percent != null && filter.percent > 0);
}

function applyPercentFilters(rows, filters) {
  return filters.reduce((currentRows, filter) => {
    const values = currentRows
      .map((row) => row[filter.key])
      .filter((value) => value != null && Number.isFinite(value))
      .sort((a, b) => a - b);

    if (!values.length) return [];

    const percent = clamp(filter.percent, 0, 100);
    const count = Math.max(1, Math.ceil(values.length * (percent / 100)));
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

function updateSortIndicators() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const marker = button.querySelector("span");
    const active = state.sort?.key === button.dataset.sort;
    button.classList.toggle("active", active);
    marker.textContent = active ? (state.sort.direction === "asc" ? "▲" : "▼") : "";
  });
}

function renderTable() {
  const html = state.filtered.slice(0, 500).map((row) => {
    const trend = trendClass(row.changeRate);
    const selected = row === state.selected ? " selected" : "";
    return `<tr class="${selected}" data-symbol="${row.symbol}">
      <td><div class="stock-name"><strong>${escapeHtml(row.name)}</strong><span>${row.symbol}</span></div></td>
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
  }).join("");

  els.table.innerHTML = html || `<tr><td class="empty" colspan="11">조건에 맞는 종목이 없습니다.</td></tr>`;
  els.table.querySelectorAll("tr[data-symbol]").forEach((tr) => {
    tr.addEventListener("click", () => selectStock(state.rows.find((row) => row.symbol === tr.dataset.symbol)));
  });
}

async function selectStock(row) {
  state.selected = row;
  renderTable();

  if (!row) {
    els.chartTitle.textContent = "주가 차트";
    drawEmptyChart("선택된 종목이 없습니다.");
    return;
  }

  els.chartTitle.textContent = `${row.name} (${row.symbol})`;
  await drawSelectedChart();
}

async function drawSelectedChart() {
  const row = state.selected;
  if (!row) return;

  els.chartState.textContent = "차트 로딩";
  try {
    let chart = state.chartCache.get(row.symbol);
    if (!chart) {
      const response = await fetch(`./data/charts/${row.symbol}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error("차트 캐시 없음");
      chart = await response.json();
      state.chartCache.set(row.symbol, chart);
    }
    const candles = aggregateCandles(chart.rows ?? [], state.chartPeriod).slice(-state.chartWindow);
    drawCandles(candles);
    els.chartState.textContent = `${periodLabel(state.chartPeriod)} · ${candles.length}봉 · 마우스 휠로 확대/축소`;
  } catch {
    drawEmptyChart("차트 데이터가 없습니다.");
    els.chartState.textContent = "차트 없음";
  }
}

function aggregateCandles(rows, period) {
  if (period === "day") return rows.map(toCandle);

  const groups = new Map();
  rows.forEach((row) => {
    const key = period === "week" ? weekKey(row.date) : row.date.slice(0, 6);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  return [...groups.values()].map((items) => {
    const first = items[0];
    const last = items[items.length - 1];
    return {
      date: last.date,
      open: first.open,
      high: Math.max(...items.map((item) => item.high)),
      low: Math.min(...items.map((item) => item.low)),
      close: last.close,
    };
  });
}

function toCandle(row) {
  return {
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  };
}

function drawCandles(candles) {
  if (!candles.length) {
    drawEmptyChart("표시할 차트 데이터가 없습니다.");
    return;
  }

  const width = 720;
  const height = 360;
  const pad = { top: 22, right: 18, bottom: 26, left: 54 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const max = Math.max(...candles.map((candle) => candle.high));
  const min = Math.min(...candles.map((candle) => candle.low));
  const span = max - min || 1;
  const slot = innerWidth / candles.length;
  const bodyWidth = clamp(slot * 0.58, 2, 12);
  const y = (value) => pad.top + ((max - value) / span) * innerHeight;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const gy = pad.top + ratio * innerHeight;
    const value = max - ratio * span;
    return `<line class="chart-grid" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}"></line>
      <text class="axis-label" x="${pad.left - 7}" y="${gy + 4}" text-anchor="end">${formatCompact(value)}</text>`;
  }).join("");

  const shapes = candles.map((candle, index) => {
    const x = pad.left + index * slot + slot / 2;
    const openY = y(candle.open);
    const closeY = y(candle.close);
    const highY = y(candle.high);
    const lowY = y(candle.low);
    const top = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(openY - closeY), 1);
    const klass = candle.close > candle.open ? "candle up-candle" : candle.close < candle.open ? "candle down-candle" : "candle flat-candle";
    return `<g class="${klass}">
      <line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}"></line>
      <rect x="${x - bodyWidth / 2}" y="${top}" width="${bodyWidth}" height="${bodyHeight}"></rect>
    </g>`;
  }).join("");

  els.chart.innerHTML = `${grid}${shapes}`;
}

function drawEmptyChart(message) {
  els.chart.innerHTML = `<text x="360" y="180" text-anchor="middle" fill="currentColor" font-size="16">${escapeHtml(message)}</text>`;
}

function weekKey(yyyymmdd) {
  const date = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + 4 - day);
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getFullYear()}-${String(week).padStart(2, "0")}`;
}

function trendClass(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function parseFilterNumber(value) {
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function periodLabel(period) {
  return period === "day" ? "일봉" : period === "week" ? "주봉" : "월봉";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function formatCompact(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercent(value) {
  return value == null ? "-" : `${Number(value).toFixed(2)}%`;
}

function formatRatio(value) {
  return value == null ? "-" : Number(value).toFixed(2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
