(function () {
  "use strict";

  var USER_PAGE_SIZE = 20;
  var USER_CACHE_FETCH_SIZE = 50;
  var USER_SEARCH_RESULT_LIMIT = 50;
  var PAGE_PAGE_SIZE = 20;
  var USER_CACHE_STORAGE_VERSION = 1;
  var USER_CACHE_STORAGE_KEY_PREFIX = "l4u_admin_users_cache_v" + USER_CACHE_STORAGE_VERSION;
  var USER_CACHE_STORAGE_TTL_MS = 1000 * 60 * 60 * 6;

  var usersNextPageToken = null;
  var usersSearchActive = false;
  var usersLoading = false;
  var usersCacheList = [];
  var usersCacheByUid = Object.create(null);
  var usersCacheComplete = false;
  var usersVisibleCount = 0;
  var usersCachePersistTimer = null;
  var currentAdminUid = "";

  var pagesNextCursorCreatedAtMs = null;
  var pagesLoading = false;
  var pagesLoaded = false;

  var overviewLoaded = false;
  var overviewLoading = false;

  var authSequence = 0;
  var activeAdminTab = "users";
  var analyticsCollapsed = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function toInt(value, fallback) {
    var parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
    return fallback;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDateTime(createdAtMs, fallbackIso) {
    var fromMs = Number(createdAtMs);
    if (Number.isFinite(fromMs) && fromMs > 0) {
      return new Date(fromMs).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    var parsed = Date.parse(String(fallbackIso || ""));
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    return "-";
  }

  function setActionStatus(message, isError) {
    var node = byId("adminActionStatus");
    if (!node) {
      return;
    }

    node.textContent = message || "";
    node.style.color = isError ? "#b54859" : "";
  }

  function setAccessMessage(message) {
    var node = byId("adminAccessMessage");
    if (node) {
      node.textContent = message;
    }
  }

  function setAccessDenied(visible, message) {
    var denied = byId("adminDenied");
    var panel = byId("adminPanel");

    if (denied) {
      denied.classList.toggle("hidden", !visible);
    }

    if (panel) {
      panel.classList.toggle("hidden", visible);
    }

    if (message) {
      setAccessMessage(message);
    }
  }

  function showPanel() {
    var denied = byId("adminDenied");
    var panel = byId("adminPanel");

    if (denied) {
      denied.classList.add("hidden");
    }

    if (panel) {
      panel.classList.remove("hidden");
    }

    setAccessMessage("Admin access verified.");
  }

  function setActiveAdminTab(tabName) {
    var normalizedTab = tabName === "pages" ? "pages" : "users";
    activeAdminTab = normalizedTab;

    document.querySelectorAll("[data-admin-tab-button]").forEach(function (buttonNode) {
      var tab = buttonNode.getAttribute("data-admin-tab-button") || "users";
      var isActive = tab === normalizedTab;

      buttonNode.classList.toggle("is-active", isActive);
      buttonNode.setAttribute("aria-selected", isActive ? "true" : "false");
      buttonNode.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    document.querySelectorAll("[data-admin-tab-panel]").forEach(function (panelNode) {
      var panelTab = panelNode.getAttribute("data-admin-tab-panel") || "users";
      panelNode.classList.toggle("hidden", panelTab !== normalizedTab);
    });
  }

  function setAnalyticsCollapsed(collapsed) {
    var normalizedCollapsed = Boolean(collapsed);
    var toggleButton = byId("adminAnalyticsToggle");
    var panelNode = byId("adminAnalyticsBody");
    var labelNode = byId("adminAnalyticsToggleLabel");
    var iconNode = byId("adminAnalyticsToggleIcon");

    if (panelNode) {
      panelNode.hidden = normalizedCollapsed;
    }

    if (toggleButton) {
      toggleButton.classList.toggle("is-collapsed", normalizedCollapsed);
      toggleButton.setAttribute("aria-expanded", normalizedCollapsed ? "false" : "true");
    }

    if (labelNode) {
      labelNode.textContent = normalizedCollapsed ? "Expand" : "Collapse";
    }

    if (iconNode) {
      iconNode.textContent = normalizedCollapsed ? "+" : "-";
    }
  }

  function setOverviewLoadButtonState() {
    var buttonNode = byId("adminOverviewLoad");
    if (!buttonNode) {
      return;
    }

    buttonNode.disabled = overviewLoading;
    if (overviewLoading) {
      buttonNode.textContent = "Loading...";
      return;
    }

    buttonNode.textContent = overviewLoaded ? "Reload Stats" : "Load Stats";
  }

  function setOverviewNotLoadedState() {
    overviewLoaded = false;
    overviewLoading = false;
    setOverviewLoadButtonState();

    var totalUsers = byId("adminTotalUsers");
    var totalPages = byId("adminTotalPages");
    var usersToday = byId("adminUsersToday");
    var pagesToday = byId("adminPagesToday");
    var usersChart = byId("adminUsersChart");
    var pagesChart = byId("adminPagesChart");

    if (totalUsers) {
      totalUsers.textContent = "-";
    }

    if (totalPages) {
      totalPages.textContent = "-";
    }

    if (usersToday) {
      usersToday.textContent = "-";
    }

    if (pagesToday) {
      pagesToday.textContent = "-";
    }

    if (usersChart) {
      usersChart.innerHTML = '<p class="text-sm text-lfu-outline">Stats not loaded yet.</p>';
    }

    if (pagesChart) {
      pagesChart.innerHTML = '<p class="text-sm text-lfu-outline">Stats not loaded yet.</p>';
    }
  }

  function renderPagesNotLoadedState() {
    var tableBody = byId("adminPagesTableBody");
    if (!tableBody) {
      return;
    }

    tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-sm text-lfu-outline">Pages are not loaded yet. Click Load Pages.</td></tr>';
  }

  function setPagesNotLoadedState() {
    pagesLoaded = false;
    pagesNextCursorCreatedAtMs = null;
    renderPagesNotLoadedState();

    var loadButton = byId("adminPagesLoad");
    var loadMoreButton = byId("adminPagesLoadMore");
    var pagesMeta = byId("adminPagesMeta");

    if (loadButton) {
      loadButton.disabled = false;
      loadButton.textContent = "Load Pages";
    }

    if (loadMoreButton) {
      loadMoreButton.disabled = false;
      loadMoreButton.textContent = "Load More Pages";
      loadMoreButton.classList.add("hidden");
    }

    if (pagesMeta) {
      pagesMeta.textContent = "Pages are not loaded yet. Click Load Pages.";
    }
  }

  function normalizeSupportGateTikTokUrl(value) {
    var raw = String(value || "").trim();

    if (!raw) {
      return "";
    }

    var withProtocol = raw;
    if (!/^https?:\/\//i.test(withProtocol)) {
      withProtocol = "https://" + withProtocol.replace(/^\/+/, "");
    }

    try {
      var parsed = new URL(withProtocol);
      var protocol = String(parsed.protocol || "").toLowerCase();
      var hostname = String(parsed.hostname || "").toLowerCase();

      if ((protocol !== "https:" && protocol !== "http:") || hostname.indexOf("tiktok.com") === -1) {
        return "";
      }

      if (!parsed.pathname || parsed.pathname === "/") {
        return "";
      }

      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function normalizeSupportGateInstagramVideoUrl(value) {
    var raw = String(value || "").trim();

    if (!raw) {
      return "";
    }

    var withProtocol = raw;
    if (!/^https?:\/\//i.test(withProtocol)) {
      withProtocol = "https://" + withProtocol.replace(/^\/+/, "");
    }

    try {
      var parsed = new URL(withProtocol);
      var protocol = String(parsed.protocol || "").toLowerCase();
      var hostname = String(parsed.hostname || "").toLowerCase();

      if ((protocol !== "https:" && protocol !== "http:") || hostname.indexOf("instagram.com") === -1) {
        return "";
      }

      var pathName = String(parsed.pathname || "");
      if (!/^\/(p|reel|reels|tv)\//i.test(pathName)) {
        return "";
      }

      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function renderSupportGateMeta(payload) {
    var metaNode = byId("adminSupportGateMeta");
    if (!metaNode) {
      return;
    }

    var record = payload && typeof payload === "object" ? payload : {};
    var tiktokUrl = String(record.tiktokUrl || "").trim();
    var instagramVideoUrl = String(record.instagramVideoUrl || "").trim();
    var updatedAt = Math.max(0, toInt(record.updatedAt, 0));
    var updatedBy = String(record.updatedBy || "").trim();

    if (!updatedAt) {
      metaNode.textContent = (tiktokUrl || instagramVideoUrl)
        ? "Configured links active."
        : "Using app fallback links.";
      return;
    }

    var summary = "Last updated " + new Date(updatedAt).toLocaleString();
    if (updatedBy) {
      summary += " by " + updatedBy;
    }

    if (!tiktokUrl && !instagramVideoUrl) {
      summary += " (links cleared, fallback active)";
    }

    metaNode.textContent = summary;
  }

  function applySupportGateConfig(payload) {
    var record = payload && typeof payload === "object" ? payload : {};
    var tiktokInputNode = byId("adminSupportGateTikTokUrl");
    var instagramVideoInputNode = byId("adminSupportGateInstagramVideoUrl");

    if (tiktokInputNode) {
      tiktokInputNode.value = String(record.tiktokUrl || "").trim();
    }

    if (instagramVideoInputNode) {
      instagramVideoInputNode.value = String(record.instagramVideoUrl || "").trim();
    }

    renderSupportGateMeta(record);
  }

  async function loadSupportGateConfig() {
    var payload = await callAdminApi("/api/admin/config/support-gate");
    applySupportGateConfig(payload);
    return payload;
  }

  async function saveSupportGateConfig() {
    var tiktokInputNode = byId("adminSupportGateTikTokUrl");
    var instagramVideoInputNode = byId("adminSupportGateInstagramVideoUrl");
    var saveButton = byId("adminSupportGateSave");
    var rawTikTokUrl = tiktokInputNode ? tiktokInputNode.value : "";
    var rawInstagramVideoUrl = instagramVideoInputNode ? instagramVideoInputNode.value : "";
    var normalizedTikTokUrl = normalizeSupportGateTikTokUrl(rawTikTokUrl);
    var normalizedInstagramVideoUrl = normalizeSupportGateInstagramVideoUrl(rawInstagramVideoUrl);

    if (String(rawTikTokUrl || "").trim() && !normalizedTikTokUrl) {
      setActionStatus("Support gate URL must be a valid TikTok link.", true);
      return;
    }

    if (String(rawInstagramVideoUrl || "").trim() && !normalizedInstagramVideoUrl) {
      setActionStatus("Support gate Instagram URL must be a valid Instagram post link.", true);
      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }

    try {
      var payload = await callAdminApi("/api/admin/config/support-gate", {
        method: "POST",
        body: {
          tiktokUrl: normalizedTikTokUrl,
          instagramVideoUrl: normalizedInstagramVideoUrl
        }
      });

      applySupportGateConfig(payload);
      setActionStatus(
        (normalizedTikTokUrl || normalizedInstagramVideoUrl)
          ? "Support gate links saved."
          : "Support gate links cleared. App fallback remains active.",
        false
      );
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save Link";
      }
    }
  }

  async function getApi() {
    if (!window.L4UFirebaseReady || typeof window.L4UFirebaseReady.then !== "function") {
      throw new Error("FIREBASE_NOT_READY");
    }

    var api = await window.L4UFirebaseReady;
    if (!api || !api.auth) {
      throw new Error("FIREBASE_NOT_READY");
    }

    return api;
  }

  async function callAdminApi(path, options) {
    var opts = options || {};
    var api = await getApi();
    var currentUser = api.auth.currentUser;

    if (!currentUser) {
      var authError = new Error("AUTH_REQUIRED");
      authError.code = "AUTH_REQUIRED";
      throw authError;
    }

    var token = await currentUser.getIdToken();
    var headers = {
      Authorization: "Bearer " + token
    };

    if (opts.body) {
      headers["Content-Type"] = "application/json";
    }

    var response = await fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    var payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }

    if (!response.ok) {
      var apiError = new Error(String(payload && payload.code ? payload.code : "ADMIN_API_ERROR"));
      apiError.code = String(payload && payload.code ? payload.code : "ADMIN_API_ERROR");
      apiError.status = response.status;
      apiError.payload = payload;
      throw apiError;
    }

    return payload;
  }

  function renderChart(targetId, points, valueKey, toneClass) {
    var target = byId(targetId);
    if (!target) {
      return;
    }

    var rows = Array.isArray(points) ? points : [];
    if (!rows.length) {
      target.innerHTML = '<p class="text-sm text-lfu-outline">No data available yet.</p>';
      return;
    }

    var maxValue = rows.reduce(function (max, item) {
      return Math.max(max, Math.max(0, toInt(item && item[valueKey], 0)));
    }, 1);

    target.innerHTML = rows.map(function (item) {
      var value = Math.max(0, toInt(item && item[valueKey], 0));
      var height = value > 0
        ? Math.max(16, Math.round((value / maxValue) * 128))
        : 8;
      var label = String(item && item.label ? item.label : "-");

      return '' +
        '<div class="l4u-admin-chart-col">' +
        '  <div class="l4u-admin-chart-rail">' +
        '    <div class="l4u-admin-chart-bar ' + toneClass + '" style="height:' + height + 'px"></div>' +
        '  </div>' +
        '  <p class="l4u-admin-chart-label">' + escapeHtml(label) + '</p>' +
        '  <p class="l4u-admin-chart-value">' + value + '</p>' +
        '</div>';
    }).join("");
  }

  async function loadOverview() {
    if (overviewLoading) {
      return;
    }

    overviewLoading = true;
    setOverviewLoadButtonState();

    try {
      var payload = await callAdminApi("/api/admin/overview?days=7");

      var totalUsers = byId("adminTotalUsers");
      var totalPages = byId("adminTotalPages");
      var usersToday = byId("adminUsersToday");
      var pagesToday = byId("adminPagesToday");

      if (totalUsers) {
        totalUsers.textContent = String(toInt(payload && payload.totals && payload.totals.users, 0));
      }

      if (totalPages) {
        totalPages.textContent = String(toInt(payload && payload.totals && payload.totals.pages, 0));
      }

      if (usersToday) {
        usersToday.textContent = String(toInt(payload && payload.today && payload.today.users, 0));
      }

      if (pagesToday) {
        pagesToday.textContent = String(toInt(payload && payload.today && payload.today.pages, 0));
      }

      renderChart("adminUsersChart", payload && payload.series, "users", "is-users");
      renderChart("adminPagesChart", payload && payload.series, "pages", "is-pages");
      overviewLoaded = true;
    } finally {
      overviewLoading = false;
      setOverviewLoadButtonState();
    }
  }

  function userRowHtml(user) {
    var createdAtLabel = formatDateTime(user && user.createdAtMs, user && user.createdAt);

    return '' +
      '<tr data-user-uid="' + escapeHtml(user && user.uid) + '">' +
      '  <td>' + escapeHtml(createdAtLabel) + '</td>' +
      '  <td class="l4u-admin-mono">' + escapeHtml(user && user.uid) + '</td>' +
      '  <td>' +
      '    <p class="font-semibold text-lfu-primary">' + escapeHtml(user && user.displayName ? user.displayName : "-") + '</p>' +
      '    <p class="text-xs text-lfu-outline">' + escapeHtml(user && user.email ? user.email : "") + '</p>' +
      '  </td>' +
      '  <td><span data-user-credits>' + Math.max(0, toInt(user && user.credits, 0)) + '</span></td>' +
      '  <td>' +
      '    <div class="l4u-admin-credit-actions">' +
      '      <input type="number" min="0" step="1" value="1" data-credit-amount class="l4u-admin-credit-input" />' +
      '      <button type="button" data-credit-op="add" class="l4u-admin-mini-btn">Add</button>' +
      '      <button type="button" data-credit-op="reduce" class="l4u-admin-mini-btn">Reduce</button>' +
      '      <button type="button" data-credit-op="set" class="l4u-admin-mini-btn">Set</button>' +
      '    </div>' +
      '  </td>' +
      '</tr>';
  }

  function renderUsers(users, append) {
    var tableBody = byId("adminUsersTableBody");
    if (!tableBody) {
      return;
    }

    var list = Array.isArray(users) ? users : [];

    if (!append) {
      tableBody.innerHTML = "";
    }

    if (!list.length && !append) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-sm text-lfu-outline">No users found.</td></tr>';
      return;
    }

    tableBody.insertAdjacentHTML("beforeend", list.map(userRowHtml).join(""));
  }

  function pageRowHtml(page) {
    return '' +
      '<tr data-page-id="' + escapeHtml(page && page.id) + '">' +
      '  <td>' + escapeHtml(formatDateTime(page && page.createdAtMs, page && page.createdAt)) + '</td>' +
      '  <td class="l4u-admin-mono">' + escapeHtml(page && page.id) + '</td>' +
      '  <td>' + escapeHtml(page && page.templateType) + '</td>' +
      '  <td>' + escapeHtml(page && page.title ? page.title : "Untitled") + '</td>' +
      '  <td class="l4u-admin-mono">' + escapeHtml(page && page.uid) + '</td>' +
      '  <td>' + Math.max(0, toInt(page && page.photoCount, 0)) + '</td>' +
      '  <td>' +
      '    <div class="l4u-admin-page-actions">' +
      '      <button type="button" data-page-action="view" class="l4u-admin-mini-btn">View</button>' +
      '      <button type="button" data-page-action="delete" class="l4u-admin-mini-btn is-danger">Delete</button>' +
      '    </div>' +
      '  </td>' +
      '</tr>';
  }

  function renderPages(pages, append) {
    var tableBody = byId("adminPagesTableBody");
    if (!tableBody) {
      return;
    }

    var list = Array.isArray(pages) ? pages : [];

    if (!append) {
      tableBody.innerHTML = "";
    }

    if (!list.length && !append) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-sm text-lfu-outline">No pages found.</td></tr>';
      return;
    }

    tableBody.insertAdjacentHTML("beforeend", list.map(pageRowHtml).join(""));
  }

  function getUserCreatedAtMs(user) {
    var direct = toInt(user && user.createdAtMs, 0);
    if (direct > 0) {
      return direct;
    }

    var parsed = Date.parse(String(user && user.createdAt ? user.createdAt : ""));
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }

    return 0;
  }

  function getUsersCacheStorageKey() {
    var scopedUid = String(currentAdminUid || "").trim();
    if (!scopedUid) {
      return "";
    }

    return USER_CACHE_STORAGE_KEY_PREFIX + "::" + scopedUid;
  }

  function removeUsersCacheFromStorage() {
    var cacheKey = getUsersCacheStorageKey();
    if (!cacheKey) {
      return;
    }

    try {
      window.localStorage.removeItem(cacheKey);
    } catch (_error) {
      // Ignore localStorage access failures (private mode, disabled storage, etc).
    }
  }

  function clearUsersCachePersistTimer() {
    if (!usersCachePersistTimer) {
      return;
    }

    window.clearTimeout(usersCachePersistTimer);
    usersCachePersistTimer = null;
  }

  function serializeUserForCacheStorage(user) {
    return {
      uid: String(user && user.uid ? user.uid : ""),
      email: String(user && user.email ? user.email : ""),
      displayName: String(user && user.displayName ? user.displayName : ""),
      credits: Math.max(0, toInt(user && user.credits, 0)),
      createdAtMs: Math.max(0, toInt(user && user.createdAtMs, 0)),
      createdAt: String(user && user.createdAt ? user.createdAt : ""),
      disabled: Boolean(user && user.disabled),
      lastSignInAt: String(user && user.lastSignInAt ? user.lastSignInAt : "")
    };
  }

  function persistUsersCacheToStorageNow() {
    var cacheKey = getUsersCacheStorageKey();
    if (!cacheKey) {
      return;
    }

    if (!usersCacheList.length) {
      removeUsersCacheFromStorage();
      return;
    }

    var payload = {
      version: USER_CACHE_STORAGE_VERSION,
      savedAt: Date.now(),
      users: usersCacheList.map(serializeUserForCacheStorage),
      nextPageToken: usersNextPageToken ? String(usersNextPageToken) : null,
      cacheComplete: Boolean(usersCacheComplete)
    };

    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch (_error) {
      // Ignore quota and storage availability errors.
    }
  }

  function scheduleUsersCachePersist() {
    if (!currentAdminUid) {
      return;
    }

    clearUsersCachePersistTimer();
    usersCachePersistTimer = window.setTimeout(function () {
      usersCachePersistTimer = null;
      persistUsersCacheToStorageNow();
    }, 120);
  }

  function hydrateUsersCacheFromStorage() {
    var cacheKey = getUsersCacheStorageKey();
    if (!cacheKey) {
      return false;
    }

    var rawPayload = "";
    try {
      rawPayload = String(window.localStorage.getItem(cacheKey) || "");
    } catch (_error) {
      return false;
    }

    if (!rawPayload) {
      return false;
    }

    var parsedPayload = null;
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch (_error) {
      removeUsersCacheFromStorage();
      return false;
    }

    if (!parsedPayload || typeof parsedPayload !== "object") {
      removeUsersCacheFromStorage();
      return false;
    }

    if (toInt(parsedPayload.version, 0) !== USER_CACHE_STORAGE_VERSION) {
      removeUsersCacheFromStorage();
      return false;
    }

    var savedAt = Math.max(0, toInt(parsedPayload.savedAt, 0));
    if (!savedAt || (Date.now() - savedAt) > USER_CACHE_STORAGE_TTL_MS) {
      removeUsersCacheFromStorage();
      return false;
    }

    var storedUsers = Array.isArray(parsedPayload.users) ? parsedPayload.users : [];
    if (!storedUsers.length) {
      removeUsersCacheFromStorage();
      return false;
    }

    upsertUsersCache(storedUsers);

    usersNextPageToken = parsedPayload && parsedPayload.nextPageToken
      ? String(parsedPayload.nextPageToken)
      : null;

    usersCacheComplete = typeof parsedPayload.cacheComplete === "boolean"
      ? parsedPayload.cacheComplete
      : !usersNextPageToken;

    return true;
  }

  function resetUsersCache(clearStorage) {
    clearUsersCachePersistTimer();

    usersNextPageToken = null;
    usersCacheList = [];
    usersCacheByUid = Object.create(null);
    usersCacheComplete = false;
    usersVisibleCount = 0;

    if (clearStorage) {
      removeUsersCacheFromStorage();
    }
  }

  function upsertUsersCache(users) {
    var list = Array.isArray(users) ? users : [];
    if (!list.length) {
      return;
    }

    list.forEach(function (user) {
      var uid = String(user && user.uid ? user.uid : "").trim();
      if (!uid) {
        return;
      }

      var existing = usersCacheByUid[uid];
      if (existing) {
        Object.assign(existing, user);
        return;
      }

      var cachedUser = Object.assign({}, user);
      usersCacheByUid[uid] = cachedUser;
      usersCacheList.push(cachedUser);
    });

    usersCacheList.sort(function (a, b) {
      return getUserCreatedAtMs(b) - getUserCreatedAtMs(a);
    });
  }

  function getCachedUsersMatching(queryText) {
    var normalizedQuery = String(queryText || "").trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    return usersCacheList.filter(function (user) {
      var uid = String(user && user.uid ? user.uid : "").toLowerCase();
      var email = String(user && user.email ? user.email : "").toLowerCase();
      var displayName = String(user && user.displayName ? user.displayName : "").toLowerCase();

      return uid.indexOf(normalizedQuery) !== -1 ||
        email.indexOf(normalizedQuery) !== -1 ||
        displayName.indexOf(normalizedQuery) !== -1;
    });
  }

  function syncUsersLoadMoreVisibility() {
    var loadButton = byId("adminUsersLoadMore");
    if (!loadButton) {
      return;
    }

    if (usersSearchActive) {
      loadButton.classList.add("hidden");
      return;
    }

    var canLoadMore = usersVisibleCount < usersCacheList.length || !usersCacheComplete;
    loadButton.classList.toggle("hidden", !canLoadMore);
  }

  function updateDefaultUsersMeta() {
    var usersMeta = byId("adminUsersMeta");
    if (!usersMeta) {
      return;
    }

    if (!usersCacheList.length) {
      usersMeta.textContent = "No users loaded yet.";
      return;
    }

    if (usersCacheComplete) {
      usersMeta.textContent = "Showing " + usersVisibleCount + " of " + usersCacheList.length + " users (newest signup first).";
      return;
    }

    usersMeta.textContent = "Showing " + usersVisibleCount + " of " + usersCacheList.length + " cached users (newest signup first).";
  }

  async function fetchUsersPage(pageToken) {
    var query = new URLSearchParams();
    query.set("limit", String(Math.max(1, Math.min(50, USER_CACHE_FETCH_SIZE))));
    if (pageToken) {
      query.set("pageToken", String(pageToken));
    }

    var payload = await callAdminApi("/api/admin/users?" + query.toString());
    return {
      users: Array.isArray(payload && payload.users) ? payload.users : [],
      nextPageToken: payload && payload.nextPageToken ? String(payload.nextPageToken) : null
    };
  }

  async function fetchNextUsersCachePage() {
    if (usersCacheComplete) {
      return [];
    }

    var payload = await fetchUsersPage(usersNextPageToken);
    var users = payload.users;

    upsertUsersCache(users);

    usersNextPageToken = payload.nextPageToken;
    usersCacheComplete = !usersNextPageToken;
    scheduleUsersCachePersist();

    return users;
  }

  async function ensureUsersCached(minCount) {
    var targetCount = Math.max(0, toInt(minCount, 0));

    while (usersCacheList.length < targetCount && !usersCacheComplete) {
      var previousCount = usersCacheList.length;
      var previousToken = usersNextPageToken;

      await fetchNextUsersCachePage();

      if (usersCacheList.length === previousCount && usersNextPageToken === previousToken) {
        usersCacheComplete = true;
        scheduleUsersCachePersist();
        break;
      }
    }
  }

  async function refreshUsersCacheHead() {
    var payload = await fetchUsersPage(null);
    var beforeCount = usersCacheList.length;

    upsertUsersCache(payload.users);

    if (!beforeCount) {
      usersNextPageToken = payload.nextPageToken;
      usersCacheComplete = !usersNextPageToken;
    }

    scheduleUsersCachePersist();

    return usersCacheList.length > beforeCount;
  }

  async function loadUsers(append) {
    if (usersLoading || usersSearchActive) {
      return;
    }

    usersLoading = true;
    var loadButton = byId("adminUsersLoadMore");
    if (loadButton) {
      loadButton.disabled = true;
      loadButton.textContent = "Loading...";
    }

    try {
      if (!append) {
        if (!usersCacheList.length) {
          await ensureUsersCached(USER_PAGE_SIZE);
        }

        usersVisibleCount = Math.min(USER_PAGE_SIZE, usersCacheList.length);
      } else {
        var targetVisibleCount = Math.max(USER_PAGE_SIZE, usersVisibleCount + USER_PAGE_SIZE);
        await ensureUsersCached(targetVisibleCount);
        usersVisibleCount = Math.min(targetVisibleCount, usersCacheList.length);
      }

      renderUsers(usersCacheList.slice(0, usersVisibleCount), false);
      updateDefaultUsersMeta();
      syncUsersLoadMoreVisibility();
    } finally {
      usersLoading = false;
      if (loadButton) {
        loadButton.disabled = false;
        loadButton.textContent = "Load More Users";
      }
    }
  }

  async function searchUsers(queryText) {
    var trimmedQuery = String(queryText || "").trim();

    if (!trimmedQuery) {
      usersSearchActive = false;
      await loadUsers(false);
      return;
    }

    if (usersLoading) {
      return;
    }

    usersSearchActive = true;
    usersLoading = true;

    var loadButton = byId("adminUsersLoadMore");
    if (loadButton) {
      loadButton.disabled = true;
      loadButton.classList.add("hidden");
      loadButton.textContent = "Loading...";
    }

    try {
      if (!usersCacheList.length) {
        await ensureUsersCached(USER_PAGE_SIZE);
      }

      var matches = getCachedUsersMatching(trimmedQuery);

      while (!matches.length && !usersCacheComplete) {
        var previousCount = usersCacheList.length;
        var previousToken = usersNextPageToken;

        await fetchNextUsersCachePage();
        matches = getCachedUsersMatching(trimmedQuery);

        if (usersCacheList.length === previousCount && usersNextPageToken === previousToken) {
          usersCacheComplete = true;
          scheduleUsersCachePersist();
          break;
        }
      }

      if (!matches.length) {
        await refreshUsersCacheHead();
        matches = getCachedUsersMatching(trimmedQuery);
      }

      var limitedMatches = matches.slice(0, USER_SEARCH_RESULT_LIMIT);
      renderUsers(limitedMatches, false);

      var usersMeta = byId("adminUsersMeta");
      if (usersMeta) {
        if (!limitedMatches.length) {
          usersMeta.textContent = "No users matched \"" + trimmedQuery + "\" in " + usersCacheList.length + " cached users.";
        } else if (matches.length > limitedMatches.length) {
          usersMeta.textContent = "Showing " + limitedMatches.length + " of " + matches.length + " matches for \"" + trimmedQuery + "\".";
        } else {
          usersMeta.textContent = "Found " + limitedMatches.length + " match" + (limitedMatches.length === 1 ? "" : "es") + " for \"" + trimmedQuery + "\".";
        }
      }
    } finally {
      usersLoading = false;
      if (loadButton) {
        loadButton.disabled = false;
        loadButton.textContent = "Load More Users";
      }

      syncUsersLoadMoreVisibility();
    }
  }

  async function adjustCredits(rowNode, operation) {
    if (!rowNode) {
      return;
    }

    var uid = rowNode.getAttribute("data-user-uid") || "";
    var amountInput = rowNode.querySelector("[data-credit-amount]");
    var amount = toInt(amountInput && amountInput.value, 0);

    if (operation !== "set" && amount <= 0) {
      setActionStatus("Enter a positive amount before adjusting credits.", true);
      return;
    }

    if (operation === "set" && amount < 0) {
      setActionStatus("Set amount must be 0 or greater.", true);
      return;
    }

    var payload = await callAdminApi("/api/admin/users/credits/adjust", {
      method: "POST",
      body: {
        uid: uid,
        operation: operation,
        amount: amount
      }
    });

    var creditsNode = rowNode.querySelector("[data-user-credits]");
    var nextCredits = Math.max(0, toInt(payload && payload.credits, 0));
    if (creditsNode) {
      creditsNode.textContent = String(nextCredits);
    }

    if (uid && usersCacheByUid[uid]) {
      usersCacheByUid[uid].credits = nextCredits;
      scheduleUsersCachePersist();
    }

    setActionStatus("Credits updated for UID: " + uid, false);
  }

  async function loadPages(append) {
    if (pagesLoading) {
      return;
    }

    if (append && (!pagesLoaded || !pagesNextCursorCreatedAtMs)) {
      return;
    }

    pagesLoading = true;
    var triggerButton = byId(append ? "adminPagesLoadMore" : "adminPagesLoad");
    if (triggerButton) {
      triggerButton.disabled = true;
      triggerButton.textContent = "Loading...";
    }

    try {
      var query = new URLSearchParams();
      query.set("limit", String(PAGE_PAGE_SIZE));
      if (append && pagesNextCursorCreatedAtMs) {
        query.set("cursorCreatedAtMs", String(pagesNextCursorCreatedAtMs));
      }

      var payload = await callAdminApi("/api/admin/pages?" + query.toString());
      var pages = Array.isArray(payload && payload.pages) ? payload.pages : [];

      renderPages(pages, append);
      pagesLoaded = true;
      pagesNextCursorCreatedAtMs = payload && payload.hasMore
        ? Math.max(0, toInt(payload.nextCursorCreatedAtMs, 0))
        : null;

      var pagesMeta = byId("adminPagesMeta");
      if (pagesMeta) {
        pagesMeta.textContent = pages.length || append
          ? "Showing newest loaded pages."
          : "No pages found.";
      }

      var loadMoreButton = byId("adminPagesLoadMore");
      if (loadMoreButton) {
        loadMoreButton.classList.toggle("hidden", !pagesNextCursorCreatedAtMs);
      }

      var pagesLoadButton = byId("adminPagesLoad");
      if (pagesLoadButton) {
        pagesLoadButton.textContent = "Reload Pages";
      }
    } finally {
      pagesLoading = false;
      if (triggerButton) {
        triggerButton.disabled = false;
        triggerButton.textContent = append ? "Load More Pages" : (pagesLoaded ? "Reload Pages" : "Load Pages");
      }
    }
  }

  function openPageModal() {
    var modal = byId("adminPageModal");
    if (!modal) {
      return;
    }

    modal.hidden = false;
    window.requestAnimationFrame(function () {
      modal.classList.add("is-open");
    });

    document.body.classList.add("l4u-lock-scroll");
  }

  function closePageModal() {
    var modal = byId("adminPageModal");
    if (!modal) {
      return;
    }

    modal.classList.remove("is-open");
    window.setTimeout(function () {
      modal.hidden = true;
      document.body.classList.remove("l4u-lock-scroll");
    }, 160);
  }

  async function viewPage(pageId) {
    var payload = await callAdminApi("/api/admin/pages/" + encodeURIComponent(pageId));

    var title = byId("adminPageModalTitle");
    var id = byId("adminPageModalId");
    var uid = byId("adminPageModalUid");
    var template = byId("adminPageModalTemplate");
    var date = byId("adminPageModalDate");
    var youtube = byId("adminPageModalYoutube");
    var pin = byId("adminPageModalPin");
    var recipient = byId("adminPageModalRecipient");
    var closing = byId("adminPageModalClosing");
    var signature = byId("adminPageModalSignature");
    var photoCount = byId("adminPageModalPhotoCount");
    var message = byId("adminPageModalMessage");
    var photos = byId("adminPageModalPhotos");

    if (title) {
      title.textContent = payload && payload.title ? payload.title : "Untitled";
    }

    if (id) {
      id.textContent = payload && payload.id ? payload.id : "-";
    }

    if (uid) {
      uid.textContent = payload && payload.uid ? payload.uid : "-";
    }

    if (template) {
      template.textContent = payload && payload.templateType ? payload.templateType : "love-lock";
    }

    if (date) {
      date.textContent = formatDateTime(payload && payload.createdAtMs, payload && payload.createdAt);
    }

    if (youtube) {
      youtube.textContent = payload && payload.youtubeUrl ? payload.youtubeUrl : "-";
    }

    if (pin) {
      pin.textContent = payload && payload.pinCode ? payload.pinCode : "-";
    }

    if (recipient) {
      recipient.textContent = payload && payload.recipient ? payload.recipient : "-";
    }

    if (closing) {
      closing.textContent = payload && payload.closing ? payload.closing : "-";
    }

    if (signature) {
      signature.textContent = payload && payload.signature ? payload.signature : "-";
    }

    if (message) {
      message.textContent = payload && payload.message ? payload.message : "-";
    }

    var photoRows = Array.isArray(payload && payload.photos) ? payload.photos : [];
    if (photoCount) {
      photoCount.textContent = String(photoRows.length);
    }

    if (photos) {
      var withPreview = photoRows.filter(function (photo) {
        return photo && photo.dataUrl;
      });

      if (!withPreview.length) {
        photos.innerHTML = '<p class="text-sm text-lfu-outline">No photo previews embedded in this page payload.</p>';
      } else {
        photos.innerHTML = withPreview.map(function (photo) {
          return '<div class="l4u-photo-thumb"><img alt="Admin preview photo" src="' + escapeHtml(photo.dataUrl) + '" /></div>';
        }).join("");
      }
    }

    openPageModal();
  }

  async function deletePage(rowNode, pageId) {
    if (!window.confirm("Delete page " + pageId + "? This action cannot be undone.")) {
      return;
    }

    await callAdminApi("/api/admin/pages/" + encodeURIComponent(pageId), {
      method: "DELETE"
    });

    if (rowNode && rowNode.parentNode) {
      rowNode.parentNode.removeChild(rowNode);
    }

    setActionStatus("Page deleted: " + pageId, false);

    if (overviewLoaded) {
      loadOverview().catch(function () {
        // Ignore non-critical refresh errors here.
      });
    }
  }

  function bindUiEvents() {
    document.querySelectorAll("[data-admin-tab-button]").forEach(function (buttonNode) {
      buttonNode.addEventListener("click", function () {
        var tab = buttonNode.getAttribute("data-admin-tab-button") || "users";
        setActiveAdminTab(tab);
      });
    });

    var analyticsToggle = byId("adminAnalyticsToggle");
    var overviewLoadButton = byId("adminOverviewLoad");
    if (analyticsToggle) {
      analyticsToggle.addEventListener("click", function () {
        analyticsCollapsed = !analyticsCollapsed;
        setAnalyticsCollapsed(analyticsCollapsed);
      });
    }

    if (overviewLoadButton) {
      overviewLoadButton.addEventListener("click", function () {
        loadOverview().catch(function (error) {
          setActionStatus("Could not load overview stats: " + (error && error.code ? error.code : "unknown error"), true);
        });
      });
    }

    setActiveAdminTab(activeAdminTab);
    setAnalyticsCollapsed(analyticsCollapsed);

    var supportGateForm = byId("adminSupportGateForm");
    var supportGateReload = byId("adminSupportGateReload");

    if (supportGateForm) {
      supportGateForm.addEventListener("submit", function (event) {
        event.preventDefault();

        saveSupportGateConfig().catch(function (error) {
          setActionStatus("Could not save support gate links: " + (error && error.code ? error.code : "unknown error"), true);
        });
      });
    }

    if (supportGateReload) {
      supportGateReload.addEventListener("click", function () {
        supportGateReload.disabled = true;
        supportGateReload.textContent = "Loading...";

        loadSupportGateConfig()
          .then(function () {
            setActionStatus("Support gate config reloaded.", false);
          })
          .catch(function (error) {
            setActionStatus("Could not reload support gate config: " + (error && error.code ? error.code : "unknown error"), true);
          })
          .finally(function () {
            supportGateReload.disabled = false;
            supportGateReload.textContent = "Reload";
          });
      });
    }

    var userSearchForm = byId("adminUserSearchForm");
    var userSearchInput = byId("adminUserSearchInput");
    var userSearchClear = byId("adminUserSearchClear");
    var usersLoadMore = byId("adminUsersLoadMore");
    var usersTableBody = byId("adminUsersTableBody");

    if (userSearchForm) {
      userSearchForm.addEventListener("submit", function (event) {
        event.preventDefault();

        searchUsers(userSearchInput ? userSearchInput.value : "")
          .catch(function (error) {
            setActionStatus("User search failed: " + (error && error.code ? error.code : "unknown error"), true);
          });
      });
    }

    if (userSearchClear) {
      userSearchClear.addEventListener("click", function () {
        if (userSearchInput) {
          userSearchInput.value = "";
        }

        usersSearchActive = false;

        loadUsers(false).catch(function (error) {
          setActionStatus("Could not reload users: " + (error && error.code ? error.code : "unknown error"), true);
        });
      });
    }

    if (usersLoadMore) {
      usersLoadMore.addEventListener("click", function () {
        loadUsers(true).catch(function (error) {
          setActionStatus("Could not load more users: " + (error && error.code ? error.code : "unknown error"), true);
        });
      });
    }

    if (usersTableBody) {
      usersTableBody.addEventListener("click", function (event) {
        var target = event.target.closest("[data-credit-op]");
        if (!target) {
          return;
        }

        var rowNode = target.closest("tr[data-user-uid]");
        if (!rowNode) {
          return;
        }

        adjustCredits(rowNode, target.getAttribute("data-credit-op") || "add")
          .catch(function (error) {
            setActionStatus("Credit update failed: " + (error && error.code ? error.code : "unknown error"), true);
          });
      });
    }

    var pagesLoadButton = byId("adminPagesLoad");
    var pagesLoadMore = byId("adminPagesLoadMore");

    if (pagesLoadButton) {
      pagesLoadButton.addEventListener("click", function () {
        loadPages(false).catch(function (error) {
          setActionStatus("Could not load pages: " + (error && error.code ? error.code : "unknown error"), true);
        });
      });
    }

    if (pagesLoadMore) {
      pagesLoadMore.addEventListener("click", function () {
        loadPages(true).catch(function (error) {
          setActionStatus("Could not load more pages: " + (error && error.code ? error.code : "unknown error"), true);
        });
      });
    }

    var pagesTableBody = byId("adminPagesTableBody");
    if (pagesTableBody) {
      pagesTableBody.addEventListener("click", function (event) {
        var actionNode = event.target.closest("[data-page-action]");
        if (!actionNode) {
          return;
        }

        var rowNode = actionNode.closest("tr[data-page-id]");
        if (!rowNode) {
          return;
        }

        var pageId = rowNode.getAttribute("data-page-id") || "";
        var action = actionNode.getAttribute("data-page-action") || "";

        if (action === "view") {
          viewPage(pageId)
            .catch(function (error) {
              setActionStatus("Could not load page preview: " + (error && error.code ? error.code : "unknown error"), true);
            });
          return;
        }

        if (action === "delete") {
          deletePage(rowNode, pageId)
            .catch(function (error) {
              setActionStatus("Could not delete page: " + (error && error.code ? error.code : "unknown error"), true);
            });
        }
      });
    }

    document.querySelectorAll("[data-admin-modal-close]").forEach(function (node) {
      node.addEventListener("click", function () {
        closePageModal();
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closePageModal();
      }
    });
  }

  async function bootstrapAdminPanel() {
    setAccessMessage("Checking admin access...");

    var api;
    try {
      api = await getApi();
    } catch (_error) {
      setAccessDenied(true, "Firebase bridge is not ready.");
      return;
    }

    bindUiEvents();

    api.onAuthChanged(function (user) {
      var currentSequence = authSequence + 1;
      authSequence = currentSequence;

      if (!user) {
        resetUsersCache(true);
        currentAdminUid = "";
        renderUsers([], false);
        setAccessDenied(true, "Sign in with an admin account to continue.");
        return;
      }

      user.getIdTokenResult()
        .then(function (tokenResult) {
          if (currentSequence !== authSequence) {
            return;
          }

          var isAdmin = Boolean(tokenResult && tokenResult.claims && tokenResult.claims.admin === true);
          if (!isAdmin) {
            resetUsersCache(true);
            currentAdminUid = "";
            renderUsers([], false);
            setAccessDenied(true, "This account is signed in but does not have admin access.");
            return;
          }

          currentAdminUid = String(user && user.uid ? user.uid : "");
          showPanel();
          resetUsersCache(false);
          var hasHydratedUserCache = hydrateUsersCacheFromStorage();
          usersSearchActive = false;
          activeAdminTab = "users";
          analyticsCollapsed = false;
          setOverviewNotLoadedState();
          setPagesNotLoadedState();

          setActiveAdminTab(activeAdminTab);
          setAnalyticsCollapsed(analyticsCollapsed);

          if (hasHydratedUserCache) {
            usersVisibleCount = Math.min(USER_PAGE_SIZE, usersCacheList.length);
            renderUsers(usersCacheList.slice(0, usersVisibleCount), false);
            updateDefaultUsersMeta();
            syncUsersLoadMoreVisibility();
          } else {
            renderUsers([], false);
          }

          loadSupportGateConfig().catch(function (error) {
            setActionStatus("Could not load support gate config: " + (error && error.code ? error.code : "unknown error"), true);
          });

          loadUsers(false)
            .catch(function (error) {
              setActionStatus("Admin panel load failed: " + (error && error.code ? error.code : "unknown error"), true);
            });
        })
        .catch(function () {
          if (currentSequence !== authSequence) {
            return;
          }

          resetUsersCache(true);
          currentAdminUid = "";
          renderUsers([], false);
          setAccessDenied(true, "Could not verify admin claim. Please sign in again.");
        });
    });
  }

  if (document.body && document.body.getAttribute("data-page") === "admin") {
    bootstrapAdminPanel();
  }
})();
