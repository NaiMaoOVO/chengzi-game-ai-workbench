const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { createRateLimiter, stableSerialize, createSingleFlightCache } = require("./lib/http-guards");
const { createCors } = require("./lib/cors");
require("./lib/env-file").loadProjectEnv(__dirname);

const PORT = Number(process.env.LLM_PORT) || 8794;
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "deepseek-chat";
const LLM_JSON_MODE = ["auto", "force", "off"].includes(process.env.LLM_JSON_MODE) ? process.env.LLM_JSON_MODE : "auto";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 45000;
const LLM_MAX_CONCURRENCY = Math.max(1, Number(process.env.LLM_MAX_CONCURRENCY) || 2);
const CACHE_TTL_MS = Math.max(0, Number(process.env.LLM_CACHE_TTL_MS) || 600000);
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.LLM_RATE_LIMIT_MAX) || 20;
const MAX_REQUEST_BYTES = 256 * 1024;

const cors = createCors({ allowedOrigins: process.env.ALLOWED_ORIGIN, methods: "GET, POST, OPTIONS" });
const checkRateLimit = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  trustProxy: process.env.TRUST_PROXY === "1"
});
const responseCache = createSingleFlightCache({ ttlMs: CACHE_TTL_MS, maxEntries: 200 });
let activeJobs = 0;

/* ---- 身份与 CORS ---- */

function providerStatus() {
  if (!LLM_API_KEY) return { ready: false, llm: "no_key", detail: "LLM_API_KEY 未配置，运行在规则模式" };
  if (!/^https?:\/\//.test(LLM_BASE_URL)) return { ready: false, llm: "not_ready", detail: "LLM_BASE_URL 无效" };
  return { ready: true, llm: "ready", detail: `已接入 ${LLM_MODEL}` };
}

const corsHeaders = cors.corsHeaders;
const isOriginAllowed = cors.isOriginAllowed;

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function checkRateLimitRequest(request) {
  return checkRateLimit(request);
}

/* ---- Prompt 设计（服务端内聚） ---- */

const TASKS = {
  "feedback-insight": {
    temperature: 0.3,
    maxTokens: 1800,
    build(data) {
      const game = String(data.game || "目标游戏").slice(0, 40);
      const comments = Array.isArray(data.comments)
        ? data.comments.filter((c) => typeof c === "string" && c.trim()).slice(0, 60).map((c) => c.slice(0, 300))
        : [];
      if (comments.length < 3) throw new Error("评论样本不足（至少 3 条有效评论）");
      const list = comments.map((c, i) => `${i + 1}. ${c}`).join("\n");
      return {
        system: "你是资深游戏内容运营分析师，擅长从玩家评论中提炼舆情洞察和可执行建议。只输出 JSON，不要输出其他内容。引用评论时必须使用【#编号】格式（编号对应输入列表序号），禁止编造不存在的编号。",
        user: `分析以下《${game}》玩家评论（已做基础清洗，每条前置编号）：\n\n${list}\n\n输出 JSON，字段定义：\n{"summary":"总体舆情摘要，2-3句话，覆盖情绪倾向与核心议题，提及具体评论时用【#编号】标注来源","sentiment_overview":"正向/中性/负向大致占比与形成原因，1-2句话","top_issues":["玩家最关心的3-5个议题，每个一句话并注明热度依据，附【#编号】来源"],"suggested_actions":["3-5条可直接执行的运营动作，每条一句话"],"representative_quotes":[{"quote_id":1,"comment":"代表性原评论截取前50字（与原评论一致）","reason":"入选理由一句话"}]}`
      };
    }
  },
  "version-copy": {
    temperature: 0.7,
    maxTokens: 2000,
    build(data) {
      const game = String(data.game || "目标游戏").slice(0, 40);
      const theme = String(data.theme || "全新版本").slice(0, 60);
      const style = String(data.style || "官方公告风").slice(0, 20);
      const audience = String(data.audience || "核心玩家").slice(0, 20);
      const points = Array.isArray(data.points)
        ? data.points.filter((p) => typeof p === "string" && p.trim()).slice(0, 15).map((p) => p.slice(0, 80))
        : [];
      const pointText = points.join("、") || "核心内容更新";
      return {
        system: "你是游戏版本营销文案专家，擅长为不同平台定制内容包装。只输出 JSON，不要输出其他内容。",
        user: `为游戏《${game}》的「${theme}」版本生成包装文案。\n更新点：${pointText}\n文案风格：${style}（主推人群：${audience}）\n\n输出 JSON，字段定义：\n{"announcement":"版本公告文案，120-200字，符合所选风格","social":{"bilibili":"B站动态文案，60-100字，末尾带1-2个#话题","douyin":"抖音口播文案，40-60字，口语化有钩子","xiaohongshu":"小红书笔记文案，60-100字，分点且友好","weibo":"微博文案，50-80字，带#话题#"},"push_titles":["5条推送标题，每条不超过20字，覆盖利益点/情绪点/悬念点"]}`
      };
    }
  }
};

/* ---- LLM 调用（OpenAI 兼容 chat/completions） ---- */

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch (_e) { /* fallthrough */ }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (_e) { /* fallthrough */ }
    }
    throw new Error("LLM 返回内容无法解析为 JSON");
  }
}

function callUpstream(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      temperature: options.temperature,
      max_tokens: options.maxTokens
    };
    if (LLM_JSON_MODE !== "off" && options.jsonMode !== false) {
      payload.response_format = { type: "json_object" };
    }

    const upstreamUrl = new URL(`${LLM_BASE_URL}/chat/completions`);
    const transport = upstreamUrl.protocol === "https:" ? https : http;

    const request = transport.request(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LLM_API_KEY}`,
        "Content-Length": Buffer.byteLength(JSON.stringify(payload))
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let detail = `上游 HTTP ${response.statusCode}`;
          try {
            const parsed = JSON.parse(body);
            detail = parsed?.error?.message || detail;
          } catch (_error) { /* keep default */ }
          reject(new Error(detail.slice(0, 240)));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          const content = parsed?.choices?.[0]?.message?.content;
          if (typeof content !== "string" || !content.trim()) throw new Error("上游返回为空");
          resolve(extractJsonObject(content));
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    });

    request.setTimeout(LLM_TIMEOUT_MS, () => {
      request.destroy(new Error(`LLM 请求超时（${LLM_TIMEOUT_MS}ms）`));
    });
    request.on("error", reject);
    request.end(JSON.stringify(payload));
  });
}

/* ---- 缓存 ---- */

function cacheKey(task, data) {
  return crypto.createHash("sha256").update(task + "::" + stableSerialize(data)).digest("hex");
}

/* ---- SSE 流式输出（P1-2） ---- */
// 缓存语义：流式请求完全不读写 responseCache——增量交付无法从缓存回放，也不能复用单飞生产者的增量流；
// 但仍计入 activeJobs 受 LLM_MAX_CONCURRENCY 约束，限流/体积/Origin 守卫与非流式共用同一套。

function sseFrame(eventName, payload) {
  return "event: " + eventName + "\ndata: " + JSON.stringify(payload) + "\n\n";
}

function beginEventStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...corsHeaders(request)
  });
  response.flushHeaders();
}

function streamUpstreamText(prompt, task, onDelta, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      temperature: task.temperature,
      max_tokens: task.maxTokens,
      stream: true
    };
    if (LLM_JSON_MODE !== "off" && options.jsonMode !== false) {
      payload.response_format = { type: "json_object" };
    }

    const upstreamUrl = new URL(LLM_BASE_URL + "/chat/completions");
    const transport = upstreamUrl.protocol === "https:" ? https : http;

    const upstreamRequest = transport.request(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + LLM_API_KEY,
        "Content-Length": Buffer.byteLength(JSON.stringify(payload))
      }
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let detail = "上游 HTTP " + response.statusCode;
          try {
            const parsed = JSON.parse(body);
            detail = parsed?.error?.message || detail;
          } catch (_error) { /* keep default */ }
          reject(new Error(detail.slice(0, 240)));
        });
        response.on("error", reject);
        return;
      }
      let buffer = "";
      let assembled = "";
      const consumeLine = (rawLine) => {
        const line = rawLine.replace(/\r$/, "");
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") return;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (_error) {
          return; // 忽略心跳或无法解析的行
        }
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          assembled += delta;
          onDelta(delta);
        }
      };
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;
        let newlineAt = buffer.indexOf("\n");
        while (newlineAt >= 0) {
          consumeLine(buffer.slice(0, newlineAt));
          buffer = buffer.slice(newlineAt + 1);
          newlineAt = buffer.indexOf("\n");
        }
      });
      response.on("end", () => {
        if (buffer.trim()) consumeLine(buffer);
        if (assembled.trim()) resolve(assembled);
        else reject(new Error("上游返回为空"));
      });
      response.on("error", reject);
    });

    if (options.signal) {
      const abortHandler = () => {
        upstreamRequest.destroy(options.signal.reason instanceof Error ? options.signal.reason : new Error("请求已中止"));
      };
      if (options.signal.aborted) abortHandler();
      else options.signal.addEventListener("abort", abortHandler, { once: true });
    }
    upstreamRequest.on("error", reject);
    upstreamRequest.end(JSON.stringify(payload));
  });
}

async function handleStreamGenerate(request, response, taskName, task, prompt) {
  beginEventStream(request, response);
  response.on("error", () => { /* 客户端断开等写入错误不应杀死进程 */ });
  let clientGone = false;
  const sendEvent = (eventName, payload) => {
    if (clientGone || response.writableEnded || response.destroyed) return;
    response.write(sseFrame(eventName, payload));
  };
  const abortController = new AbortController();
  response.on("close", () => {
    clientGone = true;
    abortController.abort(new Error("客户端已断开连接"));
  });
  // 整个流式会话（含降级重试）共享一个总超时预算
  const deadlineTimer = setTimeout(() => {
    abortController.abort(new Error("LLM 流式请求超时（" + LLM_TIMEOUT_MS + "ms 总时限）"));
  }, LLM_TIMEOUT_MS);

  activeJobs += 1;
  let emittedAnyDelta = false;
  const forwardDelta = (delta) => {
    emittedAnyDelta = true;
    sendEvent("delta", { delta: delta });
  };
  try {
    let assembled;
    try {
      assembled = await streamUpstreamText(prompt, task, forwardDelta, { signal: abortController.signal });
    } catch (firstError) {
      const canRetryWithoutJsonMode =
        !emittedAnyDelta &&
        LLM_JSON_MODE === "auto" &&
        /response_format|json_object|json mode/i.test(firstError.message || "");
      if (!canRetryWithoutJsonMode) throw firstError;
      console.log("LLM 网关：流式请求上游不支持 response_format，已自动降级为纯提示词模式重试");
      emittedAnyDelta = false;
      assembled = await streamUpstreamText(prompt, task, forwardDelta, { jsonMode: false, signal: abortController.signal });
    }
    const result = extractJsonObject(assembled);
    sendEvent("done", { task: taskName, result: result, model: LLM_MODEL, cached: false });
    response.end();
  } catch (error) {
    sendEvent("error", {
      error: String(error?.message || error).slice(0, 240),
      hint: "请检查 LLM_API_KEY 是否有效、账户余额与 LLM_BASE_URL 网络"
    });
    response.end();
  } finally {
    clearTimeout(deadlineTimer);
    activeJobs -= 1;
  }
}

/* ---- HTTP 服务 ---- */

const server = http.createServer((request, response) => {
  if (!isOriginAllowed(request)) {
    sendJson(request, response, 403, { error: "origin not allowed" });
    return;
  }
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }
  if (request.method === "GET" && (request.url === "/health" || request.url === "/ready")) {
    const status = providerStatus();
    sendJson(request, response, request.url === "/health" || status.ready ? 200 : 503, {
      ok: status.ready,
      service: "gameops-llm",
      llm: status.llm,
      model: LLM_MODEL,
      provider: LLM_BASE_URL.includes("deepseek") ? "deepseek" : "openai-compatible",
      detail: status.detail
    });
    return;
  }
  if (request.method === "GET" && request.url === "/live") {
    sendJson(request, response, 200, { ok: true, service: "gameops-llm" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/generate") {
    sendJson(request, response, 404, { error: "not found" });
    return;
  }

  const status = providerStatus();
  if (!status.ready) {
    sendJson(request, response, 503, { error: status.detail, llm: status.llm });
    return;
  }
  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    sendJson(request, response, 429, { error: "too many requests" }, { "Retry-After": String(rateLimit.retryAfter) });
    return;
  }

  const chunks = [];
  let received = 0;
  let rejected = false;
  request.on("data", (chunk) => {
    if (rejected) return;
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) {
      rejected = true;
      sendJson(request, response, 413, { error: "请求体过大" });
      request.resume();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", async () => {
    if (rejected) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (_error) {
      sendJson(request, response, 400, { error: "请求体不是合法 JSON" });
      return;
    }
    const task = Object.hasOwn(TASKS, body.task) ? TASKS[body.task] : null;
    if (!task) {
      sendJson(request, response, 400, { error: "不支持的任务" });
      return;
    }
    let prompt;
    try {
      prompt = task.build(body.data || {});
    } catch (error) {
      sendJson(request, response, 400, { error: error.message });
      return;
    }
    // P1-2：仅当显式 stream === true 时走 SSE 增量分支；其余请求与历史非流式行为保持逐字节一致。
    if (body.stream === true) {
      await handleStreamGenerate(request, response, body.task, task, prompt);
      return;
    }
    const key = cacheKey(body.task, body.data || {});
    const cached = responseCache.get(key);
    if (cached) {
      sendJson(request, response, 200, { task: body.task, result: cached, model: LLM_MODEL, cached: true });
      return;
    }
    if (activeJobs >= LLM_MAX_CONCURRENCY && !responseCache.hasInFlight(key)) {
      sendJson(request, response, 503, { error: "LLM 服务繁忙，请稍后重试" }, { "Retry-After": "2" });
      return;
    }
    const sharedInFlight = responseCache.hasInFlight(key);
    if (!sharedInFlight) activeJobs += 1;
    try {
      const result = await responseCache.getOrCreate(key, async () => {
        try {
          return await callUpstream(prompt, {});
        } catch (firstError) {
          const canRetryWithoutJsonMode =
            LLM_JSON_MODE === "auto" &&
            /response_format|json_object|json mode/i.test(firstError.message || "");
          if (!canRetryWithoutJsonMode) throw firstError;
          console.log("LLM 网关：上游不支持 response_format，已自动降级为纯提示词模式重试");
          return callUpstream(prompt, task, { jsonMode: false });
        }
      });
      sendJson(request, response, 200, { task: body.task, result, model: LLM_MODEL, cached: false });
    } catch (error) {
      sendJson(request, response, 502, {
        error: error.message,
        hint: "请检查 LLM_API_KEY 是否有效、账户余额与 LLM_BASE_URL 网络"
      });
    } finally {
      if (!sharedInFlight) activeJobs -= 1;
    }
  });
});

server.requestTimeout = Math.max(LLM_TIMEOUT_MS + 5000, 60000);

server.listen(PORT, "127.0.0.1", () => {
  const status = providerStatus();
  console.log(`🤖 LLM 增强服务已启动 → http://127.0.0.1:${PORT}`);
  console.log(`   状态: ${status.llm === "ready" ? `已接入 ${LLM_MODEL}` : status.detail}`);
  console.log(`   健康检查: http://127.0.0.1:${PORT}/health`);
  console.log(`   支持任务: ${Object.keys(TASKS).join("、")}`);
});
