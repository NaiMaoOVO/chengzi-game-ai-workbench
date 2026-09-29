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
  let visibilityRefreshRegistered = false;
  let lastDailyBusinessDate = "";
  let latestDailyInsightContext = { manualItems: [], state: {} };
  let dailyAiInsightGeneration = 0;
  let dailyAiInsightResultKey = "";
  let dailyAiInsightUserKey = "";
  let dailyAiInsightSnapshot = null;
  let dailyAiInsightPendingContextKey = "";
  let dailyAiInsightPendingUserKey = "";
  let dailyAiInsightNeedsRetry = false;
  let lastDailyQueueSnapshot = null;
  let observedDailyQueueSessionKey = "";

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

  function setStats({ todoCount = 0, todoTotal = todoCount, riskCount = 0, publicationCount = 0, doneItems = [], doneTotal = doneItems.length, loading = false, error = false, authRequired = false, archiveOffline = false, archiveStorageUnavailable = false, staleSnapshot = false, todoUnavailable = false, doneUnavailable = false, riskUnavailable = false, publicationUnavailable = false, publicationTruncated = false } = {}) {
    const serviceUnavailable = loading || error || authRequired || ((archiveOffline || archiveStorageUnavailable) && !staleSnapshot);
    setText("#daily-stat-todo", serviceUnavailable || todoUnavailable ? "—" : todoCount);
    setText("#daily-stat-risk", serviceUnavailable || riskUnavailable ? "—" : riskCount);
    setText("#daily-stat-publish", serviceUnavailable || publicationUnavailable || publicationTruncated && !publicationCount
      ? "—"
      : publicationTruncated ? `≥${publicationCount}` : publicationCount);
    const loadedManual = todoCount + doneItems.length;
    const totalManual = Math.max(todoCount, Number(todoTotal) || 0) + Math.max(doneItems.length, Number(doneTotal) || 0);
    const loadedHint = loadedManual < totalManual ? `（当前加载 ${loadedManual}/${totalManual} 条）` : "";
    let progressSummary = "从一条关键待办开始，风险与回流会自动汇总到这里。";
    if (staleSnapshot) progressSummary = "同步失败；下方保留的是上次成功读取的队列，刷新后再确认最新状态。";
    else if (todoUnavailable) progressSummary = "手动待办暂不可用；风险、回流与热点仍按各自数据状态展示。";
    else if (doneUnavailable) progressSummary = `已同步 ${todoCount} 条未完成待办；已完成记录暂不可用。`;
    else if (totalManual) progressSummary = `已完成 ${doneItems.length}/${totalManual} 项手动待办${loadedHint}，优先清空高风险事项。`;
    setText("#daily-progress-summary", progressSummary);
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

  function dailyQueueSessionKey() {
    const serviceMode = typeof getServiceMode === "function" ? getServiceMode() : "local";
    const prefix = `${serviceMode}|`;
    const user = typeof archiveSessionUser === "undefined" ? null : archiveSessionUser;
    if (typeof archiveAuthRequired !== "undefined" && archiveAuthRequired && !user) return `${prefix}unauthenticated`;
    if (!user) return `${prefix}anonymous`;
    if (typeof user !== "object") return `${prefix}${String(user)}`;
    const userId = user.id || user.user_id || "";
    const username = user.username || user.email || "";
    return `${prefix}${userId}|${username}`;
  }

  function captureDailyQueueSnapshot(manualItems, state) {
    const copyItems = (items) => (Array.isArray(items) ? items : []).map((item) => item && typeof item === "object" ? { ...item } : item);
    const platformSnapshot = state.platformSnapshot && typeof state.platformSnapshot === "object"
      ? { ...state.platformSnapshot, topics: copyItems(state.platformSnapshot.topics) }
      : state.platformSnapshot;
    return {
      userKey: dailyQueueSessionKey(),
      capturedAt: Date.now(),
      manualItems: copyItems(manualItems),
      state: {
        ...state,
        riskItems: copyItems(state.riskItems),
        publicationItems: copyItems(state.publicationItems),
        doneItems: copyItems(state.doneItems),
        morningRuns: copyItems(state.morningRuns),
        platformSnapshots: copyItems(state.platformSnapshots),
        platformSnapshot
      }
    };
  }

  function isDailyWorkbenchActive() {
    return document.querySelector("#daily-view")?.classList.contains("active");
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

  function refreshDailyDateLabels() {
    const currentDate = today();
    const due = dueEl();
    if (due && lastDailyBusinessDate && due.value === lastDailyBusinessDate && currentDate !== lastDailyBusinessDate) {
      due.value = currentDate;
    }
    const date = new Date(`${currentDate}T12:00:00+08:00`);
    const label = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(date);
    setText("#daily-date-label", label);
    setText("#topbar-date", label);
    lastDailyBusinessDate = currentDate;
  }

  function shiftBusinessDate(dateValue, days) {
    const base = new Date(`${dateValue}T12:00:00+08:00`);
    const source = Number.isNaN(base.getTime()) ? new Date() : base;
    return businessDate(new Date(source.getTime() + days * 86400000));
  }

  let pendingDailyTodoRequest = null;

  function dailyTodoRequestSignature(game, title, priority, dueDate) {
    return JSON.stringify({ game, title, priority, dueDate });
  }

  function dailyTodoRequestId(game, title, priority, dueDate) {
    const signature = dailyTodoRequestSignature(game, title, priority, dueDate);
    if (pendingDailyTodoRequest?.signature === signature) return pendingDailyTodoRequest.id;
    const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    pendingDailyTodoRequest = { signature, id: `daily-todo-${nonce}` };
    return pendingDailyTodoRequest.id;
  }

  function clearDailyTodoRequest(game, title, priority, dueDate) {
    if (pendingDailyTodoRequest?.signature === dailyTodoRequestSignature(game, title, priority, dueDate)) {
      pendingDailyTodoRequest = null;
    }
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

  function sortRiskItems(items) {
    const levelOrder = { 高: 0, 中: 1, 低: 2 };
    return [...(Array.isArray(items) ? items : [])].sort((a, b) =>
      (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3) || Number(b.id || 0) - Number(a.id || 0)
    );
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
    if (state.archiveStorageUnavailable) {
      const local = !isOnlineServiceMode();
      setConnection(local ? "本机服务在线 · 存储未就绪" : "线上存档存储未就绪", "danger");
      renderEmptyState(
        local ? "本机存档服务正在响应，但 SQLite 存储暂不可用；请检查数据库状态后重试。" : "线上存档服务正在响应，但账号数据存储暂不可用；请稍后重试。",
        "重试同步",
        () => window.loadTodayTodos?.()
      );
      setStatus("服务进程在线，但归档存储未就绪；待办、风险和回流状态暂不可确认。", "mock");
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
    renderDailyInsightSignalCounts(manualItems, state);
    latestDailyInsightContext = { manualItems: Array.isArray(manualItems) ? manualItems : [], state };
    syncDailyAiInsight();
    list.innerHTML = "";
    action.hidden = false;
    const platformSnapshot = state.platformSnapshot && typeof state.platformSnapshot === "object" ? state.platformSnapshot : {};
    const knownTopics = Array.isArray(platformSnapshot.topics) ? platformSnapshot.topics : [];
    const hotspotSourceLabel = {
      real: "真实平台",
      sample: "样例",
      mixed: "真实 / 样例混合",
      unverified: "来源未核验"
    }[platformSnapshot.topicSource] || "来源未核验";
    const knownHotspot = knownTopics[0];
    const recommendations = [];
    let actionLabel = "添加今日待办";
    let actionHandler = () => titleEl()?.focus();

    if (state.loading) {
      summary.textContent = "正在整理风险、回流与待办信号…";
      action.hidden = true;
      return;
    }
    if (state.authRequired) {
      const localFile = window.location.protocol === "file:";
      summary.textContent = localFile
        ? "本地文件模式无法登录线上账号，请改用线上站点或本机个人服务。"
        : "请登录后再查看当前账号的风险与发布回流。";
      if (knownTopics.length) {
        summary.textContent += ` 当前仍保留 ${Math.max(knownTopics.length, Number(platformSnapshot.topicCount) || 0)} 条${hotspotSourceLabel}热点。`;
        recommendations.push(`先核对${hotspotSourceLabel}热点「${knownHotspot.title || "未命名话题"}」的原始页面和更新时间，再决定是否转为待办。`);
      }
      recommendations.push(localFile
        ? "通过 HTTPS 线上站点登录，或启动本机服务后继续作为个人工作台使用。"
        : "登录后即可恢复待办、风险工单和发布回流的同步。");
      actionLabel = localFile ? "查看本机服务" : "去登录";
      actionHandler = localFile
        ? openLocalServiceRecovery
        : () => document.querySelector("#archive-login-username")?.focus();
    } else if (state.archiveStorageUnavailable) {
      summary.textContent = "归档服务仍可访问，但存储暂未就绪；当前无法确认完整的运营队列。";
      recommendations.push("检查归档数据库或磁盘状态，恢复后重新同步；不要把缺失数据当作队列已清空。");
      actionLabel = "重试同步";
      actionHandler = () => window.loadTodayTodos?.();
    } else if (state.error || state.archiveOffline) {
      const local = !isOnlineServiceMode();
      summary.textContent = state.archiveOffline
        ? local ? "本机存档服务未连接；今日运营记录暂不可读取。" : "线上存档服务暂不可用；账号运营记录暂不可读取。"
        : "暂时无法读取完整运营信号；先恢复服务连接，再决定下一步。";
      if (knownTopics.length) {
        summary.textContent = `待办、风险与回流暂不可同步；当前仍保留 ${Math.max(knownTopics.length, Number(platformSnapshot.topicCount) || 0)} 条${hotspotSourceLabel}热点。`;
        recommendations.push(`先核对${hotspotSourceLabel}热点「${knownHotspot.title || "未命名话题"}」的原始页面和更新时间，不把它当作已确认结论。`);
      }
      recommendations.push(state.archiveOffline
        ? local ? "启动本机服务后，再核对待办、风险和发布回流。" : "确认线上存档服务状态后，再重试同步。"
        : "检查服务连接状态，恢复后再确认风险与发布回流。");
      actionLabel = local ? "查看本机服务" : "重新连接";
      actionHandler = () => local ? openLocalServiceRecovery() : window.loadTodayTodos?.();
    } else {
      const riskCount = state.riskUnavailable ? 0 : Number(state.riskCount) || 0;
      const publicationCount = state.publicationUnavailable ? 0 : Number(state.publicationCount) || 0;
      const todoCount = Number(state.todoCount) || manualItems.length;
      if (state.riskUnavailable) {
        recommendations.push("风险工单未同步，恢复连接后再判断是否需要升级处理。");
        actionLabel = "重试同步";
        actionHandler = () => window.loadTodayTodos?.();
      }
      if (state.todoUnavailable) {
        recommendations.push("个人待办暂未同步，不能判断今日队列是否已清空；恢复后再核对。");
        actionLabel = "重试同步";
        actionHandler = () => window.loadTodayTodos?.();
      }
      if (state.publicationUnavailable) {
        recommendations.push("发布回流暂未同步，不能确认是否有内容等待补齐效果数据。");
        actionLabel = "重试同步";
        actionHandler = () => window.loadTodayTodos?.();
      }
      if (riskCount) {
        recommendations.push(`优先处理 ${riskCount} 条风险工单，确认是否需要转为对外回应或内容调整。`);
        actionLabel = "查看风险工单";
        actionHandler = () => openManagementPanel("#risk-ticket-panel");
      }
      if (publicationCount) recommendations.push(state.publicationTruncated
        ? `至少有 ${publicationCount} 条发布内容待效果回流，补齐结果后再评估下一轮动作。`
        : `回流 ${publicationCount} 条已发布内容，补齐真实效果后再评估下一轮动作。`);
      if (todoCount) recommendations.push(`把 ${todoCount} 条个人待办按截止日期和优先级推进，避免关键事项沉到底部。`);
      if (!recommendations.length) recommendations.push(state.todoUnavailable
        ? "个人待办暂未同步，不能判断今日队列是否已清空。"
        : "队列已清空。补充一件最重要的事，或在热点追踪中寻找新的运营信号。");
      if (state.riskUnavailable) {
        const publicationNote = state.publicationUnavailable
          ? "；发布回流也未同步"
          : publicationCount ? `；${publicationCount} 条内容等待效果回流` : "";
        summary.textContent = `风险工单未同步，暂无法判断是否存在待处理风险${publicationNote}。`;
      } else if (state.todoUnavailable && state.publicationUnavailable && !riskCount) {
        summary.textContent = "个人待办与发布回流暂未同步，无法判断今日队列是否完整。";
      } else if (state.todoUnavailable && !riskCount && !publicationCount) {
        summary.textContent = "个人待办暂未同步，不能判断今日队列是否已清空。";
      } else if (state.publicationUnavailable && !riskCount) {
        summary.textContent = "发布回流暂未同步，不能确认是否有内容等待补齐效果数据。";
      } else if (riskCount) {
        summary.textContent = `发现 ${riskCount} 个需要优先判断的风险信号。`;
      } else if (publicationCount) {
        summary.textContent = `当前没有风险升级项，${publicationCount} 条内容等待效果回流。`;
      } else {
        summary.textContent = "当前没有需要升级的异常信号。";
      }
    }
    recommendations.slice(0, 3).forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    });
    action.textContent = actionLabel;
    action.onclick = actionHandler;
  }

  function renderDailyInsightSignalCounts(manualItems = [], state = {}) {
    const serviceUnavailable = Boolean(state.loading || state.error || state.authRequired || state.archiveOffline && !state.staleSnapshot);
    const unavailable = (key) => serviceUnavailable || Boolean(state[key]);
    setText("#daily-ai-todo-count", unavailable("todoUnavailable") ? "—" : Number(state.todoCount) || manualItems.length || 0);
    setText("#daily-ai-risk-count", unavailable("riskUnavailable") ? "—" : Number(state.riskCount) || 0);
    const publicationCount = Number(state.publicationCount) || 0;
    setText("#daily-ai-publication-count", unavailable("publicationUnavailable") || state.publicationTruncated && !publicationCount
      ? "—"
      : state.publicationTruncated ? `≥${publicationCount}` : publicationCount);
  }

  function platformValue(value, fallback = "未设置") {
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallback).slice(0, 60);
  }

  function platformSourceLabel(source) {
    if (source === "real") return "真实热点";
    if (source === "sample") return "样例兜底";
    if (source === "mixed") return "真实 / 样例混合";
    if (source === "unverified") return "热点来源未核验";
    return "未读取热点";
  }

  function platformSnapshotTime(value, kind) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return kind === "restored" ? "原快照时间未知 · 请刷新核验" : "时间未知";
    const time = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
    const label = { source: "更新于", sample: "样例于", mixed: "刷新于", unverified: "载入于", archive: "存档于", restored: "原快照时间" }[kind] || "时间未知";
    return `${label} ${time}`;
  }

  function appendPlatformCell(row, value, className) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value;
    row.append(cell);
  }

  function renderDailyPlatformOverview(state = {}) {
    const list = document.querySelector("#daily-platform-list");
    const status = document.querySelector("#daily-platform-status");
    const note = document.querySelector("#daily-platform-note");
    if (!list || !status || !note) return;
    list.replaceChildren();

    if (state.loading) {
      const row = document.createElement("tr");
      appendPlatformCell(row, "正在同步平台信号…", "daily-platform-empty");
      row.firstChild.colSpan = 4;
      list.append(row);
      status.textContent = "同步中";
      status.dataset.tone = "loading";
      note.textContent = "正在读取当前项目的热点存档与待回流内容。";
      return;
    }

    const snapshot = state.platformSnapshot && typeof state.platformSnapshot === "object" ? state.platformSnapshot : {};
    const platform = platformValue(snapshot.platform);
    const topics = Math.max(0, Number(snapshot.topicCount) || 0);
    const source = ["real", "sample", "mixed", "unverified"].includes(snapshot.topicSource) ? snapshot.topicSource : "";
    const publicationUnavailable = Boolean(state.publicationUnavailable || state.error || state.authRequired);
    const topicRows = Array.isArray(snapshot.topics) ? snapshot.topics : [];
    const expectedTopCount = Math.min(topics, 5);
    const topicViews = source === "real" ? topicRows.map((topic) => Number(topic?.views)) : [];
    const hasCompleteTopViews = source === "real"
      && expectedTopCount > 0
      && topicRows.length === expectedTopCount
      && topicViews.every((views) => Number.isFinite(views) && views > 0);
    const topFiveViews = hasCompleteTopViews ? topicViews.reduce((sum, views) => sum + views, 0) : null;
    const rows = new Map();
    const ensureRow = (name) => {
      const key = platformValue(name);
      if (!rows.has(key)) rows.set(key, { platform: key, topics: null, topFiveViews: null, publications: 0, source: "", updatedAt: "", updatedAtKind: "" });
      return rows.get(key);
    };
    (Array.isArray(state.platformSnapshots) ? state.platformSnapshots : []).forEach((item) => {
      const payload = item && item.payload && typeof item.payload === "object" ? item.payload : {};
      if (item?.invalid || !payload.platform || !Array.isArray(payload.topics)) return;
      const row = ensureRow(payload.platform);
      if (row.updatedAt || row.topics !== null) return;
      row.topics = payload.topics.length;
      row.source = ["real", "sample", "mixed", "unverified"].includes(payload.topicSource)
        ? payload.topicSource
        : item.source === "real" || payload.source === "real" ? "real" : "sample";
      row.updatedAt = item.created_at || "";
      row.updatedAtKind = "archive";
    });
    if (snapshot.platform && source && !snapshot.restored) {
      const active = ensureRow(platform);
      active.topics = topics;
      active.topFiveViews = topFiveViews;
      active.source = source;
      active.updatedAt = snapshot.updatedAt || "";
      active.updatedAtKind = snapshot.updatedAtKind || "";
    } else if (snapshot.platform && source && !rows.has(platform)) {
      const restored = ensureRow(platform);
      restored.topics = topics;
      restored.source = source;
      restored.updatedAtKind = "restored";
    } else if (snapshot.platform && !rows.has(platform)) {
      ensureRow(platform);
    }
    if (!publicationUnavailable) {
      (Array.isArray(state.publicationItems) ? state.publicationItems : []).forEach((item) => {
        const row = ensureRow(item?.channel);
        row.publications += 1;
      });
    }

    if (!rows.size) {
      const row = document.createElement("tr");
      appendPlatformCell(row, "暂无已同步的平台数据，请先刷新热点或登记发布链接。", "daily-platform-empty");
      row.firstChild.colSpan = 4;
      list.append(row);
      status.textContent = "暂无信号";
      status.dataset.tone = "idle";
      note.textContent = state.authRequired || state.error
        ? "服务恢复后会继续汇总平台信号；不会用模拟指标替代真实数据。"
        : "当前工作台没有热点或待回流内容。";
      return;
    }

    rows.forEach((item) => {
      const row = document.createElement("tr");
      appendPlatformCell(row, item.platform, "daily-platform-name");
      const displayRank = item.topics === null ? 0 : Math.min(item.topics, 5);
      const topicSummary = item.topics === null ? "—" : item.topFiveViews === null
        ? `${item.topics} 条已存档`
        : `${item.topics} 条 · TOP${displayRank} ${item.topFiveViews.toLocaleString("zh-CN")} 播放`;
      appendPlatformCell(row, topicSummary);
      const publicationSummary = publicationUnavailable || state.publicationTruncated && !item.publications
        ? "—"
        : state.publicationTruncated ? `≥${item.publications}` : String(item.publications);
      appendPlatformCell(row, publicationSummary);
      const dataState = item.source
        ? `${platformSourceLabel(item.source)} · ${platformSnapshotTime(item.updatedAt, item.updatedAtKind)}`
        : publicationUnavailable ? "回流未连接" : item.publications ? "待回流" : "未读取热点";
      appendPlatformCell(row, dataState, "daily-platform-state");
      list.append(row);
    });
    const hasPublications = [...rows.values()].some((item) => item.publications > 0);
    const topicRowsAvailable = [...rows.values()].filter((item) => item.topics !== null);
    const sourceKinds = new Set(topicRowsAvailable.map((item) => item.source));
    const hasMixedSources = sourceKinds.has("mixed") || sourceKinds.has("real") && sourceKinds.has("sample");
    status.textContent = hasMixedSources
      ? "真实 / 样例混合"
      : sourceKinds.has("unverified") ? "来源未核验"
      : sourceKinds.has("real") ? "已读取真实信号"
        : sourceKinds.has("sample") ? "含样例兜底"
          : hasPublications ? "回流信号" : "等待热点";
    status.dataset.tone = hasMixedSources ? "mixed"
      : sourceKinds.has("unverified") ? "unverified"
        : sourceKinds.has("sample") ? "sample" : sourceKinds.has("real") ? "real" : "idle";
    const game = String(state.platformGame || "").trim();
    const topicNote = topicRowsAvailable.length
      ? `已读取热点 ${topicRowsAvailable.length} 个平台${game ? ` · ${game}` : ""}`
      : "热点尚未同步";
    const historyNote = state.platformHistoryUnavailable ? "；历史热点存档暂不可用" : "";
    note.textContent = `${topicNote}${historyNote}${publicationUnavailable ? "；待回流暂不可用" : state.publicationTruncated ? "；仅扫描最近 200 条发布记录，待回流数为下限" : ""}`;
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

  function latestDailyHotspotArchive(items, game) {
    const now = Date.now();
    const expectedGame = String(game || "").trim();
    return (Array.isArray(items) ? items : []).map((item) => {
      const payload = item && item.payload && typeof item.payload === "object" ? item.payload : {};
      const createdAt = typeof item?.created_at === "string" ? item.created_at : "";
      const createdAtTime = Date.parse(createdAt);
      const itemGame = String(item?.game || payload.game || "").trim();
      if (item?.invalid || typeof payload.platform !== "string" || !payload.platform.trim() || !Array.isArray(payload.topics)
        || !Number.isFinite(createdAtTime) || createdAtTime > now || now - createdAtTime > 24 * 60 * 60 * 1000
        || expectedGame && expectedGame !== itemGame) return null;
      const topics = dailyInsightSignalItems(payload.topics, ["title", "tag", "risk", "views", "danmaku", "source"]);
      if (!topics.length) return null;
      const source = ["real", "sample", "mixed", "unverified"].includes(payload.topicSource)
        ? payload.topicSource
        : item.source === "real" || payload.source === "real" ? "real"
          : item.source === "sample" || payload.source === "sample" ? "sample" : "unverified";
      return { item, payload, createdAt, createdAtTime, itemGame, topics, source };
    }).filter(Boolean).sort((left, right) => right.createdAtTime - left.createdAtTime)[0] || null;
  }

  function buildDailyAiInsightContext() {
    const { manualItems, state } = latestDailyInsightContext;
    const snapshot = state.platformSnapshot && typeof state.platformSnapshot === "object" ? state.platformSnapshot : {};
    const orderedManualItems = Array.isArray(manualItems) ? [...manualItems].sort(manualSort) : [];
    const todos = dailyInsightSignalItems(orderedManualItems, ["title", "priority", "due_date", "game"]);
    const todoTotal = Math.max(todos.length, Number(state.todoTotal ?? state.todoCount) || 0);
    const todoTruncated = todoTotal > todos.length;
    const risks = dailyInsightSignalItems(sortRiskItems(state.riskItems), ["title", "level", "source", "game"]);
    const riskTotal = Math.max(risks.length, Number(state.riskCount ?? state.riskTotal) || 0);
    const publications = dailyInsightSignalItems(state.publicationItems, ["title", "channel", "related_topic", "game"]);
    const publicationTotal = Math.max(publications.length, Number(state.publicationCount ?? state.publicationTotal) || 0);
    const publicationScanTruncated = Boolean(state.publicationTruncated);
    const publicationTruncated = publicationScanTruncated || publicationTotal > publications.length;
    const activeHotspots = dailyInsightSignalItems(snapshot.topics, ["title", "tag", "risk", "views", "danmaku", "source"]);
    const archivedHotspot = activeHotspots.length ? null
      : latestDailyHotspotArchive(state.platformSnapshots, state.platformGame || snapshot.game || currentGame());
    const hotspots = activeHotspots.length ? activeHotspots : archivedHotspot?.topics || [];
    const hotspotGame = String(archivedHotspot?.itemGame || snapshot.game || state.platformGame || currentGame()).trim();
    const hotspotPlatform = String(archivedHotspot?.payload.platform || snapshot.platform || "").trim().slice(0, 60);
    const hotspotTotal = archivedHotspot
      ? Math.max(hotspots.length, Number(archivedHotspot.payload.topicCount) || archivedHotspot.payload.topics.length)
      : Math.max(hotspots.length, Number(snapshot.topicCount) || 0);
    const hotspotUpdatedAt = archivedHotspot ? archivedHotspot.createdAt : snapshot.updatedAt;
    const hotspotUpdatedAtTime = typeof hotspotUpdatedAt === "string" ? Date.parse(hotspotUpdatedAt) : NaN;
    return {
      game: currentGame(),
      asOfDate: today(),
      hotspotGame,
      todos,
      todoTotal,
      todoTruncated,
      todoUnavailable: Boolean(state.todoUnavailable || state.error || state.authRequired),
      risks,
      riskTotal,
      riskTruncated: riskTotal > risks.length,
      riskUnavailable: Boolean(state.riskUnavailable || state.error || state.authRequired),
      publications,
      publicationTotal,
      publicationScanTruncated,
      publicationTruncated,
      publicationUnavailable: Boolean(state.publicationUnavailable || state.error || state.authRequired),
      loading: Boolean(state.loading),
      hotspots,
      hotspotPlatform,
      hotspotTotal,
      hotspotTruncated: hotspotTotal > hotspots.length,
      hotspotSource: archivedHotspot ? archivedHotspot.source
        : ["real", "sample", "mixed", "unverified"].includes(snapshot.topicSource) ? snapshot.topicSource : "",
      hotspotRange: ["today", "24h", "3d", "7d"].includes(archivedHotspot?.payload.range || snapshot.range)
        ? archivedHotspot?.payload.range || snapshot.range : "",
      hotspotUpdatedAt: Number.isFinite(hotspotUpdatedAtTime) ? new Date(hotspotUpdatedAtTime).toISOString() : "",
      hotspotRestored: !archivedHotspot && Boolean(snapshot.restored || snapshot.updatedAtKind === "restored"),
      hotspotArchived: Boolean(archivedHotspot),
      hotspotHistoryUnavailable: Boolean(state.platformHistoryUnavailable && !archivedHotspot)
    };
  }

  window.getDailyWorkbenchBriefingSnapshot = function getDailyWorkbenchBriefingSnapshot() {
    const context = buildDailyAiInsightContext();
    return {
      scope: allProjectsScope,
      todos: context.todos,
      todoTotal: context.todoTotal,
      todoTruncated: context.todoTruncated,
      todoUnavailable: context.todoUnavailable || context.loading,
      risks: context.risks,
      riskTotal: context.riskTotal,
      riskTruncated: context.riskTruncated,
      riskUnavailable: context.riskUnavailable || context.loading,
      publications: context.publications,
      publicationTotal: context.publicationTotal,
      publicationTruncated: context.publicationTruncated,
      publicationScanTruncated: context.publicationScanTruncated,
      publicationUnavailable: context.publicationUnavailable || context.loading
    };
  };

  window.getDailyAiInsightBriefingSnapshot = function getDailyAiInsightBriefingSnapshot() {
    const context = buildDailyAiInsightContext();
    const result = document.querySelector("#daily-ai-insight-result");
    if (!result || result.hidden || !dailyAiInsightSnapshot
      || dailyAiInsightResultKey !== dailyAiInsightContextKey(context)) return null;
    return {
      ...dailyAiInsightSnapshot,
      priorityActions: [...dailyAiInsightSnapshot.priorityActions],
      watchouts: [...dailyAiInsightSnapshot.watchouts]
    };
  };

  function hasDailyAiSignals(context) {
    return !context.loading && context.todos.length + context.risks.length + context.publications.length + context.hotspots.length > 0;
  }

  function setDailyAiInsightStatus(text, tone) {
    const status = document.querySelector("#daily-insight-status");
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone || "";
  }

  function dailyAiInsightContextKey(context) {
    const stableContext = { ...context };
    delete stableContext.loading;
    return JSON.stringify(stableContext);
  }

  function clearDailyAiInsightResult() {
    const result = document.querySelector("#daily-ai-insight-result");
    if (result) {
      result.hidden = true;
      result.replaceChildren();
    }
    dailyAiInsightResultKey = "";
    dailyAiInsightUserKey = "";
    dailyAiInsightSnapshot = null;
  }

  function syncDailyAiInsight() {
    const button = document.querySelector("#generate-daily-ai-insight");
    const result = document.querySelector("#daily-ai-insight-result");
    const context = buildDailyAiInsightContext();
    const contextKey = dailyAiInsightContextKey(context);
    const userKey = dailyQueueSessionKey();
    const hasPendingRequest = Boolean(dailyAiInsightPendingContextKey);
    const pendingMatches = hasPendingRequest
      && dailyAiInsightPendingContextKey === contextKey
      && dailyAiInsightPendingUserKey === userKey;
    if (!pendingMatches) {
      dailyAiInsightGeneration += 1;
      if (hasPendingRequest) dailyAiInsightNeedsRetry = true;
      dailyAiInsightPendingContextKey = "";
      dailyAiInsightPendingUserKey = "";
    }
    let hasResult = Boolean(result && !result.hidden);
    if (hasResult && dailyAiInsightUserKey !== dailyQueueSessionKey()) {
      clearDailyAiInsightResult();
      hasResult = false;
    }
    const clearResult = () => {
      clearDailyAiInsightResult();
    };
    const setActionButtonsDisabled = (disabled) => {
      result?.querySelectorAll?.(".daily-ai-action-add")?.forEach((action) => {
        action.disabled = disabled;
        if (disabled) action.title = "数据正在更新或未同步；恢复后重新生成洞察，再使用这条建议。";
        else action.removeAttribute("title");
      });
    };

    if (context.loading) {
      setActionButtonsDisabled(true);
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      const statusText = dailyAiInsightNeedsRetry ? "数据刷新中 · 旧洞察已取消，完成后请重新生成"
        : pendingMatches ? "数据刷新中 · 当前洞察继续生成"
          : hasResult ? "数据刷新中 · 保留上次洞察" : "正在整理数据";
      setDailyAiInsightStatus(statusText, dailyAiInsightNeedsRetry ? "warning" : "loading");
      return;
    }
    if (context.authRequired) {
      clearResult();
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      setDailyAiInsightStatus("请登录后重新生成", "warning");
      return;
    }
    if (context.todoUnavailable && context.riskUnavailable && context.publicationUnavailable) {
      setActionButtonsDisabled(true);
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      const statusText = dailyAiInsightNeedsRetry ? "数据未同步 · 洞察已取消，恢复后请重新生成"
        : hasResult ? "数据未同步 · 保留上次洞察" : "等待服务连接";
      setDailyAiInsightStatus(statusText, "warning");
      return;
    }

    const available = hasDailyAiSignals(context);
    const resultMatches = hasResult && dailyAiInsightResultKey === contextKey;
    if (hasResult && !resultMatches) clearResult();
    if (resultMatches) setActionButtonsDisabled(Boolean(context.todoUnavailable));
    if (button) {
      button.disabled = !available || pendingMatches;
      button.setAttribute("aria-disabled", String(!available || pendingMatches));
      button.title = pendingMatches ? "AI 正在归纳当前运营信号"
        : available
          ? "手动触发；每类最多发送 5 条信号及项目、数量、热点平台/来源/范围和快照时间到已配置的 AI 服务"
          : "当前没有可供 AI 判断的工作信号或样例信号";
    }
    const statusText = pendingMatches ? "AI 洞察正在生成"
      : dailyAiInsightNeedsRetry ? "信号已变化 · 洞察已取消，请重新生成"
        : resultMatches ? "AI 洞察已保留"
          : hasResult ? "信号已更新 · 请重新生成"
            : available ? "规则归纳" : "等待信号";
    const statusTone = pendingMatches ? "loading" : dailyAiInsightNeedsRetry || hasResult && !resultMatches ? "warning" : resultMatches || available ? "ready" : "idle";
    setDailyAiInsightStatus(statusText, statusTone);
  }

  function dailyAiFailureText(response) {
    if (response?.reason === "no_key") return "尚未配置 AI 服务，已保留规则归纳结果。";
    if (response?.reason === "timeout") return "AI 响应超时，已保留规则归纳结果。";
    return "AI 洞察暂不可用，已保留规则归纳结果。";
  }

  function dailyAiInsightInputLabel(context = buildDailyAiInsightContext()) {
    const publicationTotal = Math.max(context.publications.length, Number(context.publicationTotal) || 0);
    const publicationScanTruncated = Boolean(context.publicationScanTruncated
      || context.publicationTruncated && context.publicationTotal === undefined);
    const parts = [
      context.todos.length ? context.todoTruncated
        ? `${context.todoTotal} 条待办（仅向 AI 提供前 ${context.todos.length} 条）`
        : `${context.todos.length} 条待办` : "",
      context.risks.length ? context.riskTruncated
        ? `${context.riskTotal} 条风险工单（仅向 AI 提供前 ${context.risks.length} 条）`
        : `${context.risks.length} 条风险工单` : "",
      context.publications.length ? publicationScanTruncated
        ? `至少 ${publicationTotal} 条待回流（仅向 AI 提供前 ${context.publications.length} 条，台账只扫描最近 200 条）`
        : context.publicationTruncated
          ? `${publicationTotal} 条待回流（仅向 AI 提供前 ${context.publications.length} 条）`
          : `${context.publications.length} 条待回流` : ""
    ].filter(Boolean);
    const projects = new Set([...context.todos, ...context.risks, ...context.publications]
      .map((item) => String(item.game || "").trim())
      .filter(Boolean));
    if (context.hotspots.length && context.hotspotGame) projects.add(context.hotspotGame);
    const projectNames = [...projects];
    if (projectNames.length) {
      const visibleProjects = projectNames.slice(0, 3).join("、");
      const remainingProjects = projectNames.length > 3 ? ` 等 ${projectNames.length} 个项目` : "";
      parts.push(`涉及项目：${visibleProjects}${remainingProjects}`);
    }
    if (context.asOfDate) parts.push(`业务日期：${context.asOfDate}`);
    if (context.hotspots.length) {
      parts.push(`热点平台 ${context.hotspotPlatform || "未提供"}`);
      const hotspotLabel = context.hotspotSource === "real" ? "真实热点"
        : context.hotspotSource === "sample" ? "样例兜底热点"
          : context.hotspotSource === "mixed" ? "真实与样例混合热点"
            : context.hotspotSource === "unverified" ? "来源未核验热点" : "热点";
      parts.push(context.hotspotTruncated
        ? `${context.hotspotTotal} 条${hotspotLabel}（仅向 AI 提供前 ${context.hotspots.length} 条）`
        : `${context.hotspots.length} 条${hotspotLabel}`);
      const hotspotRangeLabel = { today: "今日", "24h": "近 24 小时", "3d": "近 3 天", "7d": "近 7 天" }[context.hotspotRange];
      parts.push(`热点筛选范围 ${hotspotRangeLabel || "未提供"}`);
      parts.push(context.hotspotArchived
        ? context.hotspotUpdatedAt ? `服务端历史热点存档，存档时间 ${context.hotspotUpdatedAt}；不是本次抓取结果` : "服务端历史热点存档，存档时间未知；不是本次抓取结果"
        : context.hotspotRestored
        ? context.hotspotUpdatedAt ? `历史缓存热点，原快照时间 ${context.hotspotUpdatedAt}` : "历史缓存热点，原快照时间未知"
        : context.hotspotUpdatedAt ? `热点快照时间 ${context.hotspotUpdatedAt}` : "热点快照时间未知");
    }
    if (context.hotspotHistoryUnavailable) parts.push("历史热点存档暂不可用；不能据此断言历史范围内没有热点或判断历史趋势");
    if (context.riskUnavailable) parts.push("风险工单未同步");
    if (context.publicationUnavailable) parts.push("发布回流未同步");
    if (context.todoUnavailable) parts.push("待办未同步");
    return `提交给 AI 的输入：${parts.join(" · ") || "当前无可用信号"}${["sample", "mixed"].includes(context.hotspotSource) ? "；含样例数据，仅供参考" : context.hotspotSource === "unverified" ? "；来源未核验" : ""}`;
  }

  function renderDailyAiInsightResult(value, context = buildDailyAiInsightContext()) {
    const result = document.querySelector("#daily-ai-insight-result");
    if (!result) return;
    const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const summary = typeof payload.summary === "string" ? payload.summary.trim().slice(0, 500) : "";
    const priorities = Array.isArray(payload.priority_actions) ? payload.priority_actions : [];
    const watchouts = Array.isArray(payload.watchouts) ? payload.watchouts : [];
    const priorityActions = priorities.filter((item) => typeof item === "string" && item.trim()).slice(0, 3).map((item) => item.trim().slice(0, 240));
    const watchoutItems = watchouts.filter((item) => typeof item === "string" && item.trim()).slice(0, 2).map((item) => item.trim().slice(0, 240));
    const inputLabel = dailyAiInsightInputLabel(context);
    dailyAiInsightSnapshot = {
      summary: summary || "AI 未返回可用摘要，请以规则归纳结果为准。",
      priorityActions,
      watchouts: watchoutItems,
      inputLabel,
      generatedAt: new Date().toISOString()
    };
    dailyAiInsightUserKey = dailyQueueSessionKey();
    result.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "AI 决策洞察";
    const source = document.createElement("small");
    source.className = "daily-ai-insight-source";
    source.textContent = inputLabel;
    const copy = document.createElement("p");
    copy.textContent = summary || "AI 未返回可用摘要，请以规则归纳结果为准。";
    result.append(heading, source, copy);
    [["优先动作", priorities], ["观察项", watchouts]].forEach(([label, items]) => {
      const values = label === "优先动作" ? priorityActions : watchoutItems;
      if (!values.length) return;
      const title = document.createElement("small");
      title.textContent = label;
      const list = document.createElement("ul");
      values.forEach((item) => {
        const row = document.createElement("li");
        const action = item;
        row.textContent = action;
        if (label === "优先动作") {
          row.className = "daily-ai-insight-action-item";
          const add = button("填入待办", () => {
            const currentContext = buildDailyAiInsightContext();
            if (dailyAiInsightResultKey !== dailyAiInsightContextKey(currentContext)) {
              setDailyAiInsightStatus("运营信号已变化 · 请重新生成后再使用建议", "warning");
              return;
            }
            const input = titleEl();
            if (!input) return;
            if (input.value.trim() && input.value.trim() !== action
              && !window.confirm("当前已有待办草稿，是否替换为这条 AI 建议？")) return;
            input.value = action;
            input.scrollIntoView({ behavior: "smooth", block: "center" });
            input.focus();
            setStatus("AI 建议已填入待办草稿；确认项目、优先级和日期后再添加。", "mock");
          });
          add.classList.add("daily-ai-action-add");
          row.append(add);
        }
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
    const contextKey = dailyAiInsightContextKey(context);
    dailyAiInsightPendingContextKey = contextKey;
    dailyAiInsightPendingUserKey = dailyQueueSessionKey();
    dailyAiInsightNeedsRetry = false;
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }
    setDailyAiInsightStatus("AI 正在归纳", "loading");
    try {
      const response = await requestLlmTask("daily-insight", context, 45000);
      if (generation !== dailyAiInsightGeneration) return;
      if (!response.ok) {
        setDailyAiInsightStatus("规则归纳", "warning");
        const result = document.querySelector("#daily-ai-insight-result");
        if (result) {
          result.textContent = dailyAiFailureText(response);
          result.hidden = false;
          dailyAiInsightResultKey = contextKey;
          dailyAiInsightUserKey = dailyQueueSessionKey();
          dailyAiInsightSnapshot = null;
        }
        return;
      }
      renderDailyAiInsightResult(response.result, context);
      dailyAiInsightResultKey = contextKey;
      dailyAiInsightNeedsRetry = false;
      setDailyAiInsightStatus(response.cached ? "AI 缓存结果" : "AI 已归纳", "ready");
    } catch (error) {
      if (generation !== dailyAiInsightGeneration) return;
      dailyAiInsightNeedsRetry = false;
      setDailyAiInsightStatus("规则归纳", "warning");
      const result = document.querySelector("#daily-ai-insight-result");
      if (result) {
        const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
        result.textContent = dailyAiFailureText({ reason: timedOut ? "timeout" : "unavailable" });
        result.hidden = false;
        dailyAiInsightResultKey = contextKey;
        dailyAiInsightUserKey = dailyQueueSessionKey();
        dailyAiInsightSnapshot = null;
      }
    } finally {
      if (generation === dailyAiInsightGeneration) {
        dailyAiInsightPendingContextKey = "";
        dailyAiInsightPendingUserKey = "";
        if (button) {
          button.disabled = false;
          button.setAttribute("aria-disabled", "false");
        }
      }
    }
  }

  window.renderTodayTodos = function renderTodayTodos(manualItems, state = {}) {
    const container = listEl();
    if (!container) return;
    if (state.authRequired) lastDailyQueueSnapshot = null;
    const hasCurrentUserSnapshot = lastDailyQueueSnapshot?.userKey === dailyQueueSessionKey();
    if (hasCurrentUserSnapshot && state.loading) {
      renderDailyInsight(lastDailyQueueSnapshot.manualItems, { ...lastDailyQueueSnapshot.state, ...state });
      setConnection("正在刷新 · 保留最近同步的数据", "loading");
      setStatus(`正在刷新；下方显示最近一次同步于 ${formatMorningTime(lastDailyQueueSnapshot.capturedAt)} 的工作队列。`, "mock");
      const platformStatus = document.querySelector("#daily-platform-status");
      if (platformStatus) {
        platformStatus.textContent = "刷新中 · 保留最近数据";
        platformStatus.dataset.tone = "loading";
      }
      return;
    }
    if (hasCurrentUserSnapshot && (state.error || state.archiveOffline || state.archiveStorageUnavailable)) {
      const previousState = lastDailyQueueSnapshot.state;
      const unavailable = (key) => Boolean(state.error || state[key]);
      const canReusePlatformHistory = previousState.platformGame === state.platformGame;
      const staleState = {
        ...previousState,
        ...state,
        loading: false,
        staleSnapshot: true,
        todoCount: unavailable("todoUnavailable") ? previousState.todoCount : state.todoCount,
        todoTotal: unavailable("todoUnavailable") ? previousState.todoTotal : state.todoTotal,
        doneItems: unavailable("doneUnavailable") ? previousState.doneItems : state.doneItems,
        doneTotal: unavailable("doneUnavailable") ? previousState.doneTotal : state.doneTotal,
        riskCount: unavailable("riskUnavailable") ? previousState.riskCount : state.riskCount,
        riskTotal: unavailable("riskUnavailable") ? previousState.riskTotal : state.riskTotal,
        riskItems: unavailable("riskUnavailable") ? previousState.riskItems : state.riskItems,
        publicationCount: unavailable("publicationUnavailable") ? previousState.publicationCount : state.publicationCount,
        publicationTotal: unavailable("publicationUnavailable") ? previousState.publicationTotal : state.publicationTotal,
        publicationItems: unavailable("publicationUnavailable") ? previousState.publicationItems : state.publicationItems,
        morningRuns: unavailable("morningUnavailable") ? previousState.morningRuns : state.morningRuns,
        platformSnapshots: unavailable("platformHistoryUnavailable") && canReusePlatformHistory
          ? previousState.platformSnapshots
          : state.platformSnapshots
      };
      setStats(staleState);
      renderDailyInsight(lastDailyQueueSnapshot.manualItems, staleState);
      renderDailyPlatformOverview(staleState);
      renderMorningStatus(lastDailyQueueSnapshot.state.morningRuns || [], false, true);
      const local = !isOnlineServiceMode();
      setConnection(state.archiveStorageUnavailable
        ? local ? "本机服务在线 · 存储未就绪 · 显示最近数据" : "存储未就绪 · 显示最近数据"
        : local ? "本机服务未连接 · 显示最近同步数据" : "线上存档服务暂不可用 · 显示最近同步数据", "warning");
      setStatus(state.archiveStorageUnavailable
        ? `存储暂未就绪；仍显示上次成功同步于 ${formatMorningTime(lastDailyQueueSnapshot.capturedAt)} 的工作队列。恢复存储后重试同步。`
        : `同步失败；仍显示上次成功同步于 ${formatMorningTime(lastDailyQueueSnapshot.capturedAt)} 的工作队列。点击“刷新”重试。`, "mock");
      if (state.archiveStorageUnavailable) {
        renderEmptyState(
          local ? "本机服务在线，但归档存储暂不可用；下方保留上次成功同步的队列。" : "归档存储暂不可用；下方保留上次成功同步的队列。",
          "重试同步",
          () => window.loadTodayTodos?.()
        );
      } else if (state.archiveOffline) {
        renderEmptyState(
          local ? "本机服务未连接；下方保留上次成功同步的队列。" : "线上存档服务暂不可用；下方保留上次同步的队列。",
          local ? "打开并启动本地服务" : "重新连接",
          local ? openLocalServiceRecovery : () => window.loadTodayTodos?.()
        );
      }
      return;
    }
    const doneList = doneListEl();
    const doneContainer = doneContainerEl();
    if (doneList) doneList.hidden = true;
    if (doneContainer) doneContainer.innerHTML = "";
    container.innerHTML = "";
    setStats(state);
    renderDailyInsight(manualItems, state);
    renderDailyPlatformOverview(state);

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
    sortRiskItems(riskItems).slice(0, 5).forEach((risk) => rows.push({ kind: "risk", node: buildAutoRow({
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
    if (!rows.length) {
      const local = !isOnlineServiceMode();
      renderEmptyState(
        state.archiveStorageUnavailable
          ? local ? "本机服务在线，但归档存储暂不可用，无法确认今日队列状态。" : "归档存储暂不可用，无法确认账号工作队列状态。"
          : state.archiveOffline
          ? local ? "本机存档服务未连接，无法确认今日队列状态。" : "线上存档服务暂不可用，无法确认账号工作队列状态。"
          : state.todoUnavailable ? "个人待办暂不可用，无法确认今日队列是否已清空。" : "今日队列已清空，安排一件最重要的事吧。",
        state.archiveStorageUnavailable ? "重试同步" : state.archiveOffline
          ? local ? "打开并启动本地服务" : "重新连接"
          : state.todoUnavailable ? "重试同步" : "添加待办",
        state.archiveStorageUnavailable ? () => window.loadTodayTodos?.() : state.archiveOffline
          ? local ? openLocalServiceRecovery : () => window.loadTodayTodos?.()
          : state.todoUnavailable ? () => window.loadTodayTodos?.() : () => titleEl()?.focus()
      );
    }
    if (rows.length && !container.children.length) renderEmptyState("当前筛选下没有事项。", "查看全部", () => {
      activeFilter = "all";
      updateFilterControls();
      window.renderTodayTodos(manualItems, state);
    });

    const doneItems = state.doneItems || [];
    if (doneList && doneContainer) {
      doneList.hidden = !doneItems.length && !state.doneUnavailable;
      const summary = doneList.querySelector("summary");
      if (summary) summary.textContent = state.doneUnavailable ? "已完成（暂不可用）" : `已完成（${doneItems.length}）`;
      if (state.doneUnavailable) {
        const notice = document.createElement("p");
        notice.className = "muted-copy";
        notice.textContent = "已完成记录暂不可用；未完成待办仍可正常使用。";
        doneContainer.append(notice);
      }
      doneItems.forEach((item) => doneContainer.append(buildManualRow(item, true)));
    }
    const unavailable = [
      state.todoUnavailable ? "个人待办" : "",
      state.doneUnavailable ? "已完成记录" : "",
      state.riskUnavailable ? "风险工单" : "",
      state.publicationUnavailable ? "发布回流" : ""
    ].filter(Boolean);
    const truncations = [];
    if (!state.riskUnavailable && Number(state.riskTotal) > 5) truncations.push(`风险队列仅展示最近 5/${state.riskTotal} 条`);
    if (!state.publicationUnavailable && Number(state.publicationTotal) > 5) truncations.push(`回流队列仅展示最近 5/${state.publicationTotal} 条`);
    if (state.publicationTruncated) truncations.push("发布台账仅扫描最近 200 条，待回流数为下限");
    if (Number(state.todoTotal) > manualItems.length) truncations.push(`手动待办仅加载最近 ${manualItems.length}/${state.todoTotal} 条`);
    if (Number(state.doneTotal) > doneItems.length) truncations.push(`已完成仅加载最近 ${doneItems.length}/${state.doneTotal} 条`);
    const local = !isOnlineServiceMode();
    if (state.archiveStorageUnavailable) {
      const localStorageLabel = local ? "本机服务在线，但存储未就绪" : "线上存档存储未就绪";
      setConnection(localStorageLabel, "danger");
      setStatus("存档服务可访问，但数据存储未就绪；同步结果不完整。", "mock");
    } else if (state.archiveOffline) {
      setConnection(local ? "本机存档服务未连接" : "线上存档服务暂不可用", "danger");
      setStatus(local
        ? "本机存档服务未连接；今日待办、风险、回流和晨报状态未知。"
        : "线上存档服务未连接；账号待办、风险和发布回流状态未知。", "mock");
    } else {
      setConnection(unavailable.length ? "部分数据不可用 · 其余来源仍可用" : "已连接 · 队列实时汇总中", unavailable.length ? "warning" : "success");
      setStatus(`已汇总 ${rows.length} 条行动事项${doneItems.length ? `，另有 ${doneItems.length} 条已完成` : ""}${unavailable.length ? `；${unavailable.join("、")}暂不可用` : ""}${truncations.length ? `；${truncations.join("；")}` : ""}。`, unavailable.length || truncations.length ? "mock" : "real");
    }
    if (!state.todoUnavailable && !state.doneUnavailable && !state.riskUnavailable && !state.publicationUnavailable) {
      lastDailyQueueSnapshot = captureDailyQueueSnapshot(manualItems, state);
    }
  };

  async function request(path, options) {
    const requestWithTimeout = window.archiveJsonRequestWithTimeout;
    if (typeof requestWithTimeout !== "function") throw new Error("archive_request_not_ready");
    const { response, payload } = await requestWithTimeout(archiveUrl() + path, options);
    if (!response.ok || !payload.ok) throw new Error(payload.error || "HTTP " + response.status);
    return payload;
  }

  function isDailyServiceUnavailable(error) {
    return /Failed to fetch|NetworkError|load failed/i.test(String(error?.message || ""));
  }

  function dailyTodoMutationError(error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      return "待办请求超时，结果可能已保存；请刷新队列确认后再重试。";
    }
    return isDailyServiceUnavailable(error)
      ? "待办请求未收到服务确认；结果可能已保存。恢复连接后刷新队列，再决定是否重试。"
      : "待办保存状态未确认；刷新队列核对后再重试。";
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
    const sessionKeyAtStart = dailyQueueSessionKey();
    const game = currentGame();
    const priority = priorityEl()?.value || "medium";
    refreshDailyDateLabels();
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
      if (sessionKeyAtStart !== dailyQueueSessionKey()) return;
      clearDailyTodoRequest(game, title, priority, dueDate);
      titleEl().value = "";
      await window.loadTodayTodos?.();
    } catch (error) {
      if (sessionKeyAtStart === dailyQueueSessionKey()) setStatus(dailyTodoMutationError(error), "mock");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function updateTodo(id, body) {
    const sessionKeyAtStart = dailyQueueSessionKey();
    try {
      await request("/daily-todos/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (sessionKeyAtStart === dailyQueueSessionKey()) await window.loadTodayTodos?.();
    } catch (error) {
      if (sessionKeyAtStart === dailyQueueSessionKey()) setStatus(dailyTodoMutationError(error), "mock");
    }
  }

  observedDailyQueueSessionKey = dailyQueueSessionKey();
  document.addEventListener("gameops:archive-session", (event) => {
    const userKey = dailyQueueSessionKey();
    const userChanged = observedDailyQueueSessionKey !== userKey;
    observedDailyQueueSessionKey = userKey;
    const queueUserChanged = lastDailyQueueSnapshot && lastDailyQueueSnapshot.userKey !== userKey;
    const insightUserChanged = dailyAiInsightUserKey && dailyAiInsightUserKey !== userKey;
    if (!userChanged && !queueUserChanged && !insightUserChanged) return;
    lastDailyQueueSnapshot = null;
    window.cancelTodayTodosLoad?.();
    dailyAiInsightGeneration += 1;
    dailyAiInsightPendingContextKey = "";
    dailyAiInsightPendingUserKey = "";
    dailyAiInsightNeedsRetry = false;
    latestDailyInsightContext = { manualItems: [], state: {} };
    clearDailyAiInsightResult();
    const user = event.detail?.user || null;
    if (user) {
      window.renderTodayTodos?.([], { loading: true });
    } else if (event.detail?.required) {
      window.renderTodayTodos?.([], { authRequired: true });
    } else {
      window.loadTodayTodos?.();
    }
  });

  window.initDailyWorkbench = function initDailyWorkbench() {
    const due = dueEl();
    if (due && !due.value) due.value = today();
    refreshDailyDateLabels();
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
    document.querySelector("#daily-platform-trending-action")?.addEventListener("click", () => {
      if (typeof navigateToView === "function") navigateToView("trending");
    });
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
        refreshDailyDateLabels();
        if (document.visibilityState === "visible" && isDailyWorkbenchActive()) window.loadTodayTodos?.();
      }, 300000);
    }
    if (!visibilityRefreshRegistered) {
      visibilityRefreshRegistered = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        refreshDailyDateLabels();
        if (isDailyWorkbenchActive()) window.loadTodayTodos?.();
      });
    }
    if (typeof archiveAuthRequired !== "undefined" && archiveAuthRequired && !archiveSessionUser) {
      window.renderTodayTodos([], { authRequired: true });
      return;
    }
    window.loadTodayTodos?.();
  };
})();
