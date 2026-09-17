const test = require("node:test");
const assert = require("node:assert/strict");

const { businessDate, businessTime } = require("../lib/business-date");

test("business date uses Shanghai day boundaries", () => {
  assert.equal(businessDate(new Date("2026-09-16T15:59:59.000Z")), "2026-09-16");
  assert.equal(businessDate(new Date("2026-09-16T16:00:00.000Z")), "2026-09-17");
});

test("business time uses Shanghai clock boundaries", () => {
  assert.equal(businessTime(new Date("2026-09-16T00:00:00.000Z")), "08:00");
  assert.equal(businessTime(new Date("2026-09-16T15:59:00.000Z")), "23:59");
});
