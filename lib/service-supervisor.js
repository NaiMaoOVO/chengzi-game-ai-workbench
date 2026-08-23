function getRestartDelay(attempt) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  return Math.min(10000, 500 * (2 ** (safeAttempt - 1)));
}

module.exports = { getRestartDelay };
