const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_ALLOWED_ORIGIN, parseAllowedOrigins, isOriginAllowed, createCors } = require("../lib/cors");

function request(origin) {
  return { headers: origin === undefined ? {} : { origin } };
}

test("parseAllowedOrigins keeps the shared default whitelist and trims entries", () => {
  assert.equal(parseAllowedOrigins().has("null"), false);
  assert.equal(parseAllowedOrigins().has("http://127.0.0.1:8793"), true);
  assert.deepEqual([...parseAllowedOrigins("null, http://a.example ,,http://b.example")].sort(), ["http://a.example", "http://b.example", "null"]);
});

test("isOriginAllowed permits file pages only in local or explicit configurations", () => {
  const cors = createCors({ allowedOrigins: "http://ok.example", methods: "GET, OPTIONS" });
  assert.equal(isOriginAllowed(request(), cors.allowedOrigins), true);
  assert.equal(isOriginAllowed(request("null"), cors.allowedOrigins), false);
  assert.equal(isOriginAllowed(request("http://ok.example"), cors.allowedOrigins), true);
  assert.equal(isOriginAllowed(request("http://evil.example"), cors.allowedOrigins), false);
  assert.equal(createCors({ allowedOrigins: "null,http://ok.example", methods: "GET, OPTIONS" }).isOriginAllowed(request("null")), true);
  assert.equal(createCors({ methods: "GET, OPTIONS" }).isOriginAllowed(request("null")), true, "未配置线上 Origin 时保留本机 file:// 支持");
  assert.equal(createCors({ allowedOrigins: "*", methods: "GET" }).isOriginAllowed(request("http://evil.example")), true);
});

test("corsHeaders echoes allowed origins and answers disallowed ones with fixed null ACAO", () => {
  const cors = createCors({ allowedOrigins: "http://ok.example", methods: "GET, OPTIONS" });
  const allowed = cors.corsHeaders(request("http://ok.example"));
  assert.equal(allowed["access-control-allow-origin"] ?? allowed["Access-Control-Allow-Origin"], "http://ok.example");
  assert.equal(allowed["Access-Control-Allow-Methods"], "GET, OPTIONS");
  assert.equal(allowed["Vary"], "Origin");

  const anonymous = cors.corsHeaders(request("null"));
  assert.equal(anonymous["Access-Control-Allow-Origin"], "null", "拒绝的匿名 Origin 不应得到放行头");

  const rejected = cors.corsHeaders(request("http://evil.example"));
  assert.equal(rejected["Access-Control-Allow-Origin"], "null", "拒绝来源不得回显其 Origin");
  assert.equal(rejected["Vary"], "Origin");

  const wildcard = createCors({ allowedOrigins: "*", methods: "GET, POST, OPTIONS" });
  assert.equal(wildcard.corsHeaders(request("http://evil.example"))["Access-Control-Allow-Origin"], "*");
});

test("all service presets share the same default origin whitelist", () => {
  const origins = parseAllowedOrigins(DEFAULT_ALLOWED_ORIGIN);
  for (const origin of ["http://localhost:8793", "http://127.0.0.1:8793", "http://localhost:3000", "http://localhost:5173"]) {
    assert.equal(origins.has(origin), true, `缺少默认白名单项 ${origin}`);
  }
});
