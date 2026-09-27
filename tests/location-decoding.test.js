const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const utils = fs.readFileSync(require.resolve("../utils.js"), "utf8");
const decoderStart = utils.indexOf("function decodeURIComponentSafe(");
const decoderEnd = utils.indexOf("\n}", decoderStart) + 2;
assert.ok(decoderStart >= 0 && decoderEnd > decoderStart, "safe URI decoder should exist in utils.js");
const decodeURIComponentSafe = vm.runInNewContext(`(${utils.slice(decoderStart, decoderEnd).trim()})`);

test("safe URI decoding returns the caller-selected fallback for malformed escapes", () => {
  assert.equal(decodeURIComponentSafe("%E9%B8%A3%E6%BD%AE", "fallback"), "鸣潮");
  assert.equal(decodeURIComponentSafe("%E0%A4%A", "fallback"), "fallback");
  assert.equal(decodeURIComponentSafe("%E0%A4%A", null), null);
});

test("a malformed file path does not break the runtime badge", () => {
  const start = app.indexOf("function renderRuntimeModeBadge() {");
  const end = app.indexOf("\nfunction renderLauncherSyncWarning()", start);
  assert.ok(start >= 0 && end > start, "runtime mode badge renderer should exist");
  const badge = { textContent: "" };
  const render = vm.runInNewContext(`(() => {
    ${app.slice(start, end)}
    return renderRuntimeModeBadge;
  })()`, {
    window: { location: { protocol: "file:", pathname: "/tmp/%E0%A4%A" } },
    document: { querySelector: () => badge },
    decodeURIComponentSafe
  });

  assert.doesNotThrow(render);
  assert.match(badge.textContent, /%E0%A4%A/);
});

test("a malformed route hash falls back to the daily view", () => {
  const match = app.match(/const initialView = ([^;]+);/);
  assert.ok(match, "initial view should be resolved from the location hash");
  const expression = match[1].replaceAll("window.location.hash", "hash");
  const resolveInitialView = vm.runInNewContext(`(hash, views) => {
    const initialView = ${expression};
    return views[initialView] ? initialView : "daily";
  }`, { decodeURIComponentSafe });

  assert.equal(resolveInitialView("#/%E0%A4%A", { daily: true, feedback: true }), "daily");
  assert.equal(resolveInitialView("#/feedback", { daily: true, feedback: true }), "feedback");
});
