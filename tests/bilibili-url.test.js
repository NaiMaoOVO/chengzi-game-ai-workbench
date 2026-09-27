const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_VIDEO_INFO_URL, assertSafeVideoInfoUrl } = require("../lib/bilibili-url");

test("Bilibili video-info URL defaults to the official HTTPS endpoint", () => {
  assert.equal(assertSafeVideoInfoUrl("", { production: true }), DEFAULT_VIDEO_INFO_URL);
});

test("production video-info URL is pinned to the official Bilibili origin", () => {
  assert.equal(
    assertSafeVideoInfoUrl("https://api.bilibili.com/x/web-interface/view", { production: true }),
    DEFAULT_VIDEO_INFO_URL
  );
  assert.throws(
    () => assertSafeVideoInfoUrl("https://api.bilibili.com.attacker.example/view", { production: true }),
    /线上 BILIBILI_VIDEO_INFO_URL.*api\.bilibili\.com/
  );
});

test("video-info URLs reject embedded credentials and fixed query strings", () => {
  assert.throws(() => assertSafeVideoInfoUrl("https://user:secret@api.bilibili.com/view"), /不得包含账号密码/);
  assert.throws(() => assertSafeVideoInfoUrl("https://api.bilibili.com/view?token=secret"), /不得包含查询参数/);
});

test("local development permits loopback HTTP but rejects remote HTTP", () => {
  assert.equal(
    assertSafeVideoInfoUrl("http://127.0.0.1:19000/view"),
    "http://127.0.0.1:19000/view"
  );
  assert.throws(() => assertSafeVideoInfoUrl("http://provider.example/view"), /必须使用 HTTPS/);
});
