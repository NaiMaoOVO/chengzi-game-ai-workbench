function getRestartDelay(attempt) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  return Math.min(10000, 500 * (2 ** (safeAttempt - 1)));
}

function getChildProcessExitCode(code, signal) {
  if (Number.isInteger(code)) return code;
  return signal ? 1 : 0;
}

module.exports = { getChildProcessExitCode, getRestartDelay };
