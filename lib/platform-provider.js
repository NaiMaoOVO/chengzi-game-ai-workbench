function assertSafeProviderUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_error) {
    throw new Error("平台提供器必须是有效的 HTTP URL");
  }

  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("平台提供器只支持 HTTP 或 HTTPS");
    }
    throw new Error("非本机平台提供器必须使用 HTTPS");
  }
  return url;
}

function numberValue(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizePublishedAt(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const numeric = Number(value);
    const milliseconds = numeric > 100000000000 ? numeric : numeric * 1000;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeProviderItems(payload, platform, limit = 10) {
  const sourceItems = Array.isArray(payload)
    ? payload
    : payload?.items || (Array.isArray(payload?.data) ? payload.data : null) || payload?.data?.items || payload?.data?.feeds || payload?.feeds || payload?.notes || [];

  if (!Array.isArray(sourceItems)) return [];

  return sourceItems
    .map((item, index) => {
      const card = item?.noteCard || item?.note_card || {};
      const interaction = item.interact_info || item.interaction || card.interactInfo || card.interact_info || {};
      const title = String(item?.title || item?.note_title || item?.desc || item?.content || card.displayTitle || card.display_title || "").trim();
      if (!title) return null;
      const views = numberValue(item.views, item.view_count, item.play_count, item.play);
      const likes = numberValue(item.likes, item.like_count, item.digg_count, item.digg, interaction.liked_count, interaction.likedCount, interaction.likes);
      const comments = numberValue(item.comments, item.comment_count, item.reply_count, interaction.comment_count, interaction.commentCount, interaction.comments);
      const author = String(item.author?.name || item.author?.nickname || item.user?.nickname || item.user?.name || card.user?.nickname || card.user?.name || item.author || item.nickname || "平台创作者");
      const publishedAt = normalizePublishedAt(item.publishedAt || item.published_at || item.publish_time || item.create_time || item.time || card.publishTime || card.publish_time);
      const feedId = item.feed_id || item.note_id || item.id || "";
      const token = item.xsec_token || item.xsecToken || "";
      const url = String(item.url || item.link || item.share_url || item.note_url || (feedId ? `https://www.xiaohongshu.com/explore/${feedId}${token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_search` : ""}` : ""));
      return {
        rank: index + 1,
        title,
        author,
        views,
        likes,
        comments,
        danmaku: comments,
        heat: Math.round(views + likes * 3 + comments * 6),
        url,
        publishedAt,
        source: "real",
        platform,
        suffix: platform
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.heat - a.heat)
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 10)))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function rangeStart(range, now = Date.now()) {
  if (range === "today") {
    const date = new Date(now);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }
  const hours = { "24h": 24, "3d": 72, "7d": 168 }[range] || 24;
  return now - hours * 60 * 60 * 1000;
}

function filterItemsByRange(items, range, now = Date.now(), allowMissingTimestamp = false) {
  const start = rangeStart(range, now);
  return items.filter((item) => {
    const published = Date.parse(item.publishedAt);
    if (!Number.isFinite(published)) return allowMissingTimestamp;
    return published >= start && published <= now + 5 * 60 * 1000;
  });
}

async function fetchPlatformProvider(options) {
  const {
    providerUrl,
    providerToken,
    platform,
    game,
    range,
    limit,
    timeoutMs = 15000,
    fetchImpl = fetch
  } = options;
  const url = assertSafeProviderUrl(providerUrl);
  url.searchParams.set("keyword", game);
  url.searchParams.set("game", game);
  url.searchParams.set("range", range);
  url.searchParams.set("limit", String(limit));

  const headers = { Accept: "application/json" };
  if (providerToken) headers.Authorization = `Bearer ${providerToken}`;
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`${platform} 提供器返回 HTTP ${response.status}`);

  const payload = await response.json();
  const providerRangeVerified = payload?.providerRangeVerified === range;
  const items = filterItemsByRange(normalizeProviderItems(payload, platform, 20), range, Date.now(), providerRangeVerified).slice(0, limit);
  if (!items.length) throw new Error(`${platform} 提供器未返回可用内容`);
  return {
    platform,
    source: "real",
    sourceLabel: `${platform} 外部提供器`,
    range,
    updatedAt: new Date().toISOString(),
    items,
    note: "数据由已配置的外部只读提供器返回，请遵守平台规则并控制请求频率。"
  };
}

module.exports = {
  assertSafeProviderUrl,
  normalizeProviderItems,
  filterItemsByRange,
  fetchPlatformProvider
};
