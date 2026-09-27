const BUSINESS_TIME_ZONE = "Asia/Shanghai";
const BUSINESS_UTC_OFFSET = "+08:00";

function businessDate(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const values = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return `${values.year}-${values.month}-${values.day}`;
}

function businessDateStart(date = new Date(), daysAgo = 0) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError("date must be a valid Date");
  if (!Number.isSafeInteger(daysAgo) || daysAgo < 0) throw new RangeError("daysAgo must be a non-negative integer");
  const targetDate = new Date(date.getTime() - daysAgo * 86400000);
  return new Date(`${businessDate(targetDate)}T00:00:00${BUSINESS_UTC_OFFSET}`);
}

function businessTime(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const values = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return `${values.hour}:${values.minute}`;
}

function isValidBusinessTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { businessDate, businessDateStart, businessTime, isValidBusinessTime };
}
