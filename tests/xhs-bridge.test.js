const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const path = require("node:path");

const {
  buildSearchArgs,
  parseMcpJsonOutput,
  createSearchGate,
  resolveMcporterBin,
  runMcpSearch,
  buildChildEnv
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
