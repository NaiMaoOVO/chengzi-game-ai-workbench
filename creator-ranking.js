(function creatorRankingModule(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CreatorRanking = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCreatorRanking() {
  const CREATOR_TIER = Object.freeze({
    A: "A档优先邀约",
    B: "B档补充合作",
    C: "C档低预算测试",
    PENDING: "待补数据",
    RISK: "风险名单"
  });

  const activityConfigs = Object.freeze({
    newLaunch: { label: "新品上线/首曝", weights: { launch: 0.5, review: 0.12, guide: 0.1, value: 0.28 }, logic: "优先看触达规模和破圈效率，同时保留预算效率约束。" },
    version: { label: "版本节点传播", weights: { launch: 0.34, review: 0.24, guide: 0.22, value: 0.2 }, logic: "兼顾声量、内容解释和玩家行动路径。" },
    guidePush: { label: "攻略内容铺量", weights: { launch: 0.12, review: 0.16, guide: 0.52, value: 0.2 }, logic: "更看重垂类匹配、互动率和内容可复用性。" },
    live: { label: "直播活动引流", weights: { launch: 0.38, review: 0.08, guide: 0.14, value: 0.4 }, logic: "优先看短期触达和预算效率。" },
    reputation: { label: "社区口碑建设", weights: { launch: 0.1, review: 0.48, guide: 0.24, value: 0.18 }, logic: "更依赖可信内容、评论质量和深度表达。" },
    budget: { label: "低预算测试", weights: { launch: 0.14, review: 0.14, guide: 0.24, value: 0.48 }, logic: "优先验证单位成本和内容反馈。" }
  });

  const platformThresholds = Object.freeze({
    B站: [500000, 150000, 50000],
    抖音: [1000000, 300000, 80000],
    小红书: [300000, 80000, 20000],
    微博: [500000, 150000, 50000],
    default: [500000, 150000, 50000]
  });

  function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function parseMetricValue(value) {
    const raw = String(value || "").trim().replace(/,/g, "");
    if (!raw) return 0;
    const number = Number(raw.replace(/[%万wWkK千+]/g, "")) || 0;
    if (/[万wW]/.test(raw)) return number * 10000;
    if (/[kK千]/.test(raw)) return number * 1000;
    return number;
  }

  function parseRateValue(value) {
    const raw = String(value || "").trim();
    const number = Number(raw.replace("%", "")) || 0;
    if (raw.includes("%")) return number;
    if (number > 0 && number <= 1) return number * 100;
    return number;
  }

  function qualityScore(value) {
    const text = String(value || "");
    if (text.includes("高") || text.includes("优")) return 90;
    if (text.includes("低") || text.includes("差") || text.includes("水")) return 35;
    return text ? 65 : 0;
  }

  function densityScore(value) {
    const text = String(value || "");
    if (text.includes("高")) return 30;
    if (text.includes("低")) return 85;
    return text ? 60 : 0;
  }

  function hasAny(text, words) {
    return words.some((word) => String(text || "").includes(word));
  }

  function getCreatorType(row) {
    const [kol, mid, koc] = platformThresholds[row.platform] || platformThresholds.default;
    if (row.followers >= kol) return "头部 KOL";
    if (row.followers >= mid) return "腰部 KOL";
    if (row.followers >= koc) return "垂类 KOC";
    return "长尾 KOC";
  }

  function creatorKey(row) {
    const normalize = (value) => String(value || "").trim().replace(/\s+/g, "").toLowerCase();
    const platform = normalize(row?.platform || "未标注");
    const accountId = normalize(row?.accountId);
    if (accountId) return `${platform}::id::${accountId}`;
    const accountUrl = String(row?.accountUrl || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (/^https?:\/\//i.test(accountUrl)) return `${platform}::url::${accountUrl}`;
    return `${platform}::name::${normalize(row?.name || "未命名达人")}`;
  }

  function getActivityConfig(activity) {
    return activityConfigs[activity] || activityConfigs.newLaunch;
  }

  function getBriefKeywords(brief) {
    return [brief?.category]
      .join("/")
      .split(/[、,，/｜|\s]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2);
  }

  function scoreCreator(row, brief = {}) {
    const type = getCreatorType(row);
    const content = `${row.contentType || ""} ${row.gameHistory || ""}`;
    const projectKeywords = getBriefKeywords(brief);
    const projectMatch = projectKeywords.length ? hasAny(content, projectKeywords) : true;
    const fanScore = Math.min(100, Math.log10(Math.max(row.followers, 1)) * 18);
    const viewScore = Math.min(100, Math.log10(Math.max(row.avgViews, 1)) * 20);
    const engagementScore = Math.min(100, (Number(row.engagementRate) || 0) * 8);
    const quality = qualityScore(row.commentQuality);
    const density = densityScore(row.commercialDensity);
    const quote = Number(row.quote) || 0;
    const cpm = quote > 0 && row.avgViews > 0 ? quote / row.avgViews * 1000 : null;
    const cpe = quote > 0 && row.avgViews > 0 && row.engagementRate > 0 ? quote / (row.avgViews * row.engagementRate / 100) : null;
    const conversionRate = parseRateValue(row.conversionRate);
    const conversionScore = conversionRate > 0 ? clampScore(conversionRate * 5) : 0;
    const reviewBonus = hasAny(content, ["测评", "拆解", "数据", "机制", "硬核", "长视频"]) ? 18 : 0;
    const guideBonus = hasAny(content, ["攻略", "养成", "合集", "技巧", "新手", "实战"]) ? 20 : 0;
    const exposureBonus = hasAny(content, ["资讯", "热点", "挑战", "泛娱乐", "短视频", "直播切片"]) ? 14 : 0;
    const verticalBonus = projectMatch ? 10 : 0;
    const dataGaps = [];
    if (!row.followers) dataGaps.push("粉丝数");
    if (!row.avgViews) dataGaps.push("平均播放");
    if (!row.engagementRate) dataGaps.push("互动率");
    if (!quote) dataGaps.push("预估报价");
    if (!row.contentType || row.contentType === "综合内容") dataGaps.push("内容类型");
    if (!row.gameHistory || row.gameHistory === "未标注") dataGaps.push("历史游戏品类");
    if (!row.commentQuality) dataGaps.push("评论质量");
    if (!row.commercialDensity) dataGaps.push("商单密度");
    const requiredGaps = dataGaps.filter((item) => ["粉丝数", "平均播放", "互动率", "预估报价"].includes(item));
    const riskPenalty = (density && density < 50 ? 14 : 0) + (quality && quality < 50 ? 18 : 0) + (row.engagementRate > 18 ? 10 : 0) + (!projectMatch ? 8 : 0);
    const launch = clampScore(fanScore * 0.32 + viewScore * 0.34 + engagementScore * 0.12 + quality * 0.1 + density * 0.06 + exposureBonus + verticalBonus * 0.4 - riskPenalty * 0.35);
    const review = clampScore(viewScore * 0.18 + engagementScore * 0.18 + quality * 0.3 + density * 0.08 + reviewBonus + verticalBonus - riskPenalty * 0.3);
    const guide = clampScore(viewScore * 0.18 + engagementScore * 0.28 + quality * 0.24 + density * 0.1 + guideBonus + verticalBonus * 0.7 - riskPenalty * 0.25);
    const value = quote > 0 ? clampScore(100 - Math.min(60, cpm * 1.3) - Math.min(25, cpe * 0.2) + engagementScore * 0.25 + quality * 0.2 + density * 0.12 + conversionScore * 0.12 - riskPenalty * 0.45) : 0;
    const overall = clampScore(launch * 0.28 + review * 0.24 + guide * 0.24 + value * 0.24);
    const risks = [];
    if (row.commercialDensity && row.commercialDensity.includes("高")) risks.push("商单密度偏高");
    if (quality > 0 && quality < 50) risks.push("评论质量偏低");
    if (row.engagementRate > 18) risks.push("互动率异常，需核查刷量");
    if (!projectMatch) risks.push("与当前项目品类匹配不足");
    if (cpm !== null && cpm > 120) risks.push("CPM 偏高");
    const reasons = [];
    if (projectKeywords.length && projectMatch) reasons.push("匹配当前项目品类");
    if (engagementScore >= 55) reasons.push(`互动率 ${Number(row.engagementRate).toFixed(1)}%`);
    if (quote > 0 && cpm !== null && cpm <= 120) reasons.push(`CPM ¥${Math.round(cpm)}`);
    if (reviewBonus) reasons.push("具备深度内容能力");
    if (guideBonus) reasons.push("具备攻略扩散能力");
    const tier = requiredGaps.length ? CREATOR_TIER.PENDING : risks.length >= 3 || quality < 50 ? CREATOR_TIER.RISK : overall >= 78 ? CREATOR_TIER.A : overall >= 62 ? CREATOR_TIER.B : CREATOR_TIER.C;

    return {
      ...row,
      type,
      cpm,
      cpe,
      conversionRate,
      scores: { launch, review, guide, value, overall },
      risks,
      reasons,
      dataGaps,
      tier
    };
  }

  function scoreByGoal(row, goal, activity = "newLaunch") {
    const config = getActivityConfig(activity);
    const baseScore = Object.entries(config.weights).reduce((total, [key, weight]) => total + row.scores[key] * weight, 0);
    const goalScore = row.scores[goal] ?? row.scores.overall;
    const baseDecisionScore = baseScore * 0.82 + goalScore * 0.18;
    const rawHistoryScore = row?.historyScore;
    const parsedHistoryScore = Number(rawHistoryScore);
    const historyScore = rawHistoryScore === null || rawHistoryScore === undefined || rawHistoryScore === ""
      ? null
      : Number.isFinite(parsedHistoryScore) ? parsedHistoryScore : null;
    return historyScore === null
      ? clampScore(baseDecisionScore)
      : clampScore(baseDecisionScore * 0.9 + historyScore * 0.1);
  }

  function getCreatorHistoryScore(collaborations) {
    const records = Array.isArray(collaborations) ? collaborations.filter((item) => item && typeof item === "object") : [];
    if (!records.length) return null;
    const scores = records.map((record) => {
      const quality = Number(record.quality);
      const qualityScore = Number.isFinite(quality) && quality >= 1 && quality <= 5 ? quality * 20 : 60;
      const onTimeScore = record.onTime === "yes" ? 100 : record.onTime === "no" ? 25 : 60;
      const recommendationScore = record.recommendation === "again" ? 100 : record.recommendation === "avoid" ? 20 : 60;
      const components = [
        { score: qualityScore, weight: 0.25 },
        { score: onTimeScore, weight: 0.18 },
        { score: recommendationScore, weight: 0.12 }
      ];
      const actualViews = Number(record.actualViews);
      const baselineViews = Number(record.baselineViews);
      if (actualViews > 0 && baselineViews > 0) {
        components.push({ score: clampScore(50 + (actualViews / baselineViews - 1) * 50), weight: 0.2 });
      }
      const actualCost = Number(record.actualCost);
      const baselineQuote = Number(record.baselineQuote);
      if (actualCost > 0 && actualViews > 0 && baselineQuote > 0 && baselineViews > 0) {
        const actualCpm = actualCost / actualViews;
        const baselineCpm = baselineQuote / baselineViews;
        components.push({ score: clampScore(50 + (1 - actualCpm / baselineCpm) * 50), weight: 0.15 });
      }
      const actualConversionRate = parseRateValue(record.actualConversionRate ?? record.conversionRate);
      const baselineConversionRate = parseRateValue(record.baselineConversionRate);
      if (actualConversionRate > 0) {
        const conversionScore = baselineConversionRate > 0
          ? clampScore(50 + (actualConversionRate / baselineConversionRate - 1) * 50)
          : clampScore(actualConversionRate * 5);
        components.push({ score: conversionScore, weight: 0.1 });
      }
      const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
      return components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
    });
    return {
      score: clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length),
      count: records.length,
      dataSignals: records.reduce((count, record) => count + [record.actualViews, record.actualCost, record.actualConversions, record.actualConversionRate ?? record.conversionRate].filter((value) => Number(value) > 0).length, 0)
    };
  }

  function isEligibleCreator(row) {
    return row.tier !== CREATOR_TIER.RISK && row.tier !== CREATOR_TIER.PENDING && row.quote > 0;
  }

  function chooseCreatorsByBudget(candidates, budget, scoreKey, limit = 8, maxPerPlatform = 2) {
    const selected = [];
    const platformCounts = new Map();
    let used = 0;
    [...candidates]
      .filter(isEligibleCreator)
      .sort((a, b) => (b.scores[scoreKey] / Math.max(b.quote, 1)) - (a.scores[scoreKey] / Math.max(a.quote, 1)))
      .forEach((row) => {
        const platformCount = platformCounts.get(row.platform) || 0;
        if (selected.length >= limit || platformCount >= maxPerPlatform || used + row.quote > budget) return;
        selected.push(row);
        used += row.quote;
        platformCounts.set(row.platform, platformCount + 1);
      });
    return { selected, used, platformCount: platformCounts.size };
  }

  return {
    CREATOR_TIER,
    parseMetricValue,
    parseRateValue,
    creatorKey,
    getActivityConfig,
    getCreatorHistoryScore,
    scoreCreator,
    scoreByGoal,
    isEligibleCreator,
    chooseCreatorsByBudget
  };
});
