const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

for (const filename of ["nginx.conf.example", "nginx-https.conf.example"]) {
  test(`${filename} lets LLM SSE responses stream through Nginx`, () => {
    const config = fs.readFileSync(path.join(root, filename), "utf8");
    const llmLocation = config.match(/location\s+\/api\/llm\/\s*\{([^{}]*)\}/)?.[1];

    assert.ok(llmLocation, "expected an LLM API proxy location");
    assert.match(llmLocation, /^\s*proxy_request_buffering\s+off\s*;/m);
    assert.match(llmLocation, /^\s*proxy_buffering\s+off\s*;/m);
  });

  test(`${filename} forwards one trusted client IP to each API service`, () => {
    const config = fs.readFileSync(path.join(root, filename), "utf8");
    const locations = [...config.matchAll(/location\s+[^{}]+\{([^{}]*)\}/g)]
      .map((match) => match[1])
      .filter((block) => /^\s*proxy_pass\s+/m.test(block));

    assert.equal(locations.length, 5);
    for (const block of locations) {
      assert.doesNotMatch(block, /^\s*include\s+proxy_params\s*;/m);
      assert.equal((block.match(/^\s*proxy_set_header\s+X-Forwarded-For\b/gim) || []).length, 1);
      assert.match(block, /^\s*proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;/im);
      assert.match(block, /^\s*proxy_set_header\s+Host\s+\$host\s*;/im);
      assert.match(block, /^\s*proxy_set_header\s+X-Real-IP\s+\$remote_addr\s*;/im);
      assert.match(block, /^\s*proxy_set_header\s+X-Forwarded-Proto\s+\$scheme\s*;/im);
    }
  });
}

test("HTTPS site locations inherit the server-level Basic Auth gate", () => {
  const config = fs.readFileSync(path.join(root, "nginx-https.conf.example"), "utf8");
  const httpsServerStart = config.indexOf("listen 443 ssl");
  assert.notEqual(httpsServerStart, -1, "expected an HTTPS server block");

  const firstLocation = config.indexOf("\n    location ", httpsServerStart);
  assert.notEqual(firstLocation, -1, "expected locations in the HTTPS server block");
  const serverDirectives = config.slice(httpsServerStart, firstLocation);
  assert.match(serverDirectives, /^\s*auth_basic\s+"[^"]+"\s*;/m);
  assert.match(serverDirectives, /^\s*auth_basic_user_file\s+\S+\s*;/m);

  const proxyLocations = [...config.matchAll(/location\s+[^{}]+\{([^{}]*)\}/g)]
    .map((match) => match[1])
    .filter((block) => /^\s*proxy_pass\s+/m.test(block));
  assert.equal(proxyLocations.length, 5);
  for (const block of proxyLocations) {
    assert.doesNotMatch(block, /^\s*auth_basic\s+off\s*;/im);
  }

  const allLocations = [...config.matchAll(/location\s+[^{}]+\{([^{}]*)\}/g)];
  assert.equal(allLocations.length, 12);
  for (const [, block] of allLocations) {
    assert.doesNotMatch(block, /^\s*auth_basic\s+off\s*;/im);
  }
});

test("HTTPS cache locations keep inheriting the server-level security headers", () => {
  const config = fs.readFileSync(path.join(root, "nginx-https.conf.example"), "utf8");
  const httpsServerStart = config.indexOf("listen 443 ssl");
  const firstLocation = config.indexOf("\n    location ", httpsServerStart);
  const serverDirectives = config.slice(httpsServerStart, firstLocation);
  for (const header of [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy"
  ]) {
    assert.match(
      serverDirectives,
      new RegExp(`^\\s*add_header\\s+${header}\\s+.+\\s+always\\s*;`, "m"),
      `${header} should be sent on success and error responses`
    );
  }

  const locations = [...config.matchAll(/location\s+([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(locations.length > 0);
  for (const [, , block] of locations) {
    assert.doesNotMatch(block, /^\s*add_header\b/im);
  }

  const staticAssets = locations.find(([, selector]) => selector.includes("(js|css)"))?.[2];
  const indexHtml = locations.find(([, selector]) => selector.includes("= /index.html"))?.[2];
  assert.ok(staticAssets, "expected a fingerprinted static asset location");
  assert.ok(indexHtml, "expected an explicit HTML cache location");
  assert.match(staticAssets, /^\s*expires\s+30d\s*;/m);
  assert.match(indexHtml, /^\s*expires\s+-1\s*;/m);
});

test("HSTS template defaults to the configured host until subdomains are confirmed", () => {
  const config = fs.readFileSync(path.join(root, "nginx-https.conf.example"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const hsts = config.match(/^\s*add_header\s+Strict-Transport-Security\s+"([^"]+)"/m)?.[1];

  assert.ok(hsts, "expected an HSTS header in the HTTPS template");
  assert.doesNotMatch(hsts, /includeSubDomains/i);
  assert.match(config, /^\s*#.*所有子域都支持 HTTPS 时.*includeSubDomains/m);
  assert.match(readme, /`includeSubDomains`.*所有子域.*HTTPS/);
});
