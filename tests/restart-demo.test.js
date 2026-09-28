const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { getControllerInstanceId } = require("../lib/controller-instance");

const projectRoot = path.resolve(__dirname, "..");

test("restart refuses to duplicate a healthy controller when its process owner cannot be verified", async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-restart-demo-"));
  const controller = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "gameops-local-controller", instanceId: getControllerInstanceId(projectRoot) }));
  });
  await new Promise((resolve, reject) => {
    controller.once("error", reject);
    controller.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => controller.close(resolve));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const port = controller.address().port;
  const child = spawn(process.execPath, [path.join(projectRoot, "restart-demo.js")], {
    cwd: projectRoot,
    env: { ...process.env, CONTROLLER_PORT: String(port), TMPDIR: temporaryRoot },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
  const [code] = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("restart helper did not exit"));
    }, 5000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (exitCode, signal) => { clearTimeout(timeout); resolve([exitCode, signal]); });
  });

  assert.equal(code, 1);
  assert.match(output, /控制器已在线.*未重启/);
  assert.equal(controller.listening, true);
});
