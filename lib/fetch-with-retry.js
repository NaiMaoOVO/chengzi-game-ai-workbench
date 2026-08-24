// 上游请求重试：对 429/5xx 退避重试，优先遵循 Retry-After（上限 30 秒），受全局重试预算约束。
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFetchWithRetry({ retries = 0, timeoutMs = 8000, retryBudget = null, sleep = defaultSleep, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((url, options) => fetch(url, options));
  return async function fetchWithRetry(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await doFetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
        if (response.status !== 429 && response.status < 500) return response;
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          lastError = new Error(`HTTP ${response.status}`);
          lastError.retryAfterSeconds = Math.min(retryAfterSeconds, 30);
        } else {
          lastError = new Error(`HTTP ${response.status}`);
        }
        await response.body?.cancel();
      } catch (error) {
        lastError = error.name === "TimeoutError" ? new Error("上游请求超时") : error;
      }
      if (attempt >= retries) break;
      if (retryBudget && !retryBudget.trySpend()) break;
      await sleep(lastError.retryAfterSeconds ? lastError.retryAfterSeconds * 1000 : Math.min(5000, 200 * (2 ** attempt)));
    }
    throw lastError;
  };
}

module.exports = { createFetchWithRetry };
