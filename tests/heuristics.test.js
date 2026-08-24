const test = require("node:test");
const assert = require("node:assert/strict");
const { parseChineseNumber, detectImage } = require("../lib/ocr-heuristics");
const { extractBvid, extractAid } = require("../lib/bilibili-url");
const { createFetchWithRetry } = require("../lib/fetch-with-retry");
const { createRetryBudget } = require("../lib/http-guards");

test("parseChineseNumber handles CJK magnitudes, w/k suffixes, separators and plain numbers", () => {
  assert.equal(parseChineseNumber("1.2万"), 12000);
  assert.equal(parseChineseNumber("80w"), 800000);
  assert.equal(parseChineseNumber("80W"), 800000);
  assert.equal(parseChineseNumber("5千"), 5000);
  assert.equal(parseChineseNumber("2k"), 2000);
  assert.equal(parseChineseNumber("2K"), 2000);
  assert.equal(parseChineseNumber("3,456"), 3456);
  assert.equal(parseChineseNumber("12，345"), 12345);
  assert.equal(parseChineseNumber("12345"), 12345);
  assert.equal(parseChineseNumber("播放 1.2万"), 12000);
  assert.equal(parseChineseNumber("0.5千"), 500);
  assert.equal(parseChineseNumber(""), 0);
  assert.equal(parseChineseNumber("无数字文本"), 0);
});

test("detectImage recognizes jpg/png/gif/webp/heic magic bytes", () => {
  assert.deepEqual(
    detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
    { ext: ".jpg", contentType: "image/jpeg" }
  );
  assert.deepEqual(
    detectImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])),
    { ext: ".png", contentType: "image/png" }
  );
  assert.deepEqual(detectImage(Buffer.from("GIF89aabcd", "ascii")), { ext: ".gif", contentType: "image/gif" });
  assert.deepEqual(detectImage(Buffer.from("GIF87aabcd", "ascii")), { ext: ".gif", contentType: "image/gif" });

  const webp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.alloc(4, 0x00),
    Buffer.from("WEBP", "ascii"),
    Buffer.from("VP8 ", "ascii")
  ]);
  assert.deepEqual(detectImage(webp), { ext: ".webp", contentType: "image/webp" });

  const heic = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypheic", "ascii")]);
  assert.deepEqual(detectImage(heic), { ext: ".heic", contentType: "image/heic" });
  const heif = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypmif1", "ascii")]);
  assert.deepEqual(detectImage(heif), { ext: ".heic", contentType: "image/heic" });
});

test("detectImage rejects truncated signatures and garbage bytes", () => {
  assert.equal(detectImage(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectImage(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(detectImage(Buffer.from("GIF89", "ascii")), null);
  assert.equal(detectImage(Buffer.from("just some plain text bytes")), null);
  assert.equal(detectImage(Buffer.alloc(0)), null);
});

test("extractBvid handles standard urls, b23.tv short links, bare ids and case normalization", () => {
  assert.equal(extractBvid("https://www.bilibili.com/video/BV1GJ411x7h7?p=1&t=2"), "BV1GJ411x7h7");
  assert.equal(extractBvid("https://www.bilibili.com/video/BV1GJ411x7h7/"), "BV1GJ411x7h7");
  assert.equal(extractBvid("https://b23.tv/BV1GJ411x7h7"), "BV1GJ411x7h7");
  assert.equal(extractBvid("BV1GJ411x7h7"), "BV1GJ411x7h7");
  assert.equal(extractBvid("看这个 BV1GJ411x7h7 太顶了"), "BV1GJ411x7h7");
  assert.equal(extractBvid("https://www.bilibili.com/video/bv1GJ411x7h7"), "BV1GJ411x7h7");
  assert.equal(extractBvid("https://www.bilibili.com/video/av170001"), "");
  assert.equal(extractBvid(""), "");
});

test("extractAid handles av links, aid query params and rejects lookalikes", () => {
  assert.equal(extractAid("https://www.bilibili.com/video/av170001"), "170001");
  assert.equal(extractAid("av170001"), "170001");
  assert.equal(extractAid("https://b23.tv/av170001"), "170001");
  assert.equal(extractAid("https://www.bilibili.com/video/av170001?spm_id_from=x"), "170001");
  assert.equal(extractAid("https://api.bilibili.com/x/web-interface/view?aid=998877"), "998877");
  assert.equal(extractAid("?aid=998877&foo=1"), "998877");
  assert.equal(extractAid("AV170001"), "170001");
  assert.equal(extractAid("jav170001"), "");
  assert.equal(extractAid("170001"), "");
  assert.equal(extractAid(""), "");
});

function stubResponse(status, headers = {}) {
  return {
    status,
    headers: {
      get: (name) => {
        const key = name.toLowerCase();
        return Object.prototype.hasOwnProperty.call(headers, key) ? headers[key] : null;
      }
    },
    body: { cancel: async () => {} }
  };
}

function stubFetch(script) {
  const queue = [...script];
  const seen = [];
  const impl = (url, options) => {
    seen.push({ url, options });
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    if (next && typeof next === "object") return Promise.resolve(stubResponse(next.status, next.headers));
    return Promise.resolve(stubResponse(next));
  };
  impl.seen = seen;
  return impl;
}

const LONG_REFILL = { refillIntervalMs: 3600000 };

async function recordSleep(sleeps) {
  return async (ms) => sleeps.push(ms);
}

test("createFetchWithRetry retries 5xx with 200/400/800ms exponential backoff", async () => {
  const fetchImpl = stubFetch([500, 500, 500, 201]);
  const sleeps = [];
  const fetchWithRetry = createFetchWithRetry({
    retries: 3,
    timeoutMs: 1000,
    retryBudget: createRetryBudget({ capacity: 10, ...LONG_REFILL }),
    sleep: await recordSleep(sleeps),
    fetchImpl
  });
  const response = await fetchWithRetry("https://upstream.example/api");
  assert.equal(response.status, 201);
  assert.equal(fetchImpl.seen.length, 4);
  assert.deepEqual(sleeps, [200, 400, 800]);
});

test("createFetchWithRetry honors 429 Retry-After and caps it at 30 seconds", async () => {
  const fetchImpl = stubFetch([{ status: 429, headers: { "retry-after": "3" } }, 204]);
  const sleeps = [];
  const fetchWithRetry = createFetchWithRetry({
    retries: 2,
    timeoutMs: 1000,
    retryBudget: createRetryBudget({ capacity: 10, ...LONG_REFILL }),
    sleep: await recordSleep(sleeps),
    fetchImpl
  });
  const response = await fetchWithRetry("https://upstream.example/api");
  assert.equal(response.status, 204);
  assert.deepEqual(sleeps, [3000]);

  const cappedFetch = stubFetch([{ status: 429, headers: { "retry-after": "120" } }, { status: 429, headers: { "retry-after": "120" } }]);
  const cappedSleeps = [];
  const retryCapped = createFetchWithRetry({
    retries: 1,
    timeoutMs: 1000,
    retryBudget: createRetryBudget({ capacity: 10, ...LONG_REFILL }),
    sleep: await recordSleep(cappedSleeps),
    fetchImpl: cappedFetch
  });
  await assert.rejects(retryCapped("https://upstream.example/api"), /HTTP 429/);
  assert.deepEqual(cappedSleeps, [30000]);
});

test("createFetchWithRetry stops early once the retry budget is spent", async () => {
  const fetchImpl = stubFetch([500, 500, 500]);
  const sleeps = [];
  const fetchWithRetry = createFetchWithRetry({
    retries: 5,
    timeoutMs: 1000,
    retryBudget: createRetryBudget({ capacity: 1, ...LONG_REFILL }),
    sleep: await recordSleep(sleeps),
    fetchImpl
  });
  await assert.rejects(fetchWithRetry("https://upstream.example/api"), /HTTP 500/);
  assert.equal(fetchImpl.seen.length, 2);
  assert.deepEqual(sleeps, [200]);
});

test("createFetchWithRetry maps upstream TimeoutError to a friendly message", async () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  const fetchWithRetry = createFetchWithRetry({
    retries: 0,
    timeoutMs: 50,
    sleep: async () => {},
    fetchImpl: stubFetch([timeout])
  });
  await assert.rejects(fetchWithRetry("https://upstream.example/api"), /上游请求超时/);
});

test("createFetchWithRetry returns non-retryable responses immediately with abort signal wired", async () => {
  const fetchImpl = stubFetch([404]);
  const fetchWithRetry = createFetchWithRetry({
    retries: 3,
    timeoutMs: 25,
    retryBudget: createRetryBudget({ capacity: 5, ...LONG_REFILL }),
    sleep: async () => {},
    fetchImpl
  });
  const response = await fetchWithRetry("https://upstream.example/api", { headers: { Accept: "application/json" } });
  assert.equal(response.status, 404);
  assert.equal(fetchImpl.seen.length, 1);
  assert.ok(fetchImpl.seen[0].options.signal instanceof AbortSignal);
  assert.equal(fetchImpl.seen[0].options.headers.Accept, "application/json");
});
