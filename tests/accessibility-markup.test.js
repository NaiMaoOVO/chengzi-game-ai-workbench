const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("screenshot drop zone has button semantics and keyboard activation", () => {
  assert.match(html, /id="stream-drop-zone"[^>]*role="button"[^>]*aria-label=/);
  assert.match(app, /dropZone\?\.addEventListener\("keydown"/);
});

test("dynamic launcher and overview statuses announce updates", () => {
  assert.match(html, /id="overview-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="launcher-status"[^>]*aria-live="polite"/);
});

test("project slots use explicit buttons instead of a clickable div", () => {
  assert.doesNotMatch(app, /slot\.addEventListener\("click"/);
  assert.match(html, /class="slot-action slot-save"/);
  assert.match(html, /class="slot-action slot-load"/);
});

test("mobile styles allow the service mode switch to wrap", () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.service-mode-switch[\s\S]*grid-template-columns:\s*1fr 1fr/);
});
