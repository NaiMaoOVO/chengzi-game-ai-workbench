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
  let latestDailyInsightContext = { manualItems: [], state: {} };
  let dailyAiInsightGeneration = 0;

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

  function setStats({ todoCount = 0, todoTotal = todoCount, riskCount = 0, publicationCount = 0, doneItems = [], doneTotal = doneItems.length, riskUnavailable = false, publicationUnavailable = false } = {}) {
    setText("#daily-stat-todo", todoCount);
    setText("#daily-stat-risk", riskUnavailable ? "—" : riskCount);
    setText("#daily-stat-publish", publicationUnavailable ? "—" : publicationCount);
    const loadedManual = todoCount + doneItems.length;
    const totalManual = Math.max(todoCount, Number(todoTotal) || 0) + Math.max(doneItems.length, Number(doneTotal) || 0);
    const loadedHint = loadedManual < totalManual ? `（当前加载 ${loadedManual}/${totalManual} 条）` : "";
    setText("#daily-progress-summary", totalManual
      ? `已完成 ${doneItems.length}/${totalManual} 项手动待办${loadedHint}，优先清空高风险事项。`
      : "从一条关键待办开始，风险与回流会自动汇总到这里。");
  }

  function setConnection(text, tone) {
    const element = connectionEl();
    if (!element) return;
    element.textContent = text;
    element.dataset.tone = tone || "";
    const serviceLabel = tone === "success" ? "数据服务 · 已连接" : tone === "danger" ? "数据服务 · 未连接" : tone === "warning" ? "数据服务 · 需处理" : "数据服务 · 同步中";
    setText("#sidebar-service-state", serviceLabel);
    setText("#topbar-service-state", serviceLabel.replace("数据服务 · ", ""));
  }

  function formatMorningTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function renderMorningStatus(items = [], loading = false, unavailable = false) {
    const element = morningStatusEl();
    if (!element) return;
    if (loading) {
      element.textContent = "晨报：正在检查最近运行状态…";
      element.dataset.tone = "loading";
      setText("#daily-stat-morning", "—");
      return;
    }
    if (unavailable) {
      element.textContent = "晨报：登录或连接服务后可查看运行状态";
      element.dataset.tone = "warning";
      setText("#daily-stat-morning", "—");
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
      setText("#daily-stat-morning", "待配置");
      return;
    }
    const summaries = [...latestByGame.entries()].map(([key, item]) => {
      if (item.status === "success") return `${key} 最近成功 ${formatMorningTime(item.finished_at || item.started_at)}`;
      if (item.status === "running") return `${key} 抓取中`;
      return `${key} 失败：${String(item.error || "未知错误").slice(0, 80)}`;
    });
    element.textContent = "晨报：" + summaries.join("；");
    element.dataset.tone = summaries.some((summary) => summary.includes("失败")) ? "danger" : "success";
    setText("#daily-stat-morning", latestByGame.size);
  }

  function currentGame() {
    return document.querySelector("#trending-game")?.value.trim()
      || document.querySelector("#version-game")?.value.trim()
      || document.querySelector("#feedback-game")?.value.trim()
      || "未设置";
  }

  function refreshProjectContext() {
    const element = document.querySelector("#daily-project-context");
    const game = currentGame();
    const versionGame = document.querySelector("#version-game")?.value.trim();
    const versionTheme = document.querySelector("#version-theme")?.value.trim();
    if (element) element.textContent = allProjectsScope + " · 新增待办归属：" + game;
    setText("#sidebar-project-name", game === "未设置" ? "全部项目" : game);
    setText("#daily-project-banner-game", game === "未设置" ? "未设置项目" : game);
    setText("#daily-project-banner-theme", versionGame === game && versionTheme
      ? versionTheme
      : "尚未为当前项目配置版本主题");
  }

  window.refreshDailyProjectContext = refreshProjectContext;

  function today() {
    return businessDate();
  }

  function shiftBusinessDate(dateValue, days) {
    const base = new Date(`${dateValue}T12:00:00+08:00`);
    const source = Number.isNaN(base.getTime()) ? new Date() : base;
    return businessDate(new Date(source.getTime() + days * 86400000));
  }

  function dailyTodoRequestId(game, title, priority, dueDate) {
    const source = JSON.stringify({ game, title, priority, dueDate });
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    return `daily-todo-${hash.toString(36)}`;
  }

  function isCalendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function dueState(item, referenceDate = today()) {
    const dueDate = typeof item?.due_date === "string" ? item.due_date.trim() : "";
    if (!isCalendarDate(dueDate)) return "unscheduled";
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
    const source = document.createElement("span");
    source.className = "daily-queue-cell daily-queue-source";
    source.textContent = "个人待办";
    const state = document.createElement("div");
    state.className = "daily-queue-cell daily-queue-state";
    state.append(meta);
    row.append(text, source, state);

    const actions = document.createElement("div");
    actions.className = "publication-actions";
    const sourceAction = sourceViewAction(item);
    if (sourceAction) actions.append(sourceAction);
    if (completed) {
      actions.append(button("重新打开", () => updateTodo(item.id, { status: "open" })));
    } else {
      actions.append(button("完成", () => updateTodo(item.id, { status: "done" })));
      actions.append(button("改到明天", () => updateTodo(item.id, { due_date: shiftBusinessDate(today(), 1) })));
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
    const source = document.createElement("span");
    source.className = "daily-queue-cell daily-queue-source";
    source.textContent = item.kind === "risk" ? "风险工单" : "发布回流";
    const state = document.createElement("div");
    state.className = "daily-queue-cell daily-queue-state";
    state.append(meta);
    row.append(text, source, state);

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

  function matchesActiveFilter(row) {
    if (activeFilter === "overdue" || activeFilter === "today") {
      return row.kind === "manual" && dueState(row.item) === activeFilter;
    }
    return activeFilter === "all" || row.kind === activeFilter;
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

  function renderDailyInsight(manualItems = [], state = {}) {
    const summary = document.querySelector("#daily-insight-summary");
    const list = document.querySelector("#daily-insight-recommendations");
    const action = document.querySelector("#daily-insight-action");
    if (!summary || !list || !action) return;
    latestDailyInsightContext = { manualItems: Array.isArray(manualItems) ? manualItems : [], state };
    resetDailyAiInsight();
    list.innerHTML = "";
    action.hidden = false;
    const recommendations = [];
    let actionLabel = "添加今日待办";
    let actionHandler = () => titleEl()?.focus();

    if (state.loading) {
      summary.textContent = "正在整理风险、回流与待办信号…";
      action.hidden = true;
      return;
    }
    if (state.error || state.authRequired) {
      summary.textContent = "暂时无法读取完整运营信号；先恢复服务连接，再决定下一步。";
      recommendations.push("检查服务连接状态，恢复后再确认风险与发布回流。");
      actionLabel = "查看服务状态";
      actionHandler = openLocalServiceRecovery;
    } else {
      const riskCount = state.riskUnavailable ? 0 : Number(state.riskCount) || 0;
      const publicationCount = state.publicationUnavailable ? 0 : Number(state.publicationCount) || 0;
      const todoCount = Number(state.todoCount) || manualItems.length;
      if (riskCount) {
        recommendations.push(`优先处理 ${riskCount} 条风险工单，确认是否需要转为对外回应或内容调整。`);
        actionLabel = "查看风险工单";
        actionHandler = () => openManagementPanel("#risk-ticket-panel");
      }
      if (publicationCount) recommendations.push(`回流 ${publicationCount} 条已发布内容，补齐真实效果后再评估下一轮动作。`);
      if (todoCount) recommendations.push(`把 ${todoCount} 条个人待办按截止日期和优先级推进，避免关键事项沉到底部。`);
      if (!recommendations.length) recommendations.push("队列已清空。补充一件最重要的事，或在热点追踪中寻找新的运营信号。");
      summary.textContent = riskCount
        ? `发现 ${riskCount} 个需要优先判断的风险信号。`
        : publicationCount
          ? `当前没有风险升级项，${publicationCount} 条内容等待效果回流。`
          : "当前没有需要升级的异常信号。";
    }
    recommendations.slice(0, 3).forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    });
    action.textContent = actionLabel;
    action.onclick = actionHandler;
  }

  function dailyInsightSignalItems(items, fields, limit = 5) {
    return (Array.isArray(items) ? items : []).slice(0, limit).map((item) => {
      const entry = item && typeof item === "object" ? item : {};
      const result = {};
      fields.forEach((field) => {
        const value = String(entry[field] || "").trim();
        if (value) result[field] = value.slice(0, 160);
      });
      return result;
    }).filter((item) => Object.keys(item).length);
  }

  function buildDailyAiInsightContext() {
    const { manualItems, state } = latestDailyInsightContext;
    return {
      game: currentGame(),
      todos: dailyInsightSignalItems(manualItems, ["title", "priority", "due_date", "game"]),
      risks: dailyInsightSignalItems(state.riskItems, ["title", "level", "source", "game"]),
      publications: dailyInsightSignalItems(state.publicationItems, ["title", "channel", "related_topic", "game"])
    };
  }

  function hasDailyAiSignals(context) {
    return context.todos.length + context.risks.length + context.publications.length > 0;
  }

  function setDailyAiInsightStatus(text, tone) {
    const status = document.querySelector("#daily-insight-status");
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone || "";
  }

  function resetDailyAiInsight() {
    const button = document.querySelector("#generate-daily-ai-insight");
    const result = document.querySelector("#daily-ai-insight-result");
    const context = buildDailyAiInsightContext();
    dailyAiInsightGeneration += 1;
    if (result) {
      result.hidden = true;
      result.replaceChildren();
    }
    if (!button) return;
    const available = hasDailyAiSignals(context);
    button.disabled = !available;
    button.setAttribute("aria-disabled", String(!available));
    button.title = available
      ? "仅基于当前待办、风险和待回流内容生成"
      : "当前没有可供 AI 判断的真实工作信号";
    setDailyAiInsightStatus(available ? "规则归纳" : "等待信号", available ? "ready" : "idle");
  }

  function dailyAiFailureText(response) {
    if (response?.reason === "no_key") return "尚未配置 AI 服务，已保留规则归纳结果。";
    if (response?.reason === "timeout") return "AI 响应超时，已保留规则归纳结果。";
    return "AI 洞察暂不可用，已保留规则归纳结果。";
  }

  function renderDailyAiInsightResult(value) {
    const result = document.querySelector("#daily-ai-insight-result");
    if (!result) return;
    const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const summary = typeof payload.summary === "string" ? payload.summary.trim().slice(0, 500) : "";
    const priorities = Array.isArray(payload.priority_actions) ? payload.priority_actions : [];
    const watchouts = Array.isArray(payload.watchouts) ? payload.watchouts : [];
    result.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "AI 决策洞察";
    const copy = document.createElement("p");
    copy.textContent = summary || "AI 未返回可用摘要，请以规则归纳结果为准。";
    result.append(heading, copy);
    [["优先动作", priorities], ["观察项", watchouts]].forEach(([label, items]) => {
      const values = items.filter((item) => typeof item === "string" && item.trim()).slice(0, 3);
      if (!values.length) return;
      const title = document.createElement("small");
      title.textContent = label;
      const list = document.createElement("ul");
      values.forEach((item) => {
        const row = document.createElement("li");
        row.textContent = item.trim().slice(0, 240);
        list.append(row);
      });
      result.append(title, list);
    });
    result.hidden = false;
  }

  async function generateDailyAiInsight() {
    const button = document.querySelector("#generate-daily-ai-insight");
    const context = buildDailyAiInsightContext();
    if (!hasDailyAiSignals(context)) {
      setDailyAiInsightStatus("等待信号", "idle");
      return;
    }
    if (typeof requestLlmTask !== "function") {
      setDailyAiInsightStatus("AI 服务未连接", "warning");
      return;
    }
    const generation = ++dailyAiInsightGeneration;
    if (button) button.disabled = true;
    setDailyAiInsightStatus("AI 正在归纳", "loading");
    const response = await requestLlmTask("daily-insight", context, 45000);
    if (generation !== dailyAiInsightGeneration) return;
    if (button) {
      button.disabled = false;
      button.setAttribute("aria-disabled", "false");
    }
    if (!response.ok) {
      setDailyAiInsightStatus("规则归纳", "warning");
      const result = document.querySelector("#daily-ai-insight-result");
      if (result) {
        result.textContent = dailyAiFailureText(response);
        result.hidden = false;
      }
      return;
    }
    renderDailyAiInsightResult(response.result);
    setDailyAiInsightStatus(response.cached ? "AI 缓存结果" : "AI 已归纳", "ready");
  }

  window.renderTodayTodos = function renderTodayTodos(manualItems, state = {}) {
    const container = listEl();
    if (!container) return;
    container.innerHTML = "";
    setStats(state);
    renderDailyInsight(manualItems, state);

    if (state.loading) {
      container.innerHTML = '<p class="muted-copy">正在汇总今日待办……</p>';
      setConnection("正在同步今日运营状态…", "");
      renderMorningStatus([], true);
      return;
    }
    renderMorningStatus(state.morningRuns || [], false, state.error || state.authRequired || state.morningUnavailable);
    if (renderConnectionState(state)) return;

    const rows = [];
    const riskItems = state.riskItems || [];
    const publicationItems = state.publicationItems || [];
    riskItems.slice(0, 5).forEach((risk) => rows.push({ kind: "risk", node: buildAutoRow({
      kind: "risk",
      title: risk.title,
      badge: "风险工单",
      detail: (risk.level || "中") + "风险 · " + (risk.game || "未设置"),
      actionLabel: "去处理",
      panelId: "#risk-ticket-panel"
    }) }));
    publicationItems.slice(0, 5).forEach((publication) => rows.push({ kind: "publication", node: buildAutoRow({
      kind: "publication",
      title: publication.title,
      badge: "待回流",
      detail: (publication.channel || "未知渠道") + " · " + (publication.game || "未设置"),
      actionLabel: "去回流",
      panelId: "#publication-panel"
    }) }));
    [...manualItems].sort(manualSort).forEach((item) => rows.push({ kind: "manual", item, node: buildManualRow(item, false) }));
    rows.filter(matchesActiveFilter).forEach((row) => container.append(row.node));
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
    const unavailable = [
      state.riskUnavailable ? "风险工单" : "",
      state.publicationUnavailable ? "发布回流" : ""
    ].filter(Boolean);
    const truncations = [];
    if (!state.riskUnavailable && Number(state.riskTotal) > 5) truncations.push(`风险队列仅展示最近 5/${state.riskTotal} 条`);
    if (!state.publicationUnavailable && Number(state.publicationTotal) > 5) truncations.push(`回流队列仅展示最近 5/${state.publicationTotal} 条`);
    if (Number(state.todoTotal) > manualItems.length) truncations.push(`手动待办仅加载最近 ${manualItems.length}/${state.todoTotal} 条`);
    if (Number(state.doneTotal) > doneItems.length) truncations.push(`已完成仅加载最近 ${doneItems.length}/${state.doneTotal} 条`);
    setConnection(unavailable.length ? "部分数据不可用 · 手动待办仍可用" : "已连接 · 队列实时汇总中", unavailable.length ? "warning" : "success");
    setStatus(`已汇总 ${rows.length} 条待办${doneItems.length ? `，另有 ${doneItems.length} 条已完成` : ""}${unavailable.length ? `；${unavailable.join("、")}暂不可用` : ""}${truncations.length ? `；${truncations.join("；")}` : ""}。`, unavailable.length || truncations.length ? "mock" : "real");
  };

  async function request(path, options) {
    const response = await archiveRequest(archiveUrl() + path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || "HTTP " + response.status);
    return payload;
  }

  function isDailyServiceUnavailable(error) {
    return /Failed to fetch|NetworkError|load failed/i.test(String(error?.message || ""));
  }

  function dailyTodoMutationError(error) {
    return isDailyServiceUnavailable(error)
      ? "待办未保存：本机服务未连接；启动服务后重试。"
      : "待办未保存：请稍后重试。";
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
      setStatus(dailyTodoMutationError(error), "mock");
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
      setStatus(dailyTodoMutationError(error), "mock");
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
    document.querySelector("#version-game")?.addEventListener("input", refreshProjectContext);
    document.querySelector("#version-theme")?.addEventListener("input", refreshProjectContext);
    document.querySelector("#daily-project-version-action")?.addEventListener("click", () => {
      if (typeof navigateToView === "function") navigateToView("version");
    });
    document.querySelector("#daily-project-profile-action")?.addEventListener("click", () => {
      if (typeof navigateToView === "function") navigateToView("overview");
      window.setTimeout(() => document.querySelector("#profile-select")?.focus(), 0);
    });
    document.querySelector("#daily-todo-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      addTodo();
    });
    document.querySelector("#refresh-daily-todos")?.addEventListener("click", () => window.loadTodayTodos?.());
    document.querySelector("#generate-daily-ai-insight")?.addEventListener("click", generateDailyAiInsight);
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
