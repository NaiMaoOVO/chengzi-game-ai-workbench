// OCR 文本与图片启发式：中文数量解析、图片魔数识别。
function parseChineseNumber(rawValue) {
  if (!rawValue) return 0;

  const cleaned = String(rawValue)
    .replace(/,/g, "")
    .replace(/，/g, "")
    .replace(/\s+/g, "")
    .trim();

  // 匹配 "数字 + 可选单位（万/千/w/k）"
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(万|w|W|千|k|K)?/);
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = (match[2] || "").toLowerCase();
  if (unit === "万" || unit === "w") return Math.round(value * 10000);
  if (unit === "千" || unit === "k") return Math.round(value * 1000);
  return Math.round(value);
}

function detectImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { ext: ".jpg", contentType: "image/jpeg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: ".png", contentType: "image/png" };
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")))
    return { ext: ".gif", contentType: "image/gif" };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return { ext: ".heic", contentType: "image/heic" };
    }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return { ext: ".webp", contentType: "image/webp" };
  return null;
}

module.exports = { parseChineseNumber, detectImage };
