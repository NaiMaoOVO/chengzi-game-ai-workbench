// B 站视频标识解析：从任意用户输入中提取 BV 号 / av 号。
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

module.exports = { extractBvid, extractAid };
