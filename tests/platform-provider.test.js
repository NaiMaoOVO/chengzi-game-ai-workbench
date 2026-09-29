const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  assertSafeProviderUrl,
  buildLlmCompletionUrl,
  SUPPORTED_PLATFORMS,
  isSupportedPlatform,
  normalizeProviderItems,
  fetchPlatformProvider,
  rangeStart
} = require("../lib/platform-provider");

test("hotspot platform support is shared with scheduled morning reports", () => {
  assert.deepEqual(SUPPORTED_PLATFORMS, ["B站", "抖音", "小红书", "TapTap", "微博"]);
  for (const platform of SUPPORTED_PLATFORMS) assert.equal(isSupportedPlatform(platform), true);
  assert.equal(isSupportedPlatform("未知平台"), false);
});

test("provider today range starts at Shanghai midnight even on UTC hosts", () => {
  const modulePath = path.resolve(__dirname, "../lib/platform-provider.js");
  const script = `const { rangeStart } = require(${JSON.stringify(modulePath)}); process.stdout.write(String(rangeStart("today", Date.parse("2026-09-17T16:30:00.000Z"))));`;
  const result = spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: "UTC" },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Number(result.stdout.trim()), Date.parse("2026-09-17T16:00:00.000Z"));
  assert.equal(rangeStart("today", Date.parse("2026-09-17T16:30:00.000Z")), Date.parse("2026-09-17T16:00:00.000Z"));
});

test("provider URL permits HTTPS and loopback HTTP only", () => {
  assert.doesNotThrow(() => assertSafeProviderUrl("https://provider.example/api/search"));
  assert.doesNotThrow(() => assertSafeProviderUrl("http://127.0.0.1:18060/search"));
  assert.throws(() => assertSafeProviderUrl("http://public.example/search"), /HTTPS/);
  assert.throws(() => assertSafeProviderUrl("file:///tmp/provider.json"), /HTTP/);
});

test("LLM completion URL appends its path without losing query parameters or accepting fragments and credentials", () => {
  const endpoint = buildLlmCompletionUrl("https://provider.example/v1/?tenant=studio");
  assert.equal(endpoint.pathname, "/v1/chat/completions");
  assert.equal(endpoint.search, "?tenant=studio");
  assert.throws(() => buildLlmCompletionUrl("https://user:password@provider.example/v1"), /账号密码/);
  assert.throws(() => buildLlmCompletionUrl("https://provider.example/v1#ignored"), /片段/);
  assert.throws(() => buildLlmCompletionUrl("http://provider.example/v1"), /HTTPS/);
});

test("generic provider responses normalize to hotspot items", () => {
  const items = normalizeProviderItems({
    feeds: [{
      feed_id: "note-1",
      xsec_token: "token-1",
      noteCard: {
        displayTitle: "鸣潮新版本实机演示",
        user: { nickname: "游戏达人" },
        interactInfo: { likedCount: "678", commentCount: "90" },
        publishTime: "2026-08-22T00:00:00+08:00"
      }
    }]
  }, "小红书", 10);

  assert.equal(items.length, 1);
  assert.equal(items[0].platform, "小红书");
  assert.equal(items[0].source, "real");
  assert.equal(items[0].views, 0);
  assert.match(items[0].url, /note-1/);
  assert.equal(items[0].author, "游戏达人");
});

test("generic provider accepts data as a direct array", () => {
  const items = normalizeProviderItems({
    data: [{ title: "数组结果", publishedAt: "2026-08-22T00:00:00+08:00" }]
  }, "小红书", 10);
  assert.equal(items[0].title, "数组结果");
});

test("malformed provider rows do not discard valid rows from the same response", async () => {
  const result = await fetchPlatformProvider({
    providerUrl: "https://provider.example/search",
    platform: "抖音",
    game: "鸣潮",
    range: "24h",
    limit: 10,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          items: [
            null,
            [],
            { title: "无效时间", publishedAt: 1e30 },
            { title: "有效内容", publishedAt: new Date().toISOString() }
          ]
        };
      }
    })
  });

  assert.deepEqual(result.items.map((item) => item.title), ["有效内容"]);
});

test("provider response bodies are bounded before JSON parsing", async () => {
  const oversizedPayload = JSON.stringify({ items: [], padding: "x".repeat(3 * 1024 * 1024) });

  await assert.rejects(() => fetchPlatformProvider({
    providerUrl: "https://provider.example/search",
    platform: "抖音",
    game: "鸣潮",
    range: "24h",
    limit: 10,
    fetchImpl: async () => new Response(oversizedPayload, { status: 200 })
  }), /平台提供器响应超过大小限制/);
});

test("provider parses valid JSON from a bounded response stream", async () => {
  const result = await fetchPlatformProvider({
    providerUrl: "https://provider.example/search",
    platform: "抖音",
    game: "鸣潮",
    range: "24h",
    limit: 10,
    fetchImpl: async () => new Response(JSON.stringify({
      items: [{ title: "流式响应热点", publishedAt: new Date().toISOString() }]
    }), { status: 200 })
  });

  assert.deepEqual(result.items.map((item) => item.title), ["流式响应热点"]);
});

test("provider results are filtered locally by the requested time range", async () => {
  const now = Date.now();
  const result = await fetchPlatformProvider({
    providerUrl: "https://provider.example/search",
    platform: "抖音",
    game: "鸣潮",
    range: "24h",
    limit: 10,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          items: [
            { title: "今日内容", publishedAt: new Date(now - 60 * 60 * 1000).toISOString(), views: 100 },
            { title: "十天前内容", publishedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(), views: 100000 }
          ]
        };
      }
    })
  });

  assert.deepEqual(result.items.map((item) => item.title), ["今日内容"]);
});

test("an exact provider-side range filter can keep items without timestamps", async () => {
  const result = await fetchPlatformProvider({
    providerUrl: "https://provider.example/search",
    platform: "小红书",
    game: "鸣潮",
    range: "24h",
    limit: 10,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { providerRangeVerified: "24h", items: [{ title: "一天内搜索结果", likes: 20 }] };
      }
    })
  });
  assert.equal(result.items[0].title, "一天内搜索结果");
});
