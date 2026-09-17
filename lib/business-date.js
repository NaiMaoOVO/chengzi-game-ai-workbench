const BUSINESS_TIME_ZONE = "Asia/Shanghai";

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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { businessDate, businessTime };
}
