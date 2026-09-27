const test = require("node:test");
const assert = require("node:assert/strict");

const { businessDate, businessDateStart, businessTime, isValidBusinessTime } = require("../lib/business-date");

test("business date uses Shanghai day boundaries", () => {
  assert.equal(businessDate(new Date("2026-09-16T15:59:59.000Z")), "2026-09-16");
  assert.equal(businessDate(new Date("2026-09-16T16:00:00.000Z")), "2026-09-17");
});

test("business date window starts at midnight on the oldest included Shanghai day", () => {
  const beforeMorning = new Date("2026-09-27T00:15:00.000Z");
  assert.equal(businessDateStart(beforeMorning, 13).toISOString(), "2026-09-13T16:00:00.000Z");
  assert.equal(businessDateStart(new Date("2026-09-16T15:59:59.000Z"), 1).toISOString(), "2026-09-14T16:00:00.000Z");
  assert.equal(businessDateStart(new Date("2026-09-16T16:00:00.000Z"), 1).toISOString(), "2026-09-15T16:00:00.000Z");
});

test("business time uses Shanghai clock boundaries", () => {
  assert.equal(businessTime(new Date("2026-09-16T00:00:00.000Z")), "08:00");
  assert.equal(businessTime(new Date("2026-09-16T15:59:00.000Z")), "23:59");
});

test("morning schedule accepts only zero-padded 24-hour times", () => {
  for (const value of ["00:00", "09:00", "23:59"]) assert.equal(isValidBusinessTime(value), true);
  for (const value of ["9:00", "24:00", "12:60", "09:000", "", null]) {
    assert.equal(isValidBusinessTime(value), false, `unexpectedly accepted ${value}`);
  }
});
