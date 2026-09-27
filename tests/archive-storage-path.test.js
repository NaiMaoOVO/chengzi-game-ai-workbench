const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

test("archive refuses a symlink database without changing its target", async (t) => {
  if (process.platform === "win32") return t.skip("symlink setup requires elevated privileges on Windows");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gameops-archive-symlink-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const targetPath = path.join(dir, "unrelated.txt");
  const databasePath = path.join(dir, "archive.db");
  const originalContent = "preserve this unrelated file";
  fs.writeFileSync(targetPath, originalContent, { mode: 0o644 });
  fs.chmodSync(targetPath, 0o644);
  fs.symlinkSync(targetPath, databasePath);

  const child = spawn(process.execPath, [path.join(projectRoot, "archive-server.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ARCHIVE_PORT: "19722",
      ARCHIVE_DB_PATH: databasePath,
      ARCHIVE_AUTH_ENABLED: "0",
      MORNING_GAMES: ""
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("archive did not reject the symlink path"));
    }, 10000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  assert.equal(exit.code, 1, stderr);
  assert.match(stderr, /存档数据库及 SQLite 侧文件必须是普通文件/);
  assert.equal(fs.readFileSync(targetPath, "utf8"), originalContent);
  assert.equal(fs.statSync(targetPath).mode & 0o777, 0o644);
});
