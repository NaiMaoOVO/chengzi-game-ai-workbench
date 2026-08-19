/**
 * 游戏内容运营 AI 分析工作台 — 工具函数与常量
 * 从 app.js 拆分而来。通过 <script> 标签在 app.js 之前加载。
 */

/* ============================================================
   常量定义
 ============================================================ */

const keywordGroups = {
  福利: ["福利", "奖励", "兑换码", "抽卡", "回归"],
  角色: ["角色", "皮肤", "限定", "互动", "剧情"],
  版本: ["版本", "前瞻", "更新", "地图", "系统"],
  问题: ["发热", "掉帧", "bug", "卡顿", "压力", "重复", "累", "教程"]
};


const SERVICE_MODE_STORAGE_KEY = "gameops-service-mode-v1";
const SERVICE_URL_PRESETS = {
  local: {
    ocr: "http://127.0.0.1:8787",
    hotspot: "http://127.0.0.1:8790",
    comment: "http://127.0.0.1:8791",
    launcher: "http://127.0.0.1:8793",
    llm: "http://127.0.0.1:8794"
  },
  online: {
    ocr: "/api/ocr",
    hotspot: "/api/hotspot",
    comment: "/api/comment",
    launcher: "",
    llm: "/api/llm"
  }
};

let OCR_SERVICE_URL = SERVICE_URL_PRESETS.local.ocr;
let HOTSPOT_SERVICE_URL = SERVICE_URL_PRESETS.local.hotspot;
let COMMENT_SERVICE_URL = SERVICE_URL_PRESETS.local.comment;
let LAUNCHER_SERVICE_URL = SERVICE_URL_PRESETS.local.launcher;
let LLM_SERVICE_URL = SERVICE_URL_PRESETS.local.llm;

function inferDefaultServiceMode() {
  if (typeof window === "undefined" || !window.location) return "local";
  const host = window.location.hostname;
  const isLocalHost = !host || host === "localhost" || host === "127.0.0.1";
  return window.location.protocol === "file:" || isLocalHost ? "local" : "online";
}

function getServiceMode() {
  try {
    const stored = window.localStorage?.getItem(SERVICE_MODE_STORAGE_KEY);
    return stored === "online" || stored === "local" ? stored : inferDefaultServiceMode();
  } catch (_error) {
    return inferDefaultServiceMode();
  }
}

function setServiceMode(mode) {
  const nextMode = mode === "online" ? "online" : "local";
  try {
    window.localStorage?.setItem(SERVICE_MODE_STORAGE_KEY, nextMode);
  } catch (_error) {
    /* localStorage may be unavailable in private contexts. */
  }
  return applyServiceMode(nextMode);
}

function isOnlineServiceMode() {
  return getServiceMode() === "online";
}

function getServiceModeLabel(mode = getServiceMode()) {
  return mode === "online" ? "线上模式" : "本地模式";
}

function applyServiceMode(mode = getServiceMode()) {
  const urls = SERVICE_URL_PRESETS[mode] || SERVICE_URL_PRESETS.local;
  OCR_SERVICE_URL = urls.ocr;
  HOTSPOT_SERVICE_URL = urls.hotspot;
  COMMENT_SERVICE_URL = urls.comment;
  LAUNCHER_SERVICE_URL = urls.launcher;
  LLM_SERVICE_URL = urls.llm;
  return mode;
}

applyServiceMode();


const PROJECT_STORAGE_KEY = "gameops-workbench-state-v1";
const REVIEW_POLICIES = {
  standard: {
    label: "标准口径",
    metricThreshold: 0.05,
    positiveRatio: 0.6,
    negativeRatio: 0.4,
    ctr: 3,
    participation: 30,
    conversion: 8
  },
  conservative: {
    label: "保守口径",
    metricThreshold: 0.08,
    positiveRatio: 0.7,
    negativeRatio: 0.3,
    ctr: 4,
    participation: 35,
    conversion: 10
  },
  aggressive: {
    label: "激进口径",
    metricThreshold: 0.03,
    positiveRatio: 0.5,
    negativeRatio: 0.5,
    ctr: 2,
    participation: 25,
    conversion: 6
  }
};

function countMatches(text, words) {
  return words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
}


function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function safeExternalUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}


function safeImageUrl(value) {
  const url = String(value || "").trim();
  return /^(https?:|blob:)/i.test(url) ? url : "";
}


function parseCompactNumber(value) {
  const raw = String(value || "").trim().replace(/,/g, "");
  if (!raw) return 0;
  const number = Number(raw.replace(/[万wWkK千+]/g, "")) || 0;
  if (/[万wW]/.test(raw)) return Math.round(number * 10000);
  if (/[kK千]/.test(raw)) return Math.round(number * 1000);
  return Math.round(number);
}

function splitLines(value) {
  return value
    .split(/\n|；|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberValue(value) {
  return Number(value) || 0;
}


function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/\s+|_|-|（|）|\(|\)/g, "");
}


function pickRowValue(row, headerMap, aliases, fallbackIndex) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const matchedKey = Object.keys(headerMap).find((key) => normalizedAliases.includes(key));
  const index = matchedKey ? headerMap[matchedKey] : fallbackIndex;
  return row[index] || "";
}


function formatChange(current, baseline, threshold = getReviewPolicy().metricThreshold) {
  if (!baseline) {
    return {
      rate: 0,
      label: "无基准",
      direction: "neutral"
    };
  }

  const rate = (current - baseline) / baseline;
  const sign = rate > 0 ? "+" : "";

  return {
    rate,
    label: `${sign}${(rate * 100).toFixed(1)}%`,
    direction: rate >= threshold ? "positive" : rate <= -threshold ? "negative" : "neutral"
  };
}
