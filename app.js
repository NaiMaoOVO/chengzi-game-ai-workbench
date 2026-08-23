/**
 * 游戏内容运营 AI 分析工作台 — 核心逻辑
 * 工具函数和常量已拆分到 utils.js，本地服务控制台已拆分到 launcher.js。
 */

/* ============================================================
   views (页面视图) — 保留在 app.js
 ============================================================ */

/* ============================================================
   游戏内容运营 AI 分析工作台 — 核心逻辑
   ============================================================ */

const views = {
  overview: {
    title: "项目总览",
    element: document.querySelector("#overview-view")
  },
  content: {
    title: "竞品内容拆解",
    element: document.querySelector("#content-view")
  },
  feedback: {
    title: "玩家评论分析",
    element: document.querySelector("#feedback-view")
  },
  review: {
    title: "活动复盘生成",
    element: document.querySelector("#review-view")
  },
  trending: {
    title: "热点追踪",
    element: document.querySelector("#trending-view")
  },
  version: {
    title: "版本包装助手",
    element: document.querySelector("#version-view")
  },
  segment: {
    title: "玩家分层策略",
    element: document.querySelector("#segment-view")
  },
  creator: {
    title: "KOL/KOC 合作筛选",
    element: document.querySelector("#creator-view")
  },
  resume: {
    title: "备用素材",
    element: document.querySelector("#resume-view")
  }
};

const demoRoutes = {
  "version-live": {
    caseId: "racing-live",
    view: "version",
    label: "版本上线运营链路",
    note: "建议讲法：版本卖点包装 -> 分层触达 -> 达人合作 -> 直播活动复盘。"
  },
  "hot-feedback": {
    caseId: "wuwa-community",
    view: "trending",
    label: "B站热点舆情链路",
    note: "建议讲法：热点发现 -> 评论清洗 -> 舆情风险 -> 内容动作建议。"
  },
  "launch-plan": {
    caseId: "launch-creators",
    view: "creator",
    label: "新游首曝投放链路",
    note: "建议讲法：竞品内容 -> 首曝包装 -> 达人筛选 -> 预算效率。"
  }
};

/* ---- 通用工具 ---- */

let reviewMode = "campaign";
let currentTrendingTopics = [];
let selectedTrendingIndex = 0;
const trendingRequestGuard = createGenerationGuard();
const serviceModeGuard = createGenerationGuard();
let currentFeedbackRows = [];
let currentCreatorRows = [];
let streamers = [
  {
    id: 1,
    name: "生态 KOC 主播 A",
    imageUrl: "",
    ocrStatus: "示例数据",
    event: { acu: 286, pcu: 1240, impressions: 188000, entries: 21400 },
    base: { acu: 210, pcu: 860, impressions: 132000, entries: 15800 }
  },
  {
    id: 2,
    name: "跨品类 KOL B",
    imageUrl: "",
    ocrStatus: "示例数据",
    event: { acu: 168, pcu: 690, impressions: 246000, entries: 18200 },
    base: { acu: 152, pcu: 720, impressions: 198000, entries: 17100 }
  }
];


function renderMetrics(container, metrics) {
  container.innerHTML = metrics
    .map(
      (metric) => `
        <div class="metric">
          <strong>${escapeHtml(metric.label)}</strong>
          <span>${escapeHtml(metric.value)}</span>
        </div>
      `
    )
    .join("");
}

function renderList(container, items) {
  container.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function setFetchDiagnostic(selector, state, title, message) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.className = `fetch-diagnostic ${state ? `fetch-${state}` : ""}`;
  element.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(message)}</span>
  `;
}

function renderPills(container, items) {
  container.innerHTML = items.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
}


function isDemoMode() {
  return document.querySelector("#demo-mode-toggle")?.checked ?? true;
}

function getReviewPolicy() {
  const key = document.querySelector("#review-policy")?.value || "standard";
  return REVIEW_POLICIES[key] || REVIEW_POLICIES.standard;
}

/* ========================================
   工具：变化率计算
   ======================================== */

function getStreamerResult(streamer, policy = getReviewPolicy()) {
  const changes = {
    acu: formatChange(streamer.event.acu, streamer.base.acu, policy.metricThreshold),
    pcu: formatChange(streamer.event.pcu, streamer.base.pcu, policy.metricThreshold),
    impressions: formatChange(streamer.event.impressions, streamer.base.impressions, policy.metricThreshold),
    entries: formatChange(streamer.event.entries, streamer.base.entries, policy.metricThreshold)
  };
  const positiveCount = Object.values(changes).filter((item) => item.direction === "positive").length;
  const negativeCount = Object.values(changes).filter((item) => item.direction === "negative").length;
  const verdict = positiveCount >= 3 ? "正反馈" : negativeCount >= 2 ? "负反馈" : "中性反馈";

  return {
    changes,
    verdict,
    entryRate: streamer.event.impressions ? streamer.event.entries / streamer.event.impressions : 0
  };
}

/* ---- 主播列表渲染 ---- */

function renderStreamerList() {
  const list = document.querySelector("#streamer-list");
  if (!list) return;

  list.innerHTML = streamers
    .map((streamer) => {
      const result = getStreamerResult(streamer);
      const streamerName = escapeHtml(streamer.name);
      const ocrStatus = escapeHtml(streamer.ocrStatus || (streamer.imageUrl ? "已导入截图，可按识别结果校正" : "示例/手动数据，可替换为截图识别结果"));
      const ocrHint = escapeHtml(streamer.ocrHint || (streamer.imageUrl ? "拖入截图后会自动提示缺失项" : "可直接手动修改各项指标"));
      const ocrText = escapeHtml(streamer.ocrText || "");
      const imageUrl = safeImageUrl(streamer.imageUrl);
      return `
	        <article class="streamer-card" data-streamer-id="${streamer.id}">
	          <div class="streamer-card-head">
	            <div>
	              <label>主播名称<input data-field="name" value="${streamerName}" /></label>
	              <p class="muted-copy ocr-status-line">${ocrStatus}${!ocrServerOnline && imageUrl ? ` <span class="ocr-warn">（${ocrServiceState === "preparing" ? "OCR 服务准备中，识别结果稍后可用" : "OCR 服务未连接"}）</span>` : ""}</p>
	              <p class="muted-copy ocr-hint-line">${ocrHint}</p>
	              ${ocrText ? `<details class="ocr-debug-details"><summary>查看 OCR 识别原文</summary><pre class="ocr-raw-text">${ocrText}</pre></details>` : ""}
	            </div>
	            <button class="icon-button" type="button" data-remove-streamer="${streamer.id}" aria-label="删除主播">×</button>
	          </div>
	          ${imageUrl ? `<img class="screenshot-preview" src="${escapeHtml(imageUrl)}" alt="${streamerName}直播数据截图" />` : ""}
          <div class="streamer-data-grid">
            <div>
              <h3>活动场数据</h3>
              <label>平均在线 ACU<input type="number" data-path="event.acu" value="${streamer.event.acu}" /></label>
              <label>最高在线 PCU<input type="number" data-path="event.pcu" value="${streamer.event.pcu}" /></label>
              <label>曝光量<input type="number" data-path="event.impressions" value="${streamer.event.impressions}" /></label>
              <label>进房人数<input type="number" data-path="event.entries" value="${streamer.event.entries}" /></label>
            </div>
            <div>
              <h3>近期直播均值</h3>
              <label>平均在线 ACU<input type="number" data-path="base.acu" value="${streamer.base.acu}" /></label>
              <label>最高在线 PCU<input type="number" data-path="base.pcu" value="${streamer.base.pcu}" /></label>
              <label>曝光量<input type="number" data-path="base.impressions" value="${streamer.base.impressions}" /></label>
              <label>进房人数<input type="number" data-path="base.entries" value="${streamer.base.entries}" /></label>
            </div>
          </div>
          <div class="streamer-result">
            <strong>${result.verdict}</strong>
            <span>ACU ${result.changes.acu.label}</span>
            <span>PCU ${result.changes.pcu.label}</span>
            <span>曝光 ${result.changes.impressions.label}</span>
            <span>进房 ${result.changes.entries.label}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

/* ---- 主播管理 ---- */

let streamerIdCounter = streamers.reduce((max, item) => Math.max(max, item.id), 0);

function addEmptyStreamer() {
  streamerIdCounter += 1;
  streamers.push({
    id: streamerIdCounter,
    name: `主播 ${String.fromCharCode(65 + streamers.length)}`,
    imageUrl: "",
    ocrStatus: "手动新增",
    event: { acu: 100, pcu: 500, impressions: 50000, entries: 5000 },
    base: { acu: 100, pcu: 500, impressions: 50000, entries: 5000 }
  });
  renderStreamerList();
  analyzeReview();
}

function loadDemoStreamers() {
  streamers = [
    {
      id: 1,
      name: "生态 KOC 主播 A",
      imageUrl: "",
      ocrStatus: "示例数据",
      event: { acu: 286, pcu: 1240, impressions: 188000, entries: 21400 },
      base: { acu: 210, pcu: 860, impressions: 132000, entries: 15800 }
    },
    {
      id: 2,
      name: "跨品类 KOL B",
      imageUrl: "",
      ocrStatus: "示例数据",
      event: { acu: 168, pcu: 690, impressions: 246000, entries: 18200 },
      base: { acu: 152, pcu: 720, impressions: 198000, entries: 17100 }
    }
  ];
  streamerIdCounter = 2;
  renderStreamerList();
  analyzeReview();
}

function createStreamerFromFile(file, index) {
  streamerIdCounter += 1;
  const label = file.name.replace(/\.[^.]+$/, "") || `截图 ${index + 1}`;
  return {
    id: streamerIdCounter,
    name: label,
    imageUrl: URL.createObjectURL(file),
    ocrStatus: "OCR 识别中…",
    event: { acu: 0, pcu: 0, impressions: 0, entries: 0 },
    base: { acu: 0, pcu: 0, impressions: 0, entries: 0 }
  };
}

function getStreamerMissingFields(streamer) {
  const fields = [
    ["event.acu", "活动场 ACU"],
    ["event.pcu", "活动场 PCU"],
    ["event.impressions", "活动场曝光量"],
    ["event.entries", "活动场进房人数"],
    ["base.acu", "近期均值 ACU"],
    ["base.pcu", "近期均值 PCU"],
    ["base.impressions", "近期均值曝光量"],
    ["base.entries", "近期均值进房人数"]
  ];
  return fields.filter(([path]) => {
    const [group, key] = path.split(".");
    return !streamer?.[group]?.[key];
  }).map(([, label]) => label);
}

function updateStreamerOcrHint(streamer) {
  if (!streamer) return;
  const missing = getStreamerMissingFields(streamer);
  if (!missing.length) {
    streamer.ocrHint = "4 项核心指标已完整识别，可直接进入复盘结论。";
  } else if (missing.length <= 2) {
    streamer.ocrHint = `已识别大部分指标，剩余可手动补全：${missing.join("、")}。`;
  } else {
    streamer.ocrHint = `识别到部分指标，建议手动补全：${missing.slice(0, 4).join("、")}。`;
  }
}

function streamerRowsToData(rows) {
  const cleanRows = rows
    .map((row) => row.map((cell) => String(cell || "").trim()))
    .filter((row) => row.some(Boolean));
  if (!cleanRows.length) return [];

  const aliases = [
    ["主播名", "主播", "达人名", "名称", "账号", "name"],
    ["活动acu", "活动场acu", "acu", "平均在线", "活动平均在线"],
    ["活动pcu", "活动场pcu", "pcu", "最高在线", "活动最高在线"],
    ["活动曝光", "活动曝光量", "曝光量", "曝光"],
    ["活动进房", "活动进房人数", "进房人数", "进房"],
    ["基准acu", "近期acu", "近期均值acu", "均值acu", "近期平均在线"],
    ["基准pcu", "近期pcu", "近期均值pcu", "均值pcu", "近期最高在线"],
    ["基准曝光", "近期曝光", "近期均值曝光", "均值曝光", "近期曝光量"],
    ["基准进房", "近期进房", "近期均值进房", "均值进房", "近期进房人数"]
  ];
  const allAliasSet = new Set(aliases.flat().map(normalizeHeader));
  const firstRow = cleanRows[0].map(normalizeHeader);
  const hasHeader = firstRow.some((cell) => allAliasSet.has(cell));
  const headerMap = hasHeader
    ? firstRow.reduce((result, key, index) => {
      result[key] = index;
      return result;
    }, {})
    : {};
  const dataRows = hasHeader ? cleanRows.slice(1) : cleanRows;

  return dataRows
    .map((row) => ({
      name: pickRowValue(row, headerMap, aliases[0], 0) || `主播 ${String.fromCharCode(65 + streamers.length)}`,
      event: {
        acu: parseCompactNumber(pickRowValue(row, headerMap, aliases[1], 1)),
        pcu: parseCompactNumber(pickRowValue(row, headerMap, aliases[2], 2)),
        impressions: parseCompactNumber(pickRowValue(row, headerMap, aliases[3], 3)),
        entries: parseCompactNumber(pickRowValue(row, headerMap, aliases[4], 4))
      },
      base: {
        acu: parseCompactNumber(pickRowValue(row, headerMap, aliases[5], 5)),
        pcu: parseCompactNumber(pickRowValue(row, headerMap, aliases[6], 6)),
        impressions: parseCompactNumber(pickRowValue(row, headerMap, aliases[7], 7)),
        entries: parseCompactNumber(pickRowValue(row, headerMap, aliases[8], 8))
      }
    }))
    .filter((row) => row.name && Object.values(row.event).some(Boolean));
}

function updateStreamer(id, path, value) {
  const streamer = streamers.find((item) => item.id === id);
  if (!streamer) return;

  const segments = path.split(".");
  if (segments.length === 1) {
    streamer[segments[0]] = value;
    return;
  }

  if (!streamer[segments[0]]) {
    streamer[segments[0]] = {};
  }

  streamer[segments[0]][segments[1]] = numberValue(value);
}

/* ---- OCR 识别 ---- */


/* ========================================
   OCR 健康检查
   ======================================== */

let ocrServerOnline = false;
let ocrServiceState = "down";
let ocrHealthGeneration = 0;

function renderServiceModeControls() {
  const mode = applyServiceMode();
  document.body.dataset.serviceMode = mode;
  document.querySelectorAll("[data-service-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.serviceMode === mode);
    button.setAttribute("aria-pressed", button.dataset.serviceMode === mode ? "true" : "false");
  });

  const status = document.querySelector("#service-mode-status");
  if (status) {
    status.textContent = mode === "online" ? "线上 /api 服务" : "本机 127.0.0.1 服务";
  }
}

function renderRuntimeModeBadge() {
  const badge = document.querySelector("#runtime-mode-badge");
  if (!badge) return;
  if (window.location.protocol === "file:") {
    const segments = decodeURIComponent(window.location.pathname).split("/").filter(Boolean);
    const tail = segments.slice(-3).join("/");
    badge.textContent = `运行环境：本地文件 · …/${tail}`;
    return;
  }
  badge.textContent = `运行环境：线上站点 · ${window.location.host || "未知来源"}（无法控制本机服务）`;
}

function renderLauncherSyncWarning() {
  const sync = window.__LAUNCHER_SYNC__;
  if (!sync || sync.inSync) return;
  const panel = document.querySelector(".launcher-panel");
  if (!panel || document.querySelector("#launcher-sync-warning")) return;
  const warning = document.createElement("p");
  warning.id = "launcher-sync-warning";
  warning.className = "source-status source-mock";
  warning.textContent = `⚠️ 运行快照与源码不一致（${sync.detail || "存在差异"}）。请在项目目录执行 npm run launcher:install，然后点击“重启本地服务”。`;
  panel.prepend(warning);
}

renderRuntimeModeBadge();
renderLauncherSyncWarning();

let lastTrendStats = null;
loadTrendStats();

function renderTrendBarChart(containerId, series, valueExtractor, labelBuilder) {
  const container = document.querySelector(containerId);
  if (!container || !series.length) { if (container) container.innerHTML = '<p class="muted-copy">暂无数据</p>'; return; }
  const max = Math.max(1, ...series.map((entry) => valueExtractor(entry)));
  container.innerHTML = series.map((entry) => {
    const value = valueExtractor(entry);
    const height = Math.max(4, Math.round((value / max) * 100));
    const label = labelBuilder(entry);
    return '<div class="trend-bar' + (label.negative ? " negative" : "") + '" style="height:' + height + '%" data-label="' + escapeHtml(label.text) + '"></div>';
  }).join("");
}

async function loadTrendStats() {
  const section = document.querySelector("#trend-section");
  if (!section || isOnlineServiceMode()) return;
  try {
    const game = document.querySelector("#trending-game")?.value.trim() || "";
    const [feedbackRes, trendingRes] = await Promise.all([
      fetch(ARCHIVE_SERVICE_URL + "/stats?kind=feedback&days=14" + (game ? "&game=" + encodeURIComponent(game) : ""), { cache: "no-store" }),
      fetch(ARCHIVE_SERVICE_URL + "/stats?kind=trending&days=14" + (game ? "&game=" + encodeURIComponent(game) : ""), { cache: "no-store" })
    ]);
    const feedback = await feedbackRes.json();
    const trending = await trendingRes.json();
    const fbSeries = (feedback.series || []).filter((entry) => entry.extra.samples > 0);
    const tdSeries = trending.series || [];
    lastTrendStats = { fbSeries, tdSeries };
    section.hidden = false;
    renderTrendBarChart("#trend-chart-feedback", fbSeries, (entry) => entry.extra.samples ? Math.round((entry.extra.negative / entry.extra.samples) * 100) : 0, (entry) => ({ text: entry.date + "：负向 " + (entry.extra.samples ? Math.round((entry.extra.negative / entry.extra.samples) * 100) : 0) + "%（" + entry.extra.samples + " 条）", negative: true }));
    renderTrendBarChart("#trend-chart-trending", tdSeries, (entry) => entry.extra.topics, (entry) => ({ text: entry.date + "：" + entry.extra.topics + " 条热点" }));
    renderTrendConclusion(fbSeries, tdSeries);
  } catch (_error) {
    section.hidden = true;
  }
}

function splitWeeks(series) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const current = series.filter((entry) => entry.date > weekAgo && entry.date <= today);
  const previous = series.filter((entry) => entry.date <= weekAgo);
  return { current, previous };
}

function negativeRatio(series) {
  const samples = series.reduce((sum, entry) => sum + entry.extra.samples, 0);
  const negative = series.reduce((sum, entry) => sum + entry.extra.negative, 0);
  return samples ? negative / samples : null;
}

function topicTotal(series) {
  return series.reduce((sum, entry) => sum + entry.extra.topics, 0);
}

function renderTrendConclusion(feedbackSeries, trendingSeries) {
  const target = document.querySelector("#trend-conclusion");
  if (!target) return;
  const lines = [];
  if (feedbackSeries.length >= 2) {
    const weeks = splitWeeks(feedbackSeries);
    const nowRatio = negativeRatio(weeks.current);
    const prevRatio = negativeRatio(weeks.previous);
    if (nowRatio !== null && prevRatio !== null) {
      const diff = Math.round((nowRatio - prevRatio) * 1000) / 10;
      const direction = diff > 0.5 ? "上升 " + diff + " 个百分点，建议加强舆情监测" : diff < -0.5 ? "下降 " + Math.abs(diff) + " 个百分点，口碑企稳" : "基本持平";
      lines.push("负向评论占比 " + (nowRatio * 100).toFixed(1) + "%，较上一周期" + direction + "。");
    }
  }
  if (trendingSeries.length >= 2) {
    const weeks = splitWeeks(trendingSeries);
    const nowTopics = topicTotal(weeks.current);
    const prevTopics = topicTotal(weeks.previous);
    if (prevTopics > 0) {
      const change = Math.round(((nowTopics - prevTopics) / prevTopics) * 100);
      lines.push("热点快照条数环比 " + (change >= 0 ? "+" : "") + change + "%（" + nowTopics + " vs " + prevTopics + "）。");
    }
  }
  target.textContent = lines.length ? "环比结论：" + lines.join(" ") : "积累更多存档后，这里会自动给出周环比结论。";
}
/* ---- LLM 增强服务 ---- */

function gamePlatformLabel() {
  return document.querySelector("#trending-platform")?.value || "B站";
}

function archiveSnapshot(kind, game, payload) {
  if (isOnlineServiceMode()) return;
  const body = JSON.stringify({ kind, game, source: payload.source || "sample", payload });
  fetch(ARCHIVE_SERVICE_URL + "/snapshots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  }).catch(() => { /* 存档失败不影响主流程 */ });
}

let llmServiceState = "down";

/* ---- 今日运营简报 ---- */

let lastBriefing = null;

function collectBriefingData() {
  const game = document.querySelector("#trending-game")?.value.trim()
    || document.querySelector("#version-game")?.value.trim() || "未设置";
  const topics = currentTrendingTopics.slice(0, 5).map((topic) => ({
    rank: topic.rank,
    title: topic.title,
    tag: topic.tag,
    risk: topic.risk?.level || "正常",
    heat: topic.heat || "",
    author: topic.author || ""
  }));
  const riskText = document.querySelector("#feedback-risk-summary")?.textContent?.trim() || "";
  const emotionText = document.querySelector("#emotion-summary")?.textContent?.trim() || "";
  const sourceTexts = ["#trending-source-status", "#feedback-source-status"]
    .map((selector) => document.querySelector(selector)?.textContent || "");
  const usesSample = /样例|兜底|演示/.test(sourceTexts.join("；"))
    || currentTrendingTopics.some((topic) => topic.source !== "real");
  return {
    game,
    generatedAt: new Date().toISOString(),
    dataSource: usesSample ? "sample" : "real",
    topics,
    feedback: { risk: riskText, emotion: emotionText },
    riskEventCount: collectRiskEventsText() ? (currentFeedbackRows || []).length : 0,
    todoSuggestions: buildBriefingTodos(topics, riskText)
  };
}

function buildBriefingTodos(topics, riskText) {
  const todos = [];
  if (/风险|负向|预警/.test(riskText)) todos.push("优先处理舆情预警项，2 小时内跟进最新评论走向。");
  if (topics.length) todos.push("从热点 TOP3 中选择 1 个选题，套用竞品拆解的标题结构产出今日内容。");
  if (!topics.length) todos.push("先运行热点追踪，确认今日可蹭的赛道热度。");
  todos.push("检查版本节点：确认本周是否有需要提前铺垫的内容排期。");
  return todos;
}

function renderBriefing(briefing) {
  const body = document.querySelector("#briefing-body");
  if (!body) return;
  body.hidden = false;
  const topicLines = briefing.topics.length
    ? briefing.topics.map((topic) => `<li>TOP${topic.rank} ${escapeHtml(topic.title)}（${escapeHtml(topic.tag)} · 风险：${escapeHtml(topic.risk)}）</li>`).join("")
    : "<li>暂无热点数据，请先运行热点追踪。</li>";
  const todoLines = briefing.todoSuggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const dataSourceLabel = briefing.dataSource === "real" ? "真实数据" : "含样例/兜底数据";
  body.innerHTML = `
    <h4>${escapeHtml(briefing.game)} · 运营简报</h4>
    <p class="muted-copy">生成时间：${escapeHtml(new Date(briefing.generatedAt).toLocaleString())} · 数据状态：${dataSourceLabel}${briefing.weekOverWeek ? " · 负向占比 " + (briefing.weekOverWeek.negativeRatio * 100).toFixed(1) + "%（环比 " + (briefing.weekOverWeek.changePoints >= 0 ? "+" : "") + briefing.weekOverWeek.changePoints + " 个百分点）" : ""}</p>
    <h5>今日热点 TOP${briefing.topics.length}</h5>
    <ul>${topicLines}</ul>
    <h5>舆情动态</h5>
    <p>${escapeHtml(briefing.feedback.risk || "暂无舆情数据，请先运行评论分析。")}</p>
    <p>${escapeHtml(briefing.feedback.emotion)}</p>
    <h5>待办建议</h5>
    <ul>${todoLines}</ul>
  `;
}
async function generateDailyBriefing() {
  const status = document.querySelector("#briefing-status");
  if (status) {
    status.textContent = "简报状态：正在汇总各模块数据…";
    status.className = "source-status";
  }
  loadTrendStats();
  try {
    if (!currentTrendingTopics.length) await analyzeTrending();
    analyzeFeedback();
  } catch (_error) { /* 各模块失败时按现有兜底展示 */ }
  lastBriefing = collectBriefingData();
  if (lastTrendStats) {
    const weeks = splitWeeks(lastTrendStats.fbSeries);
    const nowRatio = negativeRatio(weeks.current);
    const prevRatio = negativeRatio(weeks.previous);
    if (nowRatio !== null && prevRatio !== null) {
      const diff = Math.round((nowRatio - prevRatio) * 1000) / 10;
      lastBriefing.weekOverWeek = {
        negativeRatio: nowRatio,
        changePoints: diff
      };
    }
  }
  renderBriefing(lastBriefing);
  if (status) {
    status.textContent = lastBriefing.dataSource === "real"
      ? "简报状态：已基于真实数据生成。可直接存档形成工作日志。"
      : "简报状态：已生成（部分为样例/兜底数据），存档时会保留该标记。";
    status.className = "source-status " + (lastBriefing.dataSource === "real" ? "source-real" : "source-mock");
  }
}

async function archiveCurrentBriefing() {
  const status = document.querySelector("#briefing-status");
  if (!lastBriefing) {
    if (status) {
      status.textContent = "简报状态：请先生成今日简报，再执行存档。";
      status.className = "source-status source-mock";
    }
    return;
  }
  if (isOnlineServiceMode()) {
    if (status) {
      status.textContent = "简报状态：线上模式暂不支持本地存档，请切换本地模式或导出内容。";
      status.className = "source-status source-mock";
    }
    return;
  }
  try {
    const response = await fetch(ARCHIVE_SERVICE_URL + "/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "briefing",
        game: lastBriefing.game,
        source: lastBriefing.dataSource,
        payload: lastBriefing
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "HTTP " + response.status);
    if (status) {
      status.textContent = `简报状态：已存档（编号 #${payload.id}）。可点击“查看最近存档”回看。`;
      status.className = "source-status source-real";
    }
    await loadBriefingArchive();
  } catch (error) {
    if (status) {
      status.textContent = `简报状态：存档失败（${error.message}）。请确认本机存档服务已启动。`;
      status.className = "source-status source-mock";
    }
  }
}

function renderBriefArchiveItem(briefing) {
  const container = document.querySelector("#briefing-archive-list");
  if (!container) return;
  const entry = document.createElement("article");
  entry.className = "briefing-archive-item";
  const dateLabel = new Date(briefing.created_at).toLocaleString();
  const summary = (briefing.payload.topics || [])
    .slice(0, 2)
    .map((topic) => escapeHtml(topic.title))
    .join("、") || "无热点条目";
  const button = document.createElement("button");
  button.className = "secondary-button";
  button.type = "button";
  button.textContent = "查看";
  button.addEventListener("click", () => {
    lastBriefing = briefing.payload;
    renderBriefing(briefing.payload);
    const status = document.querySelector("#briefing-status");
    if (status) {
      status.textContent = `简报状态：已载入 ${dateLabel} 的存档（${briefing.source === "real" ? "真实数据" : "样例数据"}）。`;
      status.className = "source-status source-real";
    }
  });
  const text = document.createElement("div");
  text.innerHTML = `<strong>${escapeHtml(dateLabel)} · ${escapeHtml(briefing.game)}</strong><small>${summary}</small>`;
  entry.append(text, button);
  container.prepend(entry);
}

async function loadBriefingArchive() {
  const container = document.querySelector("#briefing-archive-list");
  if (!container || isOnlineServiceMode()) return;
  try {
    const response = await fetch(ARCHIVE_SERVICE_URL + "/snapshots?kind=briefing&limit=7", { cache: "no-store" });
    const payload = await response.json();
    container.innerHTML = "";
    for (const item of payload.items || []) {
      renderBriefArchiveItem({ ...item, payload: item.payload });
    }
    if (!(payload.items || []).length) {
      container.innerHTML = '<p class="muted-copy">暂无历史简报。生成并存档后，这里会保留最近 7 份。</p>';
    }
  } catch (_error) {
    container.innerHTML = '<p class="muted-copy">存档服务不可用（本机 8796 端口）。历史回看功能需在本地模式运行存档服务。</p>';
  }
}

document.querySelector("#generate-briefing")?.addEventListener("click", generateDailyBriefing);
document.querySelector("#archive-briefing")?.addEventListener("click", archiveCurrentBriefing);
document.querySelector("#load-briefing-archive")?.addEventListener("click", loadBriefingArchive);
let llmModelName = "";

async function checkLlmHealth(expectedModeGeneration = serviceModeGuard.current()) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2400);
  try {
    const response = await fetch(`${LLM_SERVICE_URL}/health`, { signal: controller.signal, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (payload.service !== "gameops-llm") throw new Error("identity mismatch");
    if (serviceModeGuard.isCurrent(expectedModeGeneration)) {
      llmServiceState = payload.llm === "ready" ? "ready" : payload.llm === "no_key" ? "no_key" : "not_ready";
      llmModelName = payload.model || "";
    }
  } catch (_error) {
    if (serviceModeGuard.isCurrent(expectedModeGeneration)) {
      llmServiceState = "down";
      llmModelName = "";
    }
  } finally {
    window.clearTimeout(timeout);
  }
  return llmServiceState;
}

function renderLlmBadge(id) {
  const badge = document.querySelector(id);
  if (!badge) return;
  if (llmServiceState === "ready") {
    badge.textContent = `AI 增强 · ${llmModelName}`;
    badge.className = "ai-mode-badge ai-active";
  } else {
    badge.textContent = "规则模式";
    badge.className = "ai-mode-badge";
  }
}

async function requestLlmTask(task, data, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LLM_SERVICE_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, data }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, reason: payload.llm === "no_key" ? "no_key" : "error", message: payload.error || `HTTP ${response.status}` };
    }
    return { ok: true, result: payload.result, model: payload.model, cached: payload.cached };
  } catch (error) {
    return { ok: false, reason: error.name === "AbortError" ? "timeout" : "down", message: error.message };
  } finally {
    window.clearTimeout(timeout);
  }
}

let feedbackLlmGeneration = 0;
let versionLlmGeneration = 0;

async function enhanceFeedbackWithLlm() {
  const generation = ++feedbackLlmGeneration;
  renderLlmBadge("#feedback-ai-badge");
  const panel = document.querySelector("#feedback-ai-insight");
  if (!panel) return;
  try {
    if (llmServiceState !== "ready") {
      panel.innerHTML = `<p class="muted-copy">当前为规则引擎结果。${
        llmServiceState === "no_key"
          ? "未配置 LLM_API_KEY：在项目根目录 .env 中配置后重启本地服务，即可启用大模型深度洞察。"
          : "AI 增强服务未连接，规则引擎结果保持可用。"
      }</p>`;
      return;
    }

    const game = document.querySelector("#feedback-game")?.value.trim() || "目标游戏";
    const comments = currentFeedbackRows.slice(0, 60).map((row) => row.comment);
    if (comments.length < 3) {
      panel.innerHTML = `<p class="muted-copy">评论样本不足 3 条，跳过 AI 深度分析（规则引擎结果不受影响）。</p>`;
      return;
    }

    panel.innerHTML = `<p class="muted-copy">AI 正在分析 ${comments.length} 条评论…</p>`;
    const startedAt = Date.now();
    const response = await requestLlmTask("feedback-insight", { game, comments });
    if (generation !== feedbackLlmGeneration) return;
    if (!response.ok) {
      panel.innerHTML = `<p class="muted-copy">AI 分析未完成（${escapeHtml(response.message || response.reason)}），已保留上方规则引擎结果。</p>`;
      return;
    }

    const insight = response.result || {};
    const quotes = Array.isArray(insight.representative_quotes)
      ? insight.representative_quotes.filter((q) => q && typeof q === "object").slice(0, 3).map((q) => `「${String(q.comment || "").slice(0, 50)}」— ${q.reason || ""}`)
      : [];
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    panel.innerHTML = `
      <p class="ai-insight-summary">${escapeHtml(insight.summary || "")}</p>
      <p class="muted-copy">${escapeHtml(insight.sentiment_overview || "")}</p>
      ${Array.isArray(insight.top_issues) && insight.top_issues.length ? `<h4>核心议题</h4><ul class="result-list">${insight.top_issues.slice(0, 5).map((t) => `<li>${escapeHtml(String(t))}</li>`).join("")}</ul>` : ""}
      ${Array.isArray(insight.suggested_actions) && insight.suggested_actions.length ? `<h4>AI 运营建议</h4><ul class="result-list">${insight.suggested_actions.slice(0, 5).map((t) => `<li>${escapeHtml(String(t))}</li>`).join("")}</ul>` : ""}
      ${quotes.length ? `<h4>代表性评论</h4><ul class="result-list">${quotes.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
      <p class="muted-copy">由 ${escapeHtml(response.model || llmModelName)} 生成 · 耗时 ${elapsed}s${response.cached ? " · 命中缓存" : ""}，结果仅供参考，请结合规则引擎交叉验证。</p>
    `;
  } catch (error) {
    if (generation === feedbackLlmGeneration) {
      panel.innerHTML = `<p class="muted-copy">AI 分析出现异常（${escapeHtml(error.message || "未知错误")}），已保留规则引擎结果。</p>`;
    }
  }
}

async function enhanceVersionWithLlm() {
  const generation = ++versionLlmGeneration;
  renderLlmBadge("#version-ai-badge");
  const panel = document.querySelector("#version-ai-copy");
  if (!panel) return;
  try {
    if (llmServiceState !== "ready") {
      panel.innerHTML = `<p class="muted-copy">当前为模板生成结果。${
        llmServiceState === "no_key"
          ? "未配置 LLM_API_KEY：在项目根目录 .env 中配置后重启本地服务，即可启用大模型文案。"
          : "AI 增强服务未连接，模板结果保持可用。"
      }</p>`;
      return;
    }

    const game = document.querySelector("#version-game").value.trim() || "目标游戏";
    const theme = document.querySelector("#version-theme").value.trim() || "全新版本";
    const points = splitLines(document.querySelector("#version-points").value);
    const style = document.querySelector("#version-style").value;
    const audience = document.querySelector("#version-audience").value;

    panel.innerHTML = `<p class="muted-copy">AI 正在生成「${escapeHtml(theme)}」版本文案…</p>`;
    const startedAt = Date.now();
    const response = await requestLlmTask("version-copy", { game, theme, points, style, audience });
    if (generation !== versionLlmGeneration) return;
    if (!response.ok) {
      panel.innerHTML = `<p class="muted-copy">AI 文案生成失败（${escapeHtml(response.message || response.reason)}），已保留模板结果。</p>`;
      return;
    }

    const copy = response.result || {};
    const social = copy.social || {};
    const socialEntries = [["B站", social.bilibili], ["抖音", social.douyin], ["小红书", social.xiaohongshu], ["微博", social.weibo]]
      .filter(([, value]) => value);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    panel.innerHTML = `
      ${copy.announcement ? `<h4>AI 公告文案</h4><p class="ai-insight-summary">${escapeHtml(copy.announcement)}</p>` : ""}
      ${socialEntries.length ? `<h4>AI 社媒文案</h4><div class="copy-grid">${socialEntries.map(([title, body]) => `<div class="copy-card"><strong>${title}</strong><p>${escapeHtml(String(body))}</p></div>`).join("")}</div>` : ""}
      ${Array.isArray(copy.push_titles) && copy.push_titles.length ? `<h4>AI 推送标题</h4><div class="pill-list">${copy.push_titles.slice(0, 5).map((t) => `<span>${escapeHtml(String(t))}</span>`).join("")}</div>` : ""}
      <p class="muted-copy">由 ${escapeHtml(response.model || llmModelName)} 生成 · 耗时 ${elapsed}s${response.cached ? " · 命中缓存" : ""}，与上方模板结果可对照使用。</p>
    `;
  } catch (error) {
    if (generation === versionLlmGeneration) {
      panel.innerHTML = `<p class="muted-copy">AI 文案生成出现异常（${escapeHtml(error.message || "未知错误")}），已保留模板结果。</p>`;
    }
  }
}

async function checkOcrHealth(retriesLeft = 50, expectedModeGeneration = serviceModeGuard.current()) {
  const generation = ++ocrHealthGeneration;
  const dot = document.querySelector("#ocr-status-dot");
  const text = document.querySelector("#ocr-status-text");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2400);

  const scheduleRetry = () => {
    if (retriesLeft > 0 && generation === ocrHealthGeneration) {
      window.setTimeout(() => {
        if (generation === ocrHealthGeneration && serviceModeGuard.isCurrent(expectedModeGeneration)) checkOcrHealth(retriesLeft - 1, expectedModeGeneration);
      }, 2000);
    }
  };

  try {
    const response = await fetch(`${OCR_SERVICE_URL}/health`, { signal: controller.signal, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!serviceModeGuard.isCurrent(expectedModeGeneration)) return;
    if (payload.ocr === "ready") {
      ocrServerOnline = true;
      ocrServiceState = "ready";
      if (dot) { dot.className = "ocr-status-dot ocr-dot-online"; }
      if (text) { text.textContent = "OCR 服务已连接 — 支持手机端和电脑端截图识别"; }
    } else if (payload.ocr === "not_ready") {
      ocrServerOnline = false;
      ocrServiceState = "not_ready";
      if (dot) { dot.className = "ocr-status-dot ocr-dot-offline"; }
      if (text) { text.textContent = payload.detail || (isOnlineServiceMode() ? "OCR 服务异常，请检查线上 /api/ocr" : "OCR 服务异常，请重启本地服务"); }
    } else {
      const preparing = payload.ocr === "preparing";
      ocrServerOnline = false;
      if (preparing) ocrServiceState = "preparing";
      if (dot) { dot.className = "ocr-status-dot"; }
      if (text) { text.textContent = preparing ? "OCR 服务正在准备 macOS Vision，首次启动可能需要几十秒" : "正在检查 OCR 服务…"; }
      scheduleRetry();
    }
  } catch (_e) {
    if (!serviceModeGuard.isCurrent(expectedModeGeneration)) return;
    ocrServerOnline = false;
    ocrServiceState = "down";
    if (dot) { dot.className = "ocr-status-dot ocr-dot-offline"; }
    if (text) {
      text.textContent = isOnlineServiceMode()
        ? "OCR 服务未连接 — 请检查线上 /api/ocr 反向代理或云 OCR 配置"
        : "OCR 服务未启动 — 请点击页面中的“一键启动本地服务”";
    }
    scheduleRetry();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkServiceEndpoint(url, path = "/health", timeoutMs = 2400, expectedService = "") {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}${path}`, { signal: controller.signal, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    const identityOk = !expectedService || payload.service === expectedService;
    const preparing = payload.ocr === "preparing";
    // OCR 首次启动可能返回 ok:false + ocr:"preparing"，进程已在线，不能当成未启动。
    const online = response.ok && identityOk && (payload.ok !== false || preparing);
    let detail = payload.message || payload.note || payload.detail || (response.ok ? "已连接" : `异常 HTTP ${response.status}`);
    if (response.ok && expectedService && !identityOk) {
      detail = "服务身份不匹配";
    } else if (preparing) {
      detail = payload.detail || "服务已启动，正在准备";
    } else if (response.ok && online && !payload.message && !payload.note) {
      detail = "本机服务已连接";
    }
    return { online, detail };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      online: false,
      detail: aborted ? "检测超时" : "未启动"
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function renderServiceCard(id, result, fallback) {
  const card = document.querySelector(id);
  if (!card) return;

  if (!result) {
    card.classList.remove("online", "offline");
    const copy = card.querySelector("p");
    if (copy) copy.textContent = fallback || "检测中...";
    return;
  }

  const status = result;
  card.classList.toggle("online", status.online);
  card.classList.toggle("offline", !status.online);
  const copy = card.querySelector("p");
  if (copy) {
    copy.textContent = status.online ? status.detail : `${status.detail}，相关模块会使用手动输入或样例兜底数据`;
  }
}

async function getLocalServiceStatus() {
  // 启动状态只查 /health：轻量且校验 service 身份。
  // 不要用 /probe（会真实请求 B站，常 >1.5s，容易被 2.4s 超时误判为“未启动”）。
  // LLM 卡片状态由 checkLlmHealth 的 llmServiceState 决定（区分 ready/no_key），不在此重复探测。
  const [ocr, hotspot, comment] = await Promise.all([
    checkServiceEndpoint(OCR_SERVICE_URL, "/health", 2400, "gameops-ocr"),
    checkServiceEndpoint(HOTSPOT_SERVICE_URL, "/health", 2400, "gameops-hotspot"),
    checkServiceEndpoint(COMMENT_SERVICE_URL, "/health", 2400, "gameops-comments")
  ]);
  const llm =
    llmServiceState === "ready"
      ? { online: true, detail: `AI 增强已启用（${llmModelName}）` }
      : llmServiceState === "no_key" || llmServiceState === "not_ready"
      ? { online: true, detail: "服务运行中 · 未配置 API Key，模块运行规则模式" }
      : { online: false, detail: "未启动，模块自动使用规则模式" };
  return { ocr, hotspot, comment, llm };
}

async function refreshOverviewServiceStatus() {
  const modeGeneration = serviceModeGuard.current();
  renderServiceModeControls();
  renderServiceCard("#service-status-ocr", null, "检测中");
  renderServiceCard("#service-status-hotspot", null, "检测中");
  renderServiceCard("#service-status-comment", null, "检测中");
  renderServiceCard("#service-status-llm", null, "检测中");
  await checkLlmHealth(modeGeneration);
  if (!serviceModeGuard.isCurrent(modeGeneration)) return null;

  const { ocr, hotspot, comment, llm } = await getLocalServiceStatus();
  if (!serviceModeGuard.isCurrent(modeGeneration)) return null;

  renderServiceCard("#service-status-ocr", ocr);
  renderServiceCard("#service-status-hotspot", hotspot);
  renderServiceCard("#service-status-comment", comment);
  renderServiceCard("#service-status-llm", llm);
  renderLlmBadge("#feedback-ai-badge");
  renderLlmBadge("#version-ai-badge");
  return { ocr, hotspot, comment, llm };
}

function renderDemoCheck(items) {
  const panel = document.querySelector("#demo-check-panel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="demo-check-head">
      <strong>演示前自检结果</strong>
      <span>${items.filter((item) => item.ok).length}/${items.length} 项通过</span>
    </div>
    <div class="demo-check-list">
      ${items.map((item) => `
        <article class="demo-check-item ${item.ok ? "check-ok" : item.required ? "check-risk" : "check-warn"}">
          <strong>${item.ok ? "通过" : item.required ? "需处理" : "可兜底"}</strong>
          <span>${escapeHtml(item.label)}</span>
          <small>${escapeHtml(item.detail)}</small>
        </article>
      `).join("")}
    </div>
  `;
}

async function runDemoReadinessCheck() {
  const status = document.querySelector("#overview-status");
  if (status) {
    status.textContent = "总览状态：正在执行演示前自检...";
    status.className = "source-status";
  }

  const services = await refreshOverviewServiceStatus();
  const demoMode = isDemoMode();
  const hasHotspots = currentTrendingTopics.length > 0;
  const hasFeedback = currentFeedbackRows.length > 0 || splitFeedbackInput(document.querySelector("#feedback-input")?.value || "").length > 0;
  const hasCreators = currentCreatorRows.length > 0 || splitLines(document.querySelector("#creator-input")?.value || "").length > 1;
  const hasReviewData = streamers.length > 0 || numberValue(document.querySelector("#impressions")?.value) > 0;
  const hasVersionInput = (document.querySelector("#version-theme")?.value || "").trim().length > 0;
  const hasSegmentInput = (document.querySelector("#segment-game")?.value || "").trim().length > 0;

  const items = [
    {
      ok: services.hotspot.online || demoMode,
      required: !demoMode,
      label: "热点追踪可演示",
      detail: services.hotspot.online ? `真实热点服务正常：${services.hotspot.detail}` : demoMode ? "真实热点不可用时会切换样例兜底。" : "热点服务未连接，且未开启样例兜底。"
    },
    {
      ok: services.comment.online || demoMode,
      required: !demoMode,
      label: "评论抓取可演示",
      detail: services.comment.online ? `评论服务正常：${services.comment.detail}` : demoMode ? "评论接口失败时会使用样例评论继续分析。" : "评论服务未连接，且未开启样例兜底。"
    },
    {
      ok: services.ocr.online || hasReviewData,
      required: false,
      label: "活动复盘数据可演示",
      detail: services.ocr.online ? `OCR 服务正常：${services.ocr.detail}` : hasReviewData ? "已有手动/示例活动数据，截图识别失败也能演示复盘。" : "建议载入示例数据或手动填入活动数据。"
    },
    {
      ok: hasHotspots || demoMode,
      required: false,
      label: "热点榜单已有结果",
      detail: hasHotspots ? `当前已有 ${currentTrendingTopics.length} 条热点结果。` : "还没有热点结果，演示时可先点击热点追踪。"
    },
    {
      ok: hasFeedback,
      required: false,
      label: "评论分析有样本",
      detail: hasFeedback ? "评论输入区已有样本，可直接生成舆情结论。" : "建议先抓取热门视频评论或保留默认样例评论。"
    },
    {
      ok: hasCreators,
      required: false,
      label: "KOL/KOC 筛选有数据",
      detail: hasCreators ? "达人列表已有数据，可展示目标分和性价比逻辑。" : "建议导入表格或载入示例达人数据。"
    },
    {
      ok: hasVersionInput,
      required: false,
      label: "版本包装模块可演示",
      detail: hasVersionInput ? "版本主题已填写，可生成包装方案。" : "未填写版本主题，可先输入再演示或用默认样例。"
    },
    {
      ok: hasSegmentInput,
      required: false,
      label: "玩家分层模块可演示",
      detail: hasSegmentInput ? "游戏名称已填写，可生成分层策略。" : "未填写游戏名称，可先输入再演示或用默认样例。"
    },
    {
      ok: services.ocr.online,
      required: false,
      label: "OCR 截图识别服务",
      detail: services.ocr.online ? `OCR 服务正常：${services.ocr.detail}` : "OCR 服务未启动，手工输入数据也可完成复盘演示。"
    },
    {
      ok: services.hotspot.online,
      required: false,
      label: "热点服务真实状态",
      detail: services.hotspot.online ? `热点服务正常：${services.hotspot.detail}` : "热点服务未启动，样例兜底仍可演示。"
    },
    {
      ok: services.comment.online,
      required: false,
      label: "评论服务真实状态",
      detail: services.comment.online ? `评论服务正常：${services.comment.detail}` : "评论服务未启动，样例兜底仍可演示。"
    }
  ];

  renderDemoCheck(items);

  if (status) {
    const requiredRisk = items.some((item) => item.required && !item.ok);
    const passCount = items.filter((item) => item.ok).length;
    const totalCount = items.length;
    status.textContent = requiredRisk
      ? `总览状态：自检发现关键服务未就绪（${passCount}/${totalCount} 项通过）。建议开启样例兜底，或重新运行本地服务。`
      : `总览状态：自检完成（${passCount}/${totalCount} 项通过），可以进入演示。真实服务不可用的部分已准备兜底口径。`;
    status.className = requiredRisk ? "source-status source-mock" : "source-status source-real";
  }
}

async function tryRecognizeScreenshot(streamerId, file) {
  const streamer = streamers.find((item) => item.id === streamerId);
  if (!streamer) return;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${OCR_SERVICE_URL}/ocr`, {
      method: "POST",
      body: file,
      signal: controller.signal
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const statusMessage = response.status === 429
        ? "请求过于频繁，请稍后重试"
        : response.status === 503
          ? "OCR 服务繁忙或尚未就绪"
          : response.status === 502
            ? "远端 OCR 调用失败"
            : (errData.error || "服务端错误");
      streamer.ocrStatus = "识别失败：" + statusMessage;
      streamer.ocrText = "";
      streamer.ocrDebug = { error: errData.error, hint: errData.hint };
      renderStreamerList();
      return;
    }

    const data = await response.json();
    streamer.ocrText = data.text || "";
    streamer.ocrDebug = data.metrics ? data.metrics._meta : null;

    if (data.metrics) {
      let recognizedCount = 0;
      if (data.metrics.acu) { streamer.event.acu = data.metrics.acu; recognizedCount++; }
      if (data.metrics.pcu) { streamer.event.pcu = data.metrics.pcu; recognizedCount++; }
      if (data.metrics.impressions) { streamer.event.impressions = data.metrics.impressions; recognizedCount++; }
      if (data.metrics.entries) { streamer.event.entries = data.metrics.entries; recognizedCount++; }

      updateStreamerOcrHint(streamer);
      if (recognizedCount >= 3) {
        streamer.ocrStatus = "✅ 识别成功，已填充 " + recognizedCount + "/4 项指标";
      } else if (recognizedCount > 0) {
        streamer.ocrStatus = "⚠️ 部分识别（" + recognizedCount + "/4），请手动补全";
      } else {
        streamer.ocrStatus = "❌ 未能识别指标，请查看原始文本手动输入";
      }
    } else {
      streamer.ocrStatus = "❌ OCR 返回异常，请重试";
      streamer.ocrHint = "OCR 未返回结构化指标，可以先保留截图，再手动补全四项核心数据。";
    }

    renderStreamerList();
    analyzeReview();
  } catch (error) {
    streamer.ocrStatus = error.name === "AbortError"
      ? "OCR 请求超时，请稍后重试"
      : isOnlineServiceMode()
        ? "无法连接线上 OCR，请检查 /api/ocr"
        : "OCR 服务未启动，请在终端执行 node ocr-server.js";
    streamer.ocrText = "";
    streamer.ocrDebug = { error: "无法连接到 OCR 服务" };
    streamer.ocrHint = "可切换到手动录入模式，或先载入示例数据演示复盘链路。";
    renderStreamerList();
  } finally {
    window.clearTimeout(timeout);
  }
}

/* ========================================
   模块1：竞品内容拆解
   ======================================== */

const contentTypeRules = [
  { label: "攻略教学", words: ["攻略", "教程", "路线", "配队", "培养", "强度", "技巧", "指南"], explain: "解决明确问题，适合沉淀长尾搜索和收藏价值。" },
  { label: "版本资讯", words: ["版本", "前瞻", "直播", "爆料", "更新", "公告", "上线", "官宣"], explain: "依赖时效性和信息增量，适合节点快速跟进。" },
  { label: "福利活动", words: ["福利", "兑换码", "奖励", "补偿", "登录", "抽奖", "回归"], explain: "驱动点击和参与，重点要讲清领取路径和时间限制。" },
  { label: "角色/外观内容", words: ["角色", "皮肤", "外观", "限定", "建模", "剧情", "互动", "载具", "车辆"], explain: "承接角色厨、外观党和收藏情绪，适合做情绪化包装。" },
  { label: "争议讨论", words: ["争议", "吐槽", "退坑", "节奏", "削弱", "加强", "骗氪", "骂", "翻车"], explain: "容易带来评论互动，但需要控制表达边界和事实来源。" },
  { label: "二创整活", words: ["二创", "同人", "整活", "搞笑", "名场面", "鬼畜", "mmd", "混剪", "cos"], explain: "适合社区传播和情感连接，可转化为征集活动或短切片。" },
  { label: "直播切片", words: ["直播", "主播", "切片", "口播", "连麦", "组队", "挑战"], explain: "依赖人物表达和现场感，适合做福利承接和互动转化。" }
];

const contentEmotionRules = [
  { label: "怕错过福利", words: ["福利", "兑换码", "奖励", "限时", "登录", "补偿"] },
  { label: "想快速变强", words: ["攻略", "强度", "培养", "配队", "路线", "速通", "技巧"] },
  { label: "角色厨情绪", words: ["角色", "皮肤", "剧情", "互动", "建模", "立绘", "外观"] },
  { label: "回流焦虑", words: ["回归", "追赶", "老玩家", "错过", "落后"] },
  { label: "氪金压力", words: ["抽卡", "氪金", "付费", "保底", "概率", "礼包", "贵"] },
  { label: "争议围观", words: ["争议", "吐槽", "节奏", "翻车", "退坑", "骂"] },
  { label: "身份认同", words: ["老玩家", "核心玩家", "萌新", "平民", "大佬", "车手", "博士", "旅行者"] }
];

function inferContentTypes(input) {
  const matched = contentTypeRules
    .map((rule) => ({
      ...rule,
      count: countMatches(input.toLowerCase(), rule.words.map((word) => word.toLowerCase()))
    }))
    .filter((rule) => rule.count > 0)
    .sort((a, b) => b.count - a.count);
  return matched.length ? matched.slice(0, 3) : [{ label: "综合内容", count: 1, explain: "信息点较分散，建议先明确主卖点，再决定标题和平台表达。" }];
}

function inferContentEmotions(input) {
  const emotions = contentEmotionRules
    .filter((rule) => countMatches(input, rule.words) > 0)
    .map((rule) => rule.label);
  return emotions.length ? uniqueItems(emotions).slice(0, 6) : ["信息好奇", "版本期待", "内容围观"];
}

function buildTitleBreakdown(game, platform, input, types, emotions) {
  const leadType = types[0]?.label || "综合内容";
  const hasNumber = /\d|一|二|三|四|五|十|TOP|top/.test(input);
  const hasQuestion = /吗|如何|怎么|为什么|？|\?/.test(input);
  const hook = emotions[0] || "版本期待";
  return [
    { title: "游戏名/对象", body: `用「${game}」前置，降低用户判断成本，尤其适合${platform}的信息流环境。` },
    { title: "信息增量", body: `核心信息是「${leadType}」，标题需要直接告诉玩家这条内容能解决什么问题。` },
    { title: "情绪钩子", body: `当前最强情绪点是「${hook}」，可以放在标题前半段或封面主文案。` },
    { title: "结构特征", body: `${hasNumber ? "已有数字/结果感，可以强化清单和排名。" : "可以补一个数字化表达，比如 3 点、5 分钟、TOP 榜。"}${hasQuestion ? " 当前有问题悬念，适合引导评论区讨论。" : " 当前悬念感一般，可加入问题句或对比句提升点击。"} ` }
  ];
}

function buildLearnRiskCards(platform, types, emotions) {
  const leadType = types[0]?.label || "综合内容";
  const leadEmotion = emotions[0] || "版本期待";
  const platformAdvice = {
    B站: "可借鉴信息密度、章节结构、对比结论和评论区讨论承接。",
    抖音: "可借鉴前三秒钩子、强情绪口播和短节奏画面切换。",
    小红书: "可借鉴清单体、避坑视角、收藏价值和生活化表达。",
    TapTap: "可借鉴真实体验、问题反馈和开发者回应语气。",
    微博: "可借鉴话题化表达、转评互动和节点扩散。"
  };
  return [
    { title: "可借鉴点", body: `${platformAdvice[platform] || "可借鉴标题钩子、内容结构和玩家互动方式"} 当前内容类型是「${leadType}」，适合复用它的信息组织方式和「${leadEmotion}」情绪承接。` },
    { title: "不可照搬点", body: "不要直接复制竞品表述、封面结构或未经确认的信息；涉及福利、爆料、概率、强度结论时要保留来源和条件，避免标题党反噬。" },
    { title: "复用方式", body: "建议转成自己的版本语言：先保留玩家问题，再替换为本游戏卖点、活动入口、奖励路径和评论区互动问题。" },
    { title: "风险判断", body: leadType === "争议讨论" ? "争议内容需要先做事实核查和情绪分层，不建议直接跟风放大对立。" : "当前可按常规内容复用，但仍要检查福利承诺、拉踩表达和未确认爆料。" }
  ];
}

function analyzeContent() {
  const game = document.querySelector("#game-name").value || "未知游戏";
  const platform = document.querySelector("#platform").value || "B站";
  const input = document.querySelector("#content-input").value;

  const tags = [];
  if (input.includes("限定") || input.includes("角色")) tags.push("角色内容");
  if (input.includes("福利") || input.includes("兑换码") || input.includes("回归")) tags.push("福利内容");
  if (input.includes("前瞻") || input.includes("版本") || input.includes("直播")) tags.push("版本资讯");
  if (input.includes("地图") || input.includes("区域") || input.includes("开放")) tags.push("地图探索");
  const contentTypes = inferContentTypes(input);
  const emotionPoints = inferContentEmotions(input);

  renderMetrics(document.querySelector("#content-metrics"), [
    { label: "平台", value: platform },
    { label: "主类型", value: contentTypes[0].label },
    { label: "情绪点", value: emotionPoints.length }
  ]);

  renderCopyCards(
    document.querySelector("#content-type-list"),
    contentTypes.map((item) => ({
      title: `${item.label} · 命中 ${item.count}`,
      body: item.explain
    }))
  );

  document.querySelector("#title-pattern").textContent =
    platform === "抖音"
      ? `「${game}」${tags[0] || "版本更新"}速看！${input.slice(0, 20)}…——用短平快文案 + 视觉钩子前3秒抓注意力，口播节奏偏快。`
      : `【${game}】${tags.join(" · ")} | ${input.slice(0, 18)}…——用信息增量 + 深度解读建立信任感，标题前置核心卖点。`;
  renderCopyCards(document.querySelector("#title-breakdown"), buildTitleBreakdown(game, platform, input, contentTypes, emotionPoints));
  renderPills(document.querySelector("#content-emotion-points"), emotionPoints);

  renderList(document.querySelector("#topic-list"), [
    `「${game}」${contentTypes[0].label}玩家必看：${emotionPoints.slice(0, 2).join(" + ")}一站式汇总`,
    `${game}当前版本${contentTypes[0].label}怎么做：玩家最关心的 5 个问题`,
    `${platform}上${game}竞品内容拆解：为什么它能打中「${emotionPoints[0]}」`,
    `${game}${contentTypes[0].label}内容对比竞品差异化分析`,
    `从${game}${emotionPoints.join("、")}看${platform}社区内容风向`
  ]);

  renderCopyCards(document.querySelector("#content-learn-risk"), buildLearnRiskCards(platform, contentTypes, emotionPoints));

  renderPills(document.querySelector("#rewrite-list"), [
    "强化情绪钩子",
    "加入对比/排名元素",
    "补充玩家视角吐槽",
    "适配竖屏短视频脚本",
    "增加进度条/时间轴信息密度",
    "预留评论区互动引导"
  ]);
}

/* ========================================
   模块2：玩家评论分析
   ======================================== */

const feedbackCategoryConfig = [
  { label: "性能问题", words: ["卡顿", "发热", "掉帧", "bug", "闪退", "优化", "性能", "延迟", "掉线"] },
  { label: "付费争议", words: ["抽卡", "氪金", "付费", "贵", "保底", "概率", "定价", "骗氪", "648"] },
  { label: "福利反馈", words: ["福利", "奖励", "补偿", "兑换码", "领取", "白送", "资源"] },
  { label: "玩法反馈", words: ["副本", "活动", "玩法", "肝", "重复", "扫荡", "减负", "任务"] },
  { label: "角色/皮肤偏好", words: ["角色", "皮肤", "外观", "剧情", "互动", "建模", "立绘"] },
  { label: "新手门槛", words: ["新手", "教程", "看不懂", "入坑", "门槛", "复杂"] },
  { label: "回流意愿", words: ["回归", "回流", "回来", "老玩家", "退游回来"] },
  { label: "账号/外挂风险", words: ["外挂", "封号", "脚本", "代练", "代肝", "买号", "卖号", "盗号"] },
  { label: "舆情风险", words: ["退坑", "爆雷", "跑路", "诈骗", "骂", "喷", "道歉", "炎上", "抵制", "举报"] }
];

const feedbackPositiveWords = ["喜欢", "好看", "不错", "香", "期待", "舒服", "好玩", "良心", "帅", "爽", "满意", "惊喜"];
const feedbackNegativeWords = ["退坑", "垃圾", "恶心", "失望", "骂", "差", "爆雷", "破防", "卡", "贵", "骗氪", "难受", "离谱", "崩", "烂"];
const feedbackHighRiskWords = ["退坑", "爆雷", "跑路", "诈骗", "外挂", "道歉", "抵制", "举报", "退款", "炎上", "开盒", "人肉", "虚假宣传"];
const feedbackMediumRiskWords = ["骂", "喷", "争议", "节奏", "失望", "补偿", "削弱", "骗氪", "封号", "卡顿", "掉帧", "发热"];
const feedbackAdWords = ["代肝", "代练", "接单", "价格表", "托管", "私信", "vx", "微信", "qq", "群", "陪玩", "出号", "买号", "卖号", "租号", "包月"];

function classifyFeedbackLine(line) {
  return feedbackCategoryConfig.filter((item) => countMatches(line, item.words)).map((item) => item.label);
}

function getFeedbackSentiment(line) {
  const positive = countMatches(line, feedbackPositiveWords);
  const negative = countMatches(line, feedbackNegativeWords);
  if (negative > positive) return "负向";
  if (positive > negative) return "正向";
  return "中性";
}

function getFeedbackRisk(line) {
  if (countMatches(line, feedbackHighRiskWords)) return "高风险";
  if (countMatches(line, feedbackMediumRiskWords) || countMatches(line, feedbackNegativeWords) >= 2) return "需关注";
  return "正常";
}

function splitFeedbackInput(input) {
  const byLine = input
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (byLine.length > 1) return byLine;
  return input
    .split(/[。\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanCommentText(line) {
  return String(line || "")
    .replace(/^【[^】]{1,100}】/, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\[[^\]]{1,16}\]/g, "")
    .replace(/@[\u4e00-\u9fa5A-Za-z0-9_-]{1,24}/g, "")
    .replace(/\s+/g, " ")
    .replace(/([哈啊呀额呃嗯哦])\1{4,}/g, "$1$1$1")
    .trim();
}

function extractCommentSource(line) {
  const match = String(line || "").match(/^【([^】]{1,120})】/);
  return match ? match[1].trim() : "手动输入/单视频";
}

function normalizeCommentKey(line) {
  return cleanCommentText(line)
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}

function isAdComment(line) {
  return countMatches(line.toLowerCase(), feedbackAdWords) > 0;
}

function isInvalidComment(line) {
  const key = normalizeCommentKey(line);
  if (key.length < 2) return true;
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(line)) return true;
  if (/^(哈|啊|嗯|哦|666|233)+$/.test(key) && key.length <= 8) return true;
  return false;
}

function cleanFeedbackLines(rawLines) {
  const seen = new Set();
  const lines = [];
  const items = [];
  let removedDuplicate = 0;
  let removedAd = 0;
  let removedInvalid = 0;

  rawLines.forEach((rawLine) => {
    const source = extractCommentSource(rawLine);
    const line = cleanCommentText(rawLine);
    const key = normalizeCommentKey(line);

    if (isInvalidComment(line)) {
      removedInvalid += 1;
      return;
    }

    if (isAdComment(line)) {
      removedAd += 1;
      return;
    }

    if (seen.has(key)) {
      removedDuplicate += 1;
      return;
    }

    seen.add(key);
    lines.push(line);
    items.push({ line, source });
  });

  return {
    rawCount: rawLines.length,
    lines,
    items,
    removedDuplicate,
    removedAd,
    removedInvalid,
    removedTotal: removedDuplicate + removedAd + removedInvalid
  };
}

function getKeywords(lines, extraStopWords = []) {
  const stopWords = new Set([
    "这个",
    "真的",
    "还是",
    "但是",
    "希望",
    "感觉",
    "玩家",
    "版本",
    "活动",
    "评论",
    "视频",
    "一个",
    "没有",
    "现在",
    "就是",
    ...extraStopWords
  ]);
  const counts = {};
  lines.forEach((line) => {
    const tokens = line.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [];
    tokens.forEach((token) => {
      if (stopWords.has(token)) return;
      counts[token] = (counts[token] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => `${word} ${count}`);
}

function renderFeedbackQuality(cleanResult) {
  const container = document.querySelector("#feedback-quality-metrics");
  if (!container) return;
  renderMetrics(container, [
    { label: "原始样本", value: cleanResult.rawCount },
    { label: "有效评论", value: cleanResult.lines.length },
    { label: "已过滤", value: cleanResult.removedTotal },
    { label: "重复/广告", value: `${cleanResult.removedDuplicate}/${cleanResult.removedAd}` }
  ]);
}

function buildFeedbackRiskResult(rows, sentimentCounts, riskCounts, labels, cleanResult) {
  const total = Math.max(rows.length, 1);
  const negativeRate = sentimentCounts["负向"] / total;
  let level = "正常";
  let className = "feedback-risk-low";
  let emoji = "🙂";
  let statusTitle = "舆情稳定";

  if (riskCounts["高风险"] > 0 || negativeRate >= 0.38) {
    level = "高风险";
    className = "feedback-risk-high";
    emoji = "😡";
    statusTitle = "高风险爆发";
  } else if (riskCounts["需关注"] > 0 || negativeRate >= 0.2 || cleanResult.removedAd > 0) {
    level = "需关注";
    className = "feedback-risk-medium";
    emoji = negativeRate >= 0.2 ? "😟" : "😐";
    statusTitle = negativeRate >= 0.2 ? "风险聚集" : "需观察";
  } else if (!rows.length) {
    emoji = "🤔";
    statusTitle = "样本不足";
  }

  const reasons = [];
  if (riskCounts["高风险"]) reasons.push(`命中 ${riskCounts["高风险"]} 条高风险评论`);
  if (riskCounts["需关注"]) reasons.push(`命中 ${riskCounts["需关注"]} 条需关注评论`);
  if (negativeRate >= 0.2) reasons.push(`负向占比 ${Math.round(negativeRate * 100)}%`);
  if (labels["性能问题"] > 0) reasons.push(`性能问题 ${labels["性能问题"]} 条`);
  if (labels["付费争议"] > 0) reasons.push(`付费争议 ${labels["付费争议"]} 条`);
  if (cleanResult.removedAd > 0) reasons.push(`已过滤疑似广告 ${cleanResult.removedAd} 条`);

  const actions = [];
  if (level === "高风险") actions.push("先做舆情截面记录，保留高风险原评、视频来源和出现频次，避免只凭单条评论判断。");
  if (labels["性能问题"] > 0) actions.push("性能类反馈需要同步研发或测试，社区侧优先准备优化进度和已知问题说明。");
  if (labels["付费争议"] > 0) actions.push("付费争议要拆分为价格、概率、福利感知三个问题，文案侧避免继续刺激付费焦虑。");
  if (labels["福利反馈"] > 0) actions.push("福利反馈适合转成领取路径说明、查漏补缺 FAQ 和短视频口播提醒。");
  if (labels["账号/外挂风险"] > 0) actions.push("账号、外挂、代练相关内容应从分析样本中剔除，同时保留为社区治理线索。");
  if (!actions.length) actions.push("当前未出现集中风险，可以把高频正向点沉淀为后续内容选题和评论区互动话术。");

  return {
    level,
    className,
    emoji,
    statusTitle,
    negativeRate,
    total: rows.length,
    negativeCount: sentimentCounts["负向"],
    attentionCount: riskCounts["需关注"],
    highRiskCount: riskCounts["高风险"],
    summary: rows.length
      ? `当前风险等级：${level}。有效评论 ${rows.length} 条，负向 ${sentimentCounts["负向"]} 条，需关注 ${riskCounts["需关注"]} 条，高风险 ${riskCounts["高风险"]} 条。${reasons.length ? `主要原因：${reasons.join("；")}。` : "未命中明显集中风险。"}`
      : "暂无有效评论，建议扩大样本或检查抓取结果。",
    actions
  };
}

function getTopFeedbackSource(rows, predicate) {
  const counts = {};
  rows.filter(predicate).forEach((row) => {
    const source = row.source || "评论样本";
    counts[source] = (counts[source] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "评论样本";
}

function buildFeedbackRiskEvents(rows, labels, cleanResult) {
  const events = [];
  const buildEvidence = (predicate) => {
    const matched = rows.filter(predicate);
    const sourceSet = new Set(matched.map((row) => row.source || "评论样本"));
    return {
      count: matched.length,
      sourceCount: sourceSet.size,
      sample: matched[0]?.comment || ""
    };
  };
  const addEvent = (title, source, module, severity, response, evidence) => {
    events.push({ title, source, module, severity, response, ...evidence });
  };

  if (labels["性能问题"] > 0) {
    const evidence = buildEvidence((row) => row.categories.includes("性能问题"));
    addEvent(
      "卡顿掉帧反馈集中",
      getTopFeedbackSource(rows, (row) => row.categories.includes("性能问题")),
      "版本体验",
      labels["性能问题"] >= 3 ? "高" : "中",
      "整理机型、场景和复现描述，同步研发后发布已知问题说明。",
      evidence
    );
  }

  if (labels["付费争议"] > 0) {
    const evidence = buildEvidence((row) => row.categories.includes("付费争议"));
    addEvent(
      "抽卡福利争议升温",
      getTopFeedbackSource(rows, (row) => row.categories.includes("付费争议")),
      "商业化/福利",
      labels["付费争议"] >= 3 ? "高" : "中",
      "拆分价格、概率、资源缺口，避免继续放大付费焦虑。",
      evidence
    );
  }

  if (labels["舆情风险"] > 0 || rows.some((row) => row.risk === "高风险")) {
    const evidence = buildEvidence((row) => row.risk !== "正常" || row.categories.includes("舆情风险"));
    addEvent(
      "热门视频评论区扩散",
      getTopFeedbackSource(rows, (row) => row.risk !== "正常" || row.categories.includes("舆情风险")),
      "社区舆情",
      rows.some((row) => row.risk === "高风险") ? "高" : "中",
      "保留原评和来源截图，准备 FAQ 与社区回应口径。",
      evidence
    );
  }

  if (labels["账号/外挂风险"] > 0 || cleanResult.removedAd > 0) {
    const evidence = buildEvidence((row) => row.categories.includes("账号/外挂风险"));
    addEvent(
      "账号/代练信息污染样本",
      getTopFeedbackSource(rows, (row) => row.categories.includes("账号/外挂风险")),
      "社区治理",
      "中",
      "分析样本中剔除广告与代练，同时保留给治理侧排查。",
      {
        ...evidence,
        count: Math.max(evidence.count, cleanResult.removedAd || 0),
        sample: evidence.sample || "疑似广告、代练、账号交易内容已在清洗阶段过滤。"
      }
    );
  }

  if (!events.length) {
    addEvent(
      "暂无集中风险事件",
      "当前有效评论",
      "常规观察",
      "低",
      "继续观察 TOP 视频评论区，把正向高频点沉淀为内容选题。",
      {
        count: rows.length,
        sourceCount: new Set(rows.map((row) => row.source || "评论样本")).size,
        sample: rows[0]?.comment || "暂无代表评论"
      }
    );
  }

  return events.slice(0, 4);
}

function renderFeedbackRiskHero(riskResult) {
  const container = document.querySelector("#feedback-risk-hero");
  if (!container) return;

  container.innerHTML = `
    <div class="risk-emoji" aria-hidden="true">${riskResult.emoji}</div>
    <div class="risk-hero-copy">
      <strong>${escapeHtml(riskResult.statusTitle)}</strong>
      <span>负向占比 ${Math.round((riskResult.negativeRate || 0) * 100)}% · 有效评论 ${riskResult.total || 0} 条 · 高风险 ${riskResult.highRiskCount || 0} 条</span>
    </div>
  `;
}

function renderFeedbackRiskEvents(events) {
  const container = document.querySelector("#feedback-risk-events");
  if (!container) return;

  container.innerHTML = events
    .map((event) => {
      const severityClass = event.severity === "高" ? "risk-event-high" : event.severity === "中" ? "risk-event-medium" : "risk-event-low";
      return `
        <article class="risk-event ${severityClass}">
          <div class="risk-event-head">
            <strong>${escapeHtml(event.title)}</strong>
            <span>${escapeHtml(event.severity)}风险</span>
          </div>
          <p>${escapeHtml(event.source)} · ${escapeHtml(event.module)} · 命中 ${escapeHtml(event.count || 0)} 条 · 来源 ${escapeHtml(event.sourceCount || 0)} 个</p>
          ${event.sample ? `<blockquote>${escapeHtml(event.sample)}</blockquote>` : ""}
          <small>${escapeHtml(event.response)}</small>
        </article>
      `;
    })
    .join("");
}

function renderFeedbackRisk(riskResult) {
  const panel = document.querySelector("#feedback-risk-panel");
  const summary = document.querySelector("#feedback-risk-summary");
  const list = document.querySelector("#feedback-risk-list");
  if (!panel || !summary || !list) return;

  panel.className = `section-block feedback-risk-panel ${riskResult.className}`;
  renderFeedbackRiskHero(riskResult);
  summary.textContent = riskResult.summary;
  renderFeedbackRiskEvents(riskResult.events || []);
  renderList(list, riskResult.actions);
}

function renderFeedbackSourceGroups(rows) {
  renderFeedbackTrendCompare();
  const container = document.querySelector("#feedback-source-groups");
  if (!container) return;

  const groups = rows.reduce((result, row) => {
    const source = row.source || "手动输入/单视频";
    if (!result[source]) {
      result[source] = {
        source,
        total: 0,
        negative: 0,
        highRisk: 0,
        categories: {}
      };
    }
    result[source].total += 1;
    if (row.sentiment === "负向") result[source].negative += 1;
    if (row.risk === "高风险") result[source].highRisk += 1;
    row.categories.forEach((label) => {
      result[source].categories[label] = (result[source].categories[label] || 0) + 1;
    });
    return result;
  }, {});

  const cards = Object.values(groups)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((group) => {
      const topCategory = Object.entries(group.categories).sort((a, b) => b[1] - a[1])[0];
      const riskText = group.highRisk ? `高风险 ${group.highRisk} 条` : `负向 ${group.negative} 条`;
      return {
        title: group.source,
        body: `${group.total} 条有效评论；${topCategory ? `主要集中在“${topCategory[0]}”` : "暂无明显标签"}；${riskText}。`
      };
    });

  renderCopyCards(container, cards.length ? cards : [{ title: "暂无来源拆解", body: "导入热门视频评论后，会按视频标题拆分评论来源和风险表现。" }]);
}

function generateFeedbackActions(labels, sentimentCounts, riskCounts, rows, cleanResult) {
  const actions = [];
  const topLabel = Object.entries(labels).sort((a, b) => b[1] - a[1])[0];

  if (riskCounts["高风险"] > 0) actions.push("建立高风险评论清单，按视频来源、触发词和评论时间归档，优先判断是否需要官方回应。");
  if (labels["性能问题"] > 0) actions.push("性能问题进入版本问题看板，输出“已知问题-处理进度-临时建议”的社区说明。");
  if (labels["付费争议"] > 0) actions.push("付费争议拆成福利感知、抽取概率和资源缺口，下一轮内容重点解释免费资源获取路径。");
  if (labels["玩法反馈"] > 0) actions.push("玩法重复和减负诉求适合做问卷或评论区投票，沉淀成策划反馈材料。");
  if (labels["角色/皮肤偏好"] > 0) actions.push("角色/皮肤正向反馈可转化为角色剧情、建模细节、二创征集和短视频选题。");
  if (cleanResult.removedAd > 0) actions.push("样本中已过滤疑似广告和代练信息，面试演示时可以强调数据清洗避免污染判断。");
  if (!actions.length && topLabel?.[1] > 0) actions.push(`当前主要反馈集中在“${topLabel[0]}”，建议持续观察该标签在后续版本节点的占比变化。`);
  if (!actions.length) actions.push("样本量不足时先扩大评论来源，再做标签趋势和风险判断。");

  return actions.slice(0, 5);
}

function analyzeFeedback() {
  const input = document.querySelector("#feedback-input").value;
  const rawLines = splitFeedbackInput(input);
  const cleanResult = cleanFeedbackLines(rawLines);
  const lines = cleanResult.lines;

  const labels = feedbackCategoryConfig.reduce((result, item) => {
    result[item.label] = 0;
    return result;
  }, {});
  const sentimentCounts = { 正向: 0, 中性: 0, 负向: 0 };
  const riskCounts = { 正常: 0, 需关注: 0, 高风险: 0 };
  currentFeedbackRows = [];

  renderFeedbackQuality(cleanResult);

  const feedbackItems = cleanResult.items?.length ? cleanResult.items : lines.map((line) => ({ line, source: "手动输入/单视频" }));

  feedbackItems.forEach((item) => {
    const categories = classifyFeedbackLine(item.line);
    const sentiment = getFeedbackSentiment(item.line);
    const risk = getFeedbackRisk(item.line);
    categories.forEach((label) => {
      labels[label] += 1;
    });
    sentimentCounts[sentiment] += 1;
    riskCounts[risk] += 1;
    currentFeedbackRows.push({ comment: item.line, source: item.source, categories, sentiment, risk });
  });

  const riskResult = buildFeedbackRiskResult(currentFeedbackRows, sentimentCounts, riskCounts, labels, cleanResult);
  riskResult.events = buildFeedbackRiskEvents(currentFeedbackRows, labels, cleanResult);
  renderFeedbackRisk(riskResult);

  const maxCount = Math.max(1, ...Object.values(labels));

  document.querySelector("#feedback-bars").innerHTML = Object.entries(labels)
    .map(
      ([label, count]) => `
        <div class="bar-row">
          <span>${label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(count / maxCount) * 100}%"></div></div>
          <span>${count}</span>
        </div>
      `
    )
    .join("");

  const topLabel = Object.entries(labels).sort((a, b) => b[1] - a[1])[0];
  document.querySelector("#emotion-summary").textContent =
    lines.length && topLabel[1] > 0
      ? `当前主导反馈集中在“${topLabel[0]}”，共出现 ${topLabel[1]} 条。情绪分布：正向 ${sentimentCounts["正向"]}、中性 ${sentimentCounts["中性"]}、负向 ${sentimentCounts["负向"]}；风险分布：正常 ${riskCounts["正常"]}、需关注 ${riskCounts["需关注"]}、高风险 ${riskCounts["高风险"]}。清洗阶段过滤 ${cleanResult.removedTotal} 条无效/重复/广告评论。${
          topLabel[0] === "付费争议"
            ? "建议跟进抽卡福利和付费性价比向内容。"
            : topLabel[0] === "福利反馈"
            ? "玩家对奖励感知敏感，需明确领取路径和活动条件。"
            : topLabel[0] === "性能问题"
            ? "性能类反馈已影响口碑，需要配合研发跟进优化进度公告。"
            : topLabel[0] === "角色/皮肤偏好"
            ? "角色向内容热度高，可加大角色剧情和互动内容供给。"
            : "建议结合代表评论拆解玩家真实需求。"
        }`
      : "暂无显著情绪聚类，建议扩大评论样本量。";

  const game = document.querySelector("#feedback-game")?.value.trim();
  renderPills(document.querySelector("#feedback-keywords"), getKeywords(lines, game ? [game] : []));
  const representativeRows = currentFeedbackRows
    .filter((row) => row.risk !== "正常" || row.sentiment === "负向")
    .sort((a, b) => ({ 高风险: 3, 需关注: 2, 正常: 1 }[b.risk] - { 高风险: 3, 需关注: 2, 正常: 1 }[a.risk]));
  renderList(
    document.querySelector("#feedback-samples"),
    (representativeRows.length ? representativeRows : currentFeedbackRows)
      .slice(0, 5)
      .map((row) => `【${row.risk}/${row.sentiment}】${row.comment}`)
  );

  renderList(document.querySelector("#action-list"), generateFeedbackActions(labels, sentimentCounts, riskCounts, currentFeedbackRows, cleanResult));
  renderFeedbackSourceGroups(currentFeedbackRows);
  if (typeof enhanceFeedbackWithLlm === "function") enhanceFeedbackWithLlm();

  if (lines.length >= 3) {
    archiveSnapshot("feedback", game || "未设置", {
      source: document.querySelector("#feedback-source-status")?.className?.includes("source-real") ? "real" : "sample",
      sampleCount: lines.length,
      sentiment: sentimentCounts,
      risk: riskCounts,
      topLabel: topLabel?.[0] || "",
      summary: document.querySelector("#emotion-summary")?.textContent?.slice(0, 300) || "",
      representative: representativeRows.slice(0, 5).map((row) => ({ comment: row.comment.slice(0, 120), risk: row.risk, sentiment: row.sentiment }))
    });
  }
}

function importFeedbackComments(comments) {
  const cleanResult = cleanFeedbackLines(comments);
  document.querySelector("#feedback-input").value = cleanResult.items
    .map((item) => (item.source && item.source !== "手动输入/单视频" ? `【${item.source}】${item.line}` : item.line))
    .join("\n");
  return cleanResult;
}

async function fetchBiliComments() {
  const input = document.querySelector("#bili-comment-url").value.trim();
  const status = document.querySelector("#feedback-source-status");
  if (!input) {
    status.textContent = "评论来源：请输入 B站视频链接、BV 号或 av 号。";
    status.className = "source-status source-mock";
    setFetchDiagnostic("#feedback-fetch-diagnostic", "warning", "等待输入", "请输入有效的 B站视频链接、BV 号或 av 号；单视频抓取会直接读取该视频公开评论。");
    return;
  }

  status.textContent = "评论来源：正在抓取 B站公开评论...";
  status.className = "source-status";
  setFetchDiagnostic("#feedback-fetch-diagnostic", "loading", "正在抓取评论", "正在连接本机评论服务，并请求 B站公开评论接口。");

  try {
    const params = new URLSearchParams({ url: input, limit: "120" });
    const response = await fetch(`${COMMENT_SERVICE_URL}/comments?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "评论服务请求失败");
    }

    const comments = (payload.comments || []).map((item) => item.message).filter(Boolean);
    if (!comments.length && document.querySelector("#demo-mode-toggle")?.checked) {
      const game = document.querySelector("#feedback-game")?.value.trim() || "目标游戏";
      const fallback = importFeedbackComments(buildDemoFeedbackComments(game, currentTrendingTopics.slice(0, 3)));
      status.textContent = `评论来源：真实评论为空，已自动切换为样例兜底 · ${payload.title || payload.bvid} · ${fallback.lines.length} 条样例评论。`;
      status.className = "source-status source-mock";
      setFetchDiagnostic("#feedback-fetch-diagnostic", "mock", "样例兜底", "真实接口返回为空，已保留演示模式，继续走评论清洗、舆情识别和运营建议链路。");
      analyzeFeedback();
      return;
    }

    const cleanResult = importFeedbackComments(comments);
    status.textContent = `评论来源：${payload.source} · ${payload.title || payload.bvid} · 已导入 ${cleanResult.lines.length} 条有效评论，过滤 ${cleanResult.removedTotal} 条`;
    status.className = cleanResult.lines.length ? "source-status source-real" : "source-status source-mock";
    setFetchDiagnostic(
      "#feedback-fetch-diagnostic",
      cleanResult.lines.length ? "real" : "warning",
      cleanResult.lines.length ? "真实评论已导入" : "真实评论为空",
      `已完成评论清洗：有效 ${cleanResult.lines.length} 条，过滤 ${cleanResult.removedTotal} 条。`
    );
    analyzeFeedback();
  } catch (error) {
    const normalized = normalizeBiliErrorMessage(error.message);
    if (document.querySelector("#demo-mode-toggle")?.checked) {
      const game = document.querySelector("#feedback-game")?.value.trim() || "目标游戏";
      const cleanResult = importFeedbackComments(buildDemoFeedbackComments(game, currentTrendingTopics.slice(0, 3)));
      status.textContent = `评论来源：真实抓取失败，已自动切换为样例兜底 · ${error.message || "请确认 comment-server.js 已启动"}`;
      status.className = "source-status source-mock";
      setFetchDiagnostic("#feedback-fetch-diagnostic", "mock", "真实抓取失败，已兜底", normalized);
      analyzeFeedback();
      return;
    }
    status.textContent = `评论来源：抓取失败，${error.message || "请确认 comment-server.js 已启动"}`;
    status.className = "source-status source-mock";
    setFetchDiagnostic("#feedback-fetch-diagnostic", "error", "抓取失败", normalized);
  }
}

async function fetchCommentsByVideoUrl(url, limit = 40) {
  const params = new URLSearchParams({ url, limit: String(limit) });
  const response = await fetch(`${COMMENT_SERVICE_URL}/comments?${params}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || payload.error || "评论服务请求失败");
  }

  return payload;
}

function normalizeBiliErrorMessage(message) {
  const text = String(message || "");
  if (text.includes("HTTP 412")) {
    return "B站公开接口触发风控（HTTP 412）。可以稍后重试，或先在热点追踪里刷新出真实视频后再抓评论。";
  }
  return text || "请确认 hotspot-server.js 和 comment-server.js 已启动";
}

function getCurrentTrendingCommentTargets(game) {
  return currentTrendingTopics
    .filter((item) => item.source === "real" && (item.bvid || item.aid || item.url))
    .filter((item) => {
      if (!game) return true;
      const title = String(item.title || "");
      return title.includes(game) || item.relevanceScore === undefined || item.relevanceScore >= 30;
    })
    .slice(0, 10)
    .map((item) => ({
      ...item,
      commentTarget: item.bvid || (item.aid ? `av${item.aid}` : item.url)
    }));
}

function buildDemoFeedbackComments(game, topics = []) {
  const topicNames = topics.length
    ? topics.map((item) => item.title).slice(0, 5)
    : [
      `${game}版本福利汇总`,
      `${game}新手入坑攻略`,
      `${game}角色/玩法更新讨论`,
      `${game}性能优化反馈`,
      `${game}活动奖励领取路径`
    ];

  const templates = [
    "这个更新点是想看的，但希望官方把领取入口讲清楚一点。",
    "福利还可以，不过养成材料还是有点缺，轻氪玩家压力比较大。",
    "新内容挺有热度，评论区很多人在问具体上线时间。",
    "手机端偶尔发热掉帧，建议版本公告里同步优化进度。",
    "角色/载具设计很吸引人，适合做短视频切片和二创征集。",
    "活动任务链路有点长，如果能加一张路径图会更好。",
    "回流奖励感知不错，但老玩家更关心长期玩法有没有变化。",
    "抽卡/付费点要讲清楚，不然容易引发性价比争议。"
  ];

  return topicNames.flatMap((title, index) => templates.slice(index % 3, index % 3 + 4).map((text) => `【${title}】${text}`));
}

async function checkCommentServices() {
  const status = document.querySelector("#feedback-source-status");
  const checks = [
    ["热点服务", `${HOTSPOT_SERVICE_URL}/health`],
    ["评论服务", `${COMMENT_SERVICE_URL}/health`]
  ];
  const results = [];

  for (const [label, url] of checks) {
    try {
      const response = await fetch(url);
      results.push(`${label}${response.ok ? "正常" : `异常 HTTP ${response.status}`}`);
    } catch (error) {
      results.push(`${label}无法连接`);
    }
  }

  status.textContent = `服务自检：${results.join("；")}`;
  status.className = results.every((item) => item.includes("正常"))
    ? "source-status source-real"
    : "source-status source-mock";
  setFetchDiagnostic(
    "#feedback-fetch-diagnostic",
    results.every((item) => item.includes("正常")) ? "real" : "warning",
    "服务自检完成",
    `${results.join("；")}。热点服务用于找视频，评论服务用于读取评论。`
  );
}

async function fetchHotVideoComments() {
  const game = document.querySelector("#feedback-game").value.trim() || "鸣潮";
  const range = document.querySelector("#feedback-range").value || "24h";
  const status = document.querySelector("#feedback-source-status");

  status.textContent = "评论来源：正在获取 B站热门视频...";
  status.className = "source-status";
  setFetchDiagnostic("#feedback-fetch-diagnostic", "loading", "正在抓取热门视频评论", `先获取「${game}」B站热门视频，再逐条读取评论。时间范围：${getRangeLabel(range)}。`);

  try {
    const hotParams = new URLSearchParams({ game, platform: "B站", range, limit: "10" });
    let hotPayload = {};
    let hotSourceNote = "";

    try {
      const hotResponse = await fetch(`${HOTSPOT_SERVICE_URL}/hotspots?${hotParams}`);
      hotPayload = await hotResponse.json().catch(() => ({}));
      if (!hotResponse.ok || !hotPayload.items?.length) {
        throw new Error(hotPayload.message || hotPayload.error || "未获取到热门视频，请确认 hotspot-server.js 已启动");
      }
    } catch (error) {
      hotSourceNote = normalizeBiliErrorMessage(error.message);
      hotPayload = { items: getCurrentTrendingCommentTargets(game) };
    }

    const videos = (hotPayload.items || [])
      .filter((item) => item.relevanceScore === undefined || item.relevanceScore >= 30)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        commentTarget: item.commentTarget || item.bvid || (item.aid ? `av${item.aid}` : item.url)
      }))
      .filter((item) => item.commentTarget);
    if (!videos.length) {
      throw new Error(hotSourceNote || "热门结果里没有达到相关性要求的视频，建议扩大时间范围或调整游戏名");
    }

    const allComments = [];
    const failures = [];

    for (const [index, video] of videos.entries()) {
      status.textContent = `评论来源：正在抓取第 ${index + 1}/${videos.length} 条热门视频评论...`;
      try {
        const payload = await fetchCommentsByVideoUrl(video.commentTarget, 20);
        (payload.comments || []).forEach((comment) => {
          if (comment.message) allComments.push(`【${video.title}】${comment.message}`);
        });
      } catch (error) {
        const title = video.title.length > 24 ? `${video.title.slice(0, 24)}...` : video.title;
        failures.push(`${title}：${error.message}`);
      }
    }

    const cleanResult = importFeedbackComments(allComments);
    const failureText = failures.length
      ? cleanResult.lines.length
        ? ` · ${failures.length} 条视频评论读取失败`
        : ` · 抓取失败：${failures[0]}`
      : "";
    const sourceNote = hotSourceNote ? ` · 热点搜索降级：${hotSourceNote}` : "";
    if (!cleanResult.lines.length && document.querySelector("#demo-mode-toggle")?.checked) {
      const fallback = importFeedbackComments(buildDemoFeedbackComments(game, videos));
      status.textContent = `评论来源：真实热门评论为空，已自动切换为样例兜底 · ${game} B站热门视频 TOP ${videos.length} · ${fallback.lines.length} 条样例评论${failureText}${sourceNote}`;
      status.className = "source-status source-mock";
      setFetchDiagnostic("#feedback-fetch-diagnostic", "mock", "评论为空，已兜底", `已找到 ${videos.length} 条热门视频，但真实评论为空或被限制读取；继续使用样例评论演示分析链路。${failureText}${sourceNote}`);
      analyzeFeedback();
      return;
    }

    status.textContent = `评论来源：${game} B站热门视频 TOP ${videos.length} · 已导入 ${cleanResult.lines.length} 条有效评论，过滤 ${cleanResult.removedTotal} 条${failureText}${sourceNote}`;
    status.className = cleanResult.lines.length ? "source-status source-real" : "source-status source-mock";
    setFetchDiagnostic(
      "#feedback-fetch-diagnostic",
      cleanResult.lines.length ? "real" : "warning",
      cleanResult.lines.length ? "热门视频评论已导入" : "未导入有效评论",
      `覆盖 ${videos.length} 条热门视频；有效评论 ${cleanResult.lines.length} 条，过滤 ${cleanResult.removedTotal} 条。${failureText}${sourceNote}`
    );
    analyzeFeedback();
  } catch (error) {
    const normalized = normalizeBiliErrorMessage(error.message);
    if (document.querySelector("#demo-mode-toggle")?.checked) {
      const topics = currentTrendingTopics.length ? currentTrendingTopics : generateHotTopics(game, "B站", ["攻略", "资讯", "争议"]);
      const cleanResult = importFeedbackComments(buildDemoFeedbackComments(game, topics));
      status.textContent = `评论来源：真实抓取失败，已自动切换为样例兜底 · ${normalized}`;
      status.className = "source-status source-mock";
      setFetchDiagnostic("#feedback-fetch-diagnostic", "mock", "热门评论抓取失败，已兜底", normalized);
      analyzeFeedback();
      return;
    }
    status.textContent = `评论来源：抓取失败，${normalized}`;
    status.className = "source-status source-mock";
    setFetchDiagnostic("#feedback-fetch-diagnostic", "error", "热门评论抓取失败", normalized);
  }
}

function exportFeedbackAnalysis() {
  analyzeFeedback();
  if (!currentFeedbackRows.length) return;

  const rows = [["来源", "评论", "标签", "情绪", "风险"]];
  currentFeedbackRows.forEach((row) => {
    rows.push([
      row.source || "手动输入/单视频",
      row.comment,
      row.categories.join(" / ") || "未分类",
      row.sentiment,
      row.risk
    ]);
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `玩家评论分析-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ========================================
   模块3：活动复盘
   ======================================== */

function validateCampaignFunnel({ impressions, clicks, participants, payers }) {
  const warnings = [];

  if ([impressions, clicks, participants, payers].some((value) => value < 0)) {
    warnings.push("存在负数，请检查导入或手动录入口径。");
  }
  if (!impressions) {
    warnings.push("曝光量为 0，点击率和后续转化无法作为有效判断依据。");
  }
  if (clicks > impressions) {
    warnings.push("点击量高于曝光量，通常说明曝光或点击口径不一致。");
  }
  if (participants > clicks) {
    warnings.push("参与人数高于点击量，需确认是否包含站内自然参与或多入口流量。");
  }
  if (payers > participants) {
    warnings.push("付费人数高于参与人数，需确认付费归因范围是否扩大到活动外。");
  }
  if (impressions > 0 && clicks / impressions > 0.6) {
    warnings.push("点击率超过 60%，建议确认曝光是否只统计了已进活动页人群。");
  }
  if (clicks > 0 && participants / clicks > 0.9) {
    warnings.push("参与转化超过 90%，建议检查点击和参与是否为同一层级口径。");
  }

  return warnings;
}

function renderReviewDataWarning(warnings, cleanText = "数据检查：漏斗口径未发现明显异常。") {
  renderReviewGrade();
  const warning = document.querySelector("#review-data-warning");
  if (!warning) return;

  if (warnings.length) {
    warning.textContent = `数据检查：${warnings.join("；")}`;
    warning.className = "source-status source-mock";
    return;
  }

  warning.textContent = cleanText;
  warning.className = "source-status source-real";
}

function analyzeReview() {
  if (reviewMode === "livestream") {
    analyzeLivestreamReview();
    return;
  }

  const policy = getReviewPolicy();
  const impressions = numberValue(document.querySelector("#impressions").value);
  const clicks = numberValue(document.querySelector("#clicks").value);
  const participants = numberValue(document.querySelector("#participants").value);
  const payers = numberValue(document.querySelector("#payers").value);
  const description = document.querySelector("#review-input").value;

  const ctr = impressions ? (clicks / impressions) * 100 : 0;
  const participationRate = clicks ? (participants / clicks) * 100 : 0;
  const conversionRate = participants ? (payers / participants) * 100 : 0;
  const dataWarnings = validateCampaignFunnel({ impressions, clicks, participants, payers });
  renderReviewDataWarning(dataWarnings);

  renderMetrics(document.querySelector("#review-metrics"), [
    { label: "点击率", value: `${ctr.toFixed(1)}%` },
    { label: "参与转化", value: `${participationRate.toFixed(1)}%` },
    { label: "付费转化", value: `${conversionRate.toFixed(1)}%` }
  ]);

  document.querySelector("#review-report").textContent =
    `活动漏斗：曝光 ${impressions.toLocaleString()} → 点击 ${clicks.toLocaleString()}（CTR ${ctr.toFixed(1)}%）→ 参与 ${participants.toLocaleString()}（参与率 ${participationRate.toFixed(1)}%）→ 付费 ${payers.toLocaleString()}（付费率 ${conversionRate.toFixed(1)}%）。\n\n当前采用「${policy.label}」：CTR 低于 ${policy.ctr}% 视为入口效率偏弱，参与转化低于 ${policy.participation}% 视为链路承接不足，付费转化低于 ${policy.conversion}% 视为付费引导仍需优化。\n\n${
      ctr < policy.ctr
        ? "点击率偏低，素材/入口吸引力不足，建议优化首屏视觉和文案钩子。"
        : "点击率在合理区间，素材和入口曝光效率可接受。"
    } ${
      participationRate < policy.participation
        ? "参与转化有提升空间，检查任务链路过长或奖励感知弱的问题。"
        : "参与转化表现良好，活动机制和奖励设计有效驱动参与。"
    } ${
      conversionRate < policy.conversion
        ? "付费转化有优化空间，建议增加限时礼包或分层付费引导。"
        : "付费转化顺畅，付费点设计和定价策略有效。"
	    }\n\n${dataWarnings.length ? `数据检查：${dataWarnings.join("；")}\n\n` : ""}活动说明：${description}`;

  renderList(document.querySelector("#next-list"), [
    ctr < policy.ctr ? "优化活动入口素材，A/B 测试不同视觉钩子和文案。" : "沉淀当前素材策略，形成活动入口模板。",
    participationRate < policy.participation ? "简化任务链路，强化奖励感知和进度可视化。" : "将核心参与机制沉淀为模板。",
    conversionRate < policy.conversion ? "在参与流程中增加分层付费引导和限时礼包。" : "保持付费点设计并尝试更多定价档位。",
    "输出活动复盘文档，纳入团队知识库供后续活动参考。"
  ]);
}

function analyzeLivestreamReview() {
  const policy = getReviewPolicy();
  const brief = document.querySelector("#stream-brief").value;
  const totalAcu = streamers.reduce((sum, item) => sum + item.event.acu, 0);
  const totalBaseAcu = streamers.reduce((sum, item) => sum + item.base.acu, 0);
  const totalEntries = streamers.reduce((sum, item) => sum + item.event.entries, 0);
  const totalBaseEntries = streamers.reduce((sum, item) => sum + item.base.entries, 0);
  const totalImpressions = streamers.reduce((sum, item) => sum + item.event.impressions, 0);
  const totalBaseImpressions = streamers.reduce((sum, item) => sum + item.base.impressions, 0);
  const entryRate = totalImpressions ? totalEntries / totalImpressions : 0;

  const totalAcuChange = formatChange(totalAcu, totalBaseAcu, policy.metricThreshold);
  const totalEntryChange = formatChange(totalEntries, totalBaseEntries, policy.metricThreshold);

  const results = streamers.map((streamer) => getStreamerResult(streamer, policy));
  const positiveCount = results.filter((item) => item.verdict === "正反馈").length;
  const negativeCount = results.filter((item) => item.verdict === "负反馈").length;
  const neutralCount = results.length - positiveCount - negativeCount;

  const verdict = positiveCount >= streamers.length * policy.positiveRatio
    ? "整体正反馈"
    : negativeCount >= streamers.length * policy.negativeRatio
    ? "整体负反馈"
    : "整体中性反馈";

  renderReviewDataWarning([], "数据检查：直播数据已按活动场与近期均值进行对比。");

  renderMetrics(document.querySelector("#review-metrics"), [
    { label: "活动判断", value: verdict },
    { label: "覆盖主播", value: `${streamers.length} 位` },
    { label: "进房率", value: `${(entryRate * 100).toFixed(1)}%` }
  ]);

  document.querySelector("#review-report").textContent =
    `本次主播直播活动判断为"${verdict}"。\n\n活动方案：${brief}\n\n本次共纳入 ${streamers.length} 位主播，其中正反馈 ${positiveCount} 位，中性反馈 ${neutralCount} 位，负反馈 ${negativeCount} 位。汇总口径下，ACU 较近期均值 ${totalAcuChange.label}，进房人数 ${totalEntryChange.label}，活动场进房率为 ${(entryRate * 100).toFixed(1)}%。\n\n判定口径：当前采用「${policy.label}」。单项指标相较近期均值提升 ${(policy.metricThreshold * 100).toFixed(0)}% 以上记为正向，下降 ${(policy.metricThreshold * 100).toFixed(0)}% 以上记为负向；单主播 ACU、PCU、曝光、进房 4 项中至少 3 项正向，判为正反馈；至少 2 项负向，判为负反馈。整体活动中正反馈主播占比达到 ${(policy.positiveRatio * 100).toFixed(0)}% 以上判为整体正反馈，负反馈主播占比达到 ${(policy.negativeRatio * 100).toFixed(0)}% 以上判为整体负反馈。\n\n单主播层面建议重点看"曝光是否带来进房、进房是否带来在线峰值"。如果曝光提升但 ACU/PCU 没有同步提升，说明活动对触达有帮助，但直播间承接、福利口播或内容节奏还需要优化。`;

  renderList(document.querySelector("#next-list"), [
    "将主播按正反馈、中性反馈、负反馈分层，正反馈主播进入下次活动优先邀约池。",
    "对曝光提升但进房不足的主播，重点复盘直播标题、封面、开播前预热和福利表达。",
    "对 ACU/PCU 提升明显的主播，沉淀其口播节奏、组队玩法和抽奖互动设计。",
    "跨品类 KOL 单独看进房率与停留表现，避免只用曝光量判断采买价值。",
    "活动总结按「方案目标 - 达人构成 - 数据对比 - 正负反馈 - 下次优化」结构输出。"
  ]);
}

/* ============================================================
   模块4：热点追踪 — 智能热点模拟引擎
   ============================================================ */

/* ---- 游戏知识库 ---- */
const gameKnowledge = {
  "鸣潮": {
    keywords: ["漂泊者", "共鸣者", "声骸", "索拉", "今州", "无明", "残星", "鸣域"],
    types: {
      攻略: ["新版本声骸刷取路线", "全角色强度榜与配队推荐", "深渊/幻痛高难本通关攻略", "每日体力分配优先级指南", "探索度100%全收集路线"],
      资讯: ["版本前瞻直播汇总", "限定共鸣者UP池情报", "新地图区域开放预告", "回归奖励与新手福利汇总", "联动活动官宣"],
      整活: ["抽卡玄学现场实况", "共鸣者整活向表情包合集", "漂泊者迷惑行为大赏", "声骸融合翻车名场面", "鸣潮玩家才懂的梗"],
      争议: ["版本福利对比竞品热议", "新角色数值平衡讨论", "声骸系统肝度争议", "探索引导是否过于隐晦", "老角色是否需要加强"],
      二创: ["共鸣者同人插画合集", "漂泊者剧情向MMD", "游戏BGM翻奏/Remix", "角色语音包与互动小剧场", "世界观考据深度分析"]
    }
  },
  "原神": {
    keywords: ["旅行者", "角色", "元素", "深渊", "卡池", "原石", "七圣召唤", "尘歌壶"],
    types: {
      攻略: ["新角色培养指南与圣遗物推荐", "深渊12层满星配队攻略", "新地图全宝箱收集路线", "每日委托隐藏成就汇总", "七圣召唤强势卡组推荐"],
      资讯: ["版本更新内容速览", "新角色立绘与技能爆料", "联动活动官宣与奖励", "周年庆福利汇总", "前瞻直播兑换码及解读"],
      整活: ["抽卡翻车/欧皇现场合集", "角色魔性表情包合集", "尘歌壶离谱建筑展示", "原壶玩家的脑洞创作", "派蒙吐槽合集"],
      争议: ["卡池保底机制讨论", "角色强度膨胀争议", "每日委托重复度吐槽", "活动奖励是否足够", "新地图探索引导评价"],
      二创: ["角色同人绘画合集", "提瓦特手书/动画短片", "角色生贺企划", "游戏BGM管弦乐改编", "CP向剧情剪辑"]
    }
  },
  "崩坏：星穹铁道": {
    keywords: ["开拓者", "命途", "星魂", "忘却之庭", "模拟宇宙", "差分宇宙"],
    types: {
      攻略: ["新角色遗器与光锥推荐", "忘却之庭满星配队", "模拟宇宙最优祝福流派", "每日体力分配指南", "差分宇宙高难通关思路"],
      资讯: ["版本前瞻汇总", "限定角色UP池情报", "新星球/新地图爆料", "联动活动与福利", "周年庆活动前瞻"],
      整活: ["抽卡名场面合集", "角色表情包与梗图", "开拓者迷惑行为录", "模拟宇宙翻车集锦", "三月七和丹恒相声剪辑"],
      争议: ["角色强度节奏榜争议", "新角色数值讨论", "模拟宇宙难度曲线", "活动肝度讨论", "剧情节奏评价"],
      二创: ["角色同人图", "星穹铁道手书动画", "BGM Remix", "角色互动小剧场", "开拓者日常四格漫画"]
    }
  },
  "王者荣耀": {
    keywords: ["召唤师", "英雄", "皮肤", "段位", "峡谷", "排位", "巅峰赛"],
    types: {
      攻略: ["新英雄连招教学与出装推荐", "S35赛季上分英雄梯度榜", "各位置意识教学", "巅峰赛BP思路指南", "新版本地图改动解读"],
      资讯: ["新赛季更新公告解读", "新皮肤爆料与特效展示", "KPL赛事战报", "英雄调整公告", "联动活动官宣"],
      整活: ["逆天操作名场面", "队友迷惑行为合集", "五连败破防实录", "王者搞笑配音", "峡谷鬼畜剪辑"],
      争议: ["英雄平衡性讨论", "皮肤定价争议", "匹配机制吐槽", "ELO机制讨论", "连胜/连败规律分析"],
      二创: ["英雄插画/同人", "CP向剧情剪辑", "王者COS作品", "峡谷编年史考据", "英雄语音混剪"]
    }
  },
  "和平精英": {
    keywords: ["特种兵", "吃鸡", "钢枪", "跳伞", "海岛", "空投", "赛季"],
    types: {
      攻略: ["新版本地图跳点推荐", "武器配装与灵敏度设置", "决赛圈思路教学", "载具驾驶技巧", "新武器实战评测"],
      资讯: ["新赛季通行证内容一览", "新地图/新模式曝光", "联动皮肤爆料", "版本更新公告", "赛事战报"],
      整活: ["离谱击杀集锦", "伏地魔名场面", "队友相声实录", "载具翻车合集", "空投陷阱整活"],
      争议: ["外挂举报讨论", "武器平衡性争议", "匹配机制讨论", "皮肤定价争议", "性能优化吐槽"],
      二创: ["特种兵同人插画", "精彩操作混剪", "地图考据/彩蛋", "COS短片", "剧情模式演绎"]
    }
  },
  "明日方舟": {
    keywords: ["博士", "干员", "源石", "罗德岛", "危机合约", "集成战略"],
    types: {
      攻略: ["新干员评测与专精推荐", "危机合约高分作业", "集成战略通关思路", "基建最优布局", "新活动关卡攻略"],
      资讯: ["新活动/新章节预告", "限定干员UP情报", "联动活动官宣", "制作组通讯解读", "时装上新"],
      整活: ["抽卡翻车实录", "干员沙雕表情包", "基建迷惑行为", "源石虫迫害合集", "阿米娅梗图"],
      争议: ["限定频率讨论", "干员强度争议", "关卡难度曲线", "体力系统讨论", "复刻活动机制"],
      二创: ["干员同人图", "罗德岛日常漫画", "游戏BGM翻奏", "角色手书动画", "世界观考据分析"]
    }
  },
  "巅峰极速": {
    keywords: ["赛车手", "调校", "漂移", "圈速", "排位", "赛季", "车库", "对决"],
    types: {
      攻略: ["车辆调校参数推荐", "赛道走线进阶教学", "排位冲分车辆梯度榜", "漂移技巧从入门到精通", "新车上手指南与实战评测"],
      资讯: ["新赛季限定车辆爆料", "版本更新公告解读", "联动车型/涂装官宣", "巅峰赛事战报", "车库扩充福利汇总"],
      整活: ["翻车名场面合集", "漂移失败搞笑瞬间", "排位连跪破防实录", "神级操作慢放欣赏", "车辆涂装整活大赏"],
      争议: ["车辆强度平衡讨论", "调校系统复杂度争议", "排位匹配机制吐槽", "限定车获取难度讨论", "性能优化与发热问题"],
      二创: ["车辆涂装设计展示", "精彩操作混剪集锦", "赛道风景截图摄影", "车库大片摆拍", "漂移集锦MV"]
    }
  },
  "蛋仔派对": {
    keywords: ["蛋仔", "地图", "工坊", "皮肤", "派对", "闯关", "乐园", "盲盒"],
    types: {
      攻略: ["新赛季闯关技巧汇总", "热门工坊地图推荐榜", "皮肤获取途径全攻略", "派对技巧进阶教学", "乐园建造入门指南"],
      资讯: ["新赛季主题爆料", "联动皮肤/盲盒官宣", "工坊创作大赛情报", "版本更新公告解读", "节日活动福利预告"],
      整活: ["蛋仔离谱操作合集", "工坊神图体验实况", "闯关翻车名场面", "蛋搭子迷惑行为大赏", "蛋仔沙雕表情包"],
      争议: ["皮肤定价与获取讨论", "工坊审核机制吐槽", "闯关难度曲线争议", "盲盒概率公示讨论", "新老玩家体验差距"],
      二创: ["蛋仔同人插画合集", "工坊创意地图巡礼", "蛋仔小剧场动画", "皮肤设计投稿展示", "蛋仔手书/动画短片"]
    }
  },
  "燕云十六声": {
    keywords: ["侠客", "江湖", "武学", "奇术", "探索", "门派", "燕云", "十六声"],
    types: {
      攻略: ["武学搭配与连招推荐", "奇术全收集路线攻略", "门派选择与拜师指南", "世界探索隐藏任务汇总", "新手入坑避坑指南"],
      资讯: ["新区域开放预告", "新武学/奇术更新情报", "联动活动官宣", "制作组日志解读", "版本更新公告汇总"],
      整活: ["江湖迷惑行为大赏", "轻功翻车搞笑合集", "奇术骚操作集锦", "侠客沙雕日常", "NPC离谱对话名场面"],
      争议: ["战斗手感与操作讨论", "探索引导是否过于隐晦", "武学平衡性热议", "付费模式与定价讨论", "优化性能与帧率吐槽"],
      二创: ["江湖风景截图摄影", "侠客同人绘画合集", "剧情MV/手书剪辑", "武学连招高光展示", "燕云世界观考据"]
    }
  },
  "永劫无间": {
    keywords: ["修罗", "振刀", "连招", "飞索", "魂玉", "排位", "聚窟洲", "英雄"],
    types: {
      攻略: ["英雄连招教学与进阶", "振刀时机判断与反制", "魂玉搭配最优方案", "地图跳点与资源规划", "排位上分英雄梯度榜"],
      资讯: ["新英雄/新武器爆料", "赛季更新公告解读", "联动皮肤官宣情报", "NBPL赛事战报", "版本平衡性调整汇总"],
      整活: ["振刀翻车名场面合集", "飞索骚操作集锦", "修罗搞笑时刻", "英雄鬼畜配音", "队友离谱行为实录"],
      争议: ["英雄强度平衡讨论", "武器强弱节奏争议", "服务器延迟与判定吐槽", "皮肤定价/限定讨论", "外挂举报与反作弊"],
      二创: ["英雄同人插画合集", "精彩击杀高光混剪", "COS作品展示", "聚窟洲风景截图", "剧情向MV剪辑"]
    }
  },
  "光遇": {
    keywords: ["光之子", "先祖", "蜡烛", "季节", "斗篷", "复刻", "社交", "光翼"],
    types: {
      攻略: ["季节任务全流程攻略", "蜡烛高效收集路线", "先祖复刻兑换优先级", "隐藏地图入口全收集", "光翼位置与收集顺序"],
      资讯: ["新季节主题内容爆料", "复刻先祖情报汇总", "联动季节/礼包官宣", "版本更新公告解读", "节日活动与福利预告"],
      整活: ["光遇迷惑行为大赏", "陌生人社交暖心/尴尬时刻", "跑图翻车搞笑合集", "弹琴整活/魔改演奏", "光之子沙雕日常"],
      争议: ["蜡烛获取效率讨论", "复刻频率与排期吐槽", "社交功能优化建议", "季节毕业难度讨论", "画质优化与机型适配"],
      二创: ["绝美风景截图摄影", "光之子同人插画", "钢琴/乐器演奏视频", "季节剧情MV剪辑", "先祖故事同人漫画"]
    }
  },
  "第五人格": {
    keywords: ["侦探", "求生者", "监管者", "庄园", "人格", "排位", "线索", "赛季"],
    types: {
      攻略: ["求生者遛鬼技巧进阶", "监管者追击与控场思路", "角色天赋与人格推荐", "地图点位与转点路线", "排位上分角色梯度榜"],
      资讯: ["新角色/新皮肤爆料", "赛季精华内容情报", "联动活动官宣汇总", "角色平衡性调整公告", "IVL赛事战报速递"],
      整活: ["翻车名场面合集", "求生者迷惑操作大赏", "监管者搞笑时刻", "庄园鬼畜配音", "队友逆天行为实录"],
      争议: ["角色强度平衡讨论", "皮肤定价与限定争议", "排位匹配机制吐槽", "判定延迟与网络问题", "新老角色差距热议"],
      二创: ["角色同人插画合集", "庄园剧情深度解析", "COS作品展示", "精彩操作高光混剪", "角色故事手书/MV"]
    }
  },
  "崩坏3": {
    keywords: ["舰长", "女武神", "圣痕", "武器", "深渊", "战场", "剧情", "律者"],
    types: {
      攻略: ["新女武神配队与评测", "圣痕搭配最优方案", "深渊/记忆战场高分作业", "水晶资源规划指南", "新手入坑全面指引"],
      资讯: ["新版本更新内容速览", "新女武神/SP装甲爆料", "联动活动官宣情报", "主线剧情更新预告", "周年庆/春节福利汇总"],
      整活: ["抽卡翻车/欧皇实录", "舰长迷惑行为大赏", "女武神沙雕表情包", "深渊凹分翻车名场面", "剧情吐槽与整活"],
      争议: ["角色强度膨胀讨论", "抽卡保底与概率机制", "深渊/战场温度争议", "主线剧情走向热议", "老角色退环境与加强"],
      二创: ["女武神同人插画", "剧情手书/MAD剪辑", "游戏BGM翻奏/Remix", "舰长日常四格漫画", "崩坏世界观考据分析"]
    }
  }
};

const defaultGame = {
  keywords: ["版本", "角色", "活动", "攻略", "福利", "社区", "玩家"],
  types: {
    攻略: ["{game}新手入坑避坑指南", "{game}版本资源规划与养成优先级", "{game}高难关卡通关思路", "{game}角色/装备搭配推荐", "{game}每日任务效率路线"],
    资讯: ["{game}版本更新内容速览", "{game}新角色/新活动情报汇总", "{game}福利领取路径整理", "{game}官方公告重点解读", "{game}社区活动参与指南"],
    整活: ["{game}玩家名场面合集", "{game}抽卡/开箱翻车实录", "只有{game}老玩家才懂的梗", "{game}离谱操作和反差瞬间", "{game}社区热梗二创混剪"],
    争议: ["{game}版本福利是否足够", "{game}角色强度和平衡性讨论", "{game}活动肝度与奖励反馈", "{game}新老玩家体验差距", "{game}付费内容性价比讨论"],
    二创: ["{game}角色同人作品合集", "{game}剧情向剪辑与手书", "{game}游戏音乐翻奏/Remix", "{game}世界观考据分析", "{game}玩家创意作品展示"]
  }
};

/* ---- 热点引擎 ---- */

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function formatHeat(baseHeat, rng) {
  const heat = Math.floor(baseHeat * (0.7 + rng() * 0.6));
  if (heat >= 10000) return (heat / 10000).toFixed(1) + "万";
  return heat.toLocaleString();
}

function formatNumberCompact(value) {
  const number = Number(value || 0);
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return number.toLocaleString();
}

function heatTrend(rng) {
  const v = rng();
  if (v < 0.35) return { icon: "↑", cls: "trend-up", label: "上升" };
  if (v < 0.7) return { icon: "→", cls: "trend-flat", label: "持平" };
  return { icon: "↓", cls: "trend-down", label: "下降" };
}

function getGameData(gameName) {
  const exact = gameKnowledge[gameName];
  if (exact) return exact;
  for (const key of Object.keys(gameKnowledge)) {
    if (gameName.includes(key) || key.includes(gameName)) return gameKnowledge[key];
  }
  return defaultGame;
}

function generateHotTopics(gameName, platform, selectedTags) {
  const gameData = getGameData(gameName);
  const seed = [...gameName, ...platform, Date.now()].join("").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const rng = seededRandom(seed);

  const baseHeats = [9800, 8700, 7600, 6500, 5400, 4300, 3200, 2400, 1800, 1200];

  const enrichedTags = selectedTags.map((tag) => ({
    tag,
    topics: gameData.types[tag] || defaultGame.types[tag] || [`${tag}相关话题`]
  }));

  const topics = [];
  const tagCycle = [...enrichedTags];
  let tagIndex = 0;

  for (let rank = 0; rank < 10; rank++) {
    if (tagCycle.length === 0) break;

    const entry = tagCycle[tagIndex % tagCycle.length];
    const topicPool = entry.topics;
    const topicIdx = Math.floor(rng() * topicPool.length);
    let topicText = topicPool[topicIdx];

    topicText = topicText.replace(/{game}/g, gameName);

    const heat = formatHeat(baseHeats[rank], rng);
    const trend = heatTrend(rng);
    let suffix = "";
    if (rng() < 0.3 && rank < 5) {
      suffix = platform === "抖音" ? " 冲上挑战榜！" : platform === "微博" ? " 登上热搜！" : " 社区热议中";
    }

    topics.push({
      rank: rank + 1,
      title: topicText,
      heat,
      heatScore: parseCompactNumber(heat),
      views: 0,
      danmaku: 0,
      favorites: 0,
      publishedAt: "",
      author: "样例数据",
      url: "",
      source: "mock",
      risk: getRiskSignal(topicText),
      trend,
      tag: entry.tag,
      platformStyle: platform,
      suffix
    });

    tagIndex++;
  }

  return topics;
}

function generateTrendingInsight(gameName, platform, topics) {
  const tagCount = {};
  topics.forEach((t) => {
    tagCount[t.tag] = (tagCount[t.tag] || 0) + 1;
  });

  const topTag = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];
  const topTagName = topTag ? topTag[0] : "综合";

  const upTopics = topics.filter((t) => t.trend.icon === "↑");
  const downTopics = topics.filter((t) => t.trend.icon === "↓");

  let insight = `当前「${gameName}」在${platform}的热点以"${topTagName}"类内容为主导（${topTag[1]}/10）。`;

  if (upTopics.length >= 4) {
    insight += ` 社区热度整体呈上升趋势，${upTopics.length} 条话题热度攀升，说明近期有版本更新或社区事件驱动。`;
  } else if (downTopics.length >= 3) {
    insight += ` 部分话题热度回落，社区正处于版本内容消耗期，适合用运营活动或二创激励重新点燃热度。`;
  } else {
    insight += ` 热度分布较为均衡，社区处于稳定讨论期。`;
  }

  const platformAdvice = {
    "B站": "建议关注上升趋势中的攻略和考据向长内容，B站用户对深度解析和强度榜单有持续需求。",
    "抖音": "优先跟进短平快的整活和争议话题，抖音的算法分发对情绪钩子敏感，热点窗口期通常在24-48小时。",
    "小红书": "攻略安利和避雷类内容在小红书长期有效，适合用图文+清单体做种草型内容沉淀。",
    "TapTap": "TapTap玩家对版本福利和平衡性调整高度敏感，官方公告和开发者互动在此平台价值最大。",
    "微博": "微博适合做话题造势和争议回应，热搜体话题需配合KOL矩阵转发，时效性强但长尾弱。"
  };

  insight += " " + (platformAdvice[platform] || "");

  return insight;
}

function classifyHotspot(title, fallbackTag = "视频") {
  const text = title.toLowerCase();
  const rules = [
    { tag: "攻略", words: ["攻略", "教程", "指南", "教学", "配队", "强度", "路线", "培养", "评测", "机制"] },
    { tag: "资讯", words: ["前瞻", "爆料", "更新", "版本", "公告", "官宣", "兑换码", "福利", "活动"] },
    { tag: "争议", words: ["争议", "吐槽", "破防", "削弱", "加强", "退坑", "节奏", "道歉", "翻车"] },
    { tag: "整活", words: ["整活", "名场面", "搞笑", "离谱", "抽象", "鬼畜", "挑战", "实况"] },
    { tag: "二创", words: ["同人", "手书", "mmd", "mad", "混剪", "翻奏", "cos", "剧情"] }
  ];
  const matched = rules.find((rule) => rule.words.some((word) => text.includes(word)));
  return matched?.tag || fallbackTag;
}

function getRiskSignal(title) {
  const text = title.toLowerCase();
  const highRiskWords = ["退坑", "爆雷", "道歉", "诈骗", "外挂", "封号", "炎上", "崩了", "跑路"];
  const mediumRiskWords = ["争议", "吐槽", "削弱", "加强", "节奏", "破防", "翻车", "补偿", "骂", "喷"];

  if (highRiskWords.some((word) => text.includes(word))) {
    return {
      level: "高风险",
      cls: "risk-high",
      advice: "建议优先做舆情复盘，确认玩家核心不满点，并准备官方回应或社区解释口径。"
    };
  }

  if (mediumRiskWords.some((word) => text.includes(word))) {
    return {
      level: "需关注",
      cls: "risk-medium",
      advice: "建议跟踪评论区情绪变化，避免直接二次放大争议，优先做观点整理和事实澄清。"
    };
  }

  return {
    level: "正常",
    cls: "risk-low",
    advice: "当前未命中明显负面词，可作为常规热点跟进。"
  };
}

function inferTitlePattern(title) {
  const separators = ["：", ":", "！", "!", "？", "?", "｜", "|", "-", "—"];
  const hasNumber = /\d|一|二|三|四|五|十/.test(title);
  const hasQuestion = /吗|？|\?/.test(title);
  const hasEmotion = /最|神|离谱|爆|强|稳|破防|必看|速看/.test(title);
  const hasSeparator = separators.some((item) => title.includes(item));

  if (hasNumber && hasEmotion) return "数字结果 + 强情绪钩子";
  if (hasQuestion) return "问题悬念 + 观点引导";
  if (hasSeparator) return "主题前置 + 细分卖点";
  if (hasEmotion) return "情绪词放大 + 场景承接";
  return "关键词直给 + 信息型表达";
}

function generateHookReasons(topic) {
  const reasons = [];
  const tag = topic.tag || classifyHotspot(topic.title);

  if (topic.views > 0) reasons.push(`播放量达到 ${formatNumberCompact(topic.views)}，说明标题和封面具备基础点击吸引力。`);
  if (topic.danmaku > 0) reasons.push(`弹幕 ${formatNumberCompact(topic.danmaku)}，互动密度可作为内容讨论度参考。`);
  if (tag === "攻略") reasons.push("攻略类内容能解决明确问题，适合沉淀成长尾搜索流量。");
  if (tag === "资讯") reasons.push("资讯类内容依赖时效性，适合在版本节点快速跟进。");
  if (tag === "争议") reasons.push("争议类话题容易带来评论互动，但需要控制表达边界。");
  if (tag === "整活") reasons.push("整活内容适合短视频二次传播，可拆成更轻量的切片。");
  if (tag === "二创") reasons.push("二创内容能增强角色和社区情感连接，适合联动征集活动。");

  return reasons.slice(0, 3);
}

function generateFollowUpTopics(gameName, topic) {
  const tag = topic.tag || classifyHotspot(topic.title);
  const titleCore = topic.title.replace(/[《》【】]/g, "");

  const map = {
    攻略: [
      `${gameName}同主题低门槛版：3 分钟讲清 ${titleCore}`,
      `${gameName}新手视角补充：哪些坑视频里没讲清？`,
      `${gameName}进阶对照表：把热点攻略拆成可收藏清单`
    ],
    资讯: [
      `${gameName}今日版本信息速览：只保留玩家最关心的 5 点`,
      `${gameName}新内容上线前必做准备清单`,
      `${gameName}公告翻译成玩家语言：福利、角色、活动怎么拿`
    ],
    争议: [
      `${gameName}争议点拆解：玩家到底在不满什么？`,
      `${gameName}正反观点整理：评论区高频意见复盘`,
      `${gameName}运营回应建议：如何降低节奏扩散`
    ],
    整活: [
      `${gameName}热点名场面二创挑战`,
      `${gameName}玩家才懂的 5 个梗`,
      `${gameName}把热点视频拆成 15 秒短切片脚本`
    ],
    二创: [
      `${gameName}二创征集活动主题包装`,
      `${gameName}角色向剧情混剪选题`,
      `${gameName}社区作品周榜栏目策划`
    ]
  };

  return map[tag] || [
    `${gameName}热点复盘：为什么这条内容能起量？`,

    `${gameName}同主题选题延展：标题、封面、评论区三点拆解`,
    `${gameName}今日内容跟进脚本：用热点做轻量二创`
  ];
}

function normalizeRealHotspot(item, index) {
  if (item.trend && item.risk && typeof item.heat === "string") {
    return { ...item, rank: index + 1 };
  }

  const tag = classifyHotspot(item.title, "视频");
  const risk = getRiskSignal(item.title || "");
  return {
    rank: index + 1,
    title: item.title || "未命名视频",
    heat: item.heat ? `热度 ${formatNumberCompact(item.heat)}` : item.views ? `${formatNumberCompact(item.views)}播放` : "暂无播放数据",
    heatScore: Number(item.heat || item.views || 0),
    views: Number(item.views || 0),
    danmaku: Number(item.danmaku || 0),
    favorites: Number(item.favorites || 0),
    publishedAt: item.publishedAt || "",
    author: item.author || "未知作者",
    url: item.url || "",
    source: "real",
    risk,
    trend: { icon: "↑", cls: "trend-up", label: "真实" },
    tag,
    suffix: item.danmaku ? `${Number(item.danmaku).toLocaleString()}弹幕` : ""
  };
}

function formatPublishedDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffHours = Math.max(0, (now - date.getTime()) / 3600000);
  if (diffHours < 1) return `${Math.max(1, Math.round(diffHours * 60))}分钟前`;
  if (diffHours < 24) return `${Math.round(diffHours)}小时前`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getRangeLabel(range) {
  return {
    today: "今日",
    "24h": "近24h",
    "3d": "近3天",
    "7d": "近7天"
  }[range] || "近24h";
}

function getActiveViewName() {
  const active = document.querySelector(".nav-button.active")?.dataset.view;
  return active || "overview";
}

function updateChainBar(viewName = "overview", sourceText = "") {
  const flow = document.querySelector("#chain-flow-text");
  const source = document.querySelector("#chain-source-text");
  if (!flow || !source) return;

  const flowMap = {
    overview: "热点发现 → 评论分析 → 风险事件 → 运营动作",
    content: "竞品内容 → 标题拆解 → 情绪提炼 → 选题改写",
    feedback: "评论导入 → 情绪识别 → 风险事件 → 应对建议",
    review: "活动数据 → 漏斗/直播对比 → 反馈判断 → 下一轮优化",
    trending: "关键词搜索 → 热点过滤 → TOP10 排序 → 选题跟进",
    version: "更新点 → 卖点包装 → 平台文案 → 素材清单",
    segment: "玩家标签 → 分层判断 → 触达话术 → 奖励设计",
    creator: "达人导入 → 目标分 → 性价比 → Brief 输出",
    resume: "项目素材 → 简历表达 → 面试讲法 → 备用说明"
  };
  const platform = document.querySelector("#trending-platform")?.value || "B站";
  const range = getRangeLabel(document.querySelector("#trending-range")?.value || "24h");
  const savedTrendingSource = viewName === "trending"
    ? document.querySelector("#trending-source-status")?.textContent?.replace(/^数据源：/, "")
    : "";
  const sourceLabel = sourceText || savedTrendingSource || `${platform}公开数据 · ${range} · 旧视频过滤`;

  flow.textContent = flowMap[viewName] || flowMap.overview;
  source.textContent = sourceLabel;
}

function renderTrendingList(gameName, platform, options = {}) {
  const selectedTags = Array.from(document.querySelectorAll("#trending-tags input:checked")).map((el) => el.value);
  const validTags = selectedTags.length > 0 ? selectedTags : ["攻略", "资讯"];
  const topics = options.items?.length
    ? options.items.map((item, index) => (options.source === "real" || item.source === "real" ? normalizeRealHotspot(item, index) : item))
    : generateHotTopics(gameName, platform, validTags);
  const sourceStatus = document.querySelector("#trending-source-status");
  const methodStatus = document.querySelector("#trending-method");
  currentTrendingTopics = topics;
  selectedTrendingIndex = Math.min(selectedTrendingIndex, Math.max(topics.length - 1, 0));

  const list = document.querySelector("#trending-list");
  list.innerHTML = topics
    .map((t, index) => {
      const url = safeExternalUrl(t.url);
      const title = escapeHtml(t.title);
      const suffix = t.suffix ? `<span class="trending-suffix">${escapeHtml(t.suffix)}</span>` : "";
      const author = t.author ? `<span class="trending-author">${escapeHtml(t.author)}</span>` : "";
      const publishedAt = formatPublishedDate(t.publishedAt);
      const published = publishedAt ? `<span class="trending-author">发布 ${escapeHtml(publishedAt)}</span>` : "";
      return `
        <li class="trending-item ${index === selectedTrendingIndex ? "active" : ""}" data-trending-index="${index}">
          <span class="trending-rank ${t.rank <= 3 ? "trending-rank-hot" : ""}">${t.rank}</span>
          <div class="trending-body">
            <div class="trending-title-row">
              ${url ? `<a class="trending-title" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${title}</a>` : `<span class="trending-title">${title}</span>`}
              ${suffix}
            </div>
            <div class="trending-meta">
              <span class="trending-tag">${escapeHtml(t.tag)}</span>
              <span class="risk-badge ${t.risk?.cls || "risk-low"}">${escapeHtml(t.risk?.level || "正常")}</span>
              <span class="trending-heat">${t.source === "real" ? "热度" : "🔥"} ${escapeHtml(t.heat)}</span>
              ${author}
              ${published}
              <span class="trending-trend ${t.trend.cls}">${escapeHtml(t.trend.icon)} ${escapeHtml(t.trend.label)}</span>
            </div>
          </div>
        </li>
      `;
    })
    .join("");

  document.querySelector("#trending-game-label").textContent = gameName;
  document.querySelector("#trending-platform-label").textContent = platform;

  const now = new Date();
  document.querySelector("#trending-timestamp").textContent =
    `更新于 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  if (sourceStatus) {
    sourceStatus.textContent = options.source === "real"
      ? `数据源：${options.sourceLabel || "真实数据"}${options.note ? `；${options.note}` : ""}`
      : `数据源：样例兜底榜单${options.reason ? `；${options.reason}` : ""}`;
    sourceStatus.className = `source-status ${options.source === "real" ? "source-real" : "source-mock"}`;
    setFetchDiagnostic(
      "#trending-fetch-diagnostic",
      options.source === "real" ? "real" : "mock",
      options.source === "real" ? "真实热点已返回" : "样例兜底榜单",
      options.source === "real"
        ? `已按「${gameName}」和时间范围完成旧视频过滤，返回 ${topics.length} 条可拆解视频。${options.note || ""}`
        : `当前使用演示榜单。原因：${options.reason || "未连接真实热点服务"}。真实服务恢复后会自动优先读取公开数据。`
    );
  }

  if (methodStatus) {
    const range = document.querySelector("#trending-range")?.value || "24h";
    const rangeMap = { today: "今日", "24h": "近 24 小时", "3d": "近 3 天", "7d": "近 7 天" };
    methodStatus.textContent = options.source === "real"
      ? `口径：${options.sourceLabel || "B站公开搜索结果"}；关键词「${gameName}」；时间范围 ${rangeMap[range] || range}；按播放、弹幕、收藏和发布时间衰减计算综合热度，不等同于 B站官方全站榜。`
      : `口径：样例兜底榜单；用于离线演示链路，不代表真实平台热度。开启本地热点服务后会优先使用真实公开搜索数据。`;
    methodStatus.className = `source-status ${options.source === "real" ? "source-real" : "source-mock"}`;
    updateChainBar(getActiveViewName(), `${options.source === "real" ? "真实数据" : "样例兜底"} · ${platform} · ${rangeMap[range] || range} · 旧视频过滤`);
  }

  renderTrendingDetail(gameName, platform, topics[selectedTrendingIndex]);

  archiveSnapshot("trending", gameName, {
    source: options.source === "real" ? "real" : "sample",
    platform,
    topics: topics.slice(0, 10).map((topic) => ({
      rank: topic.rank,
      title: topic.title,
      tag: topic.tag,
      heat: topic.heat,
      risk: topic.risk?.level || "正常",
      author: topic.author || ""
    }))
  });
}

function generateRealTrendingInsight(gameName, platform, topics) {
  const totalViews = topics.reduce((sum, item) => sum + (item.views || 0), 0);
  const top = topics[0];
  const topAuthor = top?.author ? `，头部视频来自 ${top.author}` : "";
  const averageViews = topics.length ? Math.round(totalViews / topics.length) : 0;

  return `当前「${gameName}」在${platform}返回 ${topics.length} 条真实搜索结果，总播放约 ${totalViews.toLocaleString()}，单条平均播放约 ${averageViews.toLocaleString()}${topAuthor}。建议优先拆解 TOP 3 的标题钩子、封面信息密度和评论区高频需求，再反推今日选题。`;
}

async function fetchRealTrending(game, platform) {
  const range = document.querySelector("#trending-range")?.value || "24h";
  const params = new URLSearchParams({ game, platform, range, limit: "10" });
  const response = await fetch(`${HOTSPOT_SERVICE_URL}/hotspots?${params}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || payload.error || "热点服务请求失败");
  }

  return payload;
}

function renderTrendingDetail(gameName, platform, topic) {
  const detail = document.querySelector("#trending-detail");
  if (!detail || !topic) return;

  const titlePattern = inferTitlePattern(topic.title);
  const reasons = generateHookReasons(topic);
  const followUps = generateFollowUpTopics(gameName, topic);
  const publishAdvice = platform === "B站"
    ? "适合做 3-8 分钟拆解视频，标题保留关键词，封面突出结果或冲突点。"
    : "适合先做短内容测试，再根据评论反馈延展成长内容。";
  const risk = topic.risk || {};

  detail.innerHTML = `
    <h3>热点详情分析</h3>
    <div class="detail-title-row">
      <span class="trending-tag">${escapeHtml(topic.tag)}</span>
      <span class="risk-badge ${risk.cls || "risk-low"}">${escapeHtml(risk.level || "正常")}</span>
      <strong>${escapeHtml(topic.title)}</strong>
    </div>
    <div class="detail-metrics">
      <span>标题结构：${escapeHtml(titlePattern)}</span>
      <span>播放：${topic.views ? formatNumberCompact(topic.views) : "暂无"}</span>
      <span>弹幕：${topic.danmaku ? formatNumberCompact(topic.danmaku) : "暂无"}</span>
      <span>热度分：${topic.heatScore ? formatNumberCompact(topic.heatScore) : "样例"}</span>
    </div>
    <div class="detail-grid">
      <div>
        <h4>可能爆的原因</h4>
        <ul class="result-list">${reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div>
        <h4>可跟进选题</h4>
        <ul class="result-list">${followUps.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    </div>
    <p class="detail-advice">${escapeHtml(publishAdvice)}</p>
    <p class="detail-advice">风险判断：${escapeHtml(risk.advice || "当前未命中明显负面词，可作为常规热点跟进。")}</p>
    <div class="detail-actions">
      <button class="secondary-button" id="copy-topic-plan" type="button">复制选题方案</button>
    </div>
  `;
}

function buildTopicPlan(gameName, platform, topic) {
  const reasons = generateHookReasons(topic);
  const followUps = generateFollowUpTopics(gameName, topic);
  const titlePattern = inferTitlePattern(topic.title);

  return [
    `游戏：${gameName}`,
    `平台：${platform}`,
    `热点：${topic.title}`,
    `分类：${topic.tag}`,
    `风险：${topic.risk?.level || "正常"}`,
    `标题结构：${titlePattern}`,
    "",
    "可能爆的原因：",
    ...reasons.map((item, index) => `${index + 1}. ${item}`),
    "",
    "可跟进选题：",
    ...followUps.map((item, index) => `${index + 1}. ${item}`),
    "",
    `运营建议：${topic.risk?.advice || "常规热点跟进。"}`
  ].join("\n");
}

function showSourceStatus(message, className) {
  const sourceStatus = document.querySelector("#trending-source-status");
  if (!sourceStatus) return;
  sourceStatus.textContent = message;
  sourceStatus.className = `source-status ${className || ""}`;
}

async function copySelectedTopicPlan() {
  const topic = currentTrendingTopics[selectedTrendingIndex];
  if (!topic) return;

  const game = document.querySelector("#trending-game").value.trim() || "鸣潮";
  const platform = document.querySelector("#trending-platform").value || "B站";
  const plan = buildTopicPlan(game, platform, topic);

  try {
    await navigator.clipboard.writeText(plan);
    showSourceStatus("已复制当前热点选题方案。", "source-real");
  } catch (error) {
    showSourceStatus("复制失败：浏览器未开放剪贴板权限。", "source-mock");
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportTrendingCsv() {
  if (!currentTrendingTopics.length) return;

  const game = document.querySelector("#trending-game").value.trim() || "鸣潮";
  const platform = document.querySelector("#trending-platform").value || "B站";
  const rows = [
    ["排名", "游戏", "平台", "标题", "作者", "分类", "风险", "播放", "弹幕", "收藏", "热度分", "链接", "跟进选题"]
  ];

  currentTrendingTopics.forEach((topic) => {
    rows.push([
      topic.rank,
      game,
      platform,
      topic.title,
      topic.author || "",
      topic.tag,
      topic.risk?.level || "正常",
      topic.views || "",
      topic.danmaku || "",
      topic.favorites || "",
      topic.heatScore || "",
      topic.url || "",
      generateFollowUpTopics(game, topic).join(" / ")
    ]);
  });

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${game}-${platform}-热点榜单-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showSourceStatus("已导出当前热点榜单 CSV。", "source-real");
}

async function analyzeTrending() {
  const requestGeneration = trendingRequestGuard.next();
  const game = document.querySelector("#trending-game").value.trim() || "鸣潮";
  const platform = document.querySelector("#trending-platform").value || "B站";
  const sourceStatus = document.querySelector("#trending-source-status");
  selectedTrendingIndex = 0;

  if (sourceStatus) {
    sourceStatus.textContent = isDemoMode()
      ? "数据源：正在请求真实热点服务；如失败将自动使用样例兜底。"
      : "数据源：正在请求真实热点服务...";
    sourceStatus.className = "source-status";
  }
  setFetchDiagnostic(
    "#trending-fetch-diagnostic",
    "loading",
    "正在抓取热点",
    `正在请求${isOnlineServiceMode() ? "线上热点服务" : "本机热点服务"}：${platform} · ${game} · ${getRangeLabel(document.querySelector("#trending-range")?.value || "24h")}。`
  );

  try {
    const result = await fetchRealTrending(game, platform);
    if (!trendingRequestGuard.isCurrent(requestGeneration)) return;
    if (!result.items?.length) {
      renderTrendingList(game, platform, {
        source: "mock",
        reason: result.note || "真实结果为空，已使用样例兜底榜单"
      });
      return;
    }

    const resultSource = result.source === "real" ? "real" : "mock";
    renderTrendingList(game, platform, {
      source: resultSource,
      sourceLabel: result.sourceLabel,
      note: result.note,
      reason: resultSource === "real" ? "" : result.note || `${platform} 当前使用样例兜底`,
      items: result.items
    });
  } catch (error) {
    if (!trendingRequestGuard.isCurrent(requestGeneration)) return;
    if (isDemoMode()) {
      renderTrendingList(game, platform, {
        source: "mock",
        reason: `${error.message || "热点服务不可用"}；已自动使用本地样例兜底`
      });
      return;
    }

    if (sourceStatus) {
      sourceStatus.textContent = `数据源：真实热点抓取失败，${error.message || "请确认热点服务已启动"}`;
      sourceStatus.className = "source-status source-mock";
    }
    setFetchDiagnostic(
      "#trending-fetch-diagnostic",
      "error",
      "真实热点抓取失败",
      error.message || (isOnlineServiceMode()
        ? "请检查线上 /api/hotspot 反向代理和服务状态。B站 HTTP 412 通常代表公开接口触发临时风控。"
        : "请确认 hotspot-server.js 已启动；B站 HTTP 412 通常代表公开接口触发临时风控。")
    );
  }
}

/* ============================================================
   模块5：版本包装助手
   ============================================================ */

function classifyVersionPoint(point) {
  const rules = [
    { type: "新角色/载具", words: ["角色", "车辆", "英雄", "干员", "共鸣者", "超跑", "新车"] },
    { type: "新皮肤/外观", words: ["皮肤", "涂装", "时装", "外观", "装扮"] },
    { type: "新副本/玩法", words: ["副本", "玩法", "挑战", "赛道", "关卡", "模式"] },
    { type: "新系统", words: ["系统", "调校", "分享", "养成", "优化", "功能"] },
    { type: "福利活动", words: ["福利", "登录", "奖励", "抽奖", "材料", "领取"] }
  ];
  const matched = rules.find((rule) => rule.words.some((word) => point.includes(word)));
  return matched?.type || "版本内容";
}

function buildVersionSummary(points) {
  const counts = points.reduce((acc, point) => {
    const type = classifyVersionPoint(point);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([type, count]) => `${type} ${count} 项`)
    .join("、");
}

function renderCopyCards(container, items) {
  container.innerHTML = items
    .map(
      (item) => `
        <article class="copy-card">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.body)}</p>
        </article>
      `
    )
    .join("");
}

function getVersionTone(style) {
  const tones = {
    官方公告风: {
      verb: "正式开启",
      hook: "版本重点内容现已公开",
      ending: "请以游戏内实际上线内容为准。"
    },
    社区口语风: {
      verb: "来了",
      hook: "这次更新可以先看这几项",
      ending: "上线后可以先按清单体验。"
    },
    热血燃向: {
      verb: "燃爆开启",
      hook: "准备好迎接新一轮挑战",
      ending: "现在就加入版本主战场。"
    },
    福利导向: {
      verb: "福利开启",
      hook: "先领福利，再体验新内容",
      ending: "记得在活动期内完成领取。"
    },
    KOL口播风: {
      verb: "上线了",
      hook: "兄弟们这波更新重点我帮你们划好了",
      ending: "评论区告诉我你最想先冲哪一项。"
    }
  };
  return tones[style] || tones["官方公告风"];
}

function checkVersionRisks(points, announcement, pushTitles) {
  const text = [points.join("\n"), announcement, pushTitles.join("\n")].join("\n");
  const risks = [];
  const checks = [
    { label: "绝对化承诺", words: ["永久免费", "必得", "必出", "最强", "第一", "史上最强"], advice: "建议改成更稳妥的表达，避免绝对化承诺。" },
    { label: "过度刺激付费", words: ["不抽就亏", "不买后悔", "必须氪", "错过血亏"], advice: "建议改成福利路径或价值说明，避免强刺激付费。" },
    { label: "竞品攻击", words: ["吊打竞品", "碾压", "完爆"], advice: "建议聚焦自身版本卖点，避免引发平台或社区争议。" },
    { label: "信息不完整", words: ["领取", "限时", "福利", "奖励"], advice: "出现福利/领取信息时，应补充时间、入口和条件。" }
  ];

  checks.forEach((check) => {
    if (check.words.some((word) => text.includes(word))) {
      risks.push(`${check.label}：${check.advice}`);
    }
  });

  if (!points.some((point) => /时间|入口|条件|登录|活动/.test(point))) {
    risks.push("信息完整性：建议补充上线时间、活动入口或领取条件。");
  }

  return risks.length ? risks : ["未发现明显高风险表达，发布前仍建议核对活动时间、奖励条件和游戏内入口。"];
}

function checkVersionInfoGaps(points) {
  const text = points.join("\n");
  const checks = [
    { label: "上线时间", pattern: /上线|开启|时间|日期|今日|明日|\d+月|\d+日/ },
    { label: "活动入口", pattern: /入口|活动页|游戏内|大厅|邮件|任务|商店/ },
    { label: "奖励条件", pattern: /条件|完成|登录|参与|累计|任务|领取/ },
    { label: "截止时间", pattern: /截止|结束|限时|活动期|到期/ },
    { label: "适用玩家范围", pattern: /新手|回流|老玩家|全服|等级|段位|玩家/ }
  ];

  const gaps = checks
    .filter((check) => !check.pattern.test(text))
    .map((check) => `${check.label}缺失：建议在公告和推送落地页中补充。`);

  return gaps.length ? gaps : ["关键信息较完整，发布前重点核对时间、入口、奖励条件是否与游戏内一致。"];
}

function generateReleaseCalendar(game, theme, audience, leadPoint) {
  return [
    {
      title: "预热期",
      body: `目标：建立期待。渠道：B站/微博/小红书。内容：${leadPoint} 亮点预告、版本关键词、预约提醒。主推人群：${audience}。`
    },
    {
      title: "上线当天",
      body: `目标：推动进入游戏。渠道：Push/公告/抖音。内容：更新清单、福利领取路径、上线后先做什么。`
    },
    {
      title: "上线后 3 天",
      body: `目标：提升体验深度。渠道：B站/社区。内容：攻略拆解、玩家反馈回应、热门问题 FAQ。`
    },
    {
      title: "活动末期召回",
      body: `目标：减少错过和流失。渠道：Push/微博/社群。内容：奖励截止提醒、回流补领、最后挑战。`
    }
  ];
}

function generateAssetList(points) {
  const types = points.map(classifyVersionPoint);
  const assets = [
    { title: "通用素材", body: "版本主 KV 1 张、版本更新长图 1 张、公告头图 1 张、渠道统一话题图 1 张。" },
    { title: "短视频素材", body: "15 秒竖版高光切片、30 秒版本速览、福利领取路径录屏、评论区互动引导封面。" },
    { title: "B站素材", body: "版本重点录屏、玩法实机片段、更新前后对比、UP 主口播提纲、分 P 封面。" },
    { title: "小红书素材", body: "更新清单截图、福利领取步骤图、新手/回流路线图、适合收藏的图文模板。" }
  ];

  if (types.includes("新皮肤/外观")) {
    assets.push({ title: "外观展示", body: "外观三视图、局内展示、获取方式图、不同场景截图。" });
  }

  if (types.includes("新副本/玩法")) {
    assets.push({ title: "玩法展示", body: "玩法入口录屏、失败/成功关键节点、奖励结算页、难度分层截图。" });
  }

  return assets;
}

function generateAbTitles(game, theme, leadPoint) {
  return [
    `福利导向：${theme}开启，登录先领版本奖励`,
    `内容导向：${leadPoint.slice(0, 18)}，${game}新版本重点来了`,
    `回流导向：老玩家回归先看这份${theme}清单`,
    `挑战导向：新赛季开打，这次版本先冲什么？`,
    `收藏导向：${game}${theme}更新重点一图看懂`
  ];
}

function generateVersionPackage() {
  const game = document.querySelector("#version-game").value.trim() || "目标游戏";
  const theme = document.querySelector("#version-theme").value.trim() || "全新版本";
  const points = splitLines(document.querySelector("#version-points").value);
  const audience = document.querySelector("#version-audience").value;
  const style = document.querySelector("#version-style").value;
  const tone = getVersionTone(style);
  const pointSummary = buildVersionSummary(points);
  const leadPoint = points[0] || "全新内容上线";
  const topPoints = points.slice(0, 3).join("、") || "核心更新内容";

  const announcement =
    `${game}「${theme}」版本${tone.verb}。${tone.hook}：本次更新围绕 ${pointSummary || "核心内容体验"} 展开，重点带来「${leadPoint}」等内容。玩家可通过版本活动体验新内容、领取限时福利，并根据自身进度选择养成、挑战或回归路径。${tone.ending}`;
  document.querySelector("#version-announcement").textContent = announcement;

  renderCopyCards(document.querySelector("#version-social"), [
    {
      title: "B站",
      body: `【${game} ${theme}版本速览】${leadPoint}。简介建议补充：本期按「更新重点 - 玩家先做什么 - 福利入口」拆解，适合 3-8 分钟长视频。`
    },
    {
      title: "抖音",
      body: `${game}新版本${tone.verb}！${topPoints}，30 秒带你看完上线后先做什么。`
    },
    {
      title: "小红书",
      body: `${game}「${theme}」版本更新清单：新手/回流/冲进度玩家都能看，先收藏这份上线前重点。`
    },
    {
      title: "微博",
      body: `#${game}${theme}# 新版本内容公开：${topPoints}。评论区说说你最期待哪一项。`
    }
  ]);

  renderList(document.querySelector("#version-script"), [
    `0-3 秒：用「${leadPoint}」做开场钩子，直接展示版本最大卖点。`,
    `3-15 秒：快速扫过 ${points.slice(0, 3).join("、") || "核心更新内容"}，让玩家建立版本期待。`,
    `15-35 秒：按玩家路径拆解：新手看入坑收益，回流看福利和追赶，核心玩家看挑战和深度系统。`,
    `35-50 秒：补充领取路径、上线时间和活动入口，降低玩家行动成本。`,
    `结尾：用评论互动收口，例如“你最想先体验哪一项？”`
  ]);

  renderPills(document.querySelector("#version-push"), [
    `${theme}开启，领版本福利`,
    `${leadPoint.slice(0, 16)}上线`,
    `${game}新版本，回归奖励开放`,
    `新赛季挑战开启`,
    `版本更新清单已送达`
  ]);

  const pushTitles = [
    `${theme}开启，领版本福利`,
    `${leadPoint.slice(0, 16)}上线`,
    `${game}新版本，回归奖励开放`,
    `新赛季挑战开启`,
    `版本更新清单已送达`
  ];
  renderList(document.querySelector("#version-risk"), checkVersionRisks(points, announcement, pushTitles));
  renderList(document.querySelector("#version-gap"), checkVersionInfoGaps(points));
  renderCopyCards(document.querySelector("#version-calendar"), generateReleaseCalendar(game, theme, audience, leadPoint));
  renderCopyCards(document.querySelector("#version-assets"), generateAssetList(points));
  renderPills(document.querySelector("#version-ab"), generateAbTitles(game, theme, leadPoint));

  renderCopyCards(document.querySelector("#version-audiences"), [
    {
      title: "新手玩家",
      body: `强调低门槛体验和资源获取：先告诉他们上线后做什么、奖励在哪里领、如何快速进入核心乐趣。`
    },
    {
      title: "回流玩家",
      body: `强调追赶成本降低：突出回归奖励、版本福利、养成材料和新内容入口，减少“跟不上”的心理负担。`
    },
    {
      title: "核心玩家",
      body: `强调挑战深度和策略空间：突出新玩法、新系统、强度变化和可研究内容。`
    },
    {
      title: "付费玩家",
      body: `强调稀缺性和展示价值：突出限定外观、主题涂装、收藏感和版本专属权益。`
    },
    {
      title: "当前主推",
      body: `${audience} 是本次主推人群，建议首屏文案优先承接他们的核心需求，再补充其他玩家路径。`
    }
  ]);
  if (typeof enhanceVersionWithLlm === "function") enhanceVersionWithLlm();
}

function buildVersionPackageText() {
  const game = document.querySelector("#version-game").value.trim() || "目标游戏";
  const theme = document.querySelector("#version-theme").value.trim() || "全新版本";
  const announcement = document.querySelector("#version-announcement").textContent;
  const social = Array.from(document.querySelectorAll("#version-social .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`);
  const script = Array.from(document.querySelectorAll("#version-script li")).map((item, index) => `${index + 1}. ${item.textContent}`);
  const push = Array.from(document.querySelectorAll("#version-push span")).map((item) => item.textContent);
  const risks = Array.from(document.querySelectorAll("#version-risk li")).map((item) => item.textContent);
  const gaps = Array.from(document.querySelectorAll("#version-gap li")).map((item) => item.textContent);
  const calendar = Array.from(document.querySelectorAll("#version-calendar .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`);
  const assets = Array.from(document.querySelectorAll("#version-assets .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`);
  const abTitles = Array.from(document.querySelectorAll("#version-ab span")).map((item) => item.textContent);
  const audiences = Array.from(document.querySelectorAll("#version-audiences .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`);

  return [
    `${game}「${theme}」版本包装方案`,
    "",
    "公告文案：",
    announcement,
    "",
    "社媒短文案：",
    ...social,
    "",
    "视频脚本：",
    ...script,
    "",
    "推送标题：",
    ...push.map((item) => `- ${item}`),
    "",
    "风险检查：",
    ...risks.map((item) => `- ${item}`),
    "",
    "信息缺口检查：",
    ...gaps.map((item) => `- ${item}`),
    "",
    "发布节奏表：",
    ...calendar,
    "",
    "素材需求清单：",
    ...assets,
    "",
    "A/B 测试标题：",
    ...abTitles.map((item) => `- ${item}`),
    "",
    "玩家群体卖点：",
    ...audiences
  ].join("\n");
}

async function copyVersionPackage() {
  generateVersionPackage();
  try {
    await navigator.clipboard.writeText(buildVersionPackageText());
  } catch (error) {
    return;
  }
}

function exportVersionPackage() {
  generateVersionPackage();
  const game = document.querySelector("#version-game").value.trim() || "目标游戏";
  const blob = new Blob([buildVersionPackageText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${game}-版本包装方案-${date}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}



/* ---- 模块6：玩家分层运营策略 ---- */

const segmentRules = {
  新手: {
    insight: "核心需求是快速理解玩法、获得正反馈和形成首个短期目标。",
    activities: ["新手七日任务", "首局/首章引导活动", "低门槛组队体验"],
    rewards: ["分阶段引导奖励", "基础养成资源", "首日登录补给"],
    risks: ["避免信息过载，不要一次性塞太多系统入口。"],
    kpis: ["次日留存", "新手任务完成率", "首局/首章完成率"]
  },
  回流: {
    insight: "核心阻力是怕追不上，需要降低回归成本并重建目标感。",
    activities: ["回流追赶任务", "老玩家专属补给", "版本变化速览"],
    rewards: ["追赶资源包", "限时回归任务奖励", "核心玩法直达券"],
    risks: ["不要强调落后差距，优先表达现在回来能快速接上。"],
    kpis: ["回流3日留存", "追赶任务完成率", "回流后活跃天数"]
  },
  重氪: {
    insight: "关注稀缺感、身份感和高价值体验稳定性。",
    activities: ["高阶挑战/收藏活动", "限定外观展示", "尊享权益预告"],
    rewards: ["限定称号/头像框", "收藏型外观", "高阶养成材料"],
    risks: ["避免显得过度区别对待，权益表达要控制社区观感。"],
    kpis: ["ARPPU", "复购率", "高价值礼包转化"]
  },
  轻氪: {
    insight: "关注高性价比、低压力付费和持续收益。",
    activities: ["月卡/通行证引导", "小额礼包组合", "阶段性折扣活动"],
    rewards: ["高性价比礼包", "通行证经验", "小额付费返利"],
    risks: ["不要制造付费焦虑，重点表达可选、划算和长期收益。"],
    kpis: ["小额转化率", "月卡购买率", "通行证激活率"]
  },
  剧情党: {
    insight: "更容易被角色关系、世界观悬念和剧情更新驱动。",
    activities: ["剧情章节预约", "角色故事解锁", "二创征集/剧情讨论"],
    rewards: ["角色相关道具", "剧情纪念头像", "收藏向文本/插画"],
    risks: ["避免剧透，预告只给情绪钩子和角色关系。"],
    kpis: ["剧情任务完成率", "角色内容互动", "剧情话题评论量"]
  },
  竞技党: {
    insight: "更关注强度、排名、荣誉和公平竞技体验。",
    activities: ["排位冲刺", "限时赛事", "段位目标挑战"],
    rewards: ["段位奖励", "排行榜称号", "赛事纪念道具"],
    risks: ["避免引发强度和平衡争议，表达要强调公平和技术成长。"],
    kpis: ["排位参与率", "对局时长", "赛事报名率"]
  }
};

const segmentGoalMap = {
  activation: {
    label: "拉新激活",
    strategy: "降低首次体验门槛，让玩家快速完成一次正反馈行为。",
    activities: ["首局/首章完成激励", "新手目标打卡", "好友助力入坑"],
    rewards: ["首日补给", "新手成长礼包", "低门槛抽奖券"],
    kpis: ["新手注册转化", "首日核心行为完成率", "次日留存"]
  },
  recall: {
    label: "召回回流",
    strategy: "减少追赶焦虑，用补给和清晰目标推动回流后连续活跃。",
    activities: ["回归追赶路线", "版本变化速览", "老友组队回归"],
    rewards: ["回归补给", "追赶资源", "限时回归称号"],
    kpis: ["回流登录率", "回流3日留存", "追赶任务完成率"]
  },
  payment: {
    label: "付费转化",
    strategy: "强调价值感和可选性，优先引导低压力、可持续的付费路径。",
    activities: ["月卡权益说明", "通行证阶段奖励展示", "小额礼包组合推荐"],
    rewards: ["高性价比礼包", "连续收益权益", "首充/复购返利"],
    kpis: ["小额转化率", "礼包点击率", "付费后留存"]
  },
  version: {
    label: "版本促活",
    strategy: "把版本卖点转化成玩家行动路径，推动登录、体验和任务完成。",
    activities: ["版本主线体验", "限时挑战任务", "版本福利签到"],
    rewards: ["版本纪念奖励", "限定道具", "活动兑换资源"],
    kpis: ["版本内容参与率", "活动任务完成率", "人均在线时长"]
  },
  reputation: {
    label: "社区口碑",
    strategy: "用可信内容和玩家语言建立讨论氛围，降低争议风险。",
    activities: ["玩家故事征集", "版本体验问答", "攻略/二创共创"],
    rewards: ["社区身份奖励", "UGC 展示位", "纪念头像框"],
    kpis: ["正向评论占比", "社区互动量", "争议反馈响应率"]
  },
  participation: {
    label: "活动参与",
    strategy: "突出奖励入口、参与成本和截止时间，降低行动阻力。",
    activities: ["每日轻任务", "限时冲刺", "组队协作活动"],
    rewards: ["任务积分", "阶段兑换奖励", "截止前加码奖励"],
    kpis: ["活动入口点击率", "任务参与率", "奖励领取率"]
  }
};

const segmentProfileMap = {
  新手: {
    motivation: "希望快速理解游戏核心乐趣，并尽快获得一次明确正反馈。",
    barrier: "系统入口多、成长目标不清晰，容易在前几分钟流失。",
    lever: "用低门槛任务、明确路径和即时奖励降低理解成本。"
  },
  回流: {
    motivation: "想知道现在回来是否跟得上版本，以及有没有值得回来的新内容。",
    barrier: "担心进度落后、资源缺口大，重新熟悉成本高。",
    lever: "用追赶补给、版本变化速览和短周期目标重建目标感。"
  },
  重氪: {
    motivation: "关注稀缺感、身份感、收藏价值和高价值内容的稳定体验。",
    barrier: "如果权益表达过强，容易引发社区公平性争议。",
    lever: "强调收藏、荣誉和高阶挑战，不把优势包装成破坏公平的能力。"
  },
  轻氪: {
    motivation: "愿意为长期收益和高性价比内容付费，但不希望被强推。",
    barrier: "对付费焦虑敏感，如果价值解释不清会直接放弃。",
    lever: "用月卡、通行证、小额礼包表达可选性和长期收益。"
  },
  剧情党: {
    motivation: "被角色关系、剧情悬念、世界观设定和情绪价值驱动。",
    barrier: "对剧透和过度功利化活动敏感，容易被破坏沉浸感。",
    lever: "用情绪钩子、角色故事和讨论空间承接内容兴趣。"
  },
  竞技党: {
    motivation: "追求排名、技术成长、赛事荣誉和公平竞技体验。",
    barrier: "对强度失衡、奖励影响公平、规则不透明非常敏感。",
    lever: "用排位目标、段位荣誉和清晰规则推动参与。"
  }
};

const segmentPriorityReasons = {
  回流: "回流玩家先解决追赶焦虑，否则后续活动和付费承接都会变弱。",
  新手: "新手玩家先解决理解成本和首次正反馈，优先保证留存基础。",
  重氪: "重氪玩家先处理身份感和稀缺感，同时控制社区公平观感。",
  轻氪: "轻氪玩家先强调性价比和可选性，避免把触达做成付费压力。",
  竞技党: "竞技玩家先保证规则、公平和荣誉路径，再放大赛事参与。",
  剧情党: "剧情玩家先建立情绪期待和角色关系，再引导讨论与分享。"
};

const segmentRewardCostMap = {
  low: ["称号/头像框", "登录补给", "抽奖券", "限时加成", "活动积分"],
  medium: ["资源包", "通行证经验", "兑换代币", "回归追赶材料", "限定任务奖励"],
  high: ["限定外观", "稀有道具", "高价值礼包返利", "收藏型装扮", "专属展示权益"]
};

function parseSegmentTags(value) {
  return String(value || "")
    .split(/[、,，\n\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSegmentRules(tags) {
  const matched = tags.map((tag) => segmentRules[tag]).filter(Boolean);
  return matched.length ? matched : [segmentRules.新手];
}

function getPrimarySegment(tags) {
  const priority = ["回流", "新手", "重氪", "轻氪", "竞技党", "剧情党"];
  return priority.find((tag) => tags.includes(tag)) || tags[0] || "综合玩家";
}

function uniqueItems(items) {
  return Array.from(new Set(items)).filter(Boolean);
}

function buildSegmentCards(items, prefix) {
  return items.map((item, index) => ({
    title: `${prefix} ${index + 1}`,
    body: item
  }));
}

function buildSegmentPersonaCards(tags, primary) {
  const selectedTags = uniqueItems(tags.length ? tags : [primary]).filter((tag) => segmentProfileMap[tag]);
  const visibleTags = selectedTags.length ? selectedTags : [primary];

  return visibleTags.slice(0, 6).map((tag) => {
    const profile = segmentProfileMap[tag] || segmentProfileMap.新手;
    return {
      title: tag,
      body: `动机：${profile.motivation} 阻力：${profile.barrier} 抓手：${profile.lever}`
    };
  });
}

function buildSegmentPriorityCards(tags, primary, goalLabel) {
  const orderedTags = uniqueItems([primary, ...tags]).filter((tag) => segmentPriorityReasons[tag]);
  if (!orderedTags.length) {
    return [
      {
        title: "优先级 1",
        body: `当前按「综合玩家」处理，先围绕「${goalLabel}」建立清晰行动路径，再根据数据回收结果细分人群。`
      }
    ];
  }

  return orderedTags.slice(0, 4).map((tag, index) => ({
    title: `优先级 ${index + 1}：${tag}`,
    body: `${segmentPriorityReasons[tag]} 本轮目标是「${goalLabel}」，因此触达顺序先保证这个标签的核心阻力被解决。`
  }));
}

function buildRewardCostCards(primary, goalConfig) {
  const primaryProfile = segmentProfileMap[primary] || segmentProfileMap.新手;
  return [
    {
      title: "低成本",
      body: `${segmentRewardCostMap.low.join("、")}。适合做大范围触达，用来降低参与门槛，重点服务「${goalConfig.label}」。`
    },
    {
      title: "中成本",
      body: `${segmentRewardCostMap.medium.join("、")}。适合承接已经参与活动的玩家，强化连续活跃和任务完成。`
    },
    {
      title: "高成本",
      body: `${segmentRewardCostMap.high.join("、")}。适合小范围激励高价值或核心玩家，表达重点应贴近「${primaryProfile.lever}」`
    }
  ];
}

function generateSegmentPlan() {
  const game = document.querySelector("#segment-game")?.value.trim() || "目标游戏";
  const tags = parseSegmentTags(document.querySelector("#segment-tags")?.value);
  const goal = document.querySelector("#segment-goal")?.value || "version";
  const goalConfig = segmentGoalMap[goal] || segmentGoalMap.version;
  const stage = document.querySelector("#segment-lifecycle")?.value || "30日活跃";
  const theme = document.querySelector("#segment-theme")?.value.trim() || "版本活动";
  const rules = getSegmentRules(tags);
  const primary = getPrimarySegment(tags);
  const tagText = tags.join(" / ") || "综合玩家";
  const activities = uniqueItems([...goalConfig.activities, ...rules.flatMap((rule) => rule.activities)]).slice(0, 6);
  const rewards = uniqueItems([...goalConfig.rewards, ...rules.flatMap((rule) => rule.rewards)]).slice(0, 6);
  const risks = uniqueItems(rules.flatMap((rule) => rule.risks)).slice(0, 6);
  const kpis = uniqueItems([...goalConfig.kpis, ...rules.flatMap((rule) => rule.kpis)]).slice(0, 10);
  const insight = `当前人群为「${tagText}」，主策略优先级按「${primary}」处理；生命周期为「${stage}」。本轮目标是「${goalConfig.label}」：${goalConfig.strategy}围绕「${theme}」，建议先明确玩家下一步该做什么，再匹配奖励和触达渠道。`;

  document.querySelector("#segment-insight").textContent = insight;
  renderCopyCards(document.querySelector("#segment-persona"), buildSegmentPersonaCards(tags, primary));
  renderCopyCards(document.querySelector("#segment-priority"), buildSegmentPriorityCards(tags, primary, goalConfig.label));
  renderCopyCards(document.querySelector("#segment-copy"), [
    { title: "主文案", body: `${game}「${theme}」已开启，${primary}玩家可以先完成今日关键目标，领取对应奖励并快速进入版本核心体验。` },
    { title: "短文案", body: `${primary}玩家回到${game}，先领补给，再体验${theme}。` },
    { title: "社群引导", body: `今天优先推荐${tagText}看这条路线：先完成入口任务，再根据进度领取奖励，有问题可以在群里直接问。` }
  ]);
  renderCopyCards(document.querySelector("#segment-activity"), buildSegmentCards(activities, "活动"));
  renderCopyCards(document.querySelector("#segment-reward"), buildSegmentCards(rewards, "奖励"));
  renderCopyCards(document.querySelector("#segment-reward-cost"), buildRewardCostCards(primary, goalConfig));
  renderCopyCards(document.querySelector("#segment-channel"), [
    { title: "Push", body: `${theme}奖励已开放，${primary}玩家今天先完成关键任务。` },
    { title: "邮件", body: `为帮助你更顺畅体验「${theme}」，我们准备了对应奖励和推荐路线。登录后可按活动页指引完成任务并领取奖励。` },
    { title: "社群", body: `${tagText}今天可以优先看这条活动路线，奖励入口和任务顺序已经整理好，适合直接照着做。` },
    { title: "游戏内弹窗", body: `${theme}进行中：完成推荐任务，领取专属奖励。` }
  ]);
  renderList(document.querySelector("#segment-risk"), risks);
  renderPills(document.querySelector("#segment-metrics"), [
    `目标：${goalConfig.label}`,
    `主策略：${primary}`,
    `标签数：${tags.length || 1}`,
    ...kpis
  ]);
}

function buildSegmentPlanText() {
  generateSegmentPlan();
  const sections = [
    ["玩家核心洞察", document.querySelector("#segment-insight")?.textContent || ""],
    ["玩家画像说明", Array.from(document.querySelectorAll("#segment-persona .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`).join("\n")],
    ["多标签优先级解释", Array.from(document.querySelectorAll("#segment-priority .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`).join("\n")],
    ["触达文案", Array.from(document.querySelectorAll("#segment-copy .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`).join("\n")],
    ["活动推荐", Array.from(document.querySelectorAll("#segment-activity .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`).join("\n")],
    ["奖励设计建议", Array.from(document.querySelectorAll("#segment-reward .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`).join("\n")],
    ["奖励成本等级", Array.from(document.querySelectorAll("#segment-reward-cost .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`).join("\n")],
    ["渠道话术", Array.from(document.querySelectorAll("#segment-channel .copy-card")).map((card) => `${card.querySelector("strong").textContent}：${card.querySelector("p").textContent}`).join("\n")],
    ["风险提醒", Array.from(document.querySelectorAll("#segment-risk li")).map((item) => `- ${item.textContent}`).join("\n")],
    ["观察指标", Array.from(document.querySelectorAll("#segment-metrics span")).map((item) => `- ${item.textContent}`).join("\n")]
  ];
  return sections.map(([title, body]) => `${title}：\n${body}`).join("\n\n");
}

async function copySegmentPlan() {
  try {
    await navigator.clipboard.writeText(buildSegmentPlanText());
  } catch (error) {
    return;
  }
}

function exportSegmentPlan() {
  const blob = new Blob([buildSegmentPlanText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `玩家分层运营策略-${date}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ---- 模块7：KOL/KOC 合作筛选 ---- */

const creatorDemoRows = [
  "达人名,平台,粉丝数,平均播放,互动率,内容类型,历史游戏品类,评论质量,预估报价,商单密度",
  "竞速研究所,B站,180000,82000,6.8%,深度测评/攻略,赛车/竞速/开放世界,高,18000,中",
  "阿橙手游日记,抖音,520000,210000,4.2%,新品资讯/短视频,二游/开放世界/动作,中,42000,中",
  "老王不是欧皇,B站,76000,38000,9.6%,攻略/平民养成,二游/卡牌/策略,高,9000,低",
  "小白试玩间,小红书,95000,26000,7.1%,新手体验/图文种草,休闲/女性向/派对,高,7000,低",
  "爆肝测评君,B站,310000,96000,3.1%,深度测评/吐槽,MMO/开放世界/射击,中,35000,高",
  "电竞情报站,抖音,880000,360000,2.8%,热点资讯/赛事,射击/MOBA/竞技,低,76000,高",
  "攻略课代表,B站,130000,69000,10.5%,攻略合集/角色培养,二游/动作/策略,高,12000,低",
  "车手小林,抖音,240000,118000,8.3%,直播切片/实战技巧,赛车/体育/模拟经营,高,22000,中",
  "泛娱乐小鹿,抖音,1200000,420000,1.9%,泛娱乐挑战/热点,休闲/派对/社交,中,110000,高",
  "硬核拆包社,B站,56000,33000,12.4%,机制拆解/数据测试,动作/硬核/独立游戏,高,8000,低"
].join("\n");

const creatorActivityConfigs = {
  newLaunch: {
    label: "新品上线/首曝",
    weights: { launch: 0.5, review: 0.12, guide: 0.1, value: 0.28 },
    logic: "新品首曝更看重触达规模和破圈效率，因此新品曝光权重最高，同时保留性价比约束。"
  },
  version: {
    label: "版本节点传播",
    weights: { launch: 0.34, review: 0.24, guide: 0.22, value: 0.2 },
    logic: "版本节点需要兼顾声量、内容解释和玩家行动路径，所以曝光、测评和攻略权重更均衡。"
  },
  guidePush: {
    label: "攻略内容铺量",
    weights: { launch: 0.12, review: 0.16, guide: 0.52, value: 0.2 },
    logic: "攻略铺量更看重垂类匹配、互动率、收藏价值和内容可复用性，因此攻略扩散权重最高。"
  },
  live: {
    label: "直播活动引流",
    weights: { launch: 0.38, review: 0.08, guide: 0.14, value: 0.4 },
    logic: "直播引流需要短期触达和预算效率，优先看曝光能力与单位成本，深度测评权重较低。"
  },
  reputation: {
    label: "社区口碑建设",
    weights: { launch: 0.1, review: 0.48, guide: 0.24, value: 0.18 },
    logic: "口碑建设更依赖可信内容、评论质量和深度表达，因此深度测评权重最高。"
  },
  budget: {
    label: "低预算测试",
    weights: { launch: 0.14, review: 0.14, guide: 0.24, value: 0.48 },
    logic: "低预算测试优先验证单位成本和内容反馈，性价比权重最高。"
  }
};

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseMetricValue(value) {
  const raw = String(value || "").trim().replace(/,/g, "");
  if (!raw) return 0;
  const number = Number(raw.replace(/[%万wWkK千+]/g, "")) || 0;
  if (/[万wW]/.test(raw)) return number * 10000;
  if (/[kK千]/.test(raw)) return number * 1000;
  return number;
}

function parseRateValue(value) {
  const raw = String(value || "").trim();
  const number = Number(raw.replace("%", "")) || 0;
  if (raw.includes("%")) return number;
  if (number > 0 && number <= 1) return number * 100;
  return number;
}

function qualityScore(value) {
  const text = String(value || "");
  if (text.includes("高") || text.includes("优")) return 90;
  if (text.includes("低") || text.includes("差") || text.includes("水")) return 35;
  return 65;
}

function densityScore(value) {
  const text = String(value || "");
  if (text.includes("高")) return 30;
  if (text.includes("低")) return 85;
  return 60;
}

function splitCreatorLine(line) {
  return line.includes("\t") ? line.split("\t") : line.split(/,|，/);
}

function parseCreators(input) {
  return String(input || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^达人名[,，\t]/.test(line))
    .map((line, index) => {
      const cells = splitCreatorLine(line).map((cell) => cell.trim());
      return {
        id: index + 1,
        name: cells[0] || `达人 ${index + 1}`,
        platform: cells[1] || "未标注",
        followers: parseMetricValue(cells[2]),
        avgViews: parseMetricValue(cells[3]),
        engagementRate: parseRateValue(cells[4]),
        contentType: cells[5] || "综合内容",
        gameHistory: cells[6] || "未标注",
        commentQuality: cells[7] || "中",
        quote: parseMetricValue(cells[8]),
        commercialDensity: cells[9] || "中"
      };
    });
}

function inferCreatorType(row) {
  if (row.followers >= 800000) return "头部 KOL";
  if (row.followers >= 200000) return "腰部达人";
  if (row.followers >= 50000) return "垂类 KOC";
  return "长尾 KOC";
}

function hasAny(text, words) {
  return words.some((word) => String(text || "").includes(word));
}

function scoreCreator(row) {
  const type = inferCreatorType(row);
  const conversionRate = parseRateValue(row.conversionRate);
  const conversionScore = conversionRate > 0 ? clampScore(conversionRate * 5) : 0;
  const content = `${row.contentType} ${row.gameHistory}`;
  const fanScore = Math.min(100, Math.log10(Math.max(row.followers, 1)) * 18);
  const viewScore = Math.min(100, Math.log10(Math.max(row.avgViews, 1)) * 20);
  const engagementScore = Math.min(100, row.engagementRate * 8);
  const quality = qualityScore(row.commentQuality);
  const density = densityScore(row.commercialDensity);
  const quote = row.quote || 1;
  const cpm = row.avgViews ? (quote / row.avgViews) * 1000 : quote;
  const cpe = row.avgViews && row.engagementRate ? quote / (row.avgViews * row.engagementRate / 100) : quote;
  const verticalBonus = hasAny(content, ["二游", "动作", "射击", "赛车", "竞速", "MMO", "开放世界", "策略", "卡牌", "MOBA"]) ? 10 : 0;
  const reviewBonus = hasAny(content, ["测评", "拆解", "数据", "机制", "硬核", "长视频"]) ? 18 : 0;
  const guideBonus = hasAny(content, ["攻略", "养成", "合集", "技巧", "新手", "实战"]) ? 20 : 0;
  const exposureBonus = hasAny(content, ["资讯", "热点", "挑战", "泛娱乐", "短视频", "直播切片"]) ? 14 : 0;
  const riskPenalty = (density < 50 ? 14 : 0) + (quality < 50 ? 18 : 0) + (row.engagementRate > 18 ? 10 : 0) + (!verticalBonus ? 8 : 0);

  const launch = clampScore(fanScore * 0.32 + viewScore * 0.34 + engagementScore * 0.12 + quality * 0.1 + density * 0.06 + exposureBonus + verticalBonus * 0.4 - riskPenalty * 0.35);
  const review = clampScore(viewScore * 0.18 + engagementScore * 0.18 + quality * 0.3 + density * 0.08 + reviewBonus + verticalBonus - riskPenalty * 0.3);
  const guide = clampScore(viewScore * 0.18 + engagementScore * 0.28 + quality * 0.24 + density * 0.1 + guideBonus + verticalBonus * 0.7 - riskPenalty * 0.25);
  const value = clampScore(100 - Math.min(60, cpm * 1.3) - Math.min(25, cpe * 0.2) + engagementScore * 0.25 + quality * 0.2 + density * 0.12 + conversionScore * 0.12 - riskPenalty * 0.45);
  const overall = clampScore(launch * 0.28 + review * 0.24 + guide * 0.24 + value * 0.24);
  const risks = [];
  if (row.commercialDensity.includes("高")) risks.push("商单密度偏高");
  if (quality < 50) risks.push("评论质量偏低");
  if (row.engagementRate > 18) risks.push("互动率异常，需核查刷量");
  if (!verticalBonus) risks.push("历史游戏品类匹配不足");
  if (cpm > 120) risks.push("CPM 偏高");

  return {
    ...row,
    type,
    conversionRate,
    conversionScore,
    cpm,
    cpe,
    scores: { launch, review, guide, value, overall },
    risks,
    tier: risks.length >= 3 || quality < 50 ? "风险名单" : overall >= 78 ? "A档优先邀约" : overall >= 62 ? "B档补充合作" : "C档低预算测试"
  };
}

function getActivityConfig(activity) {
  return creatorActivityConfigs[activity] || creatorActivityConfigs.newLaunch;
}

function scoreByGoal(row, goal, activity = "newLaunch") {
  if (goal === "value") return row.scores.value;
  const config = getActivityConfig(activity);
  const baseScore = Object.entries(config.weights).reduce((total, [key, weight]) => total + row.scores[key] * weight, 0);
  const goalBoost = {
    launch: row.scores.launch * 0.12,
    review: row.scores.review * 0.12,
    guide: row.scores.guide * 0.12
  }[goal] || 0;
  return clampScore(baseScore * 0.88 + goalBoost);
}

function explainCreatorScore(goal, activity) {
  const config = getActivityConfig(activity);
  const goalLabels = { launch: "新品曝光", review: "深度测评", guide: "攻略扩散", value: "性价比优先" };
  const weights = Object.entries(config.weights)
    .map(([key, value]) => ({ launch: "曝光", review: "测评", guide: "攻略", value: "性价比" }[key] + ` ${Math.round(value * 100)}%`))
    .join("、");
  if (goal === "value") {
    return `目标分当前等同于性价比分：用均播、互动率、评论质量和商单密度修正报价效率，核心看 CPM/CPE 是否划算。性价比不是单纯报价低，而是单位播放和单位互动更有效。`;
  }
  return `目标分会随活动场景动态调整。当前场景「${config.label}」的基础权重为：${weights}；合作目标「${goalLabels[goal] || "综合"}」会额外强化对应能力。${config.logic} 性价比分单独展示，用来判断同等合作效果下谁的预算效率更高。`;
}

function targetScore(row, goal, activity) {
  return scoreByGoal(row, goal, activity);
}

function formatWan(value) {
  if (!value) return "0";
  return value >= 10000 ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万` : String(Math.round(value));
}

function formatCurrency(value) {
  return value ? `¥${Math.round(value).toLocaleString()}` : "未填";
}

function getCreatorFit(row) {
  const best = Object.entries(row.scores)
    .filter(([key]) => key !== "overall")
    .sort((a, b) => b[1] - a[1])[0];
  const labels = { launch: "新品曝光", review: "深度测评", guide: "攻略扩散", value: "性价比合作" };
  return labels[best[0]] || "综合合作";
}

function getCreatorBrief(row) {
  const fit = getCreatorFit(row);
  if (fit === "新品曝光") return "适合承接版本首曝、福利口播、挑战赛话题和短视频扩散，brief 要前置核心卖点和发布时间。";
  if (fit === "深度测评") return "适合做长视频测评、版本机制拆解和优缺点分析，brief 需提供体验重点、素材包和禁用表述。";
  if (fit === "攻略扩散") return "适合做新手路线、角色养成、活动速通和实战技巧，brief 要给清晰步骤、奖励路径和结论模板。";
  return "适合用小预算做多点测试，优先观察评论质量、完播和互动成本，再决定是否加码。";
}

function getCreatorBriefDetail(row) {
  const fit = getCreatorFit(row);
  const platformAdvice = {
    B站: "交付以 3-8 分钟视频为主，要求标题包含游戏名和核心结论，保留数据截图或实机片段。",
    抖音: "交付以 30-60 秒短视频或直播切片为主，前三秒突出卖点和福利信息。",
    小红书: "交付以图文种草或体验笔记为主，标题强调新手视角、颜值、上手路径和收藏价值。",
    微博: "交付以话题短文和转发扩散为主，需要配合节点话题和评论区互动。"
  };
  const structure = fit === "新品曝光"
    ? "结构：3秒卖点钩子 - 核心玩法/福利 - 上线时间 - 评论区互动。"
    : fit === "深度测评"
    ? "结构：版本结论 - 优缺点拆解 - 与同品类对比 - 适合人群 - 是否推荐体验。"
    : fit === "攻略扩散"
    ? "结构：玩家痛点 - 步骤拆解 - 资源/奖励路径 - 常见误区 - 收藏提醒。"
    : "结构：真实体验 - 单点卖点 - 评论反馈观察 - 小预算测试结论。";

  return [
    `推荐方向：${fit}。`,
    structure,
    platformAdvice[row.platform] || "交付形式按达人强项确定，brief 需明确核心卖点、发布时间和素材授权范围。",
    "禁用表达：避免绝对化承诺、未确认福利、拉踩竞品和诱导付费。",
    `验收重点：播放不低于均播 ${formatWan(row.avgViews)} 的 70%，评论区需出现有效玩家讨论。`
  ].join(" ");
}

function getCreatorAnomalies(row) {
  const anomalies = [];
  const viewFollowerRatio = row.followers ? row.avgViews / row.followers : 0;
  if (row.followers >= 500000 && viewFollowerRatio < 0.12) anomalies.push("粉丝高但均播偏低");
  if (row.followers < 120000 && row.avgViews > row.followers * 0.9) anomalies.push("均播接近或超过粉丝量，需核查爆款是否稳定");
  if (row.engagementRate > 18) anomalies.push("互动率异常偏高，需核查刷量或抽奖评论");
  if (row.engagementRate < 2 && row.followers > 200000) anomalies.push("互动率偏低，粉丝粘性不足");
  if (row.cpm > 120) anomalies.push("CPM 偏高，报价需压价或补权益");
  if (row.cpe > 30) anomalies.push("单位互动成本偏高");
  if (row.commentQuality.includes("低")) anomalies.push("评论质量低，可能不适合口碑扩散");
  if (row.commercialDensity.includes("高")) anomalies.push("商单密度高，内容可信度可能下降");
  return anomalies;
}

function chooseCreatorsByBudget(candidates, budget, scoreKey, limit = 8) {
  const selected = [];
  let used = 0;
  [...candidates]
    .filter((row) => row.tier !== "风险名单" && row.quote > 0)
    .sort((a, b) => (b.scores[scoreKey] / Math.max(b.quote, 1)) - (a.scores[scoreKey] / Math.max(a.quote, 1)))
    .forEach((row) => {
      if (selected.length >= limit) return;
      if (used + row.quote <= budget) {
        selected.push(row);
        used += row.quote;
      }
    });
  return { selected, used };
}

function buildCreatorBudgetPlans(rows, budget) {
  const usableBudget = budget || rows.filter((row) => row.tier !== "风险名单").reduce((sum, row) => sum + row.quote, 0);
  const available = rows.filter((row) => row.tier !== "风险名单");
  const exposurePool = [...available].sort((a, b) => b.scores.launch - a.scores.launch);
  const stablePool = [...available].sort((a, b) => b.scores.overall - a.scores.overall);
  const valuePool = [...available].sort((a, b) => b.scores.value - a.scores.value);
  const exposure = chooseCreatorsByBudget(exposurePool, usableBudget, "launch", 4);
  const stable = chooseCreatorsByBudget(stablePool, usableBudget, "overall", 6);
  const value = chooseCreatorsByBudget(valuePool, usableBudget, "value", 8);

  return [
    {
      title: `曝光组合 · ${formatCurrency(exposure.used)}`,
      body: exposure.selected.length
        ? `${exposure.selected.map((row) => row.name).join("、")}。适合版本首曝、节点造势和短期破圈。`
        : "当前预算下没有可推荐的曝光组合。"
    },
    {
      title: `稳妥组合 · ${formatCurrency(stable.used)}`,
      body: stable.selected.length
        ? `${stable.selected.map((row) => row.name).join("、")}。适合兼顾曝光、内容质量和风险控制。`
        : "当前预算下没有可推荐的稳妥组合。"
    },
    {
      title: `性价比组合 · ${formatCurrency(value.used)}`,
      body: value.selected.length
        ? `${value.selected.map((row) => row.name).join("、")}。适合多点测试和 KOC 铺量。`
        : "当前预算下没有可推荐的性价比组合。"
    }
  ];
}

function renderCreatorBudgetPlans(rows, budget) {
  renderCopyCards(document.querySelector("#creator-budget-plan"), buildCreatorBudgetPlans(rows, budget));
}

function renderCreatorBriefs(rows, goal, activity) {
  const selected = [...rows]
    .filter((row) => row.tier !== "风险名单")
    .sort((a, b) => targetScore(b, goal, activity) - targetScore(a, goal, activity))
    .slice(0, 4);
  renderCopyCards(
    document.querySelector("#creator-brief-list"),
    selected.length
      ? selected.map((row) => ({ title: `${row.name} · ${getCreatorFit(row)}`, body: getCreatorBriefDetail(row) }))
      : [{ title: "暂无 Brief", body: "导入可推进达人后，会自动生成达人合作 brief。" }]
  );
}

function renderCreatorAnomalies(rows) {
  const items = rows.flatMap((row) => getCreatorAnomalies(row).map((item) => `${row.name}：${item}`));
  renderList(
    document.querySelector("#creator-anomaly-list"),
    items.length ? items.slice(0, 8) : ["当前未发现明显数据异常，合作前仍建议抽查近期 5-10 条内容的播放和评论质量。"]
  );
}

function renderCreatorTable(rows, goal, activity) {
  const container = document.querySelector("#creator-table");
  if (!container) return;
  container.innerHTML = rows.length
    ? `
      <div class="creator-table-head">
        <span>达人</span><span>类型</span><span>推荐场景</span><span>目标分</span><span>性价比</span><span>报价</span>
      </div>
      ${rows.map((row) => `
        <div class="creator-table-row">
          <strong>${escapeHtml(row.name)}${row.dataSource === "backfill" ? '<em class="creator-data-badge">实测</em>' : ""}<small>${escapeHtml(row.platform)} · ${formatWan(row.followers)}粉 · 均播${formatWan(row.avgViews)}</small></strong>
          <span>${escapeHtml(row.type)}</span>
          <span>${escapeHtml(getCreatorFit(row))}</span>
          <span class="score-pill">${targetScore(row, goal, activity)}</span>
          <span>${row.scores.value}</span>
          <span>${formatCurrency(row.quote)}</span>
        </div>
      `).join("")}
    `
    : `<p class="muted-copy">暂无达人数据，请导入名单或载入示例。</p>`;
}

function renderCreatorTiers(rows) {
  const groups = ["A档优先邀约", "B档补充合作", "C档低预算测试", "风险名单"];
  renderCopyCards(
    document.querySelector("#creator-tier-list"),
    groups.map((group) => {
      const names = rows.filter((row) => row.tier === group).map((row) => row.name);
      return {
        title: `${group}（${names.length}）`,
        body: names.length ? names.join("、") : "暂无"
      };
    })
  );
}

function renderCreatorScenarios(rows) {
  const scenarios = [
    ["新品曝光", "launch"],
    ["深度测评", "review"],
    ["攻略扩散", "guide"],
    ["性价比排序", "value"]
  ];
  renderCopyCards(
    document.querySelector("#creator-scenario-list"),
    scenarios.map(([label, key]) => {
      const selected = [...rows]
        .filter((row) => row.tier !== "风险名单")
        .sort((a, b) => b.scores[key] - a.scores[key])
        .slice(0, 3);
      return {
        title: label,
        body: selected.length ? selected.map((row) => `${row.name} ${row.scores[key]}分`).join("；") : "暂无可推荐达人"
      };
    })
  );
}

function renderCreatorRisks(rows) {
  const risky = rows.filter((row) => row.risks.length);
  renderList(
    document.querySelector("#creator-risk-list"),
    risky.length
      ? risky.slice(0, 6).map((row) => `${row.name}：${row.risks.join("、")}`)
      : ["当前名单未命中明显高风险达人，仍建议合作前抽查近期内容、评论区和报价口径。"]
  );
}

function summarizeCreators(rows, goal, budget, activity) {
  if (!rows.length) return "导入达人名单后，会自动生成合作优先级、场景适配和风险提示。";
  const available = rows.filter((row) => row.tier !== "风险名单");
  const top = available[0] || rows[0];
  const totalQuote = available.reduce((sum, row) => sum + row.quote, 0);
  const goalLabels = { launch: "新品曝光", review: "深度测评", guide: "攻略扩散", value: "性价比优先" };
  return `本轮共识别 ${rows.length} 位达人，其中可优先推进 ${available.filter((row) => row.tier === "A档优先邀约").length} 位，风险名单 ${rows.filter((row) => row.tier === "风险名单").length} 位。当前场景为「${getActivityConfig(activity).label}」，目标为「${goalLabels[goal] || "综合合作"}」，首推 ${top.name}（${scoreByGoal(top, goal, activity)}分，${getCreatorFit(top)}）。若只推进非风险达人，预估报价合计 ${formatCurrency(totalQuote)}，${budget && totalQuote > budget ? "已超过预算，建议优先保留 A 档与性价比 TOP 达人。" : "在当前预算内可做组合测试。"}`;
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const source = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && next === "\n") index += 1;
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  rows.push(row);
  return rows.filter((items) => items.some(Boolean));
}

function normalizeCreatorHeader(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function creatorRowsToText(rows) {
  const standardHeader = ["达人名", "平台", "粉丝数", "平均播放", "互动率", "内容类型", "历史游戏品类", "评论质量", "预估报价", "商单密度"];
  const aliases = [
    ["达人名", "达人", "名称", "账号", "博主", "up主", "kol", "koc"],
    ["平台", "渠道"],
    ["粉丝数", "粉丝", "followers"],
    ["平均播放", "均播", "播放量", "avgviews"],
    ["互动率", "互动", "engagement"],
    ["内容类型", "内容方向", "类型"],
    ["历史游戏品类", "历史品类", "游戏品类", "品类"],
    ["评论质量", "评论", "评论区质量"],
    ["预估报价", "报价", "价格", "费用"],
    ["商单密度", "商单", "商业密度"]
  ];
  const cleanRows = rows
    .map((row) => row.map((cell) => String(cell || "").trim()))
    .filter((row) => row.some(Boolean));
  if (!cleanRows.length) return "";

  const firstRow = cleanRows[0].map(normalizeCreatorHeader);
  const headerIndex = aliases.map((names, fallbackIndex) => {
    const normalizedNames = names.map(normalizeCreatorHeader);
    const index = firstRow.findIndex((cell) => normalizedNames.includes(cell));
    return index >= 0 ? index : fallbackIndex;
  });
  const hasHeader = firstRow.some((cell) => aliases.flat().map(normalizeCreatorHeader).includes(cell));
  const dataRows = hasHeader ? cleanRows.slice(1) : cleanRows;
  const mappedRows = dataRows
    .map((row) => headerIndex.map((index) => row[index] || ""))
    .filter((row) => row[0]);

  return [standardHeader, ...mappedRows].map((row) => row.join("\t")).join("\n");
}

function getZipEntryMeta(buffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;

  for (let index = data.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }

  if (eocd < 0) throw new Error("无法读取 XLSX 文件结构");

  const totalEntries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = [];

  for (let count = 0; count < totalEntries; count += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(data.slice(offset + 46, offset + 46 + fileNameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      name,
      method,
      bytes: data.slice(dataStart, dataStart + compressedSize)
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateZipEntry(entry) {
  if (entry.method === 0) return entry.bytes;
  if (entry.method !== 8) throw new Error(`不支持的 XLSX 压缩格式：${entry.method}`);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持直接解析 XLSX，请先另存为 CSV 再导入");
  }
  const stream = new Blob([entry.bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipText(entries, fileName) {
  const entry = entries.find((item) => item.name === fileName);
  if (!entry) return "";
  const bytes = await inflateZipEntry(entry);
  return new TextDecoder().decode(bytes);
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  return Array.from(doc.getElementsByTagName("si")).map((node) =>
    Array.from(node.getElementsByTagName("t")).map((item) => item.textContent || "").join("")
  );
}

function findFirstWorksheetPath(workbookXml, relsXml) {
  if (!workbookXml || !relsXml) return "xl/worksheets/sheet1.xml";
  const workbook = new DOMParser().parseFromString(workbookXml, "application/xml");
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  const relationshipId = firstSheet?.getAttribute("r:id") || firstSheet?.getAttribute("id");
  if (!relationshipId) return "xl/worksheets/sheet1.xml";

  const rels = new DOMParser().parseFromString(relsXml, "application/xml");
  const relationship = Array.from(rels.getElementsByTagName("Relationship")).find((item) => item.getAttribute("Id") === relationshipId);
  const target = relationship?.getAttribute("Target") || "worksheets/sheet1.xml";
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/[^/]+\/\.\.\//g, "/");
}

function getColumnIndex(cellRef) {
  const letters = String(cellRef || "A").match(/^[A-Z]+/i)?.[0].toUpperCase() || "A";
  return letters.split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function parseWorksheetRows(xmlText, sharedStrings) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  return Array.from(doc.getElementsByTagName("row")).map((rowNode) => {
    const row = [];
    Array.from(rowNode.getElementsByTagName("c")).forEach((cellNode) => {
      const columnIndex = getColumnIndex(cellNode.getAttribute("r"));
      const type = cellNode.getAttribute("t");
      const valueNode = cellNode.getElementsByTagName("v")[0];
      let value = valueNode?.textContent || "";
      if (type === "s") value = sharedStrings[Number(value)] || "";
      if (type === "inlineStr") value = Array.from(cellNode.getElementsByTagName("t")).map((item) => item.textContent || "").join("");
      row[columnIndex] = value;
    });
    return row.map((cell) => cell || "");
  }).filter((row) => row.some(Boolean));
}

async function parseXlsxRows(file) {
  const buffer = await file.arrayBuffer();
  const entries = getZipEntryMeta(buffer);
  const workbookXml = await readZipText(entries, "xl/workbook.xml");
  const relsXml = await readZipText(entries, "xl/_rels/workbook.xml.rels");
  const sharedStringsXml = await readZipText(entries, "xl/sharedStrings.xml");
  const worksheetPath = findFirstWorksheetPath(workbookXml, relsXml);
  const worksheetXml = await readZipText(entries, worksheetPath);
  if (!worksheetXml) throw new Error("未找到 XLSX 的第一个工作表");
  return parseWorksheetRows(worksheetXml, parseSharedStrings(sharedStringsXml));
}

async function handleCreatorFileUpload(event) {
  const file = event.target.files?.[0];
  const status = document.querySelector("#creator-status");
  if (!file) return;

  if (status) {
    status.textContent = `达人来源：正在读取 ${file.name}...`;
    status.className = "source-status";
  }

  try {
    const extension = file.name.split(".").pop().toLowerCase();
    let rows;
    if (extension === "xlsx") {
      rows = await parseXlsxRows(file);
    } else {
      const text = await file.text();
      const delimiter = text.includes("\t") ? "\t" : ",";
      rows = parseDelimitedRows(text, delimiter);
    }

    const creatorText = creatorRowsToText(rows);
    if (!creatorText) throw new Error("表格中没有识别到达人数据");
    document.querySelector("#creator-input").value = creatorText;
    analyzeCreators();
    if (status) {
      status.textContent = `达人来源：已导入 ${file.name}，识别 ${currentCreatorRows.length} 位达人。`;
      status.className = "source-status source-real";
    }
  } catch (error) {
    if (status) {
      status.textContent = `达人来源：表格导入失败，${error.message || "请检查文件格式"}`;
      status.className = "source-status source-mock";
    }
  } finally {
    event.target.value = "";
  }
}

function analyzeCreators(rowsOverride = null) {
  const input = document.querySelector("#creator-input")?.value || "";
  const goal = document.querySelector("#creator-goal")?.value || "launch";
  const activity = document.querySelector("#creator-activity")?.value || "newLaunch";
  const budget = numberValue(document.querySelector("#creator-budget")?.value);
  const parsed = rowsOverride || parseCreators(input);
  currentCreatorRows = parsed
    .map(scoreCreator)
    .sort((a, b) => scoreByGoal(b, goal, activity) - scoreByGoal(a, goal, activity));

  const available = currentCreatorRows.filter((row) => row.tier !== "风险名单");
  renderMetrics(document.querySelector("#creator-metrics"), [
    { label: "导入达人", value: currentCreatorRows.length },
    { label: "可推进", value: available.length },
    { label: "A档达人", value: currentCreatorRows.filter((row) => row.tier === "A档优先邀约").length }
  ]);
  renderCreatorTable(currentCreatorRows, goal, activity);
  renderCreatorTiers(currentCreatorRows);
  renderCreatorScenarios(currentCreatorRows);
  renderCreatorBudgetPlans(currentCreatorRows, budget);
  renderCreatorBriefs(currentCreatorRows, goal, activity);
  renderCreatorAnomalies(currentCreatorRows);
  renderCreatorRisks(currentCreatorRows);
  document.querySelector("#creator-summary").textContent = summarizeCreators(currentCreatorRows, goal, budget, activity);
  document.querySelector("#creator-score-explain").textContent = explainCreatorScore(goal, activity);
  const status = document.querySelector("#creator-status");
  if (status) {
    status.textContent = currentCreatorRows.length
      ? `达人来源：已识别 ${currentCreatorRows.length} 位达人，已按活动场景和合作目标完成排序。`
      : "达人来源：等待导入";
    status.className = `source-status ${currentCreatorRows.length ? "source-real" : "source-mock"}`;
  }
}

function loadCreatorDemo() {
  document.querySelector("#creator-input").value = creatorDemoRows;
  analyzeCreators();
}

function exportCreatorCsv() {
  analyzeCreators();
  if (!currentCreatorRows.length) return;
  const activity = document.querySelector("#creator-activity")?.value || "newLaunch";
  const goal = document.querySelector("#creator-goal")?.value || "launch";
  const rows = [["达人名", "平台", "类型", "粉丝数", "平均播放", "互动率", "内容类型", "历史游戏品类", "评论质量", "预估报价", "商单密度", "目标分", "新品曝光", "深度测评", "攻略扩散", "性价比", "综合分", "分层", "风险", "数据异常", "合作建议", "Brief建议"]];
  currentCreatorRows.forEach((row) => {
    rows.push([
      row.name,
      row.platform,
      row.type,
      row.followers,
      row.avgViews,
      `${row.engagementRate}%`,
      row.contentType,
      row.gameHistory,
      row.commentQuality,
      row.quote,
      row.commercialDensity,
      scoreByGoal(row, goal, activity),
      row.scores.launch,
      row.scores.review,
      row.scores.guide,
      row.scores.value,
      row.scores.overall,
      row.tier,
      row.risks.join(" / ") || "无",
      getCreatorAnomalies(row).join(" / ") || "无",
      getCreatorBrief(row),
      getCreatorBriefDetail(row)
    ]);
  });
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `KOL-KOC合作筛选表-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCreatorTemplate() {
  const rows = [
    ["达人名", "平台", "粉丝数", "平均播放", "互动率", "内容类型", "历史游戏品类", "评论质量", "预估报价", "商单密度"],
    ["示例攻略UP主", "B站", "18万", "4.5万", "7.2%", "攻略/测评", "开放世界/二游", "高", "12000", "低"],
    ["示例直播KOC", "抖音", "6万", "1.8万", "9%", "直播切片/整活", "竞速/动作", "中", "3500", "中"]
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "KOL-KOC导入模板.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/* ---- 总览：案例载入与完整方案导出 ---- */

const operationCases = {
  "racing-live": {
    name: "巅峰极速版本直播活动",
    content: {
      game: "巅峰极速",
      platform: "抖音",
      input: "新赛季极速狂飙上线：新限定车辆登场，排位赛开启，赛季福利和直播抽奖同步放出，主播组队挑战带动玩家回流。"
    },
    feedback: {
      game: "巅峰极速",
      range: "24h",
      comments: [
        "新车很帅，但养成材料有点缺。",
        "直播抽奖挺热闹，想看主播带水友组队。",
        "回归福利不错，就是排位入口讲得不够清楚。",
        "新赛道手感挺爽，但手机发热还是明显。",
        "主播口播福利的时候我才知道活动入口在哪。",
        "希望多做一点平民调校方案，不要全是氪金车。"
      ].join("\n")
    },
    trending: { game: "巅峰极速", platform: "B站", range: "24h", tags: ["攻略", "资讯", "整活"] },
    review: {
      mode: "livestream",
      brief: "巅峰极速新赛季直播活动：围绕新车上线、排位奖励和登录福利，邀请生态 KOC 主播与跨品类 KOL 在抖音开播，通过福利口播、组队竞速和抽奖互动提升内容曝光与直播间承接。",
      streamers: [
        { id: 1, name: "竞速 KOC 主播 A", imageUrl: "", ocrStatus: "案例数据", event: { acu: 286, pcu: 1240, impressions: 188000, entries: 21400 }, base: { acu: 210, pcu: 860, impressions: 132000, entries: 15800 } },
        { id: 2, name: "跨品类 KOL B", imageUrl: "", ocrStatus: "案例数据", event: { acu: 168, pcu: 690, impressions: 246000, entries: 18200 }, base: { acu: 152, pcu: 720, impressions: 198000, entries: 17100 } },
        { id: 3, name: "车手技巧主播 C", imageUrl: "", ocrStatus: "案例数据", event: { acu: 344, pcu: 1380, impressions: 228000, entries: 29600 }, base: { acu: 250, pcu: 940, impressions: 170000, entries: 19400 } }
      ]
    },
    version: {
      game: "巅峰极速",
      theme: "新赛季极速狂飙",
      points: "新限定车辆登场：高性能超跑加入车库\n新赛季排位开启：新增赛道与段位奖励\n新玩法副本：限时挑战赛上线\n新系统：车辆调校方案一键分享\n福利：登录领取抽奖券与养成材料",
      audience: "回流玩家",
      style: "KOL口播风"
    },
    segment: {
      game: "巅峰极速",
      tags: "回流、轻氪、竞技党",
      goal: "version",
      lifecycle: "回流3日内",
      theme: "新赛季上线，新增赛道、排位奖励、直播抽奖和登录福利。"
    },
    creator: {
      goal: "launch",
      activity: "live",
      budget: "90000",
      input: [
        "达人名,平台,粉丝数,平均播放,互动率,内容类型,历史游戏品类,评论质量,预估报价,商单密度",
        "车手小林,抖音,240000,118000,8.3,直播切片/实战技巧,赛车/体育/模拟经营,高,22000,中",
        "竞速研究所,B站,180000,82000,6.8,深度测评/攻略,赛车/竞速/开放世界,高,18000,中",
        "阿橙手游日记,抖音,520000,210000,4.2,新品资讯/短视频,二游/开放世界/动作,中,42000,中",
        "泛娱乐小鹿,抖音,1200000,420000,1.9,泛娱乐挑战/热点,休闲/派对/社交,中,110000,高"
      ].join("\n")
    }
  },
  "wuwa-community": {
    name: "鸣潮版本社区评论分析",
    content: {
      game: "鸣潮",
      platform: "B站",
      input: "版本前瞻直播爆料：限定共鸣者登场，新地图开放，福利兑换码汇总，回归奖励提升，同时玩家讨论声骸系统肝度。"
    },
    feedback: {
      game: "鸣潮",
      range: "24h",
      comments: [
        "新角色建模真的好看，但抽卡压力还是有点大。",
        "这次剧情不错，角色关系终于有看点了。",
        "声骸还是太肝了，希望能继续减负。",
        "兑换码和回归福利可以，至少这次有诚意。",
        "手机发热和掉帧还是影响体验。",
        "新地图探索挺舒服，但引导能不能再清楚一点。"
      ].join("\n")
    },
    trending: { game: "鸣潮", platform: "B站", range: "24h", tags: ["攻略", "资讯", "争议", "二创"] },
    review: {
      mode: "campaign",
      impressions: "520000",
      clicks: "48600",
      participants: "18200",
      payers: "1320",
      description: "版本前瞻社区活动：预约直播、转发抽周边、评论区征集角色问题并发放兑换码。玩家对福利和角色内容反馈较好，但对声骸减负和移动端性能仍有集中讨论。"
    },
    version: {
      game: "鸣潮",
      theme: "共鸣者新章",
      points: "新限定共鸣者登场：角色剧情同步开放\n新地图区域开放：新增探索收集与隐藏任务\n新系统优化：声骸筛选与养成体验减负\n新活动：前瞻直播兑换码和回归任务\n新皮肤：角色主题外观限时上架",
      audience: "核心玩家",
      style: "社区口语风"
    },
    segment: {
      game: "鸣潮",
      tags: "核心玩家、剧情党、轻氪",
      goal: "reputation",
      lifecycle: "30日活跃",
      theme: "新共鸣者剧情、新地图探索、声骸减负和前瞻福利。"
    },
    creator: {
      goal: "review",
      activity: "reputation",
      budget: "70000",
      input: creatorDemoRows
    }
  },
  "launch-creators": {
    name: "新游首曝达人筛选方案",
    content: {
      game: "星海边境",
      platform: "小红书",
      input: "新游首曝：开放世界探索、角色收集、基地建造和多人协作玩法首次曝光，需要寻找达人做预约种草和首测内容解释。"
    },
    feedback: {
      game: "星海边境",
      range: "3d",
      comments: [
        "画风挺有辨识度，想看看实机是不是也这样。",
        "开放世界又加基地建造，有点期待但怕太肝。",
        "角色设计不错，希望抽卡别太重。",
        "多人协作如果做得好应该挺适合直播。",
        "首测资格在哪里预约？官方能不能讲清楚。",
        "希望别只是概念 PV，想看真实玩法。"
      ].join("\n")
    },
    trending: { game: "星海边境", platform: "小红书", range: "3d", tags: ["资讯", "攻略", "二创"] },
    review: {
      mode: "campaign",
      impressions: "310000",
      clicks: "24600",
      participants: "8200",
      payers: "0",
      description: "新游首曝预约活动：通过概念 PV、世界观海报、预约抽资格和达人种草内容积累首批核心用户。当前重点不是付费转化，而是首曝声量、预约转化和评论区兴趣点验证。"
    },
    version: {
      game: "星海边境",
      theme: "首测预约开启",
      points: "新角色阵营公开：首批角色设定曝光\n新玩法副本：星球探索与基地建造首次展示\n新系统：多人协作任务和资源采集\n福利：预约抽首测资格与限定头像框\n新PV：世界观概念片发布",
      audience: "新手玩家",
      style: "福利导向"
    },
    segment: {
      game: "星海边境",
      tags: "新手、剧情党、轻氪",
      goal: "activation",
      lifecycle: "首日新手",
      theme: "首测预约、世界观 PV、角色阵营公开和预约福利。"
    },
    creator: {
      goal: "launch",
      activity: "newLaunch",
      budget: "120000",
      input: [
        "达人名,平台,粉丝数,平均播放,互动率,内容类型,历史游戏品类,评论质量,预估报价,商单密度",
        "阿橙手游日记,抖音,520000,210000,4.2,新品资讯/短视频,二游/开放世界/动作,中,42000,中",
        "小白试玩间,小红书,95000,26000,7.1,新手体验/图文种草,休闲/女性向/派对,高,7000,低",
        "爆肝测评君,B站,310000,96000,3.1,深度测评/吐槽,MMO/开放世界/射击,中,35000,高",
        "攻略课代表,B站,130000,69000,10.5,攻略合集/角色培养,二游/动作/策略,高,12000,低",
        "硬核拆包社,B站,56000,33000,12.4,机制拆解/数据测试,动作/硬核/独立游戏,高,8000,低"
      ].join("\n")
    }
  }
};

function setFieldValue(selector, value) {
  const element = document.querySelector(selector);
  if (element && value !== undefined) element.value = value;
}

function setSelectValue(selector, value) {
  const element = document.querySelector(selector);
  if (!element || value === undefined) return;
  element.value = value;
}

function setReviewMode(mode) {
  reviewMode = mode === "livestream" ? "livestream" : "campaign";
  document.querySelectorAll(".segment-button").forEach((item) => item.classList.toggle("active", item.dataset.reviewMode === reviewMode));
  document.querySelectorAll(".review-fields").forEach((item) => item.classList.remove("active"));
  document.querySelector(`#${reviewMode === "campaign" ? "campaign" : "livestream"}-fields`)?.classList.add("active");
}

function setTrendingTags(tags) {
  const wanted = new Set(tags || []);
  document.querySelectorAll("#trending-tags input").forEach((input) => {
    input.checked = wanted.size ? wanted.has(input.value) : true;
  });
}

async function loadOperationCase(caseId) {
  const item = operationCases[caseId];
  if (!item) return;
  const status = document.querySelector("#overview-status");

  setFieldValue("#game-name", item.content.game);
  setSelectValue("#platform", item.content.platform);
  setFieldValue("#content-input", item.content.input);

  setFieldValue("#feedback-game", item.feedback.game);
  setSelectValue("#feedback-range", item.feedback.range);
  setFieldValue("#feedback-input", item.feedback.comments);
  setFieldValue("#bili-comment-url", "");

  setFieldValue("#trending-game", item.trending.game);
  setSelectValue("#trending-platform", item.trending.platform);
  setSelectValue("#trending-range", item.trending.range);
  setTrendingTags(item.trending.tags);

  setReviewMode(item.review.mode);
  if (item.review.mode === "livestream") {
    setFieldValue("#stream-brief", item.review.brief);
    streamers = item.review.streamers.map((streamer) => ({ ...streamer, event: { ...streamer.event }, base: { ...streamer.base } }));
    renderStreamerList();
  } else {
    setFieldValue("#impressions", item.review.impressions);
    setFieldValue("#clicks", item.review.clicks);
    setFieldValue("#participants", item.review.participants);
    setFieldValue("#payers", item.review.payers);
    setFieldValue("#review-input", item.review.description);
  }

  setFieldValue("#version-game", item.version.game);
  setFieldValue("#version-theme", item.version.theme);
  setFieldValue("#version-points", item.version.points);
  setSelectValue("#version-audience", item.version.audience);
  setSelectValue("#version-style", item.version.style);

  setFieldValue("#segment-game", item.segment.game);
  setFieldValue("#segment-tags", item.segment.tags);
  setSelectValue("#segment-goal", item.segment.goal);
  setSelectValue("#segment-lifecycle", item.segment.lifecycle);
  setFieldValue("#segment-theme", item.segment.theme);

  setSelectValue("#creator-goal", item.creator.goal);
  setSelectValue("#creator-activity", item.creator.activity);
  setFieldValue("#creator-budget", item.creator.budget);
  setFieldValue("#creator-input", item.creator.input);

  analyzeContent();
  analyzeFeedback();
  analyzeReview();
  generateVersionPackage();
  generateSegmentPlan();
  analyzeCreators();
  await analyzeTrending();

  if (status) {
    status.textContent = `总览状态：已载入「${item.name}」，可以按左侧模块顺序演示，也可以直接导出完整运营方案。`;
    status.className = "source-status source-real";
  }
}

async function loadDemoRoute(routeId) {
  const route = demoRoutes[routeId];
  if (!route) return;
  await loadOperationCase(route.caseId);
  navigateToView(route.view);
  const status = document.querySelector("#overview-status");
  if (status) {
    status.textContent = `总览状态：已进入「${route.label}」。${route.note}`;
    status.className = "source-status source-real";
  }
}

function collectProjectState() {
  const controls = {};
  document.querySelectorAll("input[id], textarea[id], select[id]").forEach((element) => {
    if (element.type === "file") return;
    controls[element.id] = element.type === "checkbox" ? element.checked : element.value;
  });

  return {
    savedAt: new Date().toISOString(),
    controls,
    reviewMode,
    streamers: streamers.map((streamer) => ({
      ...streamer,
      imageUrl: streamer.imageUrl?.startsWith("blob:") ? "" : streamer.imageUrl,
      event: { ...streamer.event },
      base: { ...streamer.base }
    })),
    currentTrendingTopics,
    selectedTrendingIndex
  };
}

function restoreProjectState(state) {
  if (!state?.controls) throw new Error("没有可恢复的项目数据");

  Object.entries(state.controls).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element || element.type === "file") return;
    if (element.type === "checkbox") {
      element.checked = Boolean(value);
    } else {
      element.value = value;
    }
  });

  setReviewMode(state.reviewMode || "campaign");
  streamers = Array.isArray(state.streamers) && state.streamers.length
    ? state.streamers.map((streamer) => ({
      ...streamer,
      event: { ...streamer.event },
      base: { ...streamer.base }
    }))
    : streamers;
  streamerIdCounter = streamers.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  renderStreamerList();

  currentTrendingTopics = Array.isArray(state.currentTrendingTopics) ? state.currentTrendingTopics : [];
  selectedTrendingIndex = Number(state.selectedTrendingIndex) || 0;
  if (currentTrendingTopics.length) {
    renderTrendingList(
      document.querySelector("#trending-game")?.value.trim() || "鸣潮",
      document.querySelector("#trending-platform")?.value || "B站",
      {
        source: currentTrendingTopics.some((item) => item.source === "real") ? "real" : "mock",
        sourceLabel: "已载入上次保存榜单",
        note: "本地保存结果",
        reason: "本地保存结果",
        items: currentTrendingTopics
      }
    );
  }

  analyzeContent();
  analyzeFeedback();
  analyzeReview();
  generateVersionPackage();
  generateSegmentPlan();
  analyzeCreators();
}

function saveProjectState() {
  const status = document.querySelector("#overview-status");
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(collectProjectState()));
  if (status) {
    status.textContent = "总览状态：当前项目已保存到本机浏览器，下次演示可直接载入。";
    status.className = "source-status source-real";
  }
}

function loadProjectState() {
  const status = document.querySelector("#overview-status");
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) throw new Error("还没有保存过项目");
    restoreProjectState(JSON.parse(raw));
    if (status) {
      status.textContent = "总览状态：已载入上次保存的项目内容。";
      status.className = "source-status source-real";
    }
  } catch (error) {
    if (status) {
      status.textContent = `总览状态：载入失败，${error.message || "保存数据不可用"}`;
      status.className = "source-status source-mock";
    }
  }
}

function navigateToView(viewName) {
  if (!views[viewName]?.element) return;
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
  views[viewName].element.classList.add("active");
  document.querySelector("#view-title").textContent = views[viewName].title;
  updateChainBar(viewName);
}

function collectListText(selector) {
  return Array.from(document.querySelectorAll(`${selector} li`)).map((item) => `- ${item.textContent}`).join("\n");
}

function collectPillText(selector) {
  return Array.from(document.querySelectorAll(`${selector} span`)).map((item) => `- ${item.textContent}`).join("\n");
}

function collectCardsText(selector) {
  return Array.from(document.querySelectorAll(`${selector} .copy-card`))
    .map((card) => `${card.querySelector("strong")?.textContent || "项目"}：${card.querySelector("p")?.textContent || ""}`)
    .join("\n");
}

function collectRiskEventsText() {
  return Array.from(document.querySelectorAll("#feedback-risk-events .risk-event"))
    .map((card) => {
      const title = card.querySelector(".risk-event-head strong")?.textContent || "风险事件";
      const severity = card.querySelector(".risk-event-head span")?.textContent || "";
      const meta = card.querySelector("p")?.textContent || "";
      const sample = card.querySelector("blockquote")?.textContent || "";
      const response = card.querySelector("small")?.textContent || "";
      return [`- ${title}（${severity}）`, meta ? `  证据：${meta}` : "", sample ? `  代表评论：${sample}` : "", response ? `  建议：${response}` : ""].filter(Boolean).join("\n");
    })
    .join("\n");
}

function collectDiagnosticText() {
  const diagnostics = [
    ["热点抓取诊断", document.querySelector("#trending-fetch-diagnostic")],
    ["评论抓取诊断", document.querySelector("#feedback-fetch-diagnostic")],
    ["总览状态", document.querySelector("#overview-status")]
  ];

  return diagnostics
    .map(([label, element]) => {
      if (!element) return "";
      const text = element.textContent.replace(/\s+/g, " ").trim();
      return text ? `- ${label}：${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildFullOperationReportText() {
  analyzeContent();
  analyzeFeedback();
  analyzeReview();
  generateVersionPackage();
  generateSegmentPlan();
  const hasBackfillRows = currentCreatorRows.some((row) => row.dataSource === "backfill");
  analyzeCreators(hasBackfillRows ? currentCreatorRows : null);

  const game = document.querySelector("#version-game")?.value.trim() || document.querySelector("#trending-game")?.value.trim() || "目标游戏";
  const sourceTexts = ["#trending-source-status", "#feedback-source-status", "#creator-status"]
    .map((selector) => document.querySelector(selector)?.textContent || "")
    .filter(Boolean);
  const sampleSources = sourceTexts.filter((text) => /样例|兜底|演示/.test(text));
  if (currentTrendingTopics.some((topic) => topic.source !== "real")) sampleSources.unshift("热点榜单：当前结果含样例兜底");
  const dataQuality = sampleSources.length
    ? `⚠️ 数据状态：本报告包含样例/兜底数据：${sampleSources.join("；")}，不代表真实平台表现。`
    : "数据状态：当前已生成模块未检测到样例兜底标记，请结合原始来源复核。";
  const date = new Date().toISOString().slice(0, 10);
  const topTopics = currentTrendingTopics.slice(0, 5).map((topic) => `- TOP${topic.rank} ${topic.title}（${topic.tag} / ${topic.risk?.level || "正常"}）`).join("\n");
  const creatorTop = currentCreatorRows.slice(0, 5).map((row) => `- ${row.name}：目标分 ${targetScore(row, document.querySelector("#creator-goal")?.value || "launch", document.querySelector("#creator-activity")?.value || "newLaunch")}，${row.tier}，${getCreatorFit(row)}`).join("\n");

  return [
    `# ${game} 游戏内容运营方案`,
    `生成日期：${date}`,
    dataQuality,
    "",
    "## 1. 项目定位",
    "",
    "围绕平台热点、竞品内容、玩家反馈、版本包装、分层运营、达人合作和活动复盘形成完整运营闭环。",
    "",
    "## 2. 今日热点结论",
    document.querySelector("#trending-source-status")?.textContent || "",
    document.querySelector("#trending-method")?.textContent || "",
    "抓取/演示诊断：",
    collectDiagnosticText() || "- 暂无诊断信息。",
    document.querySelector("#trending-insight")?.textContent || "",
    topTopics || "- 暂无热点榜单，请先进入热点追踪模块生成结果。",
    "",
    "## 3. 竞品内容拆解",
    "内容类型判断：",
    collectCardsText("#content-type-list"),
    `标题结构：${document.querySelector("#title-pattern")?.textContent || ""}`,
    "标题结构拆解：",
    collectCardsText("#title-breakdown"),
    "玩家情绪点：",
    collectPillText("#content-emotion-points"),
    "可复用选题：",
    collectListText("#topic-list"),
    "可借鉴 / 不可照搬：",
    collectCardsText("#content-learn-risk"),
    "改写方向：",
    collectPillText("#rewrite-list"),
    "",
    "## 4. 玩家评论与舆情洞察",
    document.querySelector("#feedback-source-status")?.textContent || "",
    document.querySelector("#feedback-risk-summary")?.textContent || "",
    document.querySelector("#emotion-summary")?.textContent || "",
    "风险事件：",
    collectRiskEventsText() || "- 暂无风险事件，请先进入玩家评论分析模块生成结果。",
    "高频关键词：",
    collectPillText("#feedback-keywords"),
    "视频来源拆解：",
    collectCardsText("#feedback-source-groups"),
    "运营动作建议：",
    collectListText("#action-list"),
    "",
    "## 5. 版本内容包装",
    buildVersionPackageText(),
    "",
    "## 6. 玩家分层运营策略",
    buildSegmentPlanText(),
    "",
    "## 7. KOL/KOC 合作建议",
    document.querySelector("#creator-score-explain")?.textContent || "",
    document.querySelector("#creator-summary")?.textContent || "",
    "达人优先级：",
    creatorTop || "- 暂无达人数据。",
    "预算组合：",
    collectCardsText("#creator-budget-plan"),
    "达人 Brief：",
    collectCardsText("#creator-brief-list"),
    "风险提示：",
    collectListText("#creator-risk-list"),
    "",
    "## 8. 活动复盘与下一轮动作",
    document.querySelector("#review-report")?.textContent || "",
    "下一轮优化：",
    collectListText("#next-list")
  ].join("\n");
}

async function exportFullOperationReport() {
  const status = document.querySelector("#overview-status");
  if (status) {
    status.textContent = "总览状态：正在打包完整方案...";
    status.className = "source-status";
  }

  if (!currentTrendingTopics.length) {
    const game = document.querySelector("#trending-game")?.value.trim() || "鸣潮";
    const platform = document.querySelector("#trending-platform")?.value || "B站";
    renderTrendingList(game, platform, {
      source: "mock",
      reason: "导出时未等待热点服务刷新，已使用当前本地榜单"
    });
  }

  const text = buildFullOperationReportText();
  const game = document.querySelector("#version-game")?.value.trim() || "目标游戏";
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${game}-完整运营方案-${date}.md`;
  link.click();
  URL.revokeObjectURL(url);

  if (status) {
    status.textContent = "总览状态：已导出完整运营方案。";
    status.className = "source-status source-real";
  }
}

/* ---- 事件绑定 ---- */

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    navigateToView(button.dataset.view);
  });
});

document.querySelectorAll(".segment-button").forEach((button) => {
  button.addEventListener("click", () => {
    setReviewMode(button.dataset.reviewMode);
    analyzeReview();
  });
});

document.querySelectorAll("[data-load-case]").forEach((button) => {
  button.addEventListener("click", () => {
    loadOperationCase(button.dataset.loadCase);
  });
});

document.querySelectorAll("[data-load-route]").forEach((button) => {
  button.addEventListener("click", () => {
    loadDemoRoute(button.dataset.loadRoute);
  });
});

document.querySelector("#export-full-report")?.addEventListener("click", exportFullOperationReport);
document.querySelector("#save-project-state")?.addEventListener("click", saveProjectState);
document.querySelector("#load-project-state")?.addEventListener("click", loadProjectState);
document.querySelector("#run-demo-check")?.addEventListener("click", runDemoReadinessCheck);

document.querySelector("#streamer-list")?.addEventListener("input", (event) => {
  const card = event.target.closest(".streamer-card");
  if (!card) return;

  const id = Number(card.dataset.streamerId);
  const path = event.target.dataset.field || event.target.dataset.path;
  updateStreamer(id, path, event.target.value);
  const streamer = streamers.find((item) => item.id === id);
  if (streamer && event.target.dataset.path) {
    streamer.ocrStatus = streamer.ocrStatus || "手动校正";
    updateStreamerOcrHint(streamer);
  }
  analyzeReview();
});

document.querySelector("#streamer-list")?.addEventListener("click", (event) => {
  const removeId = event.target.dataset.removeStreamer;
  if (!removeId) return;

  streamers = streamers.filter((item) => item.id !== Number(removeId));
  renderStreamerList();
  analyzeReview();
});

document.querySelector("#add-streamer")?.addEventListener("click", addEmptyStreamer);
document.querySelector("#load-demo-streamers")?.addEventListener("click", loadDemoStreamers);
document.querySelector("#streamer-file")?.addEventListener("change", handleStreamerFileUpload);
document.querySelector("#download-streamer-template")?.addEventListener("click", downloadStreamerTemplate);

function handleScreenshotFiles(files) {
  const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  const newStreamers = imageFiles.map(createStreamerFromFile);
  streamers = streamers.concat(newStreamers);
  renderStreamerList();
  analyzeReview();
  newStreamers.forEach((streamer, index) => {
    tryRecognizeScreenshot(streamer.id, imageFiles[index]);
  });
}

function updateStreamerImportStatus(message, className = "source-status") {
  const status = document.querySelector("#streamer-import-status");
  if (!status) return;
  status.textContent = message;
  status.className = className;
}

async function handleStreamerFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  updateStreamerImportStatus(`主播数据来源：正在读取 ${file.name}...`, "source-status");

  try {
    const extension = file.name.split(".").pop().toLowerCase();
    let rows;
    if (extension === "xlsx") {
      rows = await parseXlsxRows(file);
    } else {
      const text = await file.text();
      const delimiter = text.includes("\t") ? "\t" : ",";
      rows = parseDelimitedRows(text, delimiter);
    }

    const imported = streamerRowsToData(rows);
    if (!imported.length) {
      throw new Error("未识别到可用主播数据，请检查表头和数值字段");
    }

    const normalized = imported.map((row, index) => ({
      id: ++streamerIdCounter,
      name: row.name || `主播 ${String.fromCharCode(65 + index)}`,
      imageUrl: "",
      ocrStatus: "表格导入",
      ocrHint: "已从表格导入数据，可继续拖入截图做补充校正。",
      event: row.event,
      base: row.base
    }));

    streamers = normalized;
    renderStreamerList();
    analyzeReview();
    updateStreamerImportStatus(`主播数据来源：已导入 ${file.name}，识别 ${normalized.length} 位主播。`, "source-status source-real");
    const reviewStatus = document.querySelector("#review-data-warning");
    if (reviewStatus) {
      reviewStatus.textContent = `数据检查：已导入主播表格 ${normalized.length} 位，可直接生成复盘。`;
      reviewStatus.className = "source-status source-real";
    }
  } catch (error) {
    updateStreamerImportStatus(`主播数据来源：导入失败，${error.message || "请检查文件格式"}`, "source-status source-mock");
  } finally {
    event.target.value = "";
  }
}

function downloadStreamerTemplate() {
  const rows = [
    ["主播名", "活动ACU", "活动PCU", "活动曝光", "活动进房", "基准ACU", "基准PCU", "基准曝光", "基准进房"],
    ["示例主播 A", "286", "1240", "188000", "21400", "210", "860", "132000", "15800"],
    ["示例主播 B", "168", "690", "246000", "18200", "152", "720", "198000", "17100"]
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "主播活动数据模板.csv";
  link.click();
  URL.revokeObjectURL(url);
  updateStreamerImportStatus("主播数据来源：模板已下载，可按字段要求填充后再导入。", "source-status source-real");
}

document.querySelector("#stream-screenshots")?.addEventListener("change", (event) => {
  handleScreenshotFiles(event.target.files);
  event.target.value = "";
});

const dropZone = document.querySelector("#stream-drop-zone");
const screenshotInput = document.querySelector("#stream-screenshots");
dropZone?.addEventListener("click", (event) => {
  if (event.target !== screenshotInput) screenshotInput?.click();
});
dropZone?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    screenshotInput?.click();
  }
});
dropZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone?.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone?.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  handleScreenshotFiles(event.dataTransfer.files);
});

document.querySelector("#content-form").addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeContent();
});

document.querySelector("#feedback-form").addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeFeedback();
});

document.querySelector("#fetch-bili-comments")?.addEventListener("click", fetchBiliComments);
document.querySelector("#fetch-hot-video-comments")?.addEventListener("click", fetchHotVideoComments);
document.querySelector("#check-comment-services")?.addEventListener("click", checkCommentServices);
document.querySelector("#export-feedback")?.addEventListener("click", exportFeedbackAnalysis);

document.querySelector("#review-form").addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeReview();
});
document.querySelector("#review-policy")?.addEventListener("change", () => {
  renderStreamerList();
  analyzeReview();
});

document.querySelector("#trending-form").addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeTrending();
});

document.querySelector("#version-form").addEventListener("submit", (event) => {
  event.preventDefault();
  generateVersionPackage();
});

document.querySelector("#segment-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  generateSegmentPlan();
});

document.querySelector("#copy-segment-plan")?.addEventListener("click", copySegmentPlan);
document.querySelector("#export-segment-plan")?.addEventListener("click", exportSegmentPlan);

document.querySelector("#creator-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  analyzeCreators();
});

document.querySelector("#creator-goal")?.addEventListener("change", analyzeCreators);
document.querySelector("#creator-activity")?.addEventListener("change", analyzeCreators);
document.querySelector("#creator-file")?.addEventListener("change", handleCreatorFileUpload);
document.querySelector("#load-creator-demo")?.addEventListener("click", loadCreatorDemo);
document.querySelector("#download-creator-template")?.addEventListener("click", downloadCreatorTemplate);
document.querySelector("#export-creator-csv")?.addEventListener("click", exportCreatorCsv);

document.querySelector("#copy-version-package")?.addEventListener("click", copyVersionPackage);
document.querySelector("#export-version-package")?.addEventListener("click", exportVersionPackage);

document.querySelector("#recalc-creator-backfill")?.addEventListener("click", recalcWithBackfill);
document.querySelector("#refresh-trending")?.addEventListener("click", () => {
  analyzeTrending();
});

document.querySelector("#export-trending")?.addEventListener("click", exportTrendingCsv);



document.querySelector("#refresh-service-status")?.addEventListener("click", refreshOverviewServiceStatus);
document.querySelectorAll("[data-service-mode]")?.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = setServiceMode(button.dataset.serviceMode);
    serviceModeGuard.next();
    renderServiceModeControls();
    checkLauncherStatus();
    checkOcrHealth();
    refreshOverviewServiceStatus();
    const status = document.querySelector("#overview-status");
    if (status) {
      status.textContent = mode === "online"
        ? "总览状态：已切换线上模式，将请求 /api/ocr、/api/hotspot、/api/comment。"
        : "总览状态：已切换本地模式，将请求 127.0.0.1 本机服务。";
      status.className = "source-status source-real";
    }
  });
});
document.querySelector("#demo-mode-toggle")?.addEventListener("change", () => {
  const status = document.querySelector("#overview-status");
  if (status) {
    status.textContent = isDemoMode()
      ? "总览状态：样例兜底已开启，热点和评论会先请求真实数据，失败后再使用本地样例。"
      : "总览状态：样例兜底已关闭，真实抓取失败时会直接展示错误原因。";
    status.className = `source-status ${isDemoMode() ? "source-real" : ""}`;
  }
  analyzeTrending();
});

document.querySelector("#trending-detail")?.addEventListener("click", (event) => {
  if (event.target.closest("#copy-topic-plan")) {
    copySelectedTopicPlan();
  }
});

document.querySelector("#trending-list")?.addEventListener("click", (event) => {
  const item = event.target.closest(".trending-item");
  if (!item) return;

  selectedTrendingIndex = Number(item.dataset.trendingIndex || 0);
  document.querySelectorAll(".trending-item").forEach((node) => node.classList.remove("active"));
  item.classList.add("active");
  const game = document.querySelector("#trending-game").value.trim() || "鸣潮";
  const platform = document.querySelector("#trending-platform").value || "B站";
  renderTrendingDetail(game, platform, currentTrendingTopics[selectedTrendingIndex]);
});



/* ========================================
   优化批次 2026-06-17：效果看板 / 口径
   说明 / 确认状态 / 等级 / 回填
   ======================================== */

/* ---- 结论看板 ---- */

const PROJECT_SLOTS_KEY = "gameops-project-slots-v2";

function readProjectSlotStorage() {
  let storage = null;
  try {
    storage = window.localStorage;
  } catch (_error) {
    return [];
  }
  return sanitizeProjectSlots(readStorageArray(storage, PROJECT_SLOTS_KEY));
}

function renderOverviewConclusion() {
  const container = document.querySelector("#conclusion-items");
  if (!container) return;

  const conclusions = [];

  // Trending
  const trendingStatus = document.querySelector("#trending-source-status")?.textContent || "";
  const trendingInsight = document.querySelector("#trending-insight")?.textContent || "";
  if (trendingInsight && !trendingInsight.includes("暂无")) {
    conclusions.push({ label: "热点方向", text: trendingInsight.slice(0, 120) + (trendingInsight.length > 120 ? "…" : ""), source: trendingStatus });
  }

  // Feedback
  const riskSummary = document.querySelector("#feedback-risk-summary")?.textContent || "";
  const emotionSummary = document.querySelector("#emotion-summary")?.textContent || "";
  const feedbackSource = document.querySelector("#feedback-source-status")?.textContent || "";
  if (riskSummary && !riskSummary.includes("暂无")) {
    conclusions.push({ label: "舆情风险", text: riskSummary.slice(0, 160), source: feedbackSource });
  }
  if (emotionSummary) {
    conclusions.push({ label: "玩家情绪", text: emotionSummary.slice(0, 100), source: "" });
  }

  // Version
  const versionAnnouncement = document.querySelector("#version-announcement")?.textContent || "";
  if (versionAnnouncement) {
    const theme = document.querySelector("#version-theme")?.value || "";
    conclusions.push({ label: "版本卖点", text: theme ? theme.slice(0, 80) : "已生成版本包装内容", source: "" });
  }

  // Creator
  const creatorSummary = document.querySelector("#creator-summary")?.textContent || "";
  if (creatorSummary && !creatorSummary.includes("暂无")) {
    conclusions.push({ label: "达人推荐", text: creatorSummary.slice(0, 180), source: "" });
  }

  // Review
  const reviewReport = document.querySelector("#review-report")?.textContent || "";
  if (reviewReport && !reviewReport.includes("等待")) {
    conclusions.push({ label: "活动复盘", text: reviewReport.slice(0, 120), source: "" });
  }

  if (!conclusions.length) {
    container.innerHTML = '<div class="conclusion-item muted">当前尚无各模块分析结果。建议按运营链路顺序操作后刷新。</div>';
    return;
  }

  container.innerHTML = conclusions.map((c) =>
    c.source
      ? '<div class="conclusion-item"><strong>' + escapeHtml(c.label) + '：</strong>' + escapeHtml(c.text) + '<br><small class="conclusion-source">' + escapeHtml(c.source) + '</small></div>'
      : '<div class="conclusion-item"><strong>' + escapeHtml(c.label) + '：</strong>' + escapeHtml(c.text) + '</div>'
  ).join("");
}

/* ---- 口径说明 ---- */

function openCaliberPanel() {
  const activeView = document.querySelector(".view.active");
  const caliber = activeView?.dataset?.caliber || "";
  const label = activeView?.dataset?.screenLabel || "当前模块";
  const body = document.querySelector("#caliber-body");
  const panel = document.querySelector("#caliber-panel");
  const overlay = document.querySelector("#caliber-overlay");

  if (body) {
    body.innerHTML = caliber
      ? "<strong>" + escapeHtml(label) + "</strong><br><br>" + caliber.replace(/\n/g, "<br>")
      : "当前模块暂无专门口径说明。通用说明：<br><br>所有模块的数据来源和处理逻辑均标注在对应界面中。AI 生成内容为初稿辅助，最终判断请以人工审核为准。";
  }
  if (panel) panel.classList.add("open");
  if (overlay) overlay.classList.add("open");
}

function closeCaliberPanel() {
  const panel = document.querySelector("#caliber-panel");
  const overlay = document.querySelector("#caliber-overlay");
  if (panel) panel.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
}

/* ---- 确认状态 ---- */

function setupConfirmButtons() {
  document.querySelectorAll(".confirm-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const states = ["pending", "confirmed", "needs-adjust"];
      const current = btn.dataset.state || "pending";
      const nextIndex = (states.indexOf(current) + 1) % states.length;
      const next = states[nextIndex];
      btn.dataset.state = next;
      const labels = { pending: "待确认", confirmed: "已确认", "needs-adjust": "需调整" };
      btn.textContent = labels[next] || "待确认";
    });
  });
}

/* ---- 多项目槽位 ---- */

function saveProjectToSlot(slotIndex) {
  const data = collectProjectState();
  const stateList = readProjectSlotStorage();
  stateList[slotIndex - 1] = data;
  try {
    window.localStorage.setItem(PROJECT_SLOTS_KEY, JSON.stringify(stateList));
  } catch (_error) {
    const status = document.querySelector("#overview-status");
    if (status) {
      status.textContent = "总览状态：保存失败，本机存储暂不可用。";
      status.className = "source-status source-mock";
    }
    return;
  }
  updateSlotName(slotIndex, data.controls?.["trending-game"] || "已保存");
  document.querySelector(`.project-slot[data-slot="${slotIndex}"]`)?.classList.add("has-data");
  const status = document.querySelector("#overview-status");
  if (status) {
    status.textContent = "总览状态：已保存到槽位 " + slotIndex + "。";
    status.className = "source-status source-real";
  }
}

function loadProjectFromSlot(slotIndex) {
  const stateList = readProjectSlotStorage();
  const data = stateList[slotIndex - 1];
  if (!data || typeof data !== "object" || !data.controls || typeof data.controls !== "object") {
    const status = document.querySelector("#overview-status");
    if (status) {
      status.textContent = "总览状态：槽位 " + slotIndex + " 为空，请先保存项目。";
      status.className = "source-status source-mock";
    }
    return;
  }
  try {
    restoreProjectState(data);
  } catch (error) {
    const status = document.querySelector("#overview-status");
    if (status) {
      status.textContent = `总览状态：槽位 ${slotIndex} 数据损坏，${error.message || "无法载入"}。`;
      status.className = "source-status source-mock";
    }
    return;
  }
  const status = document.querySelector("#overview-status");
  if (status) {
    const name = data.controls?.["trending-game"] || "已保存项目";
    status.textContent = "总览状态：已从槽位 " + slotIndex + " 载入「" + name + "」。";
    status.className = "source-status source-real";
  }
}

function updateSlotName(slotIndex, name) {
  const el = document.querySelector("#slot-name-" + slotIndex);
  if (el) el.textContent = name || "槽位 " + slotIndex;
}

function refreshSlotNames() {
  const stateList = readProjectSlotStorage();
  document.querySelectorAll(".project-slot").forEach((slot) => {
    const idx = Number(slot.dataset.slot);
    const data = stateList[idx - 1];
    const el = document.querySelector("#slot-name-" + idx);
    slot.classList.toggle("has-data", Boolean(data && typeof data === "object"));
    if (el) {
      el.textContent = data
        ? data.controls?.["trending-game"] || data.controls?.["version-game"] || ("槽位 " + idx)
        : "空";
    }
  });
}

/* ---- 平台差异化策略 ---- */

function renderPlatformStrategy(platform) {
  const container = document.querySelector("#trending-platform-strategy");
  if (!container) return;

  const strategies = {
    "B站": "适合策略：长视频拆解攻略、深度测评和合集沉淀。推荐发布 3-8 分钟攻略视频，标题保留高流量关键词，封面突出结果或冲突点。视频评论区适合做 FAQ 沉淀。",
    "抖音": "适合策略：短视频爆点和福利口播。优先做 15-60 秒高密度内容，用钩子标题抓前 3 秒注意力。直播切片和赛事高光适合二次传播。",
    "小红书": "适合策略：图文种草和避雷总结。封面图和标题文字信息密度决定点击率，评论区互动容易形成高粘性讨论。适合做福利搬运和安利合集。",
    "TapTap": "适合策略：玩家评价维护和官方动态同步。适合发布版本更新解读、FAQ 答疑和社区活动帖，不适合做纯曝光导向内容。",
    "微博": "适合策略：节点话题造势和福利抽奖。配合热搜话题做短平快内容，转发抽奖和 UGC 征集效果显著。长内容需要通过图文长微博或视频发布。"
  };

  const strategyText = strategies[platform] || "暂未收录该平台策略建议。通用策略：优先做短内容测试，再根据平台特点延展成长内容。";
  container.innerHTML = `<p class="source-status source-real platform-strategy-copy">${escapeHtml(strategyText)}</p>`;
}

/* ---- 趋势对比 ---- */

function renderFeedbackTrendCompare() {
  const container = document.querySelector("#feedback-trend-compare");
  if (!container || !currentFeedbackRows.length) return;

  const sentimentCounts = { 正向: 0, 中性: 0, 负向: 0 };
  currentFeedbackRows.forEach((row) => { sentimentCounts[row.sentiment] += 1; });
  const total = Math.max(currentFeedbackRows.length, 1);
  const negativeRate = Math.round((sentimentCounts["负向"] / total) * 100);
  const topWords = currentFeedbackRows
    ?.filter((row) => row.categories?.length)
    ?.reduce((acc, row) => { row.categories.forEach((c) => { acc[c] = (acc[c] || 0) + 1; }); return acc; }, {});

  const topLabel = Object.entries(topWords || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "暂无集中分布";
  const highRisk = currentFeedbackRows.filter((row) => row.risk === "高风险").length;

  container.innerHTML =
    '<p class="trend-compare-copy">' +
    "本次分析：有效评论 " + total + " 条，负向占比 " + negativeRate + "%，高风险 " + highRisk + " 条。" +
    "主要分布在 \"" + topLabel + "\"。" +
    "趋势对比：当前为单次分析，尚无历史基线。后续导入多轮评论数据后，将自动对比负面率变化和高频词演变。" +
    "</p>";
}

/* ---- 活动结论等级 ---- */

function renderReviewGrade() {
  const container = document.querySelector("#review-conclusion-grade");
  if (!container) return;

  const reviewMode = document.querySelector(".segment-button.active")?.dataset?.reviewMode || "campaign";
  let grade, explanation;

  if (reviewMode === "livestream") {
    const verdicts = streamers.map((s) => getStreamerResult(s).verdict);
    const positiveCount = verdicts.filter((v) => v === "正反馈").length;
    const negativeCount = verdicts.filter((v) => v === "负反馈").length;
    const neutralCount = verdicts.filter((v) => v === "中性反馈").length;
    const ratio = streamers.length ? positiveCount / streamers.length : 0;

    if (ratio >= 0.7) { grade = "A（优秀）"; explanation = "多数主播活动场数据优于近期均值，活动对直播承接有明确正向作用。"; }
    else if (negativeCount >= streamers.length * 0.5) { grade = "C（需优化）"; explanation = "半数以上主播数据低于近期均值，需排查活动方案、排期和福利承接。"; }
    else { grade = "B（达标）"; explanation = "正向与中性反馈占优，部分主播有数据提升空间。"; }

    container.innerHTML = "<div><strong>活动评级：</strong>" + escapeHtml(grade) + '</div><div class="review-grade-detail">' + escapeHtml(explanation) + "正反馈 " + positiveCount + " 位 · 中性 " + neutralCount + " 位 · 负反馈 " + negativeCount + " 位</div>";
  } else {
    const impressions = numberValue(document.querySelector("#impressions")?.value);
    const clicks = numberValue(document.querySelector("#clicks")?.value);
    const participants = numberValue(document.querySelector("#participants")?.value);
    const payers = numberValue(document.querySelector("#payers")?.value);
    const ctr = impressions ? (clicks / impressions * 100).toFixed(1) : 0;
    const conversion = clicks ? (participants / clicks * 100).toFixed(1) : 0;
    const payRate = participants ? (payers / participants * 100).toFixed(1) : 0;

    const policy = getReviewPolicy();
    let textCtr, textConv;
    if (Number(ctr) >= policy.ctr) textCtr = "达标";
    else if (Number(ctr) >= policy.ctr * 0.7) textCtr = "接近";
    else textCtr = "偏低";
    if (Number(conversion) >= policy.participation) textConv = "达标";
    else if (Number(conversion) >= policy.participation * 0.7) textConv = "接近";
    else textConv = "偏低";

    container.innerHTML = "<div><strong>活动评级：</strong>" + escapeHtml("CTR " + textCtr + " · 转化 " + textConv + " · 付费率 " + payRate + "%") + '</div><div class="review-grade-detail">CTR ' + ctr + "%（口径阈值 " + policy.ctr + "%） · 参与转化 " + conversion + "%（口径阈值 " + policy.participation + "%） · 付费率 " + payRate + "%</div>";
  }
}

function parseCreatorBackfill(input) {
  return splitLines(input).map((line) => {
    const separatorIndex = line.search(/[:：]/);
    if (separatorIndex <= 0) return null;
    const name = line.slice(0, separatorIndex).trim();
    const values = line.slice(separatorIndex + 1).split(/[\/／,，\t]+/).map((value) => value.trim());
    if (!name || values.length < 2) return null;
    return {
      name,
      avgViews: parseMetricValue(values[0]),
      engagementRate: parseRateValue(values[1]),
      commentQuality: values[2] || "",
      conversionRate: values[3] || ""
    };
  }).filter(Boolean);
}

function creatorNameKey(name) {
  return String(name || "").replace(/\s+/g, "").toLowerCase();
}

function recalcWithBackfill() {
  const backfillText = document.querySelector("#creator-backfill")?.value?.trim();
  const status = document.querySelector("#creator-status");
  if (!backfillText) {
    if (status) {
      status.textContent = "达人来源：请先输入效果回填数据，每条格式如「达人名：实际播放/互动率/评论质量/转化」。";
      status.className = "source-status source-mock";
    }
    return;
  }

  const backfills = parseCreatorBackfill(backfillText);
  if (!backfills.length) {
    if (status) {
      status.textContent = "达人来源：未识别有效回填数据，请使用「达人名：实际播放/互动率/评论质量/转化」格式。";
      status.className = "source-status source-mock";
    }
    return;
  }

  if (!currentCreatorRows.length) analyzeCreators();
  const backfillMap = new Map(backfills.map((item) => [creatorNameKey(item.name), item]));
  let matched = 0;
  const updatedRows = currentCreatorRows.map((row) => {
    const patch = backfillMap.get(creatorNameKey(row.name));
    if (!patch) return row;
    matched += 1;
    return {
      ...row,
      ...(patch.avgViews ? { avgViews: patch.avgViews } : {}),
      ...(patch.engagementRate ? { engagementRate: patch.engagementRate } : {}),
      ...(patch.commentQuality ? { commentQuality: patch.commentQuality } : {}),
      ...(patch.conversionRate ? { conversionRate: patch.conversionRate } : {}),
      dataSource: "backfill"
    };
  });

  if (!matched) {
    if (status) {
      status.textContent = "达人来源：回填格式正确，但没有匹配到已导入的达人姓名。";
      status.className = "source-status source-mock";
    }
    return;
  }

  if (status) {
    status.textContent = `达人来源：已匹配 ${matched}/${backfills.length} 位达人，正在按实测数据重新计算性价比…`;
    status.className = "source-status";
  }
  analyzeCreators(updatedRows);
  if (status) {
    status.textContent = `达人来源：已按 ${matched} 位达人实测数据更新评分和性价比排序。`;
    status.className = "source-real";
  }
}

document.querySelector("#caliber-trigger")?.addEventListener("click", openCaliberPanel);
document.querySelector("#caliber-close")?.addEventListener("click", closeCaliberPanel);
document.querySelector("#caliber-overlay")?.addEventListener("click", closeCaliberPanel);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCaliberPanel(); });

/* ---- 结论看板 ---- */


/* ---- Launcher event bindings ---- */
document.querySelector("#bootstrap-local-launcher")?.addEventListener("click", bootstrapLocalLauncher);
document.querySelector("#restart-local-launcher")?.addEventListener("click", restartLocalLauncher);
document.querySelector("#check-launcher")?.addEventListener("click", checkLauncherStatus);

document.querySelector("#refresh-conclusion")?.addEventListener("click", () => {
  renderOverviewConclusion();
  const status = document.querySelector("#overview-status");
  if (status) {
    status.textContent = "总览状态：结论已按各模块当前数据刷新。";
    status.className = "source-status source-real";
  }
});

/* ---- 项目槽位 ---- */

document.querySelectorAll(".project-slot").forEach((slot) => {
  slot.querySelector(".slot-save")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const idx = Number(slot.dataset.slot);
    if (idx) saveProjectToSlot(idx);
  });
  slot.querySelector(".slot-load")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const idx = Number(slot.dataset.slot);
    if (idx) loadProjectFromSlot(idx);
  });
});

/* ---- 确认状态初始化 ---- */
setupConfirmButtons();

/* ---- 刷新各新模块 ---- */
renderOverviewConclusion();
refreshSlotNames();
renderPlatformStrategy(document.querySelector("#trending-platform")?.value || "B站");
renderFeedbackTrendCompare();
renderReviewGrade();

/* ---- 初始化 ---- */

renderServiceModeControls();
checkOcrHealth();
checkLauncherStatus();
refreshOverviewServiceStatus();
analyzeContent();
analyzeFeedback();
renderStreamerList();
analyzeReview();
analyzeTrending();
generateVersionPackage();
generateSegmentPlan();
loadCreatorDemo();
