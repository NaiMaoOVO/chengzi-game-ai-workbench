const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflows = path.join(__dirname, "..", ".github", "workflows");

test("automatic CI is the only push and pull-request workflow; manual verify is pinned", () => {
  const ci = fs.readFileSync(path.join(workflows, "ci.yml"), "utf8");
  const verify = fs.readFileSync(path.join(workflows, "verify.yml"), "utf8");
  assert.match(ci, /\n  push:\n/);
  assert.match(ci, /\n  pull_request:\n/);
  assert.match(verify, /\n  workflow_dispatch:\s*(?:\n|$)/);
  assert.doesNotMatch(verify, /\n  (?:push|pull_request):/);
  assert.match(verify, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(verify, /actions\/setup-node@[a-f0-9]{40}/);
  assert.match(verify, /persist-credentials: false/);
});
