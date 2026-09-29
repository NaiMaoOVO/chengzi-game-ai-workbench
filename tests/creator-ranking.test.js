const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { CREATOR_TIER, chooseCreatorsByBudget, compareCreatorPriority, creatorKey, getCreatorHistoryScore, getCreatorLibraryDisplayProfiles, parseMetricValue, parseRateValue, sortCreatorCollaborationsByDate, scoreByGoal, scoreCreator } = require("../creator-ranking");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

test("creator numeric imports treat negative and non-finite values as missing", () => {
  assert.equal(parseMetricValue("-1200"), 0);
  assert.equal(parseMetricValue("Infinity"), 0);
  assert.equal(parseMetricValue("1e308万"), 0);
  assert.equal(parseMetricValue("2.4万"), 24000);
  assert.equal(parseRateValue("-3%"), 0);
  assert.equal(parseRateValue("Infinity%"), 0);
  assert.equal(parseRateValue("2.5%"), 2.5);
});

test("creator library keys keep same-name creators on different platforms separate", () => {
  assert.notEqual(
    creatorKey({ platform: "B站", name: "同名达人" }),
    creatorKey({ platform: "抖音", name: "同名达人" })
  );
  assert.equal(
    creatorKey({ platform: " B站 ", name: " 同名 达人 " }),
    creatorKey({ platform: "B站", name: "同名达人" })
  );
});

test("creator identity prefers account id or homepage over mutable display name", () => {
  assert.equal(
    creatorKey({ platform: "B站", name: "旧名称", accountId: "  uid-42 " }),
    creatorKey({ platform: "B站", name: "改名后的达人", accountId: "uid-42" })
  );
  assert.notEqual(
    creatorKey({ platform: "抖音", name: "账号甲", accountId: "MS4wLjABAAA" }),
    creatorKey({ platform: "抖音", name: "账号乙", accountId: "ms4wljabaaa" })
  );
  assert.equal(
    creatorKey({ platform: "抖音", name: "旧名称", accountUrl: "https://www.douyin.com/user/demo/" }),
    creatorKey({ platform: "抖音", name: "改名后的达人", accountUrl: "https://www.douyin.com/user/demo" })
  );
  assert.notEqual(
    creatorKey({ platform: "B站", name: "同名达人", accountUrl: "https://space.bilibili.com/1" }),
    creatorKey({ platform: "B站", name: "同名达人", accountUrl: "https://space.bilibili.com/2" })
  );
});

test("creator homepage identity normalizes URL host but preserves case-sensitive account paths", () => {
  assert.equal(
    creatorKey({ platform: "抖音", name: "达人甲", accountUrl: "https://WWW.DOUYIN.com/User/AbC/?from=share#profile" }),
    creatorKey({ platform: "抖音", name: "达人甲改名", accountUrl: "https://www.douyin.com/User/AbC" })
  );
  assert.notEqual(
    creatorKey({ platform: "抖音", name: "账号甲", accountUrl: "https://www.douyin.com/user/MS4wLjABAAA" }),
    creatorKey({ platform: "抖音", name: "账号乙", accountUrl: "https://www.douyin.com/user/ms4wljabaaa" })
  );
});

test("creator library identity upgrades preserve and consolidate homepage-linked collaboration history", () => {
  const profileStart = appSource.indexOf("function creatorProfileKeys(row)");
  const profileEnd = appSource.indexOf("function saveCreatorToLibrary", profileStart);
  const mergeStart = appSource.indexOf("function mergeCreatorProfiles(primary, incoming)");
  const mergeEnd = appSource.indexOf("function canonicalizeCreatorLibrary", mergeStart);
  assert.ok(profileStart >= 0 && profileEnd > profileStart);
  assert.ok(mergeStart >= 0 && mergeEnd > mergeStart);
  const resolve = vm.runInNewContext(`(() => {
    ${appSource.slice(profileStart, profileEnd)}
    ${appSource.slice(mergeStart, mergeEnd)}
    return findCreatorProfile;
  })()`, { creatorKey });
  const url = "https://www.douyin.com/user/creator-x";
  const oldRow = { platform: "抖音", name: "旧昵称", accountUrl: url };
  const upgradedRow = { platform: "抖音", name: "新昵称", accountId: "open-id-123", accountUrl: url };
  const history = { id: "collab-1", project: "鸣潮 2.8", actualViews: 82000 };
  const oldKey = creatorKey(oldRow);
  const newKey = creatorKey(upgradedRow);
  const legacyLibrary = {
    [oldKey]: { key: oldKey, name: oldRow.name, platform: oldRow.platform, accountUrl: url, collaborations: [history], updatedAt: "2026-09-20T00:00:00.000Z" }
  };

  const migrated = resolve(legacyLibrary, upgradedRow, true);
  assert.equal(migrated.key, newKey);
  assert.equal(migrated.profile.collaborations[0].id, "collab-1");
  assert.equal(migrated.profile.accountId, upgradedRow.accountId);
  assert.equal(Object.hasOwn(legacyLibrary, oldKey), false);
  assert.equal(Object.hasOwn(legacyLibrary, newKey), true);

  const secondHistory = { id: "collab-2", project: "鸣潮 2.9", actualViews: 94000 };
  const duplicateLibrary = {
    [newKey]: { key: newKey, name: upgradedRow.name, platform: upgradedRow.platform, accountId: upgradedRow.accountId, collaborations: [secondHistory], updatedAt: "2026-09-28T00:00:00.000Z" },
    [oldKey]: { key: oldKey, name: oldRow.name, platform: oldRow.platform, accountUrl: url, collaborations: [history], updatedAt: "2026-09-20T00:00:00.000Z" }
  };
  const consolidated = resolve(duplicateLibrary, upgradedRow, true);
  assert.deepEqual(Array.from(consolidated.profile.collaborations, (item) => item.id).sort(), ["collab-1", "collab-2"]);
  assert.equal(Object.hasOwn(duplicateLibrary, oldKey), false);
  assert.equal(Object.keys(duplicateLibrary).length, 1);
});

test("creator library saves a collaboration when only the renewal recommendation changes", () => {
  const saveStart = appSource.indexOf("function saveCreatorLibraryCard(card)");
  const saveEnd = appSource.indexOf("function removeCreatorFromLibrary", saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const saveWithRecommendation = (recommendation) => {
    let library = { key: { key: "key", name: "达人", platform: "抖音", collaborations: [] } };
    const save = vm.runInNewContext(`(() => {
      ${appSource.slice(saveStart, saveEnd)}
      return saveCreatorLibraryCard;
    })()`, {
      document: { querySelector: () => ({}) },
      readCreatorLibrary: () => library,
      writeCreatorLibrary: (next) => { library = next; return true; },
      renderCreatorLibrary: () => {}
    });
    const values = {
      "[data-library-project]": "",
      "[data-library-occurred-on]": "",
      "[data-library-url]": "",
      "[data-library-result]": "",
      "[data-library-views]": "",
      "[data-library-engagement]": "",
      "[data-library-clicks]": "",
      "[data-library-conversions]": "",
      "[data-library-quoted-cost]": "",
      "[data-library-cost]": "",
      "[data-library-ontime]": "unknown",
      "[data-library-quality]": "",
      "[data-library-recommendation]": recommendation,
      "[data-library-status]": "未合作",
      "[data-library-notes]": ""
    };
    save({ dataset: { creatorLibraryKey: "key" }, querySelector: (selector) => ({ value: values[selector] }) });
    return library.key;
  };
  const avoided = saveWithRecommendation("avoid");
  assert.equal(avoided.collaborations.length, 1);
  assert.equal(avoided.collaborations[0].recommendation, "avoid");
  assert.equal(saveWithRecommendation("observe").collaborations.length, 0);
});

test("creator briefs include the selected game and target audience without changing score inputs", () => {
  const fitStart = appSource.indexOf("function getCreatorFit(row)");
  const anomaliesStart = appSource.indexOf("function getCreatorAnomalies", fitStart);
  assert.ok(fitStart >= 0 && anomaliesStart > fitStart);
  const getBriefDetail = vm.runInNewContext(`(() => {
    ${appSource.slice(fitStart, anomaliesStart)}
    return getCreatorBriefDetail;
  })()`, { formatWan: (value) => String(value) });
  const detail = getBriefDetail({
    scores: { launch: 80, review: 60, guide: 50, value: 40 },
    platform: "B站",
    avgViews: 10000
  }, { game: "鸣潮", audience: "回流玩家" });
  assert.match(detail, /目标游戏：鸣潮/);
  assert.match(detail, /目标受众：回流玩家/);
  assert.equal(scoreCreator({ contentType: "攻略", gameHistory: "开放世界", followers: 1000, avgViews: 100, engagementRate: 3, quote: 100 }, { game: "鸣潮", audience: "回流玩家" }).scores.overall,
    scoreCreator({ contentType: "攻略", gameHistory: "开放世界", followers: 1000, avgViews: 100, engagementRate: 3, quote: 100 }, {}).scores.overall);
});

test("creator history turns structured delivery reviews into a bounded confidence signal", () => {
  assert.equal(getCreatorHistoryScore([]), null);
  const records = [
    { quality: 5, onTime: "yes", recommendation: "again" },
    { quality: 3, onTime: "no", recommendation: "observe" }
  ];
  const result = getCreatorHistoryScore(records);
  assert.deepEqual(getCreatorHistoryScore([null, [], "bad", ...records]), result);
  assert.equal(result.count, 2);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.score > 50);
});

test("creator collaboration history sorts by actual event date, not when it was backfilled", () => {
  const latest = { project: "新合作", occurredOn: "2026-09-01", createdAt: "2026-09-20T10:00:00Z" };
  const backfilled = { project: "补录旧合作", occurredOn: "2025-05-01", createdAt: "2026-09-23T10:00:00Z" };
  const legacy = { project: "旧格式记录", createdAt: "2025-12-01T10:00:00Z" };
  const malformedDate = { project: "日期损坏", occurredOn: "not-a-date", createdAt: "2026-01-01T10:00:00Z" };
  assert.deepEqual(sortCreatorCollaborationsByDate([latest, null, "bad", [], backfilled, legacy, malformedDate]), [latest, malformedDate, legacy, backfilled]);
  assert.deepEqual(sortCreatorCollaborationsByDate(null), []);
});

test("creator library display skips corrupt profile values without changing the source object", () => {
  const library = {
    good: { name: "可读档案", platform: "B站" },
    empty: null,
    invalid: [],
    text: "bad",
    missingPlatform: { name: "缺平台" },
    blankName: { name: "  ", platform: "B站" },
    valid: { name: "短视频创作者", platform: "抖音" }
  };
  assert.deepEqual(getCreatorLibraryDisplayProfiles(library), [library.good, library.valid]);
  assert.deepEqual(library, {
    good: { name: "可读档案", platform: "B站" },
    empty: null,
    invalid: [],
    text: "bad",
    missingPlatform: { name: "缺平台" },
    blankName: { name: "  ", platform: "B站" },
    valid: { name: "短视频创作者", platform: "抖音" }
  });
});

test("history confidence nudges ranking without replacing public-data scoring", () => {
  const row = { scores: { launch: 80, review: 70, guide: 70, value: 60, overall: 70 }, historyScore: 95 };
  const withoutHistory = scoreByGoal({ ...row, historyScore: null }, "launch", "newLaunch");
  const withHistory = scoreByGoal(row, "launch", "newLaunch");
  assert.ok(withHistory > withoutHistory);
  assert.ok(withHistory - withoutHistory < 10);
});

test("history score incorporates actual reach, cost efficiency, and conversion when available", () => {
  const neutral = getCreatorHistoryScore([{ quality: 4, onTime: "yes", recommendation: "again" }]);
  const measured = getCreatorHistoryScore([{
    quality: 4,
    onTime: "yes",
    recommendation: "again",
    actualViews: 200000,
    baselineViews: 100000,
    actualCost: 8000,
    baselineQuote: 12000,
    baselineConversionRate: 4,
    actualConversionRate: 8
  }]);
  assert.ok(measured.dataSignals >= 3);
  assert.ok(measured.score > neutral.score);
});

test("actual creator cost replaces quote for current CPM and value scoring after backfill", () => {
  const quoteOnly = {
    platform: "B站", name: "达人甲", followers: 100000, avgViews: 10000,
    engagementRate: 5, contentType: "攻略", gameHistory: "动作游戏",
    commentQuality: "高", commercialDensity: "低", quote: 1000
  };
  const quoted = scoreCreator(quoteOnly);
  const actualAtQuote = scoreCreator({ ...quoteOnly, actualCost: 1000 });
  const actualOverrun = scoreCreator({ ...quoteOnly, actualCost: 100000 });
  const actualFree = scoreCreator({ ...quoteOnly, actualCost: 0 });

  assert.equal(quoted.cpm, 100, "unbackfilled rows should continue using the estimate");
  assert.equal(actualAtQuote.cpm, 100);
  assert.equal(actualOverrun.cpm, 10000, "backfilled CPM should use actual spend");
  assert.ok(actualAtQuote.scores.value > actualOverrun.scores.value);
  assert.equal(actualFree.cpm, 0, "an explicit zero actual cost is valid data, not a missing value");
  assert.ok(actualFree.scores.value > quoted.scores.value);
});

test("missing actual metrics stay neutral instead of lowering history score", () => {
  const result = getCreatorHistoryScore([{ quality: 4, onTime: "yes", recommendation: "again", actualCost: null }]);
  assert.equal(result.dataSignals, 0);
  assert.ok(result.score >= 70);
});

test("an explicit zero actual cost is retained as data and improves cost efficiency", () => {
  const result = getCreatorHistoryScore([{ quality: 4, onTime: "yes", recommendation: "again", actualViews: 10000, baselineViews: 10000, actualCost: 0, baselineQuote: 1000 }]);
  assert.equal(result.dataSignals, 2);
  assert.ok(result.score > 80);
});

test("an explicit zero-view result is retained and lowers historical performance", () => {
  const result = getCreatorHistoryScore([{ quality: 4, onTime: "yes", recommendation: "again", actualViews: 0, baselineViews: 10000 }]);
  assert.equal(result.dataSignals, 1);
  assert.ok(result.score < 80);
  const withSpend = getCreatorHistoryScore([{ quality: 4, onTime: "yes", recommendation: "again", actualViews: 0, baselineViews: 10000, actualCost: 1000, baselineQuote: 1000 }]);
  assert.equal(withSpend.dataSignals, 2);
  assert.ok(Number.isFinite(withSpend.score));
  assert.ok(withSpend.score < result.score);
});

test("historical engagement change contributes to creator performance and keeps zero outcomes", () => {
  const baseline = [{ quality: 4, onTime: "yes", recommendation: "again" }];
  const improved = getCreatorHistoryScore([{ ...baseline[0], actualEngagementRate: 10, baselineEngagementRate: 5 }]);
  const zero = getCreatorHistoryScore([{ ...baseline[0], actualEngagementRate: 0, baselineEngagementRate: 5 }]);
  const neutral = getCreatorHistoryScore(baseline);
  assert.equal(improved.dataSignals, 1);
  assert.equal(zero.dataSignals, 1);
  assert.ok(improved.score > neutral.score);
  assert.ok(zero.score < neutral.score);
});

test("a creator without a verified quote is held for data completion instead of being recommended", () => {
  const row = scoreCreator({
    name: "待核验达人",
    platform: "B站",
    followers: 180000,
    avgViews: 90000,
    engagementRate: 8,
    contentType: "攻略/测评",
    gameHistory: "赛车/竞速",
    commentQuality: "高",
    quote: 0,
    commercialDensity: "低"
  }, { game: "巅峰极速", category: "赛车/竞速" });

  assert.equal(row.tier, CREATOR_TIER.PENDING);
  assert.equal(row.scores.value, 0);
  assert.ok(row.dataGaps.includes("预估报价"));
});

test("missing optional quality and ad-density inputs stay neutral instead of becoming risk", () => {
  const base = {
    name: "缺少可选字段的达人",
    platform: "B站",
    followers: 500000,
    avgViews: 200000,
    engagementRate: 8,
    contentType: "攻略",
    gameHistory: "赛车/竞速",
    quote: 10000
  };
  const missing = scoreCreator(base, { category: "赛车/竞速" });
  const explicitNeutral = scoreCreator({ ...base, commentQuality: "中", commercialDensity: "中" }, { category: "赛车/竞速" });

  assert.deepEqual(missing.scores, explicitNeutral.scores);
  assert.equal(missing.tier, explicitNeutral.tier);
  assert.ok(missing.dataGaps.includes("评论质量"));
  assert.ok(missing.dataGaps.includes("商单密度"));
  assert.notEqual(missing.tier, CREATOR_TIER.RISK);
});

test("creator ratings use explicit labels instead of positive or negative substrings", () => {
  const base = {
    name: "评分标签测试",
    platform: "B站",
    followers: 500000,
    avgViews: 200000,
    engagementRate: 8,
    contentType: "攻略",
    gameHistory: "赛车/竞速",
    quote: 10000,
    commercialDensity: "中"
  };
  const needsImprovement = scoreCreator({
    ...base,
    commentQuality: "评论质量：待优化（负向评论较多）"
  }, { category: "赛车/竞速" });
  const notHigh = scoreCreator({
    ...base,
    commentQuality: "中",
    commercialDensity: "不高"
  }, { category: "赛车/竞速" });
  const highDensity = scoreCreator({
    ...base,
    commentQuality: "高",
    commercialDensity: "商单密度：偏高（近期频繁植入）"
  }, { category: "赛车/竞速" });

  assert.ok(needsImprovement.risks.includes("评论质量偏低"));
  assert.equal(needsImprovement.tier, CREATOR_TIER.RISK);
  assert.ok(!notHigh.risks.includes("商单密度偏高"));
  assert.ok(highDensity.risks.includes("商单密度偏高"));
});

test("creator admission tier is ordered before its target score", () => {
  const rows = [
    { name: "待补数据", tier: CREATOR_TIER.PENDING, scores: { launch: 99, review: 99, guide: 99, value: 0, overall: 99 } },
    { name: "可推进", tier: CREATOR_TIER.B, scores: { launch: 62, review: 62, guide: 62, value: 62, overall: 62 } },
    { name: "风险名单", tier: CREATOR_TIER.RISK, scores: { launch: 100, review: 100, guide: 100, value: 100, overall: 100 } }
  ];
  assert.deepEqual(
    rows.sort((a, b) => compareCreatorPriority(a, b, "launch", "newLaunch")).map((row) => row.name),
    ["可推进", "待补数据", "风险名单"]
  );
});

test("value-first ranking keeps the selected activity scenario in the decision", () => {
  const row = {
    scores: { launch: 90, review: 20, guide: 20, value: 80, overall: 53 }
  };

  assert.notEqual(scoreByGoal(row, "value", "newLaunch"), scoreByGoal(row, "value", "reputation"));
});

test("budget selection avoids concentrating more than two eligible creators on one platform", () => {
  const rows = ["A", "B", "C"].map((name, index) => ({
    name,
    platform: "B站",
    quote: 1000,
    tier: CREATOR_TIER.A,
    scores: { launch: 90 - index, review: 80, guide: 80, value: 80, overall: 80 }
  }));

  const plan = chooseCreatorsByBudget(rows, 5000, "launch", 8, 2);
  assert.deepEqual(plan.selected.map((row) => row.name), ["A", "B"]);
});

test("project category is visible in creator matching instead of using one global genre list", () => {
  const row = scoreCreator({
    name: "射击攻略作者",
    platform: "B站",
    followers: 150000,
    avgViews: 70000,
    engagementRate: 7,
    contentType: "攻略",
    gameHistory: "射击/战术",
    commentQuality: "高",
    quote: 10000,
    commercialDensity: "低"
  }, { category: "赛车/竞速" });

  assert.ok(row.risks.includes("与当前项目品类匹配不足"));
  assert.ok(!row.reasons.includes("匹配当前项目品类"));
});
