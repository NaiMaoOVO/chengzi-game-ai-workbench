const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter, stableSerialize, createSingleFlightCache } = require("../lib/http-guards");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("rate limiter does not trust forwarded headers unless enabled", () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, trustProxy: false });
  const request = (forwarded) => ({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": forwarded } });
  assert.equal(limiter(request("1.1.1.1")).allowed, true);
  assert.equal(limiter(request("2.2.2.2")).allowed, false);
});

test("rate limiter trusts the proxy header only when explicitly enabled", () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, trustProxy: true });
  const request = (forwarded) => ({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": forwarded } });
  assert.equal(limiter(request("1.1.1.1")).allowed, true);
  assert.equal(limiter(request("2.2.2.2")).allowed, true);
});

test("rate limiter aggregates excess addresses instead of evicting active counters", () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, maxKeys: 3 });
  const request = (address) => ({ socket: { remoteAddress: address }, headers: {} });
  assert.equal(limiter(request("client-a")).allowed, true);
  assert.equal(limiter(request("client-b")).allowed, true);
  assert.equal(limiter(request("client-c")).allowed, true);
  assert.equal(limiter(request("client-d")).allowed, false, "overflow addresses share a bounded counter");
  assert.equal(limiter(request("client-a")).allowed, false, "key churn must not reset an active address window");
  assert.equal(limiter(request("client-b")).allowed, false, "older active counters remain in force");
});

test("rate limiter rejects invalid bounds instead of silently allowing requests", () => {
  assert.throws(() => createRateLimiter({ windowMs: Number.NaN, max: 1 }), /windowMs/);
  assert.throws(() => createRateLimiter({ windowMs: 60000, max: Number.NaN }), /max/);
  assert.throws(() => createRateLimiter({ windowMs: 0, max: 1 }), /windowMs/);
  assert.throws(() => createRateLimiter({ windowMs: 60000, max: 1, maxKeys: 0 }), /maxKeys/);
});

test("single-flight cache rejects invalid TTL and capacity instead of caching entries forever", () => {
  assert.throws(() => createSingleFlightCache({ ttlMs: Number.NaN }), /ttlMs/);
  assert.throws(() => createSingleFlightCache({ ttlMs: Infinity }), /ttlMs/);
  assert.throws(() => createSingleFlightCache({ ttlMs: 1000, maxEntries: Number.NaN }), /maxEntries/);
  assert.throws(() => createSingleFlightCache({ ttlMs: 1000, maxEntries: 0 }), /maxEntries/);
  assert.doesNotThrow(() => createSingleFlightCache({ ttlMs: 0 }));
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

test("single-flight cache does not reinsert an in-flight result after capacity eviction", async () => {
  const cache = createSingleFlightCache({ ttlMs: 1000, maxEntries: 1 });
  const pending = deferred();
  const first = cache.getOrCreate("first", () => pending.promise);
  await Promise.resolve();
  assert.equal(await cache.getOrCreate("second", () => Promise.resolve("second")), "second");

  pending.resolve("first");
  assert.equal(await first, "first");
  assert.equal(cache.size(), 1);
  assert.equal(cache.get("second"), "second");
});

test("an evicted single-flight result cannot overwrite a newer request for the same key", async () => {
  const cache = createSingleFlightCache({ ttlMs: 1000, maxEntries: 1 });
  const oldResult = deferred();
  const newResult = deferred();
  const oldRequest = cache.getOrCreate("same", () => oldResult.promise);
  await Promise.resolve();
  await cache.getOrCreate("evictor", () => Promise.resolve("evictor"));
  let newProducerCalls = 0;
  const newRequest = cache.getOrCreate("same", () => {
    newProducerCalls += 1;
    return newResult.promise;
  });

  oldResult.resolve("stale");
  assert.equal(await oldRequest, "stale");
  assert.equal(cache.hasInFlight("same"), true);
  const joinedRequest = cache.getOrCreate("same", () => Promise.reject(new Error("duplicate producer")));
  newResult.resolve("fresh");
  assert.equal(await newRequest, "fresh");
  assert.equal(await joinedRequest, "fresh");
  assert.equal(newProducerCalls, 1);
});

test("an evicted single-flight failure cannot delete a newer request for the same key", async () => {
  const cache = createSingleFlightCache({ ttlMs: 1000, maxEntries: 1 });
  const oldResult = deferred();
  const newResult = deferred();
  const oldRequest = cache.getOrCreate("same", () => oldResult.promise);
  await Promise.resolve();
  await cache.getOrCreate("evictor", () => Promise.resolve("evictor"));
  const newRequest = cache.getOrCreate("same", () => newResult.promise);

  oldResult.reject(new Error("old failure"));
  await assert.rejects(oldRequest, /old failure/);
  assert.equal(cache.hasInFlight("same"), true);
  newResult.resolve("fresh");
  assert.equal(await newRequest, "fresh");
  assert.equal(cache.get("same"), "fresh");
});
