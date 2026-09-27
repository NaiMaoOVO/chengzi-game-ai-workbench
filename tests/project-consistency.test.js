const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("project checks and logs include the LLM service while service tests stay isolated", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.match(pkg.scripts.check, /node --check llm-server\.js/);
  assert.match(pkg.scripts["deploy:logs"], /gameops-llm/);
  assert.match(pkg.scripts["deploy:logs"], /gameops-archive/);
  assert.equal(pkg.scripts.test, "node --test --test-concurrency=1 tests/*.test.js");
});

test("README describes all five services and the online LLM route", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  assert.match(readme, /启动热点、评论、OCR、AI 增强、存档五个服务/);
  assert.match(readme, /\/api\/llm/);
  assert.match(readme, /个人工作默认关闭样例数据/);
  assert.match(readme, /每日工作台.*待办、风险工单、发布回流和今日简报/);
  assert.match(readme, /短暂断连时保留同一账号最近一次成功同步的队列并标明同步时间/);
  assert.match(readme, /单个存档读取 12 秒无响应时独立超时/);
  assert.match(readme, /账号切换时取消旧请求并清除待办、AI 洞察、发布\/风险列表、简报历史和项目档案列表/);
  assert.match(readme, /已完成记录或晨报单独不可用时不遮蔽未完成主队列/);
  assert.match(readme, /创作者库与晨报运行记录/);
  assert.doesNotMatch(readme, /真实数据（B站接口、OCR）失败时自动切换本地样例数据/);
});

test("README provisions the Basic Auth file required by the HTTPS Nginx template", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const nginx = fs.readFileSync(path.join(root, "nginx-https.conf.example"), "utf8");

  assert.match(nginx, /^\s*auth_basic_user_file\s+\/etc\/nginx\/\.htpasswd-gameops\s*;/m);
  assert.match(readme, /htpasswd\s+-c\s+\/etc\/nginx\/\.htpasswd-gameops\s+YOUR_BASIC_AUTH_USER/);
  assert.match(readme, /`-c` 会创建或覆盖文件[^\n]*首次创建/);
});

test("public builds generate a required inert launcher status asset instead of permitting a missing script", () => {
  const build = fs.readFileSync(path.join(root, "scripts", "build-public.js"), "utf8");
  const check = fs.readFileSync(path.join(root, "scripts", "check-public.js"), "utf8");
  assert.match(build, /generatedFiles\s*=\s*\{[\s\S]*launcher-sync-status\.js/);
  assert.match(build, /window\.__LAUNCHER_SYNC__ = null/);
  assert.match(check, /generatedFiles\s*=\s*\{[\s\S]*launcher-sync-status\.js/);
  assert.match(check, /sourceContent\(file\)/);
  assert.doesNotMatch(check, /optionalReferences/);
});

test("README describes creator selection as a personal decision library with collaboration history", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(readme, /KOL\/KOC 筛选与个人库/);
  assert.match(readme, /合作历史与实测效果/);
  assert.match(readme, /报价和实际成本/);
  assert.match(readme, /线上账号各自使用独立的浏览器缓存/);
  assert.match(readme, /旧本地库保留且不会自动并入任一账号/);
  assert.match(readme, /切换账号会取消旧个人库同步/);
  assert.match(html, /本机旧库不会自动并入账号，如需迁移请先导出/);
});

test("archive readiness probes SQLite and reports storage failure without leaking internals", () => {
  const archive = fs.readFileSync(path.join(root, "archive-server.js"), "utf8");
  const readyStart = archive.indexOf('request.url === "/ready"');
  const readyEnd = archive.indexOf('request.method === "POST" && url.pathname === "/auth/login"', readyStart);
  const readySource = archive.slice(readyStart, readyEnd);
  assert.match(readySource, /db\.exec\("BEGIN IMMEDIATE; ROLLBACK;"\)/);
  assert.match(readySource, /sendJson\(request, response, 503/);
  assert.match(readySource, /error: "storage_unavailable"/);
  assert.doesNotMatch(readySource, /error\.message/);
});
