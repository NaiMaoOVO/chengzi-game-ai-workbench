const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadProjectEnv } = require("./lib/env-file");

loadProjectEnv(__dirname);

const PORT = Number(process.env.XHS_BRIDGE_PORT) || 8805;
const MCP_SERVER = process.env.XHS_MCP_SERVER || "xiaohongshu";
const BRIDGE_TOKEN = process.env.XHS_BRIDGE_TOKEN || "";
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = Math.max(1000, Number(process.env.XHS_BRIDGE_TIMEOUT_MS) || 125000);

function createSearchGate() {
  let active = false;
  return {
    tryAcquire() {
      if (active) return false;
      active = true;
      return true;
    },
    release() {
      active = false;
    }
  };
}
const searchGate = createSearchGate();
// xiaohongshu-mcp 底层是单个浏览器会话，详情读取与搜索共用同一把单飞锁的语义。
const noteGate = createSearchGate();

function resolveMcporterBin(command, options = {}) {
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  const homeDir = options.homeDir ?? os.homedir();
  const exists = options.exists ?? fs.existsSync;
  if (path.isAbsolute(command)) return command;
  const candidates = [
    ...pathValue.split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, command)),
    path.join(homeDir, ".npm-global", "bin", command),
    "/opt/homebrew/bin/" + command,
    "/usr/local/bin/" + command
  ];
  return candidates.find((candidate) => exists(candidate)) || command;
}

const MCPORTER_BIN = resolveMcporterBin(process.env.MCPORTER_BIN || "mcporter");

// GUI 启动链的 PATH 常常没有 node；mcporter 的 shebang 依赖 `#!/usr/bin/env node`。
function buildChildEnv(baseEnv = process.env) {
  const nodeBinDir = path.dirname(process.execPath);
  const entries = String(baseEnv.PATH || "").split(path.delimiter).filter(Boolean);
  if (!entries.includes(nodeBinDir)) entries.unshift(nodeBinDir);
  return { ...baseEnv, PATH: entries.join(path.delimiter) };
}

function mcpPublishTime(range) {
  return {
    today: "一天内",
    "24h": "一天内",
    "3d": "一周内",
    "7d": "一周内"
  }[range] || "一天内";
}

function buildSearchArgs(server, keyword, range = "24h") {
  return [
    "call",
    `${server}.search_feeds`,
    "--args",
    JSON.stringify({ keyword, filters: { publish_time: mcpPublishTime(range) } }),
    "--output",
    "json",
    "--timeout",
    "120000"
  ];
}

// 笔记详情和评论由同一个只读工具 get_feed_detail 返回；xsec_token 只能取自
// Feed 列表或分享链接本身。xhslink 短链依赖浏览器跳转，服务端不做解析。
// 真实笔记 ID 有两种形态：24 位（时间戳前缀）与 32 位；均限十六进制字符。
const NOTE_ID_PATTERN = /^([0-9a-f]{24}|[0-9a-f]{32})$/i;

function parseNoteTarget(rawValue, options = {}) {
  const fail = (code) => ({ ok: false, code });
  const value = String(rawValue || "").trim();
  if (!value) return fail("note_url_required");
  const explicitToken = String(options.token || "").trim();

  if (NOTE_ID_PATTERN.test(value)) {
    if (!explicitToken) return fail("xsec_token_required");
    return { ok: true, feedId: value.toLowerCase(), xsecToken: explicitToken, source: "id" };
  }

  if (!/^https?:\/\//i.test(value)) return fail("invalid_note_url");
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    return fail("invalid_note_url");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "xhslink.com" || host.endsWith(".xhslink.com")) return fail("xhslink_unsupported");
  if (host !== "xiaohongshu.com" && !host.endsWith(".xiaohongshu.com")) return fail("unsupported_host");

  const token = explicitToken || String(parsed.searchParams.get("xsec_token") || "").trim();
  const match = parsed.pathname.match(/^\/(?:explore|discovery\/item)\/([0-9a-f]{24}|[0-9a-f]{32})\/?$/i)
    || parsed.pathname.match(/^\/user\/profile\/[0-9a-f]{32}\/([0-9a-f]{24}|[0-9a-f]{32})\/?$/i);
  if (!match) return fail("note_id_not_found");
  if (!token) return fail("xsec_token_required");
  return { ok: true, feedId: match[1].toLowerCase(), xsecToken: token, source: "url" };
}

const NOTE_TARGET_ERRORS = {
  note_url_required: { status: 400, message: "缺少笔记地址：请提供完整的小红书笔记链接或笔记 ID。" },
  invalid_note_url: { status: 400, message: "无法解析的小红书笔记地址。" },
  unsupported_host: { status: 400, message: "仅支持 xiaohongshu.com 域名下的笔记链接。" },
  xhslink_unsupported: { status: 400, message: "暂不支持 xhslink 短链：请提供含 xsec_token 的完整链接，或笔记 ID 加 xsec_token。" },
  note_id_not_found: { status: 400, message: "链接中未找到笔记 ID：支持 /explore/<id>、/discovery/item/<id> 等形式。" },
  xsec_token_required: { status: 400, message: "缺少 xsec_token：请使用带 xsec_token 的完整链接，或在请求中附加 &xsec_token=..." }
};

function buildNoteArgs(server, feedId, xsecToken, options = {}) {
  const loadAllComments = Boolean(options.loadAllComments);
  const args = { feed_id: feedId, xsec_token: xsecToken, load_all_comments: loadAllComments };
  if (loadAllComments && Number.isInteger(options.commentLimit)) {
    args.limit = Math.min(Math.max(options.commentLimit, 1), 200);
  }
  return [
    "call",
    `${server}.get_feed_detail`,
    "--args",
    JSON.stringify(args),
    "--output",
    "json",
    "--timeout",
    "120000"
  ];
}

function parseMcpJsonOutput(value) {
  const text = String(value || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) parsed = JSON.parse(fenced[1].trim());
    const starts = [text.indexOf("{"), text.indexOf("[")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (parsed === undefined && start >= 0 && end > start) parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed === undefined) throw new Error("mcporter 输出不是合法 JSON");
  }
  return unwrapMcpContent(parsed);
}

function unwrapMcpContent(value) {
  if (!value || typeof value !== "object") return value;
  if (value.isError) {
    const message = Array.isArray(value.content)
      ? value.content.find((item) => item?.type === "text")?.text
      : "";
    throw new Error(message || "xiaohongshu-mcp 返回错误");
  }
  if (value.structuredContent) return unwrapMcpContent(value.structuredContent);
  if (!Array.isArray(value.content)) return value;
  const textItem = value.content.find((item) => item && item.type === "text" && typeof item.text === "string");
  if (!textItem) return value;
  try {
    return parseMcpJsonOutput(textItem.text);
  } catch (_error) {
    return value;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  if (!BRIDGE_TOKEN) return true;
  return request.headers.authorization === `Bearer ${BRIDGE_TOKEN}`;
}

function runMcpCall(argv, options = {}) {
  return new Promise((resolve, reject) => {
    const spawnImpl = options.spawnImpl || spawn;
    const timeoutMs = options.timeoutMs || BRIDGE_TIMEOUT_MS;
    const label = String(argv[1] || "").split(".").pop() || "mcp";
    const child = spawnImpl(MCPORTER_BIN, argv, {
      cwd: __dirname,
      env: buildChildEnv(options.baseEnv),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    let received = 0;
    let stderr = "";
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    timer = setTimeout(() => {
      finish(new Error(`xiaohongshu-mcp ${label} 超时（${timeoutMs}ms）`));
      child.kill?.("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      received += chunk.length;
      if (received <= MAX_OUTPUT_BYTES) chunks.push(chunk);
      else {
        finish(new Error("xiaohongshu-mcp 输出过大"));
        child.kill?.("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8").slice(0, 2000);
    });
    child.on("error", (error) => finish(new Error(`无法启动 mcporter：${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(stderr.trim() || `mcporter 退出码 ${code}`));
        return;
      }
      try {
        finish(null, parseMcpJsonOutput(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        finish(error);
      }
    });
  });
}

function runMcpSearch(keyword, range = "24h", options = {}) {
  return runMcpCall(buildSearchArgs(MCP_SERVER, keyword, range), options);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "gameops-xiaohongshu-bridge", mcpServer: MCP_SERVER, mcporter: MCPORTER_BIN });
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }
  const isSearch = request.method === "GET" && url.pathname === "/search";
  const isNote = request.method === "GET" && url.pathname === "/note";
  if (!isSearch && !isNote) {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  if (isNote) {
    const target = parseNoteTarget(url.searchParams.get("url"), { token: url.searchParams.get("xsec_token") });
    if (!target.ok) {
      const mapped = NOTE_TARGET_ERRORS[target.code] || { status: 400, message: "无效的笔记请求。" };
      sendJson(response, mapped.status, { error: target.code, message: mapped.message });
      return;
    }
    const loadAllComments = url.searchParams.get("load_all_comments") === "1" || url.searchParams.get("load_all_comments") === "true";
    let commentLimit;
    if (loadAllComments) {
      const rawLimit = Number(url.searchParams.get("limit"));
      commentLimit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
    }

    if (!noteGate.tryAcquire()) {
      sendJson(response, 429, { error: "note_busy", message: "小红书笔记读取正在进行，请稍后重试。", "Retry-After": 3 });
      return;
    }
    try {
      const payload = await runMcpCall(buildNoteArgs(MCP_SERVER, target.feedId, target.xsecToken, { loadAllComments, commentLimit }));
      sendJson(response, 200, { note: payload });
    } catch (error) {
      sendJson(response, 502, { error: "xiaohongshu_mcp_failed", message: error.message });
    } finally {
      noteGate.release();
    }
    return;
  }

  const keyword = (url.searchParams.get("game") || url.searchParams.get("keyword") || "").trim();
  const range = url.searchParams.get("range") || "24h";
  if (!keyword || keyword.length > 80) {
    sendJson(response, 400, { error: "keyword must be 1-80 characters" });
    return;
  }

  if (!searchGate.tryAcquire()) {
    sendJson(response, 429, { error: "search_busy", message: "小红书搜索正在进行，请稍后重试。", "Retry-After": 3 });
    return;
  }
  try {
    const payload = await runMcpSearch(keyword, range);
    const exactRange = range === "24h" || range === "7d";
    const result = Array.isArray(payload)
      ? { items: payload, providerRangeVerified: exactRange ? range : "" }
      : { ...payload, providerRangeVerified: exactRange ? range : "" };
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 502, { error: "xiaohongshu_mcp_failed", message: error.message });
  } finally {
    searchGate.release();
  }
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Xiaohongshu MCP bridge running at http://127.0.0.1:${PORT}`);
    console.log(`MCP server: ${MCP_SERVER}`);
  });
}

module.exports = {
  buildSearchArgs,
  buildNoteArgs,
  parseMcpJsonOutput,
  runMcpCall,
  runMcpSearch,
  parseNoteTarget,
  NOTE_TARGET_ERRORS,
  mcpPublishTime,
  createSearchGate,
  resolveMcporterBin,
  buildChildEnv
};
