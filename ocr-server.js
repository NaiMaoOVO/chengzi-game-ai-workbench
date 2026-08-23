const http = require("node:http");
require("./lib/env-file").loadProjectEnv(__dirname);
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const https = require("node:https");
const { createRateLimiter } = require("./lib/http-guards");

const PORT = Number(process.env.PORT) || 8787;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_REMOTE_RESPONSE_BYTES = 2 * 1024 * 1024;
const OCR_PROVIDER = (process.env.OCR_PROVIDER || "macos").toLowerCase();
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 15000;
const OCR_READINESS_TIMEOUT_MS = Number(process.env.OCR_READINESS_TIMEOUT_MS) || 90000;
const OCR_MAX_CONCURRENCY = Math.max(1, Number(process.env.OCR_MAX_CONCURRENCY) || 2);
const OCR_ALLOW_INSECURE_REMOTE = process.env.OCR_ALLOW_INSECURE_REMOTE === "true";
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGIN || "null,http://localhost:3000,http://localhost:5173,http://localhost:8793,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:8793").split(",").map((value) => value.trim()).filter(Boolean));
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.OCR_RATE_LIMIT_MAX) || 30;
const rateLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  trustProxy: process.env.TRUST_PROXY === "1"
});
let activeOcrJobs = 0;

if (!["macos", "remote"].includes(OCR_PROVIDER)) {
  throw new Error(`不支持的 OCR_PROVIDER: ${OCR_PROVIDER}`);
}

const MACOS_SCRIPT_PATH = path.join(__dirname, "ocr.swift");
let macosProviderStatus = OCR_PROVIDER === "macos"
  ? { ready: false, preparing: true, detail: "正在检查 macOS Vision 与 Swift 环境" }
  : null;

let readinessCheckInFlight = false;

function checkMacosProvider() {
  if (readinessCheckInFlight) return;
  if (process.platform !== "darwin") {
    macosProviderStatus = { ready: false, preparing: false, detail: "macOS Vision Provider 只能运行在 macOS" };
    return;
  }
  if (!fs.existsSync(MACOS_SCRIPT_PATH)) {
    macosProviderStatus = { ready: false, preparing: false, detail: "ocr.swift 不存在" };
    return;
  }
  readinessCheckInFlight = true;
  const moduleCache = path.join(os.tmpdir(), "gameops-swift-module-cache");
  const child = spawn("swiftc", ["-module-cache-path", moduleCache, "-typecheck", MACOS_SCRIPT_PATH]);
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGTERM"), OCR_READINESS_TIMEOUT_MS);
  const finishCheck = () => {
    clearTimeout(timer);
    readinessCheckInFlight = false;
  };
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    finishCheck();
    macosProviderStatus = { ready: false, preparing: false, detail: error.message.slice(0, 240) };
  });
  child.on("exit", (code, signal) => {
    finishCheck();
    if (code === 0) {
      macosProviderStatus = { ready: true, preparing: false, detail: "macOS Vision ready" };
      console.log("OCR readiness 自愈成功：macOS Vision 已就绪");
      return;
    }
    const message = signal
      ? `Swift 编译检查超时或被终止（${signal}）`
      : String(stderr || `Swift 编译检查失败，退出码 ${code}`).split("\n")[0];
    macosProviderStatus = { ready: false, preparing: false, detail: message.slice(0, 240) };
  });
}

if (OCR_PROVIDER === "macos") {
  checkMacosProvider();
  const readinessSelfHealTimer = setInterval(() => {
    if (macosProviderStatus?.ready) {
      clearInterval(readinessSelfHealTimer);
      return;
    }
    checkMacosProvider();
  }, 60000);
  readinessSelfHealTimer.unref?.();
}

function remoteProviderStatus() {
  if (!process.env.OCR_REMOTE_URL) return { ready: false, detail: "OCR_REMOTE_URL 未配置" };
  try {
    const url = new URL(process.env.OCR_REMOTE_URL);
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp && !OCR_ALLOW_INSECURE_REMOTE) {
      return { ready: false, detail: "远端 OCR 必须使用 HTTPS" };
    }
    return { ready: true, detail: "remote provider configured" };
  } catch (_error) {
    return { ready: false, detail: "OCR_REMOTE_URL 无效" };
  }
}

function providerStatus() {
  if (OCR_PROVIDER === "remote") return remoteProviderStatus();
  return macosProviderStatus;
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowAll = ALLOWED_ORIGINS.has("*");
  const allowed = allowAll || !origin || origin === "null" || ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (allowAll ? "*" : (origin || "null")) : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function isOriginAllowed(request) {
  const origin = request.headers.origin;
  return ALLOWED_ORIGINS.has("*") || !origin || origin === "null" || ALLOWED_ORIGINS.has(origin);
}

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}
function checkRateLimit(request) {
  return rateLimiter(request);
}

function parseChineseNumber(rawValue) {
  if (!rawValue) return 0;

  const cleaned = String(rawValue)
    .replace(/,/g, "")
    .replace(/，/g, "")
    .replace(/\s+/g, "")
    .trim();

  // 匹配 "数字 + 可选单位（万/千/w/k）"
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(万|w|W|千|k|K)?/);
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = (match[2] || "").toLowerCase();
  if (unit === "万" || unit === "w") return Math.round(value * 10000);
  if (unit === "千" || unit === "k") return Math.round(value * 1000);
  return Math.round(value);
}

/* ---- 指标提取：支持手机端和电脑端截图 ---- */

// 每种指标有多组别名，覆盖不同平台的命名习惯
const METRIC_ALIASES = {
  acu: {
    labels: [
      // 手机端/电脑端通用
      ["acu", "ACU"],
      ["平均在线", "平均在线人数"],
      ["平均观看", "平均看播"],
      ["平均观看人数"],
      ["均值在线"],
      ["均线", "均值"],
      // B站
      ["平均同接"],
      // 英文
      ["avg", "average", "average viewers"]
    ],
    description: "平均在线 ACU"
  },
  pcu: {
    labels: [
      ["pcu", "PCU"],
      ["最高在线", "最高在线人数"],
      ["峰值在线", "峰值"],
      ["最高观看", "最高看播"],
      ["最高观看人数"],
      ["峰值人数"],
      // B站
      ["最高同接", "峰值同接"],
      // 英文
      ["peak", "max viewers", "peak viewers"]
    ],
    description: "最高在线 PCU"
  },
  impressions: {
    labels: [
      ["曝光", "曝光量", "曝光人数"],
      ["看播曝光", "直播曝光"],
      ["展现", "展示量", "展现量"],
      ["观看人次", "观看量", "观看人数"],
      ["观众总数", "覆盖人数"],
      ["impressions", "views", "reach"]
    ],
    description: "曝光量"
  },
  entries: {
    labels: [
      ["进房", "进房人数"],
      ["进入直播", "进入直播间", "直播间进入"],
      ["到访", "到访人数"],
      ["点击进房"],
      ["entered", "entries", "entry", "joined"]
    ],
    description: "进房人数"
  }
};

function pickMetric(text, aliases) {
  // 将文本按行、句号、分号、多个空格分割
  const lines = text
    .split(/[\n\r。；;]{1,2}|\s{3,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  // 第一步：精确匹配 —— 标签和数字在同一行
  for (const line of lines) {
    for (const group of aliases) {
      for (const alias of group) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes(alias.toLowerCase())) {
          // 提取这一行中的所有数字（包括中文单位）
          const numbers = [];
          const regex = /(\d[\d,.\s]*\d|\d)\s*(万|w|W|千|k|K)?/g;
          let match;
          while ((match = regex.exec(line)) !== null) {
            numbers.push(parseChineseNumber(match[0]));
          }

          if (numbers.length > 0) {
            // 如果有多个数字，取离标签最近的那个（通常是标签后的第一个）
            // 简单策略：取最大的数字，因为指标数字通常比其他辅助数字大
            return Math.max(...numbers);
          }
        }
      }
    }
  }

  // 第二步：跨行匹配 —— 标签在一行，数字在相邻行
  for (let i = 0; i < lines.length; i++) {
    const thisLine = lines[i].toLowerCase();
    for (const group of aliases) {
      for (const alias of group) {
        if (thisLine.includes(alias.toLowerCase())) {
          // 检查当前行的数字
          const selfNums = extractAllNumbers(lines[i]);
          if (selfNums.length > 0) return Math.max(...selfNums);

          // 检查相邻行（上/下各两行）
          for (const offset of [1, -1, 2, -2]) {
            const neighborIdx = i + offset;
            if (neighborIdx >= 0 && neighborIdx < lines.length) {
              const neighborNums = extractAllNumbers(lines[neighborIdx]);
              if (neighborNums.length > 0) {
                return Math.max(...neighborNums);
              }
            }
          }
        }
      }
    }
  }

  return 0;
}

function extractAllNumbers(text) {
  const numbers = [];
  const regex = /(\d[\d,.\s]*\d|\d)\s*(万|w|W|千|k|K)?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    numbers.push(parseChineseNumber(match[0]));
  }
  return numbers;
}

function parseMetrics(text) {
  const result = {
    acu: pickMetric(text, METRIC_ALIASES.acu.labels),
    pcu: pickMetric(text, METRIC_ALIASES.pcu.labels),
    impressions: pickMetric(text, METRIC_ALIASES.impressions.labels),
    entries: pickMetric(text, METRIC_ALIASES.entries.labels)
  };
  result._meta = {
    recognizedCount: Object.values(result).filter((v) => v > 0).length,
    totalLines: text.split(/[\n\r]+/).filter(Boolean).length,
    sampleText: text.slice(0, 300)
  };
  return result;
}

function runMacOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("swift", [MACOS_SCRIPT_PATH, imagePath], { cwd: __dirname });
    const maxOutputBytes = 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;
    const deadlineTimer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
    }, OCR_TIMEOUT_MS);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (killTimer) clearTimeout(killTimer);
      error ? reject(error) : resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) < maxOutputBytes) stdout += chunk.toString("utf8").slice(0, maxOutputBytes - Buffer.byteLength(stdout));
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.byteLength(stderr) < maxOutputBytes) stderr += chunk.toString("utf8").slice(0, maxOutputBytes - Buffer.byteLength(stderr));
    });
    child.on("error", (err) => finish(new Error(`swift 启动失败: ${err.message}`)));
    child.on("close", (code, signal) => {
      if (code !== 0) {
        finish(new Error(stderr.trim() || (signal ? `OCR 进程被终止（${signal}）` : `OCR 进程退出码 ${code}`)));
        return;
      }
      try { finish(null, JSON.parse(stdout)); }
      catch (_error) { finish(new Error(`OCR 输出解析失败: ${stdout.slice(0, 200)}`)); }
    });
  });
}

function runRemoteOcr(buffer, contentType) {
  return new Promise((resolve, reject) => {
    if (!process.env.OCR_REMOTE_URL) return reject(new Error("OCR_REMOTE_URL 未配置"));
    let url;
    try { url = new URL(process.env.OCR_REMOTE_URL); }
    catch (_error) { return reject(new Error("OCR_REMOTE_URL 无效")); }
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp && !OCR_ALLOW_INSECURE_REMOTE) return reject(new Error("远端 OCR 必须使用 HTTPS"));
    const transport = url.protocol === "https:" ? https : http;
    const headers = { "Content-Type": contentType, "Content-Length": buffer.length, "Accept": "application/json" };
    if (process.env.OCR_REMOTE_API_KEY) headers.Authorization = `Bearer ${process.env.OCR_REMOTE_API_KEY}`;
    const remoteRequest = transport.request(url, { method: "POST", headers }, (remoteResponse) => {
      const chunks = [];
      let received = 0;
      remoteResponse.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_REMOTE_RESPONSE_BYTES) {
          remoteResponse.destroy(new Error("远端 OCR 响应过大"));
          return;
        }
        chunks.push(chunk);
      });
      remoteResponse.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (remoteResponse.statusCode < 200 || remoteResponse.statusCode >= 300) return reject(new Error(`远端 OCR 返回 HTTP ${remoteResponse.statusCode}`));
        try {
          const result = JSON.parse(body);
          if (typeof result.text !== "string") throw new Error("响应缺少 text 字段");
          resolve(result);
        } catch (error) { reject(new Error(`远端 OCR 响应无效: ${error.message}`)); }
      });
      remoteResponse.on("error", reject);
    });
    const deadlineTimer = setTimeout(() => remoteRequest.destroy(new Error(`远端 OCR 超时（${OCR_TIMEOUT_MS}ms）`)), OCR_TIMEOUT_MS);
    remoteRequest.on("close", () => clearTimeout(deadlineTimer));
    remoteRequest.on("error", reject);
    remoteRequest.end(buffer);
  });
}

function detectImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { ext: ".jpg", contentType: "image/jpeg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: ".png", contentType: "image/png" };
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")))
    return { ext: ".gif", contentType: "image/gif" };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return { ext: ".heic", contentType: "image/heic" };
    }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return { ext: ".webp", contentType: "image/webp" };
  return null;
}

/* ---- HTTP 服务 ---- */

const server = http.createServer((request, response) => {
  if (!isOriginAllowed(request)) {
    sendJson(request, response, 403, { error: "origin not allowed" });
    return;
  }

  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    sendJson(request, response, 429, { error: "rate_limited" }, { "Retry-After": String(rateLimit.retryAfter) });
    return;
  }

  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/live") {
    sendJson(request, response, 200, { ok: true, service: "gameops-ocr" });
    return;
  }

  if (request.method === "GET" && (request.url === "/ready" || request.url === "/health")) {
    const readiness = providerStatus();
    sendJson(request, response, request.url === "/health" || readiness.ready ? 200 : 503, {
      ok: readiness.ready,
      service: "gameops-ocr",
      ocr: readiness.ready ? "ready" : readiness.preparing ? "preparing" : "not_ready",
      provider: OCR_PROVIDER,
      providerConfigured: readiness.ready,
      detail: readiness.detail,
      metrics: Object.keys(METRIC_ALIASES).map((k) => ({
        key: k,
        description: METRIC_ALIASES[k].description
      }))
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/ocr") {
    sendJson(request, response, 404, { error: "not found" });
    return;
  }

  const readiness = providerStatus();
  if (!readiness.ready) {
    sendJson(request, response, 503, {
      error: readiness.preparing ? "OCR 服务正在准备，请稍后重试" : readiness.detail,
      ocr: readiness.preparing ? "preparing" : "not_ready"
    }, readiness.preparing ? { "Retry-After": "2" } : {});
    return;
  }

  const declaredType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  const acceptedTypes = new Set([
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/heic", "image/heif", "image/webp"
  ]);
  if (!acceptedTypes.has(declaredType)) {
    sendJson(request, response, 415, { error: "仅支持图片上传" });
    return;
  }

  if (activeOcrJobs >= OCR_MAX_CONCURRENCY) {
    sendJson(request, response, 503, { error: "OCR 服务繁忙，请稍后重试" }, { "Retry-After": "2" });
    return;
  }

  const chunks = [];
  let received = 0;
  let uploadRejected = false;

  request.on("data", (chunk) => {
    if (uploadRejected) return;
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES) {
      uploadRejected = true;
      sendJson(request, response, 413, { error: `图片不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` });
      request.resume();
      return;
    }
    chunks.push(chunk);
  });

  request.on("end", async () => {
    if (uploadRejected) return;
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      sendJson(request, response, 400, { error: "图片不能为空" });
      return;
    }
    const image = detectImage(buffer);
    if (!image) {
      sendJson(request, response, 415, { error: "无法识别或不支持的图片格式" });
      return;
    }

    const imagePath = path.join(os.tmpdir(), `gameops-ocr-${crypto.randomUUID()}${image.ext}`);
    activeOcrJobs += 1;
    try {
      let ocrResult;
      if (OCR_PROVIDER === "remote") {
        ocrResult = await runRemoteOcr(buffer, image.contentType);
      } else {
        fs.writeFileSync(imagePath, buffer);
        ocrResult = await runMacOcr(imagePath);
      }
      const text = ocrResult.text || "";
      sendJson(request, response, 200, {
        text,
        metrics: parseMetrics(text),
        imageFormat: image.ext,
        provider: OCR_PROVIDER
      });
    } catch (error) {
      sendJson(request, response, 502, {
        error: error.message,
        hint: OCR_PROVIDER === "macos"
          ? "请确认已安装 Xcode Command Line Tools（xcode-select --install）并且 Swift 可用"
          : "请检查 OCR_REMOTE_URL、远端服务状态和 API Key"
      });
    } finally {
      activeOcrJobs -= 1;
      if (OCR_PROVIDER === "macos") fs.rm(imagePath, { force: true }, () => {});
    }
  });
});

server.requestTimeout = Math.max(OCR_TIMEOUT_MS + 5000, 60000);
server.headersTimeout = Math.min(OCR_TIMEOUT_MS, 60000);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🖼  OCR 服务已启动 → http://127.0.0.1:${PORT}`);
  console.log(`   OCR Provider: ${OCR_PROVIDER}`);
  console.log(`   健康检查: http://127.0.0.1:${PORT}/health`);
  console.log(`   支持指标: ${Object.keys(METRIC_ALIASES).map((k) => METRIC_ALIASES[k].description).join("、")}`);
});
