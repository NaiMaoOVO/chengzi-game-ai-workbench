const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.HOTSPOT_PORT || 8790);
const BILIBILI_SEARCH_URL = "https://api.bilibili.com/x/web-interface/search/type";
const BILIBILI_HTML_SEARCH_URL = "https://search.bilibili.com/video";
const BILIBILI_COOKIE = process.env.BILIBILI_COOKIE || "";
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGIN || "null,http://localhost:3000,http://localhost:5173,http://localhost:8793,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:8793").split(",").map((value) => value.trim()).filter(Boolean));
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const RATE_LIMIT_MAX = Math.max(1, Number(process.env.RATE_LIMIT_MAX || 60));
const CACHE_TTL_MS = Math.max(0, Number(process.env.CACHE_TTL_MS || 30000));
const UPSTREAM_TIMEOUT_MS = Math.max(1000, Number(process.env.UPSTREAM_TIMEOUT_MS || 8000));
const UPSTREAM_RETRIES = Math.max(0, Math.min(3, Number(process.env.UPSTREAM_RETRIES || 2)));
const rateLimits = new Map();
const responseCache = new Map();
const SUPPORTED_PLATFORMS = new Set(["B站", "抖音", "小红书", "TapTap", "微博"]);
const SUPPORTED_RANGES = new Set(["today", "24h", "3d", "7d"]);
const SESSION_COOKIE = [
  `buvid3=${randomHex(16)}infoc`,
  `buvid4=${randomHex(32)}`,
  `b_nut=${Math.floor(Date.now() / 1000)}`,
  "CURRENT_FNVAL=4048"
].join("; ");

function randomHex(size) {
  return crypto.randomBytes(size).toString("hex").toUpperCase();
}

function getBilibiliCookie() {
  if (BILIBILI_COOKIE) return BILIBILI_COOKIE;
  return SESSION_COOKIE;
}

function getBilibiliHeaders(referer = "https://search.bilibili.com/") {
  return {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Origin": "https://search.bilibili.com",
    "Referer": referer,
    "Cookie": getBilibiliCookie()
  };
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || (!ALLOWED_ORIGINS.has("*") && !ALLOWED_ORIGINS.has(origin))) return {};
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has("*") ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function clientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

function allowRequest(request) {
  const now = Date.now();
  const key = clientIp(request);
  const current = rateLimits.get(key);
  if (!current || now >= current.resetAt) {
    if (rateLimits.size > 1000) {
      for (const [ip, entry] of rateLimits) {
        if (entry.resetAt <= now) rateLimits.delete(ip);
      }
    }
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_MAX;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= UPSTREAM_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (response.status !== 429 && response.status < 500) return response;
      await response.body?.cancel();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error.name === "TimeoutError" ? new Error("上游请求超时") : error;
    }
    if (attempt < UPSTREAM_RETRIES) await sleep(200 * (2 ** attempt));
  }
  throw lastError;
}

function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCached(key, payload) {
  if (CACHE_TTL_MS <= 0) return;
  const now = Date.now();
  if (responseCache.size > 200) {
    for (const [cacheKey, entry] of responseCache) {
      if (entry.expiresAt <= now) responseCache.delete(cacheKey);
    }
  }
  while (responseCache.size >= 200) {
    responseCache.delete(responseCache.keys().next().value);
  }
  responseCache.set(key, { payload, expiresAt: now + CACHE_TTL_MS });
}

function boundedInteger(rawValue, fallback, min, max) {
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function rangeToSeconds(range) {
  const now = new Date();
  let start;

  if (range === "today") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else {
    const hours = {
      "24h": 24,
      "3d": 72,
      "7d": 168
    }[range] || 24;
    start = new Date(now.getTime() - hours * 60 * 60 * 1000);
  }

  return {
    begin: Math.floor(start.getTime() / 1000),
    end: Math.floor(now.getTime() / 1000)
  };
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") {
    return value > 100000000000 ? Math.floor(value / 1000) : value;
  }

  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return number > 100000000000 ? Math.floor(number / 1000) : number;
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function getRangeLabel(range) {
  return {
    today: "今天",
    "24h": "近 24 小时",
    "3d": "近 3 天",
    "7d": "近 7 天"
  }[range] || "近 24 小时";
}

function isWithinRange(item, range) {
  const pubdate = normalizeTimestamp(item.pubdate || item.pubtime || item.created || item.senddate || item.created_at);
  if (!pubdate) return false;
  const { begin, end } = rangeToSeconds(range);
  return pubdate >= begin && pubdate <= end + 300;
}

function calculateHeatScore(item) {
  const views = Number(item.play || 0);
  const danmaku = Number(item.video_review || 0);
  const favorites = Number(item.favorites || 0);
  const pubdate = normalizeTimestamp(item.pubdate || 0);
  const ageHours = pubdate ? Math.max((Date.now() / 1000 - pubdate) / 3600, 1) : 24;
  const freshness = Math.max(0.35, Math.min(1.2, 24 / ageHours));

  return Math.round((views + danmaku * 8 + favorites * 12) * freshness);
}

function normalizeKeyword(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getKeywordVariants(game) {
  const value = String(game || "").trim();
  const compact = normalizeKeyword(value);
  const variants = new Set([compact]);
  compact
    .split(/[:：·\-_\s]+/)
    .filter((item) => item.length >= 2)
    .forEach((item) => variants.add(item));

  const aliasMap = {
    鸣潮: ["鸣潮", "wuwa", "wutheringwaves"],
    原神: ["原神", "genshin"],
    "崩坏星穹铁道": ["崩坏星穹铁道", "星穹铁道", "崩铁", "honkaistarrail"],
    "崩坏：星穹铁道": ["崩坏星穹铁道", "星穹铁道", "崩铁", "honkaistarrail"],
    绝区零: ["绝区零", "zzz"],
    巅峰极速: ["巅峰极速", "racingmaster"],
    王者荣耀: ["王者荣耀", "农药"],
    和平精英: ["和平精英", "吃鸡"]
  };

  (aliasMap[value] || []).forEach((item) => variants.add(normalizeKeyword(item)));
  return Array.from(variants).filter(Boolean);
}

function calculateRelevanceScore(item, game) {
  const variants = getKeywordVariants(game);
  if (!variants.length) return 100;

  const title = normalizeKeyword(stripHtml(item.title));
  const author = normalizeKeyword(stripHtml(item.author || ""));
  const metadata = normalizeKeyword([
    item.title,
    item.author,
    item.description,
    item.tag,
    item.typename
  ].join(" "));
  let score = 0;

  variants.forEach((keyword) => {
    if (title.includes(keyword)) score += 60;
    if (metadata.includes(keyword)) score += 24;
    if (author.includes(keyword)) score += 8;
  });

  if (normalizeKeyword(item.typename).includes("游戏")) score += 6;
  if (Number(item.play || 0) > 10000) score += 4;

  const lowValueWords = ["代肝", "代练", "接单", "价格表", "托管", "陪玩", "出号", "买号", "卖号", "租号", "账号", "私信", "微信", "qq"];
  lowValueWords.forEach((word) => {
    if (metadata.includes(normalizeKeyword(word))) score -= 35;
  });

  const otherGames = ["原神", "鸣潮", "绝区零", "星穹铁道", "崩铁", "王者荣耀", "和平精英", "第五人格", "明日方舟", "巅峰极速"];
  otherGames
    .map(normalizeKeyword)
    .filter((name) => name && !variants.includes(name))
    .forEach((name) => {
      if (title.includes(name)) score -= 45;
    });

  return Math.max(0, Math.min(100, score));
}

function isRelevantVideo(item, game) {
  return calculateRelevanceScore(item, game) >= 30;
}

function toBilibiliVideo(item, index, game) {
  const aid = item.aid || item.id || "";
  const bvid = item.bvid || "";
  const url = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : item.arcurl || (aid ? `https://www.bilibili.com/video/av${aid}` : "");
  const cover = item.pic ? (item.pic.startsWith("//") ? `https:${item.pic}` : item.pic) : "";

  return {
    rank: index + 1,
    bvid,
    aid,
    title: stripHtml(item.title),
    author: stripHtml(item.author || item.mid || "未知UP主"),
    views: Number(item.play || 0),
    heat: calculateHeatScore(item),
    danmaku: Number(item.video_review || 0),
    favorites: Number(item.favorites || 0),
    duration: item.duration || "",
    publishedAt: item.pubdate ? new Date(item.pubdate * 1000).toISOString() : "",
    url,
    cover,
    relevanceScore: calculateRelevanceScore(item, game),
    source: "real",
    platform: "B站"
  };
}

function normalizeBilibiliSearchItem(item) {
  return {
    ...item,
    play: item.play || item.stat?.view || item.view || 0,
    video_review: item.video_review || item.stat?.danmaku || item.danmaku || 0,
    favorites: item.favorites || item.stat?.favorite || 0,
    pubdate: normalizeTimestamp(item.pubdate || item.pubtime || item.created || item.senddate || item.created_at || 0),
    arcurl: item.arcurl || item.url || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : "")
  };
}

async function fetchBilibiliSearchApi(game, range, order = "click") {
  const { begin, end } = rangeToSeconds(range);
  const params = new URLSearchParams({
    search_type: "video",
    keyword: game,
    order,
    page: "1",
    page_size: "30",
    pubtime_begin: String(begin),
    pubtime_end: String(end)
  });

  const response = await fetchWithRetry(`${BILIBILI_SEARCH_URL}?${params}`, {
    headers: getBilibiliHeaders(`https://search.bilibili.com/all?keyword=${encodeURIComponent(game)}`)
  });

  if (!response.ok) {
    const hint = response.status === 412
      ? "B站返回 HTTP 412，通常是公开搜索接口触发风控；可稍后重试，或在终端设置 BILIBILI_COOKIE 后重启热点服务。"
      : `B站搜索请求失败：HTTP ${response.status}`;
    throw new Error(hint);
  }

  const payload = await response.json();
  return (payload?.data?.result || []).map(normalizeBilibiliSearchItem);
}

function parseHtmlVideos(html, game) {
  const compact = String(html || "");
  const bvids = [...new Set((compact.match(/BV[a-zA-Z0-9]{10}/g) || []).map((item) => item.replace(/^bv/i, "BV")))];
  return bvids.slice(0, 30).map((bvid, index) => {
    const before = compact.slice(Math.max(0, compact.indexOf(bvid) - 600), compact.indexOf(bvid) + 600);
    const titleMatch = before.match(/"title":"([^"]+)"/) || before.match(/title="([^"]+)"/);
    const authorMatch = before.match(/"author":"([^"]+)"/) || before.match(/"uname":"([^"]+)"/);
    const playMatch = before.match(/"play":(\d+)/) || before.match(/"view":(\d+)/);
    const pubdateMatch = before.match(/"pubdate":(\d+)/) || before.match(/"pubtime":(\d+)/);
    return normalizeBilibiliSearchItem({
      type: "video",
      bvid,
      title: titleMatch ? titleMatch[1].replace(/\\u([\dA-Fa-f]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16))) : `${game} 相关视频 ${index + 1}`,
      author: authorMatch ? authorMatch[1] : "B站UP主",
      play: playMatch ? Number(playMatch[1]) : 0,
      pubdate: pubdateMatch ? normalizeTimestamp(pubdateMatch[1]) : 0
    });
  });
}

async function fetchBilibiliSearchHtml(game, range) {
  const params = new URLSearchParams({
    keyword: game,
    order: "click",
    duration: "0",
    tids_1: "4"
  });
  if (range === "today" || range === "24h") params.set("pubtime", "1");
  if (range === "3d") params.set("pubtime", "3");
  if (range === "7d") params.set("pubtime", "7");

  const response = await fetchWithRetry(`${BILIBILI_HTML_SEARCH_URL}?${params}`, {
    headers: {
      ...getBilibiliHeaders(`https://search.bilibili.com/all?keyword=${encodeURIComponent(game)}`),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error(`B站网页搜索兜底失败：HTTP ${response.status}`);
  }
  return parseHtmlVideos(await response.text(), game);
}

function buildHotspotPayload(rawItems, game, limit, range, sourceLabel, notePrefix = "") {
  const videoItems = rawItems
    .filter((item) => item.type === "video" || item.bvid || item.arcurl);
  const rangedRawItems = videoItems.filter((item) => isWithinRange(item, range));
  const outOfRangeCount = videoItems.length - rangedRawItems.length;
  const mappedItems = rawItems
    .filter((item) => item.type === "video" || item.bvid || item.arcurl)
    .filter((item) => isWithinRange(item, range))
    .filter((item) => isRelevantVideo(item, game))
    .map((item, index) => toBilibiliVideo(item, index, game));
  const fallbackItems = rangedRawItems
    .map((item, index) => toBilibiliVideo(item, index, game));
  const matchedItems = mappedItems.length ? mappedItems : fallbackItems;
  const items = matchedItems
    .sort((a, b) => (b.heat - a.heat) || (b.relevanceScore - a.relevanceScore))
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const noteParts = [];
  if (outOfRangeCount > 0) {
    noteParts.push(`已按${getRangeLabel(range)}过滤 ${outOfRangeCount} 条超出时间范围或缺少发布时间的视频。`);
  }
  if (!mappedItems.length && fallbackItems.length) {
    noteParts.push("严格匹配游戏关键词的视频不足，已放宽匹配范围。");
  }
  if (items.length < limit) {
    noteParts.push(`公开搜索结果不足 ${limit} 条，已返回可获取的视频。`);
  }
  if (notePrefix) noteParts.unshift(notePrefix);

  return {
    platform: "B站",
    game,
    source: "real",
    sourceLabel,
    range,
    updatedAt: new Date().toISOString(),
    items,
    note: noteParts.join("")
  };
}

async function fetchBilibiliHotspots(game, limit, range) {
  const attempts = [
    { label: "B站公开搜索 API · 播放排序", run: () => fetchBilibiliSearchApi(game, range, "click") },
    { label: "B站公开搜索 API · 综合排序", run: () => fetchBilibiliSearchApi(game, range, "totalrank") },
    { label: "B站公开搜索 API · 最新发布", run: () => fetchBilibiliSearchApi(game, range, "pubdate") },
    { label: "B站网页搜索兜底", run: () => fetchBilibiliSearchHtml(game, range) }
  ];
  const errors = [];

  for (const attempt of attempts) {
    try {
      const rawItems = await attempt.run();
      const payload = buildHotspotPayload(rawItems, game, limit, range, attempt.label, errors.length ? `前序接口失败，已切换到${attempt.label}。` : "");
      if (payload.items.length) return payload;
      errors.push(`${attempt.label} 返回空结果`);
    } catch (error) {
      errors.push(`${attempt.label}：${error.message}`);
    }
  }

  throw new Error(errors.join("；"));
}


/* ---- 抖音/小红书 样例兜底与抓取 ---- */
function generateDouyinSample(game, limit) {
  var now = Date.now();
  var tags = ["短视频", "直播", "口播", "整活", "福利"];
  return Array.from({length: Math.min(limit, 10)}, function(_, i) {
    var titles = [game + "版本福利领取攻略", game + "新手避坑指南", game + "活动返场值得冲吗", game + "主播挑战赛高光时刻", game + "版本更新内容速览", game + "抽卡实况", game + "高难副本通关教学", game + "联机玩法太欢乐了", game + "退坑回坑真实感受", game + "冷门套路分享"];
    var authors = ["游戏达人A", "爆肝玩家B", "攻略UP主C", "萌新日记D", "大神分析E"];
    var label = "上升" + (i + 1);
    return { rank: i + 1, title: titles[i % 10], author: authors[i % 5], tag: tags[i % tags.length], heat: String(32000 - i * 2800), views: 52000 - i * 4000, danmaku: 320 - i * 28, url: "", source: "sample", trend: { icon: "▲", label: label, cls: "trend-up" }, risk: { level: "正常", cls: "risk-low", advice: "抖音热门话题，适合做短视频拆解和福利口播。" }, publishedAt: now - i * 7200000, suffix: "抖音" };
  });
}

function generateXiaohongshuSample(game, limit) {
  var now = Date.now();
  var tags = ["种草", "安利", "避雷", "攻略", "同人"];
  return Array.from({length: Math.min(limit, 10)}, function(_, i) {
    var titles = [game + "抽卡欧气分享", game + "这个版本太香了", game + "新手入门看这一篇就够了", game + "角色/载具培养顺序", game + "活动隐藏福利合集", game + "剧情深度解析", game + "零氪玩家日常记录", game + "高画质截图分享", game + "版本更新吐槽", game + "同人创作鉴赏"][i % 10];
    var authors = ["种草小能手", "游戏日记簿", "攻略大百科", "细节控玩家", "二创小剧场"];
    var label = "上升" + (i + 1);
    return { rank: i + 1, title: titles[i % 10], author: authors[i % 5], tag: tags[i % tags.length], heat: String(18000 - i * 1500), views: 28000 - i * 2200, danmaku: 180 - i * 15, url: "", source: "sample", trend: { icon: "▲", label: label, cls: "trend-up" }, risk: { level: "正常", cls: "risk-low", advice: "小红书适合图文种草和避雷总结，封面图信息密度决定点击率。" }, publishedAt: now - i * 5400000, suffix: "小红书" };
  });
}

async function fetchDouyinHotspots(game, limit, range) {
  throw new Error("抖音真实热点需要登录 Cookie、微信/QQ登录或开放平台权限。可通过环境变量 DOUYIN_COOKIE 配置。");
}

async function fetchXiaohongshuHotspots(game, limit, range) {
  throw new Error("小红书真实热点需要登录 Cookie或开放平台权限。可通过环境变量 XIAOHONGSHU_COOKIE 配置。");
}

async function handleHotspots(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const platform = url.searchParams.get("platform") || "B站";
  const game = (url.searchParams.get("game") || "").trim();
  const limit = boundedInteger(url.searchParams.get("limit"), 10, 1, 20);
  const range = url.searchParams.get("range") || "24h";

  if (!game || game.length > 80) {
    sendJson(request, response, 400, { error: "invalid game", message: "游戏名称长度需为 1-80 个字符。" });
    return;
  }
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    sendJson(request, response, 400, { error: "invalid platform" });
    return;
  }
  if (!SUPPORTED_RANGES.has(range)) {
    sendJson(request, response, 400, { error: "invalid range" });
    return;
  }

  const cacheKey = `hotspots:${platform}:${game}:${limit}:${range}`;
  const cached = getCached(cacheKey);
  if (cached) {
    sendJson(request, response, 200, cached, { "X-Cache": "HIT" });
    return;
  }

  try {
    var result;
    if (platform === "B站") {
      result = await fetchBilibiliHotspots(game, limit, range);
    } else if (platform === "抖音") {
      result = await fetchDouyinHotspots(game, limit, range);
    } else if (platform === "小红书") {
      result = await fetchXiaohongshuHotspots(game, limit, range);
    } else {
      var sampleTags = platform === "TapTap" ? ["测评", "攻略", "资讯"] : ["话题", "爆料", "讨论"];
      var sampleItems = Array.from({length: Math.min(limit, 10)}, function(_, i) {
        var now = Date.now();
        return { rank: i + 1, title: game + " " + ["新内容", "版本动态", "玩家讨论", "活动曝光", "评测对比"][i % 5], author: "UP主" + String.fromCharCode(65 + i), tag: sampleTags[i % sampleTags.length], heat: "模拟热度", views: 10000 - i * 800, danmaku: 100 - i * 8, url: "", source: "sample", trend: { icon: "▸", label: "常规", cls: "trend-flat" }, risk: { level: "正常", cls: "risk-low", advice: "该平台无公开抓取接口，使用模拟榜单演示。" }, publishedAt: now - i * 3600000, suffix: platform };
      });
      result = { items: sampleItems, sourceLabel: platform + " 样例兜底", note: "" };
    }
    setCached(cacheKey, result);
    sendJson(request, response, 200, result, { "X-Cache": "MISS" });
  } catch (error) {
    var fallback = platform === "抖音" ? generateDouyinSample(game, limit) : platform === "小红书" ? generateXiaohongshuSample(game, limit) : [];
    sendJson(request, response, 200, {
      items: fallback,
      sourceLabel: platform + " 样例兜底（真实抓取不可用）",
      note: error.message + "；已使用样例兜底榜单。"
    });
  }
}

async function handleProbe(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const game = (url.searchParams.get("game") || "原神").trim();
  const limit = boundedInteger(url.searchParams.get("limit"), 1, 1, 3);

  if (!game || game.length > 80) {
    sendJson(request, response, 400, { ok: false, error: "invalid game" });
    return;
  }

  try {
    const result = await fetchBilibiliHotspots(game, limit, "24h");
    sendJson(request, response, 200, {
      ok: true,
      service: "gameops-hotspot",
      message: `真实热点接口可用：${result.sourceLabel}，返回 ${result.items.length} 条`,
      note: result.note || ""
    });
  } catch (error) {
    sendJson(request, response, 502, {
      ok: false,
      service: "gameops-hotspot",
      message: `真实热点接口不可用：${error.message}`
    });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(request, response, 200, { ok: true });
    return;
  }

  if (!allowRequest(request)) {
    sendJson(request, response, 429, { error: "rate_limited", message: "请求过于频繁，请稍后重试。" }, { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(request, response, 200, { ok: true, service: "gameops-hotspot" });
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/probe")) {
    handleProbe(request, response);
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/hotspots")) {
    handleHotspots(request, response);
    return;
  }

  sendJson(request, response, 404, { error: "not found" });
});

server.on("error", (error) => {
  console.error(`Hotspot service failed: ${error.message}`);
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing service or change PORT in hotspot-server.js.`);
  }
  if (error.code === "EPERM") {
    console.error("Permission denied while opening localhost port. Run this from your normal terminal.");
  }
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Hotspot service running at http://127.0.0.1:${PORT}`);
});
