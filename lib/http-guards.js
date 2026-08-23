function createRateLimiter({ windowMs, max, trustProxy = false, maxKeys = 5000 }) {
  const entries = new Map();
  let lastSweep = 0;
  function keyFor(request) {
    const socketAddress = request.socket?.remoteAddress || "unknown";
    if (!trustProxy) return socketAddress;
    const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    return forwarded || socketAddress;
  }
  function sweep(now) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
  }
  return function check(request) {
    const now = Date.now();
    sweep(now);
    const key = keyFor(request);
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (entries.size >= maxKeys) entries.delete(entries.keys().next().value);
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= max, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  };
}

function stableSerialize(value) {
  if (Array.isArray(value)) return "[" + value.map(stableSerialize).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableSerialize(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

function createSingleFlightCache({ ttlMs, maxEntries = 200 }) {
  const entries = new Map();
  function prune(now) {
    for (const [key, entry] of entries) if (entry.expiresAt <= now && !entry.promise) entries.delete(key);
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  }
  function get(key) {
    const entry = entries.get(key);
    if (!entry || entry.expiresAt <= Date.now() || entry.promise) return null;
    return entry.payload;
  }
  function hasInFlight(key) {
    const entry = entries.get(key);
    return Boolean(entry?.promise && entry.expiresAt > Date.now());
  }
  function getOrCreate(key, producer) {
    if (ttlMs <= 0) return producer();
    const now = Date.now();
    const existing = entries.get(key);
    if (existing && existing.expiresAt > now) return existing.promise || Promise.resolve(existing.payload);
    prune(now);
    const promise = Promise.resolve().then(producer);
    entries.set(key, { promise, expiresAt: now + ttlMs });
    return promise.then((payload) => {
      entries.set(key, { payload, expiresAt: Date.now() + ttlMs });
      return payload;
    }, (error) => {
      entries.delete(key);
      throw error;
    });
  }
  return { get, getOrCreate, hasInFlight, size: () => entries.size };
}

module.exports = { createRateLimiter, stableSerialize, createSingleFlightCache };
