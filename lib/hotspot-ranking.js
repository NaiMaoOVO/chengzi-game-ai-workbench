function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeTimestamp(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed > 100000000000 ? Math.floor(parsed / 1000) : parsed;
}

function calculateHeatScore(item) {
  const views = toNumber(item.play ?? item.views);
  const danmaku = toNumber(item.video_review ?? item.danmaku);
  const favorites = toNumber(item.favorites);
  const pubdate = normalizeTimestamp(item.pubdate || item.publishedAt);
  const ageHours = pubdate ? Math.max((Date.now() / 1000 - pubdate) / 3600, 1) : 24;
  const freshness = Math.max(0.35, Math.min(1.2, 24 / ageHours));

  const danmakuValue = Math.min(danmaku * 8, Math.max(40, views * 0.35));
  const favoriteValue = Math.min(favorites * 12, Math.max(24, views * 0.25));
  const abnormalEngagement = views < 300 && (danmaku + favorites) > Math.max(20, views * 0.35);
  const trust = abnormalEngagement ? Math.max(0.2, views / 300) : 1;

  return Math.round((views + danmakuValue + favoriteValue) * freshness * trust);
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function promotionalCategory(title) {
  if (/(?:口令|兑换|礼包|福利|激活)码/.test(title)) return "code";
  if (/(?:代练|代肝|接单|价格表|托管|陪玩|买号|卖号|租号)/.test(title)) return "trade";
  return "";
}

function bigrams(value) {
  const result = new Set();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function titleSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return 0;
  let intersection = 0;
  leftBigrams.forEach((value) => {
    if (rightBigrams.has(value)) intersection += 1;
  });
  return intersection / Math.min(leftBigrams.size, rightBigrams.size);
}

function rankingScore(item) {
  const heat = toNumber(item.heat);
  const views = toNumber(item.views ?? item.play);
  const lowViewTrust = views > 0 && views < 300 ? Math.max(0.2, views / 300) : 1;
  return heat * lowViewTrust + views * 0.05;
}

function rankHotspots(items, limit = 10) {
  const selected = [];
  const seenPromotions = new Set();
  const seenTitles = [];

  const sorted = [...items].sort((left, right) => {
    return (rankingScore(right) - rankingScore(left))
      || (toNumber(right.heat) - toNumber(left.heat));
  });

  for (const item of sorted) {
    const title = normalizeTitle(item.title);
    const category = promotionalCategory(title);
    if (category && seenPromotions.has(category)) continue;
    if (seenTitles.some((existing) => titleSimilarity(title, existing) >= 0.72)) continue;

    selected.push(item);
    if (category) seenPromotions.add(category);
    if (title) seenTitles.push(title);
    if (selected.length >= limit) break;
  }

  return selected;
}

module.exports = {
  calculateHeatScore,
  rankHotspots
};
