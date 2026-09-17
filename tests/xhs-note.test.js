const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  buildNoteArgs,
  parseNoteTarget,
  NOTE_TARGET_ERRORS,
  runMcpCall,
  createSearchGate,
  parseXhsCount,
  extractNoteStats,
  isNoteDetailRoute
} = require("../xiaohongshu-bridge");

const NOTE_ID = "67a1b2c3d4e5f607182934b5c6d7e8f9";
const SHORT_NOTE_ID = "6a8c2d170000000012012625";
const TOKEN = "ABcd1234efgh5678IJkl9012MNop3456QRst7890";

function exploreUrl(id, token) {
  return "https://www.xiaohongshu.com/explore/" + id + "?xsec_token=" + token + "&xsec_source=pc_search";
}

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

test("note parser extracts id and token from a real explore URL", () => {
  const target = parseNoteTarget(exploreUrl(NOTE_ID, TOKEN));
  assert.deepEqual(target, { ok: true, feedId: NOTE_ID, xsecToken: TOKEN, source: "url" });
});

test("note parser accepts discovery and profile note paths", () => {
  const discovery = parseNoteTarget("https://xiaohongshu.com/discovery/item/" + NOTE_ID + "?xsec_token=" + TOKEN);
  assert.equal(discovery.ok, true);
  assert.equal(discovery.feedId, NOTE_ID);

  const profile = parseNoteTarget(
    "https://www.xiaohongshu.com/user/profile/64a1b2c3d4e5f607182934b5c6d7e8f9/" + NOTE_ID + "?xsec_token=" + TOKEN
  );
  assert.equal(profile.ok, true);
  assert.equal(profile.feedId, NOTE_ID);
});

test("note parser normalizes uppercase ids and trims surrounding spaces", () => {
  const upper = "67A1B2C3D4E5F607182934B5C6D7E8F9";
  const target = parseNoteTarget("  " + exploreUrl(upper, TOKEN) + "  ");
  assert.equal(target.ok, true);
  assert.equal(target.feedId, upper.toLowerCase());
});

test("note parser accepts real-world 24-char note ids", () => {
  const fromUrl = parseNoteTarget(exploreUrl(SHORT_NOTE_ID, TOKEN));
  assert.equal(fromUrl.ok, true);
  assert.equal(fromUrl.feedId, SHORT_NOTE_ID);
  const bare = parseNoteTarget(SHORT_NOTE_ID, { token: TOKEN });
  assert.equal(bare.ok, true);
  assert.equal(bare.feedId, SHORT_NOTE_ID);
});

test("note parser accepts a bare 32-hex id with an explicit token", () => {
  const target = parseNoteTarget(NOTE_ID, { token: TOKEN });
  assert.deepEqual(target, { ok: true, feedId: NOTE_ID, xsecToken: TOKEN, source: "id" });
});

test("note parser rejects a bare id without a token", () => {
  assert.deepEqual(parseNoteTarget(NOTE_ID), { ok: false, code: "xsec_token_required" });
});

test("note parser rejects xhslink short links with an explanatory code", () => {
  assert.deepEqual(parseNoteTarget("https://xhslink.com/a/AbCdEf"), { ok: false, code: "xhslink_unsupported" });
});

test("note parser rejects explore URLs missing the token when none is supplied", () => {
  const target = parseNoteTarget("https://www.xiaohongshu.com/explore/" + NOTE_ID + "?xsec_source=pc_search");
  assert.deepEqual(target, { ok: false, code: "xsec_token_required" });
});

test("note parser lets an explicit token satisfy a token-less URL", () => {
  const target = parseNoteTarget("https://www.xiaohongshu.com/explore/" + NOTE_ID, { token: TOKEN });
  assert.deepEqual(target, { ok: true, feedId: NOTE_ID, xsecToken: TOKEN, source: "url" });
});

test("note parser rejects foreign hosts, malformed urls, and unknown paths", () => {
  assert.deepEqual(parseNoteTarget("https://example.com/explore/" + NOTE_ID), { ok: false, code: "unsupported_host" });
  assert.deepEqual(parseNoteTarget("not-a-url"), { ok: false, code: "invalid_note_url" });
  assert.deepEqual(parseNoteTarget("https://www.xiaohongshu.com/explore/12345"), { ok: false, code: "note_id_not_found" });
  assert.deepEqual(parseNoteTarget("https://www.xiaohongshu.com/explore/"), { ok: false, code: "note_id_not_found" });
  assert.deepEqual(parseNoteTarget(""), { ok: false, code: "note_url_required" });
  assert.deepEqual(parseNoteTarget(null), { ok: false, code: "note_url_required" });
});

test("every parser failure code maps to a 400 response message", () => {
  for (const code of Object.keys(NOTE_TARGET_ERRORS)) {
    const mapped = NOTE_TARGET_ERRORS[code];
    assert.equal(mapped.status, 400, code + " 应映射为 400");
    assert.equal(typeof mapped.message, "string");
    assert.ok(mapped.message.length > 0);
  }
});

test("buildNoteArgs targets the read-only get_feed_detail tool with default arguments", () => {
  assert.deepEqual(buildNoteArgs("xiaohongshu", NOTE_ID, TOKEN), [
    "call",
    "xiaohongshu.get_feed_detail",
    "--args",
    JSON.stringify({ feed_id: NOTE_ID, xsec_token: TOKEN, load_all_comments: false }),
    "--output",
    "json",
    "--timeout",
    "120000"
  ]);
});

test("buildNoteArgs forwards comment paging options and clamps the limit", () => {
  const args = (options) => JSON.parse(buildNoteArgs("xiaohongshu", NOTE_ID, TOKEN, options)[3]);

  assert.deepEqual(args({ loadAllComments: true }), { feed_id: NOTE_ID, xsec_token: TOKEN, load_all_comments: true });
  assert.deepEqual(args({ loadAllComments: true, commentLimit: 5 }), { feed_id: NOTE_ID, xsec_token: TOKEN, load_all_comments: true, limit: 5 });
  assert.equal(args({ loadAllComments: true, commentLimit: 999 }).limit, 200);
  assert.equal("limit" in args({ loadAllComments: false, commentLimit: 5 }), false);
});

test("runMcpCall spawns mcporter with the provided argv and unwraps mcp content", async () => {
  const seen = {};
  const child = createFakeChild();
  const spawnImpl = (bin, argv) => {
    seen.bin = bin;
    seen.argv = argv;
    return child;
  };

  const pending = runMcpCall(buildNoteArgs("xiaohongshu", NOTE_ID, TOKEN, { loadAllComments: true, commentLimit: 30 }), {
    spawnImpl,
    timeoutMs: 5000
  });
  await Promise.resolve();
  const inner = JSON.stringify({ title: "测试笔记", comments: [{ content: "很好玩" }] });
  child.stdout.write(JSON.stringify({ content: [{ type: "text", text: inner }] }));
  child.emit("close", 0);

  const payload = await pending;
  assert.deepEqual(payload, { title: "测试笔记", comments: [{ content: "很好玩" }] });
  assert.ok(String(seen.argv[1]).endsWith(".get_feed_detail"));
  assert.deepEqual(JSON.parse(seen.argv[3]), {
    feed_id: NOTE_ID,
    xsec_token: TOKEN,
    load_all_comments: true,
    limit: 30
  });
});

test("runMcpCall surfaces mcp isError text as a rejection", async () => {
  const child = createFakeChild();
  const pending = runMcpCall(["call", "xiaohongshu.get_feed_detail"], { spawnImpl: () => child, timeoutMs: 5000 });
  await Promise.resolve();
  child.stdout.write(JSON.stringify({ isError: true, content: [{ type: "text", text: "登录已失效" }] }));
  child.emit("close", 0);
  await assert.rejects(pending, /登录已失效/);
});

test("runMcpCall prefers stderr output when mcporter exits non-zero", async () => {
  const child = createFakeChild();
  const pending = runMcpCall(["call", "xiaohongshu.get_feed_detail"], { spawnImpl: () => child, timeoutMs: 5000 });
  await Promise.resolve();
  child.stderr.write("mcporter boom\n");
  child.emit("close", 1);
  await assert.rejects(pending, /mcporter boom/);
});

test("runMcpCall kills hung children and names the tool in the timeout error", async () => {
  const child = createFakeChild();
  const pending = runMcpCall(["call", "xiaohongshu.get_feed_detail"], { spawnImpl: () => child, timeoutMs: 20 });
  await assert.rejects(pending, /get_feed_detail 超时/);
  assert.equal(child.killed, true);
});

test("runMcpCall kills the child and errors once output exceeds the cap", async () => {
  const child = createFakeChild();
  const pending = runMcpCall(["call", "xiaohongshu.get_feed_detail"], { spawnImpl: () => child, timeoutMs: 5000 });
  await Promise.resolve();
  child.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
  await assert.rejects(pending, /输出过大/);
  assert.equal(child.killed, true);
});

test("search and note gates are independent single-flight slots", () => {
  const gate = createSearchGate();
  const other = createSearchGate();
  assert.equal(gate.tryAcquire(), true);
  assert.equal(other.tryAcquire(), true, "另一把锁不应被搜索占用");
  assert.equal(gate.tryAcquire(), false);
  gate.release();
  other.release();
  assert.equal(gate.tryAcquire(), true);
});

test("note stats uses the same detail route as a note request", () => {
  assert.equal(isNoteDetailRoute("GET", "/note"), true);
  assert.equal(isNoteDetailRoute("GET", "/note-stats"), true, "发布台账回流必须读取笔记详情");
  assert.equal(isNoteDetailRoute("GET", "/search"), false);
  assert.equal(isNoteDetailRoute("POST", "/note-stats"), false);
});

// /note-stats 的数值化解析：展示串「1.2万」「3,456」必须落到台账可存的整数。
test("parseXhsCount normalizes display counts to integers", () => {
  assert.equal(parseXhsCount("1.2万"), 12000);
  assert.equal(parseXhsCount("3,456"), 3456);
  assert.equal(parseXhsCount("28"), 28);
  assert.equal(parseXhsCount("2.35亿"), 235000000);
  assert.equal(parseXhsCount(""), 0);
  assert.equal(parseXhsCount(null), 0);
  assert.equal(parseXhsCount("赞"), 0);
  assert.equal(parseXhsCount("-5"), 0);
});

test("extractNoteStats reads interactInfo from both payload wrappings", () => {
  const wrapped = {
    feed_id: "6a8cfff3000000001700011f",
    data: {
      note: {
        title: "测试笔记",
        interactInfo: { likedCount: "1.2万", collectedCount: "3,456", commentCount: "28", shareCount: "12" }
      }
    }
  };
  const fromWrapped = extractNoteStats(wrapped);
  assert.deepEqual(fromWrapped, { title: "测试笔记", stats: { likes: 12000, collects: 3456, comments: 28, shares: 12 } });

  const flat = { note: { displayTitle: "备用形态", interactInfo: { likedCount: "8" } } };
  const fromFlat = extractNoteStats(flat);
  assert.deepEqual(fromFlat.stats, { likes: 8, collects: 0, comments: 0, shares: 0 });
  assert.equal(fromFlat.title, "备用形态");

  assert.equal(extractNoteStats(null), null);
  assert.equal(extractNoteStats({ data: {} }), null);
  const bare = extractNoteStats({ note: { title: "无互动字段" } });
  assert.deepEqual(bare.stats, { likes: 0, collects: 0, comments: 0, shares: 0 });
});
