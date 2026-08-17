/**
 * 游戏内容运营 AI 分析工作台 — 本地服务控制台
 * 从 app.js 拆分而来。依赖 utils.js 中的常量定义。
 */

/* ---- 本地服务控制台 ---- */

function getLauncherOfflineMessage() {
  return "控制台状态：本机控制进程未连接。点击“启动本地控制进程”；首次使用请先执行一次 npm run launcher:install。";
}

function waitForLauncher(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const response = await fetch(LAUNCHER_SERVICE_URL + "/health", { cache: "no-store" });
        const payload = response.ok ? await response.json() : null;
        if (payload?.service === "gameops-local-controller") {
          resolve(true);
          return;
        }
      } catch (_error) {
        /* The native launcher may still be starting Node. */
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(poll, 500);
    };
    poll();
  });
}

async function bootstrapLocalLauncher() {
  const status = document.querySelector("#launcher-status");
  if (!status || renderLauncherOnlineMode(status)) return;
  status.textContent = "控制台状态：正在唤起 macOS 网页启动器…";
  status.className = "source-status";

  window.location.href = "gameops://start";
  const ready = await waitForLauncher();
  if (!ready) {
    status.textContent = "控制台状态：未检测到网页启动器。请先在项目目录执行一次 npm run launcher:install，然后重试。";
    status.className = "source-status source-mock";
    return;
  }

  status.textContent = "控制台状态：本地控制进程已启动，正在检查服务…";
  status.className = "source-status source-real";
  await checkLauncherStatus();
  await refreshOverviewServiceStatus();
}

async function restartLocalLauncher() {
  const status = document.querySelector("#launcher-status");
  if (!status || renderLauncherOnlineMode(status)) return;
  status.textContent = "控制台状态：正在唤起 macOS 网页启动器并重启服务…";
  status.className = "source-status";
  window.location.href = "gameops://restart";

  // Give the old controller time to release port 8793 before checking the new one.
  await new Promise((resolve) => window.setTimeout(resolve, 1200));
  const ready = await waitForLauncher(15000);
  if (!ready) {
    status.textContent = "控制台状态：未检测到网页启动器。请先执行一次 npm run launcher:install。";
    status.className = "source-status source-mock";
    return;
  }
  await checkLauncherStatus();
  await refreshOverviewServiceStatus();
}

function renderLauncherOnlineMode(status) {
  if (!status) return true;
  if (!isOnlineServiceMode()) return false;
  status.textContent = "控制台状态：线上模式由服务器进程常驻，页面不发送启动指令。";
  status.className = "source-status source-real";
  return true;
}

async function checkLauncherStatus() {
  var status = document.querySelector("#launcher-status");
  if (!status) return;
  if (renderLauncherOnlineMode(status)) return;
  try {
    status.textContent = "控制台状态：正在检查…";
    status.className = "source-status";
    var response = await fetch(LAUNCHER_SERVICE_URL + "/status");
    if (!response.ok) throw new Error("HTTP " + response.status);
    var data = await response.json();
    if (data.service !== "gameops-local-controller") throw new Error("服务身份不匹配");
    if (data.services && data.services.length) {
      var text = data.services.map(function(s) { return s.name + (s.running ? " ✅" : " ❌"); }).join(" / ");
      status.textContent = "控制台状态：" + text;
      status.className = "source-status source-real";
    }
  } catch (error) {
    status.textContent = getLauncherOfflineMessage();
    status.className = "source-status source-mock";
  }

}
