const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertSafeProviderUrl,
  normalizeProviderItems,
  fetchPlatformProvider
} = require("../lib/platform-provider");

test("provider URL permits HTTPS and loopback HTTP only", () => {
  assert.doesNotThrow(() => assertSafeProviderUrl("https://provider.example/api/search"));
  assert.doesNotThrow(() => assertSafeProviderUrl("http://127.0.0.1:18060/search"));
  assert.throws(() => assertSafeProviderUrl("http://public.example/search"), /HTTPS/);
  assert.throws(() => assertSafeProviderUrl("file:///tmp/provider.json"), /HTTP/);
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
