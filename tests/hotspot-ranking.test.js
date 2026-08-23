const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateHeatScore, rankHotspots } = require("../lib/hotspot-ranking");

test("low-view abnormal engagement cannot outrank a healthy popular video", () => {
  const now = Math.floor(Date.now() / 1000);
  const spam = { title: "原神8.22隐藏口令码速领", play: 80, video_review: 78, favorites: 0, pubdate: now - 1800 };
  const healthy = { title: "原神版本流水与玩家反馈分析", play: 8500, video_review: 70, favorites: 12, pubdate: now - 3600 };

  assert.ok(calculateHeatScore(healthy) > calculateHeatScore(spam));
});

test("near-duplicate promotional titles occupy only one ranking slot", () => {
  const items = [
    { title: "紧急速领！原神7.0全网首发口令码8.22", author: "账号A", heat: 900, views: 100 },
    { title: "原神8.22隐藏口令码出炉！7.0版本福利", author: "账号B", heat: 850, views: 90 },
    { title: "原神7.0版本深度评测与配队建议", author: "正常作者", heat: 800, views: 5000 }
  ];

  const ranked = rankHotspots(items, 10);
  const codePosts = ranked.filter((item) => item.title.includes("口令码"));

  assert.equal(codePosts.length, 1);
  assert.equal(ranked[0].title, "原神7.0版本深度评测与配队建议");
});
