(function () {
  const archiveUrl = () => typeof ARCHIVE_SERVICE_URL === "string" ? ARCHIVE_SERVICE_URL : "";
  const statusEl = () => document.querySelector("#daily-todo-status");
  const listEl = () => document.querySelector("#daily-todo-list");
  const doneListEl = () => document.querySelector("#daily-done-list");
  const doneContainerEl = () => document.querySelector("#daily-done-container");
  const titleEl = () => document.querySelector("#daily-todo-title");
  const priorityEl = () => document.querySelector("#daily-todo-priority");
  const dueEl = () => document.querySelector("#daily-todo-due");
  const connectionEl = () => document.querySelector("#daily-connection-state");
  const morningStatusEl = () => document.querySelector("#daily-morning-status");
  const allProjectsScope = "工作范围：全部项目";
  let activeFilter = "all";
  let refreshTimer = null;

  function setStatus(text, tone) {
    const element = statusEl();
    if (!element) return;
    element.textContent = "每日工作台：" + text;
    element.className = "source-status" + (tone === "real" ? " source-real" : tone === "mock" ? " source-mock" : "");
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = String(value);
  }

  function setStats({ todoCount = 0, riskCount = 0, publicationCount = 0, doneItems = [] } = {}) {
    setText("#daily-stat-todo", todoCount);
    setText("#daily-stat-risk", riskCount);
    setText("#daily-stat-publish", publicationCount);
    const totalManual = todoCount + doneItems.length;
    setText("#daily-progress-summary", totalManual
      ? `已完成 ${doneItems.length}/${totalManual} 项手动待办，优先清空高风险事项。`
      : "从一条关键待办开始，风险与回流会自动汇总到这里。");
  }

  function setConnection(text, tone) {
    const element = connectionEl();
    if (!element) return;
    element.textContent = text;
    element.dataset.tone = tone || "";
  }

  function formatMorningTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function renderMorningStatus(items = [], loading = false, unavailable = false) {
    const element = morningStatusEl();
    if (!element) return;
    if (loading) {
      element.textContent = "晨报：正在检查最近运行状态…";
      element.dataset.tone = "loading";
      return;
    }
    if (unavailable) {
      element.textContent = "晨报：登录或连接服务后可查看运行状态";
      element.dataset.tone = "warning";
      return;
    }
    const latestByGame = new Map();
    items.forEach((item) => {
      const key = `${item.game || "未设置"} · ${item.platform || "未知平台"}`;
      if (!latestByGame.has(key)) latestByGame.set(key, item);
    });
    if (!latestByGame.size) {
      element.textContent = "晨报：尚未配置自动抓取";
      element.dataset.tone = "warning";
      return;
    }
    const summaries = [...latestByGame.entries()].map(([key, item]) => {
      if (item.status === "success") return `${key} 最近成功 ${formatMorningTime(item.finished_at || item.started_at)}`;
      if (item.status === "running") return `${key} 抓取中`;
      return `${key} 失败：${String(item.error || "未知错误").slice(0, 80)}`;
    });
    element.textContent = "晨报：" + summaries.join("；");
    element.dataset.tone = summaries.some((summary) => summary.includes("失败")) ? "danger" : "success";
  }

  function currentGame() {
    return document.querySelector("#trending-game")?.value.trim()
      || document.querySelector("#version-game")?.value.trim()
      || document.querySelector("#feedback-game")?.value.trim()
      || "未设置";
  }

  function refreshProjectContext() {
    const element = document.querySelector("#daily-project-context");
    if (element) element.textContent = allProjectsScope + " · 新增待办归属：" + currentGame();
  }

  window.refreshDailyProjectContext = refreshProjectContext;

  function today() {
    return businessDate();
  }

  function dailyTodoRequestId(game, title, priority, dueDate) {
    const source = JSON.stringify({ game, title, priority, dueDate });
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    return `daily-todo-${hash.toString(36)}`;
  }

  function dueState(item, referenceDate = today()) {
    const dueDate = typeof item?.due_date === "string" ? item.due_date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return "unscheduled";
    if (dueDate < referenceDate) return "overdue";
    if (dueDate === referenceDate) return "today";
    return "future";
  }

  function dueLabel(item) {
    const state = dueState(item);
    if (state === "overdue") return { label: "逾期 · " + item.due_date, tone: "overdue" };
    if (state === "today") return { label: "今日到期", tone: "today" };
    if (state === "future") return { label: "计划 · " + item.due_date, tone: "future" };
    return { label: "未设日期", tone: "unscheduled" };
  }

  function button(label, handler) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "secondary-button";
    element.textContent = label;
    element.addEventListener("click", handler);
    return element;
  }

  function sourceViewAction(item) {
    const target = {
      creator: { view: "creator", label: "查看达人" },
      trending: { view: "trending", label: "查看热点" }
    }[item.link_view];
    if (!target) return null;
    return button(target.label, () => {
      if (typeof navigateToView === "function") navigateToView(target.view);
    });
  }

  function buildManualRow(item, completed) {
    const row = document.createElement("article");
    row.className = "briefing-archive-item publication-item today-todo-item daily-queue-item daily-queue-item-manual";

    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.title;
    text.append(title);

    const meta = document.createElement("div");
    meta.className = "publication-meta";
    const badge = document.createElement("span");
    badge.className = "publication-badge today-todo-count";
    badge.textContent = completed ? "已完成" : ({ high: "高优先级", medium: "中优先级", low: "低优先级" }[item.priority] || "待办");
    meta.append(badge);
    const due = dueLabel(item);
    const dueBadge = document.createElement("span");
    dueBadge.className = "publication-badge daily-due-badge";
    dueBadge.dataset.tone = due.tone;
    dueBadge.textContent = due.label;
    meta.append(dueBadge);
    if (item.game) {
      const game = document.createElement("span");
      game.textContent = item.game;
      meta.append(game);
    }
    text.append(meta);
    row.append(text);

    const actions = document.createElement("div");
    actions.className = "publication-actions";
    const sourceAction = sourceViewAction(item);
    if (sourceAction) actions.append(sourceAction);
    if (completed) {
      actions.append(button("重新打开", () => updateTodo(item.id, { status: "open" })));
    } else {
      actions.append(button("完成", () => updateTodo(item.id, { status: "done" })));
      actions.append(button("放弃", () => updateTodo(item.id, { status: "dropped" })));
    }
    row.append(actions);
    return row;
  }

  function openManagementPanel(id) {
    const panel = document.querySelector(id);
    if (panel) {
      panel.open = true;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function buildAutoRow(item) {
    const row = document.createElement("article");
    row.className = "briefing-archive-item publication-item today-todo-item daily-queue-item daily-queue-item-" + item.kind;

    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.title;
    text.append(title);

    const meta = document.createElement("div");
    meta.className = "publication-meta";
    const badge = document.createElement("span");
    badge.className = "publication-badge today-todo-count";
    badge.textContent = item.badge;
    meta.append(badge);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.textContent = item.detail;
      meta.append(detail);
    }
    text.append(meta);
    row.append(text);

    const actions = document.createElement("div");
    actions.className = "publication-actions";
    actions.append(button(item.actionLabel, () => openManagementPanel(item.panelId)));
    row.append(actions);
    return row;
  }

  function priorityValue(item) {
    return { high: 0, medium: 1, low: 2 }[item.priority] ?? 1;
  }

  function manualSort(a, b) {
    const dueOrder = { overdue: 0, today: 1, future: 2, unscheduled: 3 };
    const dueCompare = dueOrder[dueState(a)] - dueOrder[dueState(b)];
    if (dueCompare) return dueCompare;
    const priorityCompare = priorityValue(a) - priorityValue(b);
    if (priorityCompare) return priorityCompare;
    return String(a.due_date || "9999-99-99").localeCompare(String(b.due_date || "9999-99-99"));
  }

  function renderEmptyState(message, actionLabel, action) {
    const container = listEl();
    if (!container) return;
    const empty = document.createElement("div");
    empty.className = "daily-empty-state";
    const title = document.createElement("strong");
    title.textContent = message;
    empty.append(title);
    if (actionLabel && action) empty.append(button(actionLabel, action));
    container.append(empty);
  }

  function openLocalServiceRecovery() {
    if (typeof navigateToView === "function") navigateToView("overview");
    window.setTimeout(() => {
      const launcher = document.querySelector("#bootstrap-local-launcher");
      launcher?.scrollIntoView({ behavior: "smooth", block: "center" });
      launcher?.focus({ preventScroll: true });
      launcher?.click();
    }, 0);
  }

  function renderConnectionState(state) {
    const needsLogin = state.authRequired || (typeof archiveAuthRequired !== "undefined" && archiveAuthRequired && !archiveSessionUser);
    if (needsLogin) {
      if (window.location.protocol === "file:") {
        setConnection("本地文件模式无法使用线上账号登录", "warning");
        renderEmptyState("请通过 HTTPS 线上站点使用协作账号，或关闭本机认证后继续个人使用。", "查看本机服务", () => document.querySelector("#bootstrap-local-launcher")?.click());
        setStatus("本地文件模式不支持账号会话。", "mock");
        return true;
      }
      setConnection("需要登录后才能查看账号工作台", "warning");
      renderEmptyState("登录后即可查看你的待办和风险队列", "去登录", () => document.querySelector("#archive-login-username")?.focus());
      setStatus("等待登录。", "mock");
      return true;
    }
    if (state.error) {
      const local = !isOnlineServiceMode();
      setConnection(local ? "本机服务未连接" : "线上存档服务暂不可用", "danger");
      renderEmptyState(
        local ? "启动本机服务后，待办、风险和回流会自动同步。" : "暂时无法同步账号数据，请稍后刷新。",
        local ? "打开并启动本地服务" : "重新连接",
        () => local ? openLocalServiceRecovery() : window.loadTodayTodos?.()
      );
      setStatus(local ? "本机服务未连接。" : "线上服务暂不可用。", "mock");
      return true;
    }
    return false;
  }

  function updateFilterControls() {
    document.querySelectorAll("[data-daily-filter]").forEach((element) => {
      const active = element.dataset.dailyFilter === activeFilter;
      element.classList.toggle("active", active);
      element.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  window.renderTodayTodos = function renderTodayTodos(manualItems, state = {}) {
    const container = listEl();
    if (!container) return;
    container.innerHTML = "";
    setStats(state);

    if (state.loading) {
      container.innerHTML = '<p class="muted-copy">正在汇总今日待办……</p>';
      setConnection("正在同步今日运营状态…", "");
      renderMorningStatus([], true);
      return;
    }
    renderMorningStatus(state.morningRuns || [], false, state.error || state.authRequired || state.morningUnavailable);
    if (renderConnectionState(state)) return;

    const rows = [];
    (state.riskItems || []).slice(0, 5).forEach((risk) => rows.push({ kind: "risk", node: buildAutoRow({
      kind: "risk",
      title: risk.title,
      badge: "风险工单",
      detail: (risk.level || "中") + "风险 · " + (risk.game || "未设置"),
      actionLabel: "去处理",
      panelId: "#risk-ticket-panel"
    }) }));
    (state.publicationItems || []).slice(0, 5).forEach((publication) => rows.push({ kind: "publication", node: buildAutoRow({
      kind: "publication",
      title: publication.title,
      badge: "待回流",
      detail: (publication.channel || "未知渠道") + " · " + (publication.game || "未设置"),
      actionLabel: "去回流",
      panelId: "#publication-panel"
    }) }));
    [...manualItems].sort(manualSort).forEach((item) => rows.push({ kind: "manual", node: buildManualRow(item, false) }));
    rows.filter((row) => activeFilter === "all" || row.kind === activeFilter).forEach((row) => container.append(row.node));
    if (!rows.length) renderEmptyState("今日队列已清空，安排一件最重要的事吧。", "添加待办", () => titleEl()?.focus());
    if (rows.length && !container.children.length) renderEmptyState("当前筛选下没有事项。", "查看全部", () => {
      activeFilter = "all";
      updateFilterControls();
      window.renderTodayTodos(manualItems, state);
    });

    const doneItems = state.doneItems || [];
    const doneList = doneListEl();
    const doneContainer = doneContainerEl();
    if (doneList && doneContainer) {
      doneContainer.innerHTML = "";
      doneList.hidden = !doneItems.length;
      const summary = doneList.querySelector("summary");
      if (summary) summary.textContent = `已完成（${doneItems.length}）`;
      doneItems.forEach((item) => doneContainer.append(buildManualRow(item, true)));
    }
    setConnection("已连接 · 队列实时汇总中", "success");
    setStatus(`已汇总 ${rows.length} 条待办${doneItems.length ? `，另有 ${doneItems.length} 条已完成` : ""}。`, "real");
  };

  async function request(path, options) {
    const response = await archiveRequest(archiveUrl() + path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "HTTP " + response.status);
    return payload;
  }

  async function addTodo() {
    const title = titleEl()?.value.trim();
    if (!title) {
      setStatus("请先填写任务标题。", "mock");
      return;
    }
    const submitButton = document.querySelector("#daily-todo-form button[type=\"submit\"]");
    if (submitButton?.disabled) return;
    if (submitButton) submitButton.disabled = true;
    const game = currentGame();
    const priority = priorityEl()?.value || "medium";
    const dueDate = dueEl()?.value || today();
    try {
      await request("/daily-todos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": dailyTodoRequestId(game, title, priority, dueDate)
        },
        body: JSON.stringify({
          game,
          title,
          priority,
          due_date: dueDate
        })
      });
      titleEl().value = "";
      await window.loadTodayTodos?.();
    } catch (error) {
      setStatus("添加失败（" + error.message + "）。", "mock");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function updateTodo(id, body) {
    try {
      await request("/daily-todos/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      await window.loadTodayTodos?.();
    } catch (error) {
      setStatus("更新失败（" + error.message + "）。", "mock");
    }
  }

  window.initDailyWorkbench = function initDailyWorkbench() {
    const due = dueEl();
    if (due && !due.value) due.value = today();
    const dateLabel = document.querySelector("#daily-date-label");
    if (dateLabel) dateLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(new Date());
    refreshProjectContext();
    document.querySelector("#trending-game")?.addEventListener("input", refreshProjectContext);
    document.querySelector("#daily-todo-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      addTodo();
    });
    document.querySelector("#refresh-daily-todos")?.addEventListener("click", () => window.loadTodayTodos?.());
    document.querySelectorAll("[data-daily-filter]").forEach((element) => {
      element.addEventListener("click", () => {
        activeFilter = element.dataset.dailyFilter || "all";
        updateFilterControls();
        window.loadTodayTodos?.();
      });
    });
    updateFilterControls();
    if (!refreshTimer) {
      refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") window.loadTodayTodos?.();
      }, 300000);
    }
    if (typeof archiveAuthRequired !== "undefined" && archiveAuthRequired && !archiveSessionUser) {
      window.renderTodayTodos([], { authRequired: true });
      return;
    }
    window.loadTodayTodos?.();
  };
})();
