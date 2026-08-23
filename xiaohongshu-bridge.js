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

function runMcpSearch(keyword, range = "24h", options = {}) {
  return new Promise((resolve, reject) => {
    const spawnImpl = options.spawnImpl || spawn;
    const timeoutMs = options.timeoutMs || BRIDGE_TIMEOUT_MS;
    const child = spawnImpl(MCPORTER_BIN, buildSearchArgs(MCP_SERVER, keyword, range), {
      cwd: __dirname,
      env: process.env,
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
      finish(new Error(`xiaohongshu-mcp 搜索超时（${timeoutMs}ms）`));
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
  if (request.method !== "GET" || url.pathname !== "/search") {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  const keyword = (url.searchParams.get("game") || url.searchParams.get("keyword") || "").trim();
  const range = url.searchParams.get("range") || "24h";
  if (!keyword || keyword.length > 80) {
    sendJson(response, 400, { error: "keyword must be 1-80 characters" });
    return;
  }

  try {
    if (!searchGate.tryAcquire()) {
      sendJson(response, 429, { error: "search_busy", message: "小红书搜索正在进行，请稍后重试。" , "Retry-After": 3 });
      return;
    }
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

module.exports = { buildSearchArgs, parseMcpJsonOutput, runMcpSearch, mcpPublishTime, createSearchGate, resolveMcporterBin };
