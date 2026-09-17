const test = require("node:test");
const assert = require("node:assert/strict");
const { CREATOR_TIER, chooseCreatorsByBudget, creatorKey, getCreatorHistoryScore, scoreByGoal, scoreCreator } = require("../creator-ranking");

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
    creatorKey({ platform: "B站", name: "旧名称", accountId: "  UID-42 " }),
    creatorKey({ platform: "B站", name: "改名后的达人", accountId: "uid-42" })
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

test("creator history turns structured delivery reviews into a bounded confidence signal", () => {
  assert.equal(getCreatorHistoryScore([]), null);
  const result = getCreatorHistoryScore([
    { quality: 5, onTime: "yes", recommendation: "again" },
    { quality: 3, onTime: "no", recommendation: "observe" }
  ]);
  assert.equal(result.count, 2);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.score > 50);
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

test("missing actual metrics stay neutral instead of lowering history score", () => {
  const result = getCreatorHistoryScore([{ quality: 4, onTime: "yes", recommendation: "again", actualCost: 0 }]);
  assert.equal(result.dataSignals, 0);
  assert.ok(result.score >= 70);
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
