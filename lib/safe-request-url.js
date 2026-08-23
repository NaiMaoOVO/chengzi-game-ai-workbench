function parseRequestUrl(request) {
  const host = String(request.headers.host || "127.0.0.1").trim();
  if (!host || /[\s\u0000-\u001f\u007f]/.test(host)) return null;
  try {
    const url = new URL(request.url || "/", `http://${host}`);
    if (url.protocol !== "http:") return null;
    return url;
  } catch (_error) {
    return null;
  }
}

module.exports = { parseRequestUrl };
