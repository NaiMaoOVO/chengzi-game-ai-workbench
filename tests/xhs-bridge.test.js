const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const projectRoot = path.resolve(__dirname, "..");

const {
  buildSearchArgs,
  parseMcpJsonOutput,
  createSearchGate,
  resolveMcporterBin,
  runMcpSearch,
  buildChildEnv,
  publicMcpError
} = require("../xiaohongshu-bridge");

test("bridge builds a fixed read-only MCP search command", () => {
  assert.deepEqual(buildSearchArgs("xiaohongshu", "鸣潮", "24h"), [
    "call",
    "xiaohongshu.search_feeds",
    "--args",
    JSON.stringify({ keyword: "鸣潮", filters: { publish_time: "一天内" } }),
    "--output",
    "json",
    "--timeout",
    "120000"
  ]);
});

test("bridge maps the workbench range to the MCP publish_time filter", () => {
  const args = JSON.parse(buildSearchArgs("xiaohongshu", "鸣潮", "7d")[3]);
  assert.equal(args.filters.publish_time, "一周内");
});

test("bridge maps MCP failures to useful public messages without echoing provider details", () => {
  const token = "fake-xsec-token-never-return-this";
  const timeout = new Error(`timeout ${token}`);
  timeout.code = "MCP_TIMEOUT";
  assert.match(publicMcpError(timeout), /超时/);

  const auth = new Error(`login expired ${token}`);
  assert.match(publicMcpError(auth), /登录态/);

  const unknown = new Error(`internal provider detail ${token}`);
  const publicMessage = publicMcpError(unknown);
  assert.match(publicMessage, /检查登录态与 mcporter/);
  assert.equal(publicMessage.includes(token), false);
});

test("bridge parses JSON and fenced JSON from mcporter output", () => {
  assert.deepEqual(parseMcpJsonOutput('{"items":[{"title":"测试"}]}'), { items: [{ title: "测试" }] });
  assert.deepEqual(parseMcpJsonOutput("```json\n{\"items\":[]}\n```"), { items: [] });
  assert.deepEqual(parseMcpJsonOutput(JSON.stringify({ content: [{ type: "text", text: '{"items":[]}' }] })), { items: [] });
  assert.deepEqual(parseMcpJsonOutput(JSON.stringify({ structuredContent: { items: [] } })), { items: [] });
  assert.throws(
    () => parseMcpJsonOutput(JSON.stringify({ isError: true, content: [{ type: "text", text: "登录失效" }] })),
    /登录失效/
  );
});

test("bridge search gate rejects concurrent searches and releases after completion", async () => {
  const gate = createSearchGate();
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), false);
  gate.release();
  assert.equal(gate.tryAcquire(), true);
});

test("bridge resolves mcporter from the npm global directory when PATH is minimal", () => {
  const resolved = resolveMcporterBin("mcporter", {
    pathValue: "/usr/bin:/bin",
    homeDir: "/Users/demo",
    exists: (value) => value === "/Users/demo/.npm-global/bin/mcporter"
  });
  assert.equal(resolved, "/Users/demo/.npm-global/bin/mcporter");
});

// 回归锁：GUI 启动链 PATH 没有 node 时，mcporter 的 shebang 会直接失败。
test("bridge spawn env prepends the running node bin dir to PATH without duplicating it", () => {
  const nodeBinDir = path.dirname(process.execPath);
  const minimal = buildChildEnv({ PATH: "/usr/bin:/bin", HOME: "/Users/demo" });
  assert.equal(minimal.PATH.split(path.delimiter)[0], nodeBinDir);

  const alreadyListed = buildChildEnv({ PATH: `${nodeBinDir}${path.delimiter}/usr/bin` });
  assert.equal(alreadyListed.PATH.split(path.delimiter).filter((entry) => entry === nodeBinDir).length, 1);
});

test("bridge kills a hung mcporter process after its own timeout", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit("close", null); };

  await assert.rejects(
    runMcpSearch("鸣潮", "24h", { spawnImpl: () => child, timeoutMs: 5 }),
    /超时/
  );
  assert.equal(child.killed, true);
});

test("bridge does not return mcporter stderr that echoes a signed note token", async () => {
  const token = "fake-xsec-token-never-return-this";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-xhs-bridge-"));
  const fakeMcporter = path.join(tempDir, "mcporter");
  fs.writeFileSync(fakeMcporter, "#!/usr/bin/env node\nprocess.stderr.write(process.argv.join(' '));\nprocess.exit(1);\n");
  fs.chmodSync(fakeMcporter, 0o700);

  const portServer = net.createServer();
  await new Promise((resolve, reject) => {
    portServer.once("error", reject);
    portServer.listen(0, "127.0.0.1", resolve);
  });
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));

  const bridge = spawn(process.execPath, [path.join(projectRoot, "xiaohongshu-bridge.js")], {
    cwd: projectRoot,
    env: { ...process.env, XHS_BRIDGE_PORT: String(port), MCPORTER_BIN: fakeMcporter },
    stdio: ["ignore", "ignore", "ignore"]
  });

  try {
    const deadline = Date.now() + 5000;
    let response;
    while (Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
      } catch (_error) { /* wait for the bridge to listen */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(response?.ok, "bridge should start for the integration test");

    const noteUrl = new URL("https://www.xiaohongshu.com/explore/0123456789abcdef01234567");
    noteUrl.searchParams.set("xsec_token", token);
    const result = await fetch(`http://127.0.0.1:${port}/note?url=${encodeURIComponent(noteUrl.toString())}`);
    const body = await result.text();
    assert.equal(result.status, 502);
    assert.equal(body.includes(token), false);
    assert.match(body, /小红书.*失败|检查.*登录态/);
  } finally {
    bridge.kill("SIGTERM");
    await new Promise((resolve) => bridge.once("exit", resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
