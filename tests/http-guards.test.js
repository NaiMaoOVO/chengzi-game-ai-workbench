const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter, stableSerialize, createSingleFlightCache } = require("../lib/http-guards");

test("rate limiter does not trust forwarded headers unless enabled", () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, trustProxy: false });
  const request = (forwarded) => ({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": forwarded } });
  assert.equal(limiter(request("1.1.1.1")).allowed, true);
  assert.equal(limiter(request("2.2.2.2")).allowed, false);
});

test("single-flight cache shares an in-flight producer and stable serializes keys", async () => {
  assert.equal(stableSerialize({ b: 2, a: 1 }), stableSerialize({ a: 1, b: 2 }));
  const cache = createSingleFlightCache({ ttlMs: 1000, maxEntries: 2 });
  let calls = 0;
  const producer = () => new Promise((resolve) => setTimeout(() => { calls += 1; resolve({ ok: true }); }, 5));
  const [one, two] = await Promise.all([cache.getOrCreate("x", producer), cache.getOrCreate("x", producer)]);
  assert.deepEqual(one, two);
  assert.equal(calls, 1);
});
