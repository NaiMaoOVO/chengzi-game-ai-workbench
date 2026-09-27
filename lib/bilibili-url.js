// B 站视频标识解析：从任意用户输入中提取 BV 号 / av 号。
const DEFAULT_VIDEO_INFO_URL = "https://api.bilibili.com/x/web-interface/view";

function assertSafeVideoInfoUrl(value, { production = false } = {}) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_VIDEO_INFO_URL));
  } catch (_error) {
    throw new Error("BILIBILI_VIDEO_INFO_URL 必须是有效的 HTTP(S) URL");
  }

  if (url.username || url.password) {
    throw new Error("BILIBILI_VIDEO_INFO_URL 不得包含账号密码");
  }
  if (url.search || url.hash) {
    throw new Error("BILIBILI_VIDEO_INFO_URL 不得包含查询参数或片段");
  }

  if (production) {
    if (url.origin !== "https://api.bilibili.com") {
      throw new Error("线上 BILIBILI_VIDEO_INFO_URL 必须使用 https://api.bilibili.com，避免将 BILIBILI_COOKIE 发往其他主机");
    }
  } else {
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error("BILIBILI_VIDEO_INFO_URL 必须使用 HTTPS；本地开发可使用 loopback HTTP");
    }
  }

  return url.href.replace(/\/$/, "");
}

function extractBvid(input) {
  const value = String(input || "").trim();
  const match = value.match(/BV[a-zA-Z0-9]{10}/i);
  return match ? match[0].replace(/^bv/i, "BV") : "";
}

function extractAid(input) {
  const value = String(input || "").trim();
  const queryMatch = value.match(/(?:^|[?&])aid=(\d+)/i);
  if (queryMatch) return queryMatch[1];

  const avMatch = value.match(/(?:^|[/?&=\s])av(\d+)\b/i);
  if (avMatch) return avMatch[1];

  return "";
}

module.exports = { DEFAULT_VIDEO_INFO_URL, assertSafeVideoInfoUrl, extractBvid, extractAid };
