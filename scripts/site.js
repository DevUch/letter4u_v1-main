(function () {
  "use strict";

  var STORAGE_KEY = "letter4u.frontend.state.v3";
  var inPagesDir = /\/pages\//i.test(window.location.pathname);
  var pendingPack = null;
  var savingFlowActive = false;
  var communityUsersAnimationFrame = 0;
  var communityUsersAnimatedValue = -1;
  var publicPagesAnimationFrame = 0;
  var publicPagesAnimatedValue = -1;
  var featuredTemplatesAnimationFrame = 0;
  var featuredTemplatesAnimatedValue = -1;
  var pageLoaderHideTimer = 0;
  var pageNavigationTimer = 0;
  var pageLoaderVisibleAtMs = 0;
  var PAGE_LOADER_MIN_VISIBLE_MS = 220;
  var FEATURED_TEMPLATES_COUNT = 2;
  var LOVE_LOCK_FIRST_CREDIT_CHARACTERS = 300;
  var LOVE_LOCK_FIRST_CREDIT_PHOTOS = 2;
  var LOVE_LOCK_CHARACTERS_PER_CREDIT = 550;
  var DEFAULT_CHARACTERS_PER_CREDIT = 300;
  var PHOTOS_PER_CREDIT = 4;
  var CUSTOM_PAGE_NAME_EXTRA_CREDITS = 5;
  var test = 0;
  var CUSTOM_PAGE_NAME_MIN_LENGTH = 4;
  var CUSTOM_PAGE_NAME_MAX_LENGTH = 15;
  var VOUCHER_DISCOUNT_CREDITS = 1;
  var VOUCHER_MINIMUM_REQUIRED_CREDITS = 2;
  var SOCIAL_COMMENT_PREVIEW_MAX_CHARS = 50;
  var DEFAULT_SOCIAL_COMMENT = "This is perfect for those quiet people who love deeply but don't always know how to express it out loud.";
  var socialCommentPool = [DEFAULT_SOCIAL_COMMENT];
  var socialCommentPoolPromise = null;
  var activeSuggestedSocialComment = DEFAULT_SOCIAL_COMMENT;
  var tiktokWarningAutoOpened = false;
  var modalFocusRestoreElement = null;
  var DEFAULT_SUPPORT_GATE_TIKTOK_PROFILE_LINK = "https://www.tiktok.com/@kiiinji";
  var DEFAULT_SUPPORT_GATE_TIKTOK_VIDEO_LINK = "https://www.tiktok.com/@kiiinji/video/7627476491730799879";
  var DEFAULT_SUPPORT_GATE_INSTAGRAM_PROFILE_LINK = "https://www.instagram.com/_kiiinji/";
  var DEFAULT_SUPPORT_GATE_INSTAGRAM_VIDEO_LINK = "https://www.instagram.com/p/DXJZOkvEsCY/";
  var LEGACY_SW_CLEANUP_KEY = "letter4u.legacy-sw-cleanup.v1";

  var firebaseApi = null;
  var firebaseReadyPromise = null;
  var firebaseSyncEnabled = false;
  var authInitialized = false;

  var authUnsubscribe = null;
  var creditsUnsubscribe = null;
  var pagesUnsubscribe = null;
  var statsUnsubscribe = null;

  var defaultState = {
    credits: 0,
    signedIn: false,
    isAdmin: false,
    userUid: "",
    userName: "Guest",
    drafts: [],
    publicStats: {
      users: 0,
      pages: 0
    },
    settings: {
      displayName: "Guest",
      autoSave: true,
      weeklyDigest: true,
      darkMode: false
    },
    draftForm: {
      templateType: "",
      title: "",
      recipient: "",
      pinCode: "",
      message: "",
      closing: "With love,",
      signature: "Your Name",
      date: "",
      youtubeUrl: "",
      customPageNameEnabled: false,
      customPageName: "",
      voucherCode: ""
    }
  };

  var state = loadState();
  cleanupLegacyServiceWorkers();

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(defaultState));
  }

  function toInt(value, fallback) {
    var parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
    return fallback;
  }

  function markLegacyServiceWorkerCleanupComplete() {
    try {
      window.localStorage.setItem(LEGACY_SW_CLEANUP_KEY, "1");
    } catch (_error) {
      // Ignore storage failures in private browsing mode.
    }
  }

  function cleanupLegacyServiceWorkers() {
    if (!("serviceWorker" in navigator) || typeof navigator.serviceWorker.getRegistrations !== "function") {
      return;
    }

    try {
      if (window.localStorage.getItem(LEGACY_SW_CLEANUP_KEY) === "1") {
        return;
      }
    } catch (_error) {
      // Continue cleanup even if storage access fails.
    }

    navigator.serviceWorker.getRegistrations()
      .then(function (registrations) {
        if (!Array.isArray(registrations) || !registrations.length) {
          return [];
        }

        return Promise.all(registrations.map(function (registration) {
          return registration.unregister().catch(function () {
            return false;
          });
        }));
      })
      .catch(function () {
        return [];
      })
      .then(function () {
        if (!("caches" in window) || !window.caches || typeof window.caches.keys !== "function") {
          return [];
        }

        return window.caches.keys()
          .then(function (cacheNames) {
            if (!Array.isArray(cacheNames) || !cacheNames.length) {
              return [];
            }

            return Promise.all(cacheNames.map(function (cacheName) {
              return window.caches.delete(cacheName).catch(function () {
                return false;
              });
            }));
          })
          .catch(function () {
            return [];
          });
      })
      .then(function () {
        markLegacyServiceWorkerCleanupComplete();
      });
  }

  function loadState() {
    var fallback = cloneDefaultState();

    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return fallback;
      }

      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return fallback;
      }

      fallback.signedIn = Boolean(parsed.signedIn);
      fallback.isAdmin = Boolean(parsed.isAdmin);
      fallback.userUid = typeof parsed.userUid === "string" ? parsed.userUid : "";
      fallback.userName = typeof parsed.userName === "string" && parsed.userName.trim() ? parsed.userName.trim() : fallback.userName;
      fallback.drafts = Array.isArray(parsed.drafts) ? parsed.drafts : fallback.drafts;
      fallback.publicStats = Object.assign({}, fallback.publicStats, parsed.publicStats || {});
      fallback.settings = Object.assign({}, fallback.settings, parsed.settings || {});
      fallback.draftForm = Object.assign({}, fallback.draftForm, parsed.draftForm || {});

      fallback.settings.displayName = typeof fallback.settings.displayName === "string" && fallback.settings.displayName.trim()
        ? fallback.settings.displayName.trim()
        : "Guest";
      fallback.settings.autoSave = Boolean(fallback.settings.autoSave);
      fallback.settings.weeklyDigest = Boolean(fallback.settings.weeklyDigest);
      fallback.settings.darkMode = Boolean(fallback.settings.darkMode);

      return fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveState() {
    var persistedState = Object.assign({}, state, {
      // Credits are server-authoritative; never persist wallet balance locally.
      credits: 0
    });

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
  }

  function emitStateUpdated() {
    document.dispatchEvent(new CustomEvent("l4u:state-updated"));
  }

  function normalizeRouteName(file) {
    return String(file || "")
      .trim()
      .replace(/^\/+/, "")
      .replace(/\.html$/i, "");
  }

  function routeTo(file) {
    var routeName = normalizeRouteName(file);

    if (!routeName || routeName === "index") {
      return inPagesDir ? "../" : "/";
    }

    if (routeName === "viewer") {
      return inPagesDir ? "../viewer" : "viewer";
    }

    return inPagesDir ? routeName : "pages/" + routeName;
  }

  function getViewerPath() {
    return inPagesDir ? "../viewer" : "viewer";
  }

  function getQrCodeUrl(text, size) {
    var normalizedSize = Math.max(120, toInt(size, 280));
    return "https://api.qrserver.com/v1/create-qr-code/?format=png&margin=0&ecc=M&size=" +
      normalizedSize + "x" + normalizedSize +
      "&data=" + encodeURIComponent(String(text || ""));
  }

  function getCurrentFile() {
    var path = String(window.location.pathname || "").replace(/\/+$/, "");
    var file = (path.split("/").pop() || "index").toLowerCase();

    if (!file || file === "index" || file === "index.html") {
      return "home.html";
    }

    if (!/\.html$/i.test(file)) {
      file += ".html";
    }

    return file;
  }

  function isLocalEnvironment() {
    var hostname = String(window.location.hostname || "").toLowerCase();

    return hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      /\.localhost$/i.test(hostname);
  }

  function isTikTokInAppBrowser() {
    var rawUserAgent = String(navigator.userAgent || "");
    var userAgent = rawUserAgent.toLowerCase();
    var referrer = String(document.referrer || "").toLowerCase();
    var searchParams = new URLSearchParams(window.location.search || "");
    var userAgentDataBrands = navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)
      ? navigator.userAgentData.brands
      : [];
    var knownMarkers = [
      "tiktok",
      "musical_ly",
      "aweme",
      "ttwebview",
      "tt_webview",
      "bytedance",
      "snssdk"
    ];

    if (!rawUserAgent) {
      return false;
    }

    // Primary check: TikTok marker in user agent.
    if (/tiktok/i.test(rawUserAgent)) {
      return true;
    }

    if (userAgentDataBrands.some(function (brandEntry) {
      var brand = String(brandEntry && brandEntry.brand ? brandEntry.brand : "").toLowerCase();
      return brand.indexOf("tiktok") >= 0 || brand.indexOf("bytedance") >= 0;
    })) {
      return true;
    }

    for (var markerIndex = 0; markerIndex < knownMarkers.length; markerIndex += 1) {
      if (userAgent.indexOf(knownMarkers[markerIndex]) >= 0) {
        return true;
      }
    }

    if (
      (searchParams.has("ttclid") || referrer.indexOf("tiktok.com") >= 0) &&
      (/;\s*wv\)/i.test(userAgent) || userAgent.indexOf("ttwebview") >= 0 || userAgent.indexOf("tt_webview") >= 0)
    ) {
      return true;
    }

    if (typeof window.TiktokJSBridge !== "undefined" || typeof window.ttJSCore !== "undefined") {
      return true;
    }

    return false;
  }

  function isLikelyPopupBlockedInAppError(error) {
    var rawCode = String(error && error.code ? error.code : "").toLowerCase();
    var rawMessage = String(error && error.message ? error.message : "").toLowerCase();
    var combined = rawCode + " " + rawMessage;

    return combined.indexOf("popup") >= 0 ||
      combined.indexOf("operation-not-supported-in-this-environment") >= 0 ||
      combined.indexOf("web storage unsupported") >= 0 ||
      combined.indexOf("inapp") >= 0;
  }

  function maybeAutoOpenTikTokBrowserWarning() {
    if (tiktokWarningAutoOpened) {
      return;
    }

    if (!isTikTokInAppBrowser()) {
      return;
    }

    tiktokWarningAutoOpened = true;

    window.setTimeout(function () {
      openModal("tiktok-browser-warning");
    }, 40);
  }

  function clearPageLoaderHideTimer() {
    if (!pageLoaderHideTimer) {
      return;
    }

    window.clearTimeout(pageLoaderHideTimer);
    pageLoaderHideTimer = 0;
  }

  function clearPageNavigationTimer() {
    if (!pageNavigationTimer) {
      return;
    }

    window.clearTimeout(pageNavigationTimer);
    pageNavigationTimer = 0;
  }

  function ensurePageLoader() {
    var loaderNode = document.getElementById("l4uPageLoader");
    if (loaderNode) {
      return loaderNode;
    }

    if (!document.body) {
      return null;
    }

    loaderNode = document.createElement("div");
    loaderNode.id = "l4uPageLoader";
    loaderNode.className = "l4u-page-loader";
    loaderNode.setAttribute("role", "status");
    loaderNode.setAttribute("aria-live", "polite");
    loaderNode.innerHTML = "" +
      '<div class="l4u-page-loader-inner">' +
      '  <img src="/public/images/icon.png" alt="Letter4U icon" class="l4u-page-loader-icon" />' +
      '  <p class="l4u-page-loader-text">Loading your page...</p>' +
      '  <div class="l4u-page-loader-dots" aria-hidden="true">' +
      '    <span></span>' +
      '    <span></span>' +
      '    <span></span>' +
      '  </div>' +
      '</div>';

    loaderNode.hidden = true;
    loaderNode.classList.add("is-hidden");
    document.body.appendChild(loaderNode);

    return loaderNode;
  }

  function showPageLoader() {
    var loaderNode = ensurePageLoader();
    if (!loaderNode) {
      return;
    }

    clearPageLoaderHideTimer();
    pageLoaderVisibleAtMs = Date.now();
    loaderNode.hidden = false;
    loaderNode.classList.remove("is-hidden");
    document.body.classList.add("l4u-page-transitioning");
  }

  function hidePageLoader() {
    var loaderNode = ensurePageLoader();
    if (!loaderNode) {
      return;
    }

    clearPageLoaderHideTimer();

    var elapsed = pageLoaderVisibleAtMs
      ? Math.max(0, Date.now() - pageLoaderVisibleAtMs)
      : PAGE_LOADER_MIN_VISIBLE_MS;
    var hideDelay = Math.max(0, PAGE_LOADER_MIN_VISIBLE_MS - elapsed);

    pageLoaderHideTimer = window.setTimeout(function () {
      loaderNode.classList.add("is-hidden");

      pageLoaderHideTimer = window.setTimeout(function () {
        loaderNode.hidden = true;
        document.body.classList.remove("l4u-page-transitioning");
        pageLoaderHideTimer = 0;
      }, 320);
    }, hideDelay);
  }

  function shouldShowPageLoaderForNavigation(linkNode, event) {
    if (!linkNode || !event || event.defaultPrevented) {
      return false;
    }

    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }

    if (linkNode.hasAttribute("download")) {
      return false;
    }

    var target = String(linkNode.getAttribute("target") || "").toLowerCase();
    if (target && target !== "_self") {
      return false;
    }

    var rawHref = String(linkNode.getAttribute("href") || "").trim();
    if (!rawHref || rawHref.charAt(0) === "#" || /^(mailto:|tel:|javascript:)/i.test(rawHref)) {
      return false;
    }

    var nextUrl;
    try {
      nextUrl = new URL(linkNode.href, window.location.href);
    } catch (_error) {
      return false;
    }

    if (nextUrl.origin !== window.location.origin) {
      return false;
    }

    if (nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search) {
      return false;
    }

    return true;
  }

  function initPageLoaderTransitions() {
    showPageLoader();

    function finalizeInitialLoading() {
      window.setTimeout(hidePageLoader, 110);
    }

    if (document.readyState === "complete") {
      finalizeInitialLoading();
    } else {
      window.addEventListener("load", finalizeInitialLoading, { once: true });
    }

    window.addEventListener("pageshow", function () {
      hidePageLoader();
    });
  }

  function normalizeSocialCommentPool(payload) {
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .map(function (entry) {
        return String(entry || "").trim();
      })
      .filter(Boolean);
  }

  function chooseRandomSocialComment() {
    var pool = Array.isArray(socialCommentPool) && socialCommentPool.length
      ? socialCommentPool
      : [DEFAULT_SOCIAL_COMMENT];
    var randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex] || DEFAULT_SOCIAL_COMMENT;
  }

  function formatSuggestedCommentPreview(commentText, maxChars) {
    var normalized = String(commentText || "").trim();
    var limit = Math.max(1, toInt(maxChars, SOCIAL_COMMENT_PREVIEW_MAX_CHARS));

    if (normalized.length <= limit) {
      return normalized;
    }

    return normalized.slice(0, limit).trimEnd() + "....";
  }

  function applySuggestedSocialComment(commentText) {
    var normalized = String(commentText || DEFAULT_SOCIAL_COMMENT).trim() || DEFAULT_SOCIAL_COMMENT;
    var preview = formatSuggestedCommentPreview(normalized, SOCIAL_COMMENT_PREVIEW_MAX_CHARS);
    var socialSuggestedComment = document.getElementById("socialSuggestedComment");

    activeSuggestedSocialComment = normalized;

    if (!socialSuggestedComment) {
      return;
    }

    socialSuggestedComment.textContent = preview;
    socialSuggestedComment.setAttribute("data-full-comment", normalized);
    socialSuggestedComment.setAttribute("title", normalized);
  }

  function ensureSocialCommentPool() {
    if (socialCommentPoolPromise) {
      return socialCommentPoolPromise;
    }

    socialCommentPoolPromise = fetch("/public/assets/comments.json", { cache: "no-store" })
      .then(function (response) {
        if (!response || !response.ok) {
          throw new Error("COMMENTS_FETCH_FAILED");
        }

        return response.json();
      })
      .then(function (payload) {
        var options = normalizeSocialCommentPool(payload);
        if (options.length) {
          socialCommentPool = options;
        }
        return socialCommentPool;
      })
      .catch(function () {
        return socialCommentPool;
      });

    return socialCommentPoolPromise;
  }

  function refreshSuggestedSocialComment() {
    return ensureSocialCommentPool()
      .then(function () {
        applySuggestedSocialComment(chooseRandomSocialComment());
      })
      .catch(function () {
        applySuggestedSocialComment(DEFAULT_SOCIAL_COMMENT);
      });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(isoDate) {
    var dateObject = new Date(isoDate);

    if (Number.isNaN(dateObject.getTime())) {
      return "Draft";
    }

    return dateObject.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function formatCompactCount(value) {
    var count = Math.max(0, toInt(value, 0));

    if (count >= 1000000) {
      var million = Math.round((count / 1000000) * 10) / 10;
      return String(million).replace(/\.0$/, "") + "M+";
    }

    if (count >= 1000) {
      var thousand = Math.round((count / 1000) * 10) / 10;
      return String(thousand).replace(/\.0$/, "") + "k+";
    }

    return String(count);
  }

  function renderCommunityUsersCount(value) {
    var normalized = Math.max(0, toInt(value, 0));

    document.querySelectorAll("[data-public-users-compact]").forEach(function (node) {
      node.textContent = normalized.toLocaleString();
      node.setAttribute("data-count-value", String(normalized));
    });
  }

  function animateCommunityUsersCount(targetValue) {
    var normalizedTarget = Math.max(0, toInt(targetValue, 0));
    var nodes = document.querySelectorAll("[data-public-users-compact]");

    if (!nodes.length) {
      communityUsersAnimatedValue = normalizedTarget;
      return;
    }

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (communityUsersAnimationFrame) {
        window.cancelAnimationFrame(communityUsersAnimationFrame);
        communityUsersAnimationFrame = 0;
      }

      renderCommunityUsersCount(normalizedTarget);
      communityUsersAnimatedValue = normalizedTarget;
      return;
    }

    var startValue = 0;
    if (communityUsersAnimatedValue >= 0) {
      startValue = communityUsersAnimatedValue;
    }

    var firstNode = nodes[0];
    if (firstNode) {
      var nodeValue = toInt(firstNode.getAttribute("data-count-value"), startValue);
      startValue = Math.max(0, nodeValue);
    }

    if (communityUsersAnimationFrame) {
      window.cancelAnimationFrame(communityUsersAnimationFrame);
      communityUsersAnimationFrame = 0;
    }

    if (startValue === normalizedTarget) {
      renderCommunityUsersCount(normalizedTarget);
      communityUsersAnimatedValue = normalizedTarget;
      return;
    }

    var durationMs = 900;
    var startedAt = 0;
    var delta = normalizedTarget - startValue;

    function paintFrame(now) {
      if (!startedAt) {
        startedAt = now;
      }

      var progress = Math.min(1, (now - startedAt) / durationMs);
      var eased = 1 - Math.pow(1 - progress, 3);
      var currentValue = Math.round(startValue + (delta * eased));

      renderCommunityUsersCount(currentValue);

      if (progress < 1) {
        communityUsersAnimationFrame = window.requestAnimationFrame(paintFrame);
        return;
      }

      communityUsersAnimationFrame = 0;
      communityUsersAnimatedValue = normalizedTarget;
      renderCommunityUsersCount(normalizedTarget);
    }

    communityUsersAnimationFrame = window.requestAnimationFrame(paintFrame);
  }

  function renderPublicPagesCount(value) {
    var normalized = Math.max(0, toInt(value, 0));

    document.querySelectorAll("[data-public-pages-compact]").forEach(function (node) {
      node.textContent = normalized.toLocaleString();
      node.setAttribute("data-count-value", String(normalized));
    });
  }

  function animatePublicPagesCount(targetValue) {
    var normalizedTarget = Math.max(0, toInt(targetValue, 0));
    var nodes = document.querySelectorAll("[data-public-pages-compact]");

    if (!nodes.length) {
      publicPagesAnimatedValue = normalizedTarget;
      return;
    }

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (publicPagesAnimationFrame) {
        window.cancelAnimationFrame(publicPagesAnimationFrame);
        publicPagesAnimationFrame = 0;
      }

      renderPublicPagesCount(normalizedTarget);
      publicPagesAnimatedValue = normalizedTarget;
      return;
    }

    var startValue = 0;
    if (publicPagesAnimatedValue >= 0) {
      startValue = publicPagesAnimatedValue;
    }

    var firstNode = nodes[0];
    if (firstNode) {
      var nodeValue = toInt(firstNode.getAttribute("data-count-value"), startValue);
      startValue = Math.max(0, nodeValue);
    }

    if (publicPagesAnimationFrame) {
      window.cancelAnimationFrame(publicPagesAnimationFrame);
      publicPagesAnimationFrame = 0;
    }

    if (startValue === normalizedTarget) {
      renderPublicPagesCount(normalizedTarget);
      publicPagesAnimatedValue = normalizedTarget;
      return;
    }

    var durationMs = 900;
    var startedAt = 0;
    var delta = normalizedTarget - startValue;

    function paintFrame(now) {
      if (!startedAt) {
        startedAt = now;
      }

      var progress = Math.min(1, (now - startedAt) / durationMs);
      var eased = 1 - Math.pow(1 - progress, 3);
      var currentValue = Math.round(startValue + (delta * eased));

      renderPublicPagesCount(currentValue);

      if (progress < 1) {
        publicPagesAnimationFrame = window.requestAnimationFrame(paintFrame);
        return;
      }

      publicPagesAnimationFrame = 0;
      publicPagesAnimatedValue = normalizedTarget;
      renderPublicPagesCount(normalizedTarget);
    }

    publicPagesAnimationFrame = window.requestAnimationFrame(paintFrame);
  }

  function renderFeaturedTemplatesCount(value) {
    var normalized = Math.max(0, toInt(value, 0));

    document.querySelectorAll("[data-featured-templates-compact]").forEach(function (node) {
      node.textContent = String(normalized);
      node.setAttribute("data-count-value", String(normalized));
    });
  }

  function animateFeaturedTemplatesCount(targetValue) {
    var normalizedTarget = Math.max(0, toInt(targetValue, 0));
    var nodes = document.querySelectorAll("[data-featured-templates-compact]");

    if (!nodes.length) {
      featuredTemplatesAnimatedValue = normalizedTarget;
      return;
    }

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (featuredTemplatesAnimationFrame) {
        window.cancelAnimationFrame(featuredTemplatesAnimationFrame);
        featuredTemplatesAnimationFrame = 0;
      }

      renderFeaturedTemplatesCount(normalizedTarget);
      featuredTemplatesAnimatedValue = normalizedTarget;
      return;
    }

    var startValue = 0;
    if (featuredTemplatesAnimatedValue >= 0) {
      startValue = featuredTemplatesAnimatedValue;
    }

    var firstNode = nodes[0];
    if (firstNode) {
      var nodeValue = toInt(firstNode.getAttribute("data-count-value"), startValue);
      startValue = Math.max(0, nodeValue);
    }

    if (featuredTemplatesAnimationFrame) {
      window.cancelAnimationFrame(featuredTemplatesAnimationFrame);
      featuredTemplatesAnimationFrame = 0;
    }

    if (startValue === normalizedTarget) {
      renderFeaturedTemplatesCount(normalizedTarget);
      featuredTemplatesAnimatedValue = normalizedTarget;
      return;
    }

    var durationMs = 700;
    var startedAt = 0;
    var delta = normalizedTarget - startValue;

    function paintFrame(now) {
      if (!startedAt) {
        startedAt = now;
      }

      var progress = Math.min(1, (now - startedAt) / durationMs);
      var eased = 1 - Math.pow(1 - progress, 3);
      var currentValue = Math.round(startValue + (delta * eased));

      renderFeaturedTemplatesCount(currentValue);

      if (progress < 1) {
        featuredTemplatesAnimationFrame = window.requestAnimationFrame(paintFrame);
        return;
      }

      featuredTemplatesAnimationFrame = 0;
      featuredTemplatesAnimatedValue = normalizedTarget;
      renderFeaturedTemplatesCount(normalizedTarget);
    }

    featuredTemplatesAnimationFrame = window.requestAnimationFrame(paintFrame);
  }

  function getTemplateCharacterCreditLimit(templateType) {
    return templateType === "love-lock"
      ? LOVE_LOCK_FIRST_CREDIT_CHARACTERS
      : DEFAULT_CHARACTERS_PER_CREDIT;
  }

  function calculateDraftCredits(templateType, charCount, photoCount) {
    var normalizedChars = Math.max(0, toInt(charCount, 0));
    var normalizedPhotos = Math.max(0, toInt(photoCount, 0));

    if (templateType === "love-lock") {
      var textCredits = normalizedChars <= LOVE_LOCK_FIRST_CREDIT_CHARACTERS
        ? 1
        : 1 + Math.ceil((normalizedChars - LOVE_LOCK_FIRST_CREDIT_CHARACTERS) / LOVE_LOCK_CHARACTERS_PER_CREDIT);
      var photoCredits = normalizedPhotos <= LOVE_LOCK_FIRST_CREDIT_PHOTOS
        ? 1
        : 1 + Math.ceil((normalizedPhotos - LOVE_LOCK_FIRST_CREDIT_PHOTOS) / PHOTOS_PER_CREDIT);

      return Math.max(textCredits, photoCredits);
    }

    var perCreditChars = Math.max(1, toInt(getTemplateCharacterCreditLimit(templateType), DEFAULT_CHARACTERS_PER_CREDIT));

    var textCredits = Math.max(1, Math.ceil(Math.max(1, normalizedChars) / perCreditChars));
    var photoCredits = Math.max(1, Math.ceil(Math.max(1, normalizedPhotos) / PHOTOS_PER_CREDIT));

    return Math.max(textCredits, photoCredits);
  }

  function hasCloudSession() {
    return Boolean(firebaseSyncEnabled && firebaseApi && authInitialized && state.signedIn && state.userUid);
  }

  function applyThemeMode() {
    var darkModeEnabled = Boolean(state.settings && state.settings.darkMode);

    document.documentElement.classList.toggle("l4u-dark", darkModeEnabled);

    if (document.body) {
      document.body.classList.toggle("l4u-dark", darkModeEnabled);
    }
  }

  function renderNavigation() {
    var mount = document.querySelector("[data-l4u-nav]");
    if (!mount) {
      return;
    }

    mount.innerHTML = "" +
      '<nav class="sticky top-0 z-40 border-b border-white/70 bg-white/70 backdrop-blur-xl">' +
      '  <div class="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8">' +
      '    <a href="' + routeTo("home.html") + '" class="l4u-brand-link font-headline text-xl font-extrabold tracking-tight text-lfu-primary" aria-label="Letter4U Home">' +
      '      <img src="/public/images/icon.png" alt="Letter4U logo" class="l4u-brand-logo" />' +
      '      <span class="l4u-brand-word">Letter4U</span>' +
      '    </a>' +
      '    <div class="hidden text-sm font-semibold md:flex l4u-nav-group" data-nav-group="desktop">' +
      '      <span class="l4u-nav-indicator" data-nav-indicator aria-hidden="true"></span>' +
      '      <a href="' + routeTo("home.html") + '" data-nav-file="home.html" class="l4u-nav-link pb-1">Home</a>' +
      '      <a href="' + routeTo("create.html") + '" data-nav-file="create.html" class="l4u-nav-link pb-1">Create</a>' +
      '      <a href="' + routeTo("my-pages.html") + '" data-nav-file="my-pages.html" data-auth-visible="signed-in" class="hidden l4u-nav-link pb-1">My Pages</a>' +
      '      <a href="' + routeTo("shop.html") + '" data-nav-file="shop.html" class="l4u-nav-link pb-1">Shop/Pricing</a>' +
      '      <a href="' + routeTo("settings.html") + '" data-nav-file="settings.html" data-auth-visible="signed-in" class="hidden l4u-nav-link pb-1">Settings</a>' +
      '      <a href="' + routeTo("admin.html") + '" data-nav-file="admin.html" data-admin-visible="true" class="hidden l4u-nav-link pb-1">Admin</a>' +
      '    </div>' +
      '    <div class="flex items-center gap-3">' +
      '      <span data-auth-visible="signed-in" class="hidden l4u-credit-pill rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.11em]"><span data-credits>0</span> credits</span>' +
      '      <button type="button" data-open-modal="signin" data-auth-visible="signed-out" class="h-10 rounded-full bg-white px-4 text-xs font-bold uppercase tracking-[0.1em] text-lfu-primary shadow-soft">Sign In</button>' +
      '      <a href="' + routeTo("settings.html") + '" data-auth-visible="signed-in" class="hidden inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-bold text-lfu-primary shadow-soft" aria-label="Open account settings">' +
      '        <span data-user-initial>G</span>' +
      '      </a>' +
      '    </div>' +
      '    <div class="l4u-mobile-nav-row w-full md:hidden">' +
      '      <div class="l4u-nav-group l4u-nav-group-mobile text-xs font-semibold" data-nav-group="mobile">' +
      '        <span class="l4u-nav-indicator" data-nav-indicator aria-hidden="true"></span>' +
      '        <a href="' + routeTo("home.html") + '" data-nav-file="home.html" class="l4u-nav-link pb-1">Home</a>' +
      '        <a href="' + routeTo("create.html") + '" data-nav-file="create.html" class="l4u-nav-link pb-1">Create</a>' +
      '        <a href="' + routeTo("my-pages.html") + '" data-nav-file="my-pages.html" data-auth-visible="signed-in" class="hidden l4u-nav-link pb-1">My Pages</a>' +
      '        <a href="' + routeTo("shop.html") + '" data-nav-file="shop.html" class="l4u-nav-link pb-1">Shop/Pricing</a>' +
      '        <a href="' + routeTo("settings.html") + '" data-nav-file="settings.html" data-auth-visible="signed-in" class="hidden l4u-nav-link pb-1">Settings</a>' +
      '        <a href="' + routeTo("admin.html") + '" data-nav-file="admin.html" data-admin-visible="true" class="hidden l4u-nav-link pb-1">Admin</a>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</nav>';

    var currentFile = getCurrentFile();
    document.querySelectorAll("[data-nav-file]").forEach(function (node) {
      if (node.getAttribute("data-nav-file") === currentFile) {
        node.classList.add("active");
      }
    });

    function syncNavIndicator(groupNode, highlightNode) {
      if (!groupNode) {
        return;
      }

      var indicator = groupNode.querySelector("[data-nav-indicator]");
      if (!indicator) {
        return;
      }

      var target = highlightNode || groupNode.querySelector(".l4u-nav-link.active");
      if (!target || target.classList.contains("hidden")) {
        indicator.style.opacity = "0";
        return;
      }

      var offsetLeft = Math.max(0, target.offsetLeft);

      indicator.style.width = target.offsetWidth + "px";
      indicator.style.transform = "translateX(" + offsetLeft + "px)";
      indicator.style.opacity = "1";
    }

    document.querySelectorAll("[data-nav-group]").forEach(function (groupNode) {
      syncNavIndicator(groupNode);

      groupNode.querySelectorAll(".l4u-nav-link").forEach(function (linkNode) {
        linkNode.addEventListener("mouseenter", function () {
          syncNavIndicator(groupNode, linkNode);
        });

        linkNode.addEventListener("focus", function () {
          syncNavIndicator(groupNode, linkNode);
        });

        linkNode.addEventListener("mouseleave", function () {
          syncNavIndicator(groupNode);
        });

        linkNode.addEventListener("click", function () {
          groupNode.querySelectorAll(".l4u-nav-link.active").forEach(function (activeNode) {
            activeNode.classList.remove("active");
          });

          linkNode.classList.add("active");
          syncNavIndicator(groupNode, linkNode);
        });
      });
    });

    if (!renderNavigation._resizeBound) {
      renderNavigation._resizeBound = true;
      window.addEventListener("resize", function () {
        document.querySelectorAll("[data-nav-group]").forEach(function (groupNode) {
          var indicator = groupNode.querySelector("[data-nav-indicator]");
          if (!indicator) {
            return;
          }

          var target = groupNode.querySelector(".l4u-nav-link.active");
          if (!target || target.classList.contains("hidden")) {
            indicator.style.opacity = "0";
            return;
          }

          indicator.style.width = target.offsetWidth + "px";
          indicator.style.transform = "translateX(" + Math.max(0, target.offsetLeft) + "px)";
          indicator.style.opacity = "1";
        });
      });
    }
  }

  function renderFooter() {
    var mount = document.querySelector("[data-l4u-footer]");
    if (!mount) {
      return;
    }

    mount.innerHTML = "" +
      '<footer class="mt-24 border-t border-lfu-primary/15 bg-transparent">' +
      '  <div class="mx-auto w-full max-w-7xl px-4 pb-8 pt-8 md:px-8">' +
      '    <div class="flex flex-col gap-3 text-xs text-lfu-outline md:flex-row md:items-center md:justify-between">' +
      '      <p>Copyright 2026 Letter4U. Crafted with intentionality.</p>' +
      '      <p><span data-public-users>0</span> community users • <span data-public-pages>0</span> pages created</p>' +
      '    </div>' +
      '  </div>' +
      '</footer>';
  }

  function renderModals() {
    var mount = document.querySelector("[data-l4u-modals]");
    if (!mount) {
      mount = document.createElement("div");
      document.body.appendChild(mount);
    }

    mount.innerHTML = "" +
      '<div class="l4u-modal" data-modal="signin" hidden>' +
      '  <div class="l4u-modal-backdrop" data-close-modal></div>' +
      '  <div class="l4u-modal-card l4u-modal-card-signin">' +
      '    <p class="l4u-kicker text-center">Welcome Back</p>' +
      '    <h2 class="mt-2 text-center font-headline text-2xl font-bold text-lfu-ink">Sign in with Google</h2>' +
      '    <p class="mt-3 text-center text-sm text-lfu-outline">Connect with Firebase Authentication to sync pages and credits across devices.</p>' +
      '    <section class="l4u-signin-terms-shell mt-5">' +
      '      <p class="l4u-signin-terms-title">Terms of Service and Privacy Policy for Letter4U</p>' +
      '      <p class="l4u-signin-terms-meta">Effective Date: April 14, 2026</p>' +
      '      <div id="signinTermsScroll" class="l4u-signin-terms-scroll" tabindex="0" role="region" aria-label="Terms of Service and Privacy Policy">' +
      '        <h4>Terms Summary (Plain Language Overview)</h4>' +
      '        <p>This summary is for convenience only. The full Terms remain legally binding.</p>' +
      '        <ul>' +
      '          <li>You create and own your content (letters, photos, pages).</li>' +
      '          <li>Credits are required to create or expand content.</li>' +
      '          <li>You may earn free credits or purchase credits.</li>' +
      '          <li>All purchases are final and non-refundable unless required by law.</li>' +
      '          <li>Pages are accessible to anyone with the link.</li>' +
      '          <li>PIN protection is not a real security feature.</li>' +
      '          <li>Do not upload sensitive or private information.</li>' +
      '          <li>We may remove content or suspend accounts for violations.</li>' +
      '          <li>We are not responsible for unauthorized sharing or data loss.</li>' +
      '        </ul>' +
      '        <h4>Terms of Service</h4>' +
      '        <h5>1. Acceptance of Terms</h5>' +
      '        <p>By accessing or using Letter4U ("we," "our," or "the Service"), you agree to be bound by these Terms. If you do not agree, you must not use the Service.</p>' +
      '        <h5>2. Description of Service</h5>' +
      '        <p>Letter4U is a digital platform that allows users to create personalized pages, including love letters, photo collages, and other custom content, and share them through unique links.</p>' +
      '        <p>The Service operates on a usage-based credit system. The number of credits required depends on factors such as the number of photos uploaded and the length of written content.</p>' +
      '        <h5>3. Eligibility</h5>' +
      '        <p>You must:</p>' +
      '        <ul>' +
      '          <li>Be at least 13 years old or the minimum legal age in your jurisdiction.</li>' +
      '          <li>Have the legal capacity to enter into these Terms.</li>' +
      '          <li>Comply with all applicable laws and regulations.</li>' +
      '        </ul>' +
      '        <h5>4. User Accounts</h5>' +
      '        <p>To access certain features, you may be required to create an account.</p>' +
      '        <p>You agree to:</p>' +
      '        <ul>' +
      '          <li>Provide accurate and complete information.</li>' +
      '          <li>Maintain the confidentiality of your account credentials.</li>' +
      '          <li>Be responsible for all activity under your account.</li>' +
      '        </ul>' +
      '        <p>We reserve the right to suspend or terminate accounts at our discretion.</p>' +
      '        <h5>5. Credits System</h5>' +
      '        <h5>5.1 Usage-Based Credits</h5>' +
      '        <p>Credits are required to create and expand content. Credits are consumed based on:</p>' +
      '        <ul>' +
      '          <li>Number of photos uploaded.</li>' +
      '          <li>Length of messages.</li>' +
      '          <li>Page creation and customization.</li>' +
      '        </ul>' +
      '        <h5>5.2 Free Credits</h5>' +
      '        <p>Users may receive free credits through promotional activities, including social media engagement tasks.</p>' +
      '        <p>We reserve the right to modify, limit, or revoke free credit offers at any time.</p>' +
      '        <h5>5.3 Paid Credits</h5>' +
      '        <ul>' +
      '          <li>Credits may be purchased using real currency.</li>' +
      '          <li>Prices are subject to change without notice.</li>' +
      '          <li>All purchases are final and non-refundable except where required by law.</li>' +
      '        </ul>' +
      '        <h5>5.4 Credit Restrictions</h5>' +
      '        <ul>' +
      '          <li>Credits have no monetary value.</li>' +
      '          <li>Credits are non-transferable and cannot be exchanged or resold.</li>' +
      '          <li>Abuse of the credit system may result in account suspension or termination.</li>' +
      '        </ul>' +
      '        <h5>6. Refunds and Disputes</h5>' +
      '        <ul>' +
      '          <li>All purchases are final and non-refundable unless required by law.</li>' +
      '          <li>If you believe a transaction was unauthorized or made in error, you must contact us within seven (7) days.</li>' +
      '          <li>We reserve the right to investigate and determine eligibility for any exception.</li>' +
      '          <li>Initiating chargebacks or disputes may result in account suspension or termination.</li>' +
      '        </ul>' +
      '        <h5>7. User Content</h5>' +
      '        <h5>7.1 Ownership</h5>' +
      '        <p>You retain ownership of the content you create.</p>' +
      '        <h5>7.2 License to Letter4U</h5>' +
      '        <p>By using the Service, you grant Letter4U a worldwide, non-exclusive, royalty-free license to host, store, reproduce, and display your content for the purpose of operating and improving the Service.</p>' +
      '        <h5>7.3 Content Restrictions</h5>' +
      '        <p>You agree not to upload or share content that:</p>' +
      '        <ul>' +
      '          <li>Violates any law or regulation.</li>' +
      '          <li>Infringes intellectual property rights.</li>' +
      '          <li>Contains harassment, hate speech, or threats.</li>' +
      '          <li>Contains explicit, harmful, or inappropriate material.</li>' +
      '        </ul>' +
      '        <p>We reserve the right to remove content without notice.</p>' +
      '        <h5>8. Public Nature of Shared Pages</h5>' +
      '        <p>You acknowledge and agree that:</p>' +
      '        <ul>' +
      '          <li>Any page created on Letter4U is accessible to anyone who has the shareable link.</li>' +
      '          <li>The platform does not guarantee privacy or confidentiality of shared content.</li>' +
      '          <li>Any PIN or similar feature is provided for aesthetic or presentation purposes only and does not provide real security.</li>' +
      '          <li>You are solely responsible for how your links are shared.</li>' +
      '        </ul>' +
      '        <p>You must not upload confidential, sensitive, or personal information.</p>' +
      '        <h5>9. Security Disclaimer</h5>' +
      '        <p>While we implement reasonable safeguards, we do not guarantee:</p>' +
      '        <ul>' +
      '          <li>Absolute security of your content.</li>' +
      '          <li>Protection against unauthorized access if links are shared.</li>' +
      '        </ul>' +
      '        <p>Use of the Service is at your own risk.</p>' +
      '        <h5>10. Prohibited Activities</h5>' +
      '        <p>You agree not to:</p>' +
      '        <ul>' +
      '          <li>Use the Service for illegal or fraudulent purposes.</li>' +
      '          <li>Exploit or abuse the credit system.</li>' +
      '          <li>Use bots, automation, or scraping tools.</li>' +
      '          <li>Attempt to hack, disrupt, or overload the platform.</li>' +
      '          <li>Reverse engineer or copy the Service.</li>' +
      '          <li>Impersonate others or provide false information.</li>' +
      '        </ul>' +
      '        <h5>11. Intellectual Property</h5>' +
      '        <p>All platform features, including design, branding, and code, are owned by Letter4U and protected by intellectual property laws.</p>' +
      '        <p>You may not copy, reproduce, or distribute any part of the Service without permission.</p>' +
      '        <h5>12. DMCA / Copyright Policy</h5>' +
      '        <h5>12.1 Copyright Compliance</h5>' +
      '        <p>You may only upload content that you own or have permission to use.</p>' +
      '        <h5>12.2 Takedown Requests</h5>' +
      '        <p>To report copyright infringement, provide:</p>' +
      '        <ul>' +
      '          <li>Your name and contact information.</li>' +
      '          <li>Description of the copyrighted work.</li>' +
      '          <li>The URL of the infringing content.</li>' +
      '          <li>A statement of good faith belief.</li>' +
      '          <li>A statement of accuracy and authorization.</li>' +
      '        </ul>' +
      '        <p>Send requests to: kenjibuena.business@gmail.com</p>' +
      '        <h5>12.3 Enforcement</h5>' +
      '        <p>We may remove content, notify users, and terminate repeat infringers.</p>' +
      '        <h5>12.4 Counter-Notice</h5>' +
      '        <p>Users may submit counter-notifications. We may restore content unless legal action is pursued.</p>' +
      '        <h5>13. Termination</h5>' +
      '        <p>We may suspend or terminate your access if:</p>' +
      '        <ul>' +
      '          <li>You violate these Terms.</li>' +
      '          <li>You engage in harmful or abusive behavior.</li>' +
      '          <li>Required by legal or security reasons.</li>' +
      '        </ul>' +
      '        <h5>14. Disclaimer of Warranties</h5>' +
      '        <p>The Service is provided "as is" and "as available."</p>' +
      '        <p>We do not guarantee uninterrupted service, error-free operation, or data preservation.</p>' +
      '        <h5>15. Limitation of Liability</h5>' +
      '        <p>To the fullest extent permitted by law, Letter4U shall not be liable for:</p>' +
      '        <ul>' +
      '          <li>Loss of data, content, or credits.</li>' +
      '          <li>Unauthorized access.</li>' +
      '          <li>Indirect or consequential damages.</li>' +
      '        </ul>' +
      '        <h5>16. Changes to Terms</h5>' +
      '        <p>We may update these Terms at any time. Continued use of the Service constitutes acceptance of the updated Terms.</p>' +
      '        <h5>17. Governing Law</h5>' +
      '        <p>These Terms are governed by the laws applicable in your jurisdiction.</p>' +
      '        <h5>18. Contact</h5>' +
      '        <p>Email: kenjibuena.business@gmail.com</p>' +
      '        <h4>Privacy Policy</h4>' +
      '        <h5>1. Information We Collect</h5>' +
      '        <p>We may collect:</p>' +
      '        <ul>' +
      '          <li>Account information (email, username).</li>' +
      '          <li>User-generated content (text, images, pages).</li>' +
      '          <li>Usage data (credits usage, interactions).</li>' +
      '          <li>Device and technical data (IP address, browser type).</li>' +
      '        </ul>' +
      '        <h5>2. How We Use Information</h5>' +
      '        <p>We use data to:</p>' +
      '        <ul>' +
      '          <li>Provide and maintain the Service.</li>' +
      '          <li>Manage accounts and credits.</li>' +
      '          <li>Improve functionality and performance.</li>' +
      '          <li>Detect and prevent abuse.</li>' +
      '        </ul>' +
      '        <h5>3. Content Visibility</h5>' +
      '        <p>Content shared via links may be publicly accessible. We do not guarantee privacy of shared content.</p>' +
      '        <h5>4. Data Sharing</h5>' +
      '        <p>We do not sell personal data. We may share data with:</p>' +
      '        <ul>' +
      '          <li>Service providers (hosting, analytics).</li>' +
      '          <li>Legal authorities when required.</li>' +
      '        </ul>' +
      '        <h5>5. Data Retention</h5>' +
      '        <p>We retain data as necessary to provide the Service and comply with legal obligations.</p>' +
      '        <h5>6. Security</h5>' +
      '        <p>We implement reasonable safeguards but cannot guarantee complete security.</p>' +
      '        <h5>7. Your Rights</h5>' +
      '        <h5>7.1 Philippines (Data Privacy Act of 2012)</h5>' +
      '        <p>You have the right to:</p>' +
      '        <ul>' +
      '          <li>Be informed.</li>' +
      '          <li>Access your data.</li>' +
      '          <li>Correct inaccurate data.</li>' +
      '          <li>Request deletion when applicable.</li>' +
      '        </ul>' +
      '        <h5>7.2 European Economic Area (GDPR)</h5>' +
      '        <p>You have the right to:</p>' +
      '        <ul>' +
      '          <li>Access your data.</li>' +
      '          <li>Correct inaccurate data.</li>' +
      '          <li>Request deletion.</li>' +
      '          <li>Restrict processing.</li>' +
      '          <li>Data portability.</li>' +
      '          <li>Object to processing.</li>' +
      '        </ul>' +
      '        <h5>7.3 Legal Basis for Processing</h5>' +
      '        <p>We process data based on:</p>' +
      '        <ul>' +
      '          <li>Consent.</li>' +
      '          <li>Contractual necessity.</li>' +
      '          <li>Legitimate interests.</li>' +
      '        </ul>' +
      '        <h5>7.4 Data Transfers</h5>' +
      '        <p>Your data may be processed outside your country. By using the Service, you consent to such transfers.</p>' +
      '        <h5>8. Children\'s Privacy</h5>' +
      '        <p>The Service is not intended for children under 13.</p>' +
      '        <h5>9. Changes to Privacy Policy</h5>' +
      '        <p>We may update this policy at any time.</p>' +
      '        <h5>10. Contact</h5>' +
      '        <p>For privacy-related concerns: kenjibuena.business@gmail.com</p>' +
      '        <p><strong>By using Letter4U, you acknowledge that you have read and agreed to these Terms of Service and Privacy Policy.</strong></p>' +
      '      </div>' +
      '    </section>' +
      '    <label class="l4u-signin-terms-consent mt-4 flex items-start gap-3 rounded-2xl bg-lfu-surface-low p-4 text-sm text-lfu-outline">' +
      '      <input id="signinTermsAgreement" type="checkbox" class="mt-0.5 rounded border-lfu-outline/30 text-lfu-primary" disabled />' +
      '      <span>I have read the Terms of Service and Privacy Policy and I agree to continue.</span>' +
      '    </label>' +
      '    <p id="signinConsentStatus" class="mt-3 text-center text-xs text-lfu-outline">Scroll to the bottom of the Terms and Privacy Policy to enable agreement.</p>' +
      '    <div class="mt-5 flex flex-col items-center gap-3">' +
      '      <button type="button" id="completeSigninButton" class="l4u-google-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]" disabled>' +
      '        <svg class="l4u-google-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '          <path fill="#EA4335" d="M12 11.98v2.95h4.11c-.18.95-.73 1.75-1.55 2.29v1.9h2.51c1.47-1.35 2.33-3.34 2.33-5.69 0-.54-.05-1.06-.14-1.56H12z"></path>' +
      '          <path fill="#34A853" d="M12 20c2.1 0 3.86-.69 5.15-1.88l-2.51-1.9c-.69.46-1.58.74-2.64.74-2.03 0-3.75-1.37-4.36-3.22H5.05v2.01A7.99 7.99 0 0 0 12 20z"></path>' +
      '          <path fill="#FBBC05" d="M7.64 13.74A4.8 4.8 0 0 1 7.4 12c0-.61.1-1.2.24-1.74V8.25H5.05A7.99 7.99 0 0 0 4 12c0 1.29.31 2.51.85 3.6l2.79-1.86z"></path>' +
      '          <path fill="#4285F4" d="M12 7.04c1.14 0 2.16.39 2.97 1.16l2.23-2.23A8.2 8.2 0 0 0 12 4a7.99 7.99 0 0 0-6.95 4.25l2.59 2.01c.61-1.85 2.33-3.22 4.36-3.22z"></path>' +
      '        </svg>' +
      '        Continue with Google' +
      '      </button>' +
      '      <button type="button" data-close-modal class="l4u-outline-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">Cancel</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="l4u-modal" data-modal="tiktok-browser-warning" hidden>' +
      '  <div class="l4u-modal-backdrop" data-close-modal></div>' +
      '  <div class="l4u-modal-card l4u-modal-card-tiktok" role="dialog" aria-modal="true" aria-labelledby="tiktokWarningTitle" aria-describedby="tiktokWarningDescription">' +
      '    <p class="l4u-kicker">TikTok In-App Browser</p>' +
      '    <h2 id="tiktokWarningTitle" class="mt-2 font-headline text-2xl font-bold text-lfu-ink">Google login is blocked here</h2>' +
      '    <p id="tiktokWarningDescription" class="mt-3 text-sm text-lfu-outline">TikTok\'s built-in browser can block Google sign-in popups. Open this page in Chrome, Safari, or another external browser to continue.</p>' +
      '    <ol class="l4u-tiktok-warning-steps mt-4" aria-label="How to open this page in your browser">' +
      '      <li>Tap the three dots (⋮) in TikTok.</li>' +
      '      <li>Tap "Open in browser".</li>' +
      '      <li>If you do not see it, copy this link and paste it into Chrome or Safari.</li>' +
      '    </ol>' +
      '    <div class="mt-5 rounded-2xl bg-lfu-surface-low p-3 text-left">' +
      '      <p class="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-lfu-outline">Website Link</p>' +
      '      <p id="tiktokBrowserLinkValue" class="mt-2 break-all text-xs font-medium text-lfu-primary"></p>' +
      '    </div>' +
      '    <p id="tiktokBrowserCopyFeedback" class="mt-3 text-xs font-semibold text-lfu-primary" aria-live="polite"></p>' +
      '    <div class="mt-5 flex flex-col items-center gap-3">' +
      '      <button type="button" id="tiktokBrowserOpenExternalButton" class="l4u-gradient-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">Try Open in Browser</button>' +
      '      <button type="button" id="tiktokBrowserCopyLinkButton" class="l4u-outline-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">Copy Link</button>' +
      '      <button type="button" data-close-modal class="l4u-outline-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">I Will Open It There</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="l4u-modal" data-modal="low-credits" hidden>' +
      '  <div class="l4u-modal-backdrop" data-close-modal></div>' +
      '  <div class="l4u-modal-card l4u-modal-card-credits">' +
      '    <span class="l4u-modal-icon">!</span>' +
      '    <h2 class="mt-5 text-center font-headline text-5xl font-extrabold tracking-tight text-lfu-ink">Out of Credits?</h2>' +
      '    <p id="lowCreditsMessage" class="mt-4 text-center text-base leading-relaxed text-lfu-outline">Your inkwell is running dry. Earn a free credit through social tasks or refill instantly to continue your correspondence.</p>' +
      '    <div class="mt-8 grid gap-3">' +
      '      <button type="button" id="lowCreditsTasksButton" class="l4u-task-button rounded-full px-5 py-3 text-sm font-bold">Complete Social Tasks</button>' +
      '      <a id="lowCreditsShopLink" href="' + routeTo("shop.html") + '" class="l4u-gradient-button rounded-full px-5 py-3 text-center text-sm font-bold">Visit Credit Shop</a>' +
      '    </div>' +
      '    <button type="button" data-close-modal class="mt-8 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-lfu-outline">Close</button>' +
      '  </div>' +
      '</div>' +
      '<div class="l4u-modal" data-modal="social-support" hidden>' +
      '  <div class="l4u-modal-backdrop" data-close-modal></div>' +
      '  <div class="l4u-modal-card l4u-modal-card-support">' +
      '    <p class="l4u-kicker">Social Support Verification</p>' +
      '    <h2 class="l4u-support-modal-title mt-2 font-headline text-2xl font-extrabold tracking-tight text-lfu-ink sm:text-3xl">Support to Gain 1 Credit</h2>' +
      '    <div class="l4u-support-modal-scroll">' +
        '      <p class="l4u-support-intro mt-3 text-sm text-lfu-outline">Support both TikTok and Instagram by following, liking, and leaving a positive comment to unlock page creation for free! It only takes a few seconds &#128591;</p>' +
      '      <p class="l4u-support-intro mt-3 text-sm text-lfu-outline"><strong>Why this gate exists:</strong> Letter4U is free to use. Your support helps cover hosting and keep this project online.</p>' +
        '      <p class="l4u-support-caption mt-3 text-[0.66rem] font-bold uppercase tracking-[0.12em] text-lfu-primary">Complete these 6 steps in order</p>' +

      '      <div class="l4u-support-progress mt-4">' +
      '        <div class="l4u-support-progress-track"><div id="socialSupportProgressBar" class="l4u-support-progress-bar"></div></div>' +
        '        <p class="mt-2 text-sm font-semibold text-lfu-primary">Progress <span id="socialSupportProgressText">0 / 6</span></p>' +
      '      </div>' +

      '      <div class="l4u-support-steps mt-4">' +
      '        <article id="socialStepCard0" class="l4u-support-step">' +
      '          <div>' +
      '            <p id="socialStepTitle0" class="l4u-support-step-title">Step 1: Follow on TikTok</p>' +
      '            <p id="socialStepState0" class="l4u-support-step-state">Ready</p>' +
      '          </div>' +
      '          <button type="button" data-support-step-index="0" class="l4u-support-step-button">Start Step 1</button>' +
      '        </article>' +

      '        <article id="socialStepCard1" class="l4u-support-step">' +
      '          <div>' +
      '            <p class="l4u-support-step-title">Step 2: Like the TikTok video</p>' +
      '            <p id="socialStepState1" class="l4u-support-step-state">Locked</p>' +
      '          </div>' +
      '          <button type="button" data-support-step-index="1" class="l4u-support-step-button" disabled>Step 2 Locked</button>' +
      '        </article>' +

      '        <div class="l4u-support-comment">' +
        '          <p class="l4u-support-comment-title">Suggested comment for comment steps</p>' +
      '          <div class="l4u-support-comment-row">' +
      '            <p id="socialSuggestedComment" class="l4u-support-comment-text">This is perfect for those quiet people who love deeply but don\'t always know how to express it out loud.</p>' +
      '            <button type="button" id="socialCommentCopyButton" class="l4u-support-copy-button">Copy</button>' +
      '          </div>' +
      '        </div>' +

      '        <article id="socialStepCard2" class="l4u-support-step">' +
      '          <div>' +
      '            <p class="l4u-support-step-title">Step 3: Comment on TikTok video</p>' +
      '            <p id="socialStepState2" class="l4u-support-step-state">Locked</p>' +
      '          </div>' +
      '          <button type="button" data-support-step-index="2" class="l4u-support-step-button" disabled>Step 3 Locked</button>' +
      '        </article>' +

        '        <article id="socialStepCard3" class="l4u-support-step">' +
        '          <div>' +
        '            <p id="socialStepTitle3" class="l4u-support-step-title">Step 4: Follow on Instagram</p>' +
        '            <p id="socialStepState3" class="l4u-support-step-state">Locked</p>' +
        '          </div>' +
        '          <button type="button" data-support-step-index="3" class="l4u-support-step-button" disabled>Step 4 Locked</button>' +
        '        </article>' +

        '        <article id="socialStepCard4" class="l4u-support-step">' +
        '          <div>' +
        '            <p class="l4u-support-step-title">Step 5: Like the Instagram post</p>' +
        '            <p id="socialStepState4" class="l4u-support-step-state">Locked</p>' +
        '          </div>' +
        '          <button type="button" data-support-step-index="4" class="l4u-support-step-button" disabled>Step 5 Locked</button>' +
        '        </article>' +

        '        <article id="socialStepCard5" class="l4u-support-step">' +
        '          <div>' +
        '            <p class="l4u-support-step-title">Step 6: Comment on Instagram post</p>' +
        '            <p id="socialStepState5" class="l4u-support-step-state">Locked</p>' +
        '          </div>' +
        '          <button type="button" data-support-step-index="5" class="l4u-support-step-button" disabled>Step 6 Locked</button>' +
        '        </article>' +
      '      </div>' +
      '    </div>' +

      '    <div class="l4u-support-modal-footer mt-4">' +
      '      <p class="l4u-support-hint text-xs text-lfu-outline">Start with Step 1. Return to this tab after each action.</p>' +
      '      <div class="l4u-support-footer-actions mt-4 flex flex-wrap items-center gap-3">' +
      '        <button type="button" id="socialVerifyButton" class="l4u-gradient-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]" disabled>Verify Support</button>' +
      '        <button type="button" data-close-modal class="l4u-outline-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">Close</button>' +
      '      </div>' +
      '      <p id="socialSupportStatus" class="l4u-support-status mt-3 text-xs text-lfu-outline">Verify unlocks automatically after all 6 steps are completed.</p>' +
      '    </div>' +
      '    <div id="socialStepFeedbackModal" class="l4u-support-feedback-modal" hidden>' +
      '      <div class="l4u-support-feedback-backdrop" data-social-feedback-close></div>' +
      '      <div class="l4u-support-feedback-card" role="dialog" aria-modal="true" aria-labelledby="socialFeedbackTitle" aria-describedby="socialFeedbackMessage">' +
      '        <p id="socialFeedbackKicker" class="l4u-kicker text-center">Support Status</p>' +
      '        <h3 id="socialFeedbackTitle" class="mt-2 text-center font-headline text-xl font-bold text-lfu-ink">Update</h3>' +
      '        <p id="socialFeedbackMessage" class="mt-3 text-center text-sm text-lfu-outline">Step status updated.</p>' +
      '        <button type="button" id="socialFeedbackOkButton" class="mt-5 l4u-gradient-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">Okay</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="l4u-modal" data-modal="manual-payment" hidden>' +
      '  <div class="l4u-modal-backdrop" data-close-modal></div>' +
      '  <div class="l4u-modal-card">' +
      '    <p class="l4u-kicker">Manual Checkout</p>' +
      '    <h2 class="mt-2 font-headline text-2xl font-bold text-lfu-ink">Complete payment transfer</h2>' +
      '    <p id="manualPackSummary" class="mt-3 rounded-2xl bg-lfu-surface-low px-4 py-3 text-sm text-lfu-muted">Select a credit pack from Shop first.</p>' +
      '    <p class="l4u-manual-instruction mt-4">Follow these steps to buy credits:</p>' +
      '    <ol class="l4u-manual-steps mt-3">' +
      '      <li><span class="l4u-manual-step-index">1</span><span>Select a pack and copy your UID below.</span></li>' +
      '      <li><span class="l4u-manual-step-index">2</span><span>Message one contact channel with your UID and selected pack.</span></li>' +
      '      <li><span class="l4u-manual-step-index">3</span><span>Wait for manual confirmation, then your credits will be added.</span></li>' +
      '    </ol>' +
      '    <div class="l4u-manual-contacts mt-3">' +
      '      <a class="l4u-manual-contact-link" href="https://m.me/devk08" target="_blank" rel="noopener noreferrer" aria-label="Messenger - Kenji Buena">' +
      '        <span class="l4u-manual-contact-logo" aria-hidden="true">' +
      '          <img class="l4u-manual-brand-icon" src="https://img.icons8.com/fluency/96/facebook-messenger.png" alt="" loading="lazy" decoding="async">' +
      '        </span>' +
      '        <span class="l4u-manual-contact-name">Kenji Buena</span>' +
      '      </a>' +
      '      <a class="l4u-manual-contact-link" href="https://www.tiktok.com/@kiiinji" target="_blank" rel="noopener noreferrer" aria-label="TikTok - Kiiinji">' +
      '        <span class="l4u-manual-contact-logo" aria-hidden="true">' +
      '          <img class="l4u-manual-brand-icon" src="https://img.icons8.com/color/96/tiktok--v1.png" alt="" loading="lazy" decoding="async">' +
      '        </span>' +
      '        <span class="l4u-manual-contact-name">Kiiinji</span>' +
      '      </a>' +
      '      <a class="l4u-manual-contact-link" href="https://www.instagram.com/_kiiinji/" target="_blank" rel="noopener noreferrer" aria-label="Instagram - _kiiinji">' +
      '        <span class="l4u-manual-contact-logo" aria-hidden="true">' +
      '          <img class="l4u-manual-brand-icon" src="https://img.icons8.com/fluency/96/instagram-new.png" alt="" loading="lazy" decoding="async">' +
      '        </span>' +
      '        <span class="l4u-manual-contact-name">_kiiinji</span>' +
      '      </a>' +
      '      <a class="l4u-manual-contact-link" href="mailto:kenjibuena.business@gmail.com" aria-label="Email - Kenji Buena">' +
      '        <span class="l4u-manual-contact-logo" aria-hidden="true">' +
      '          <img class="l4u-manual-brand-icon" src="https://img.icons8.com/fluency/96/gmail-new.png" alt="" loading="lazy" decoding="async">' +
      '        </span>' +
      '        <span class="l4u-manual-contact-name">Kenji Buena</span>' +
      '      </a>' +
      '    </div>' +
      '    <div class="l4u-manual-uid-box mt-4">' +
      '      <p class="l4u-settings-mini-label">Your UID</p>' +
      '      <div class="l4u-manual-uid-row">' +
      '        <p id="manualCheckoutUid" class="l4u-manual-uid-value">Not signed in</p>' +
      '        <button type="button" id="manualCopyUidButton" class="l4u-manual-copy-button">Copy</button>' +
      '      </div>' +
      '    </div>' +
      '    <p id="manualPaymentStatus" class="l4u-manual-status mt-3 text-xs text-lfu-outline"></p>' +
      '    <div class="mt-6 flex justify-end">' +
      '      <button type="button" data-close-modal class="l4u-outline-button rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">Close</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="l4u-modal" data-modal="success" hidden>' +
      '  <div class="l4u-modal-backdrop" data-close-modal></div>' +
      '  <div class="l4u-modal-card l4u-modal-card-success text-center">' +
      '    <p class="l4u-kicker">Success</p>' +
      '    <h2 class="mt-2 font-headline text-2xl font-bold text-lfu-ink">Action completed</h2>' +
      '    <p id="successMessage" class="mt-3 text-sm text-lfu-outline">Everything worked as expected.</p>' +
      '    <button type="button" data-close-modal class="mt-6 block l4u-gradient-button mx-auto rounded-full px-5 py-3 text-xs font-bold uppercase tracking-[0.1em]">Continue</button>' +
      '  </div>' +
      '</div>' +
      '<div class="l4u-modal" data-modal="publish-success" hidden>' +
      '  <div class="l4u-modal-backdrop" data-close-modal></div>' +
      '  <div class="l4u-modal-card l4u-modal-card-published">' +
      '    <h2 id="publishSuccessTitle" class="mt-5 text-center font-headline text-5xl font-extrabold tracking-tight text-lfu-primary">Your heart\'s letter is now live.</h2>' +
      '    <p id="publishSuccessSubtitle" class="mt-4 text-center text-base leading-relaxed text-lfu-outline">The words you\'ve penned are now a digital keepsake, ready to be shared with those who matter most.</p>' +
      '    <div id="publishSuccessLayout" class="mt-8 grid gap-5 md:grid-cols-[160px,1fr]">' +
      '      <div>' +
      '        <img id="publishQrImage" src="" alt="QR code for published letter" class="h-40 w-full rounded-3xl bg-white p-2 object-contain" />' +
      '        <button type="button" id="downloadQrCodeButton" class="l4u-task-button mt-3 w-full rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.1em]">Download QR Code</button>' +
      '      </div>' +
      '      <div class="space-y-3">' +
      '        <p class="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-lfu-outline">Shareable Link</p>' +
      '        <div id="publishShareRow" class="flex items-center gap-2 rounded-2xl bg-lfu-surface-low p-3">' +
      '          <p id="publishShareLink" class="min-w-0 flex-1 truncate text-sm font-medium text-lfu-primary">letter4u.com/h/heart-v1</p>' +
      '          <button type="button" id="copyShareLinkButton" class="rounded-full bg-white px-3 py-2 text-xs font-semibold text-lfu-primary">Copy Link</button>' +
      '        </div>' +
      '        <div class="l4u-publish-quick-share">' +
      '          <p class="l4u-publish-quick-share-title">Quick Share</p>' +
      '          <div id="publishQuickShareGrid" class="l4u-publish-quick-share-grid">' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="messenger" aria-label="Share to Messenger">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M12 2C6.48 2 2 6.03 2 11c0 2.84 1.46 5.37 3.75 7.02V22l3.57-1.96c.84.23 1.74.36 2.68.36 5.52 0 10-4.03 10-9S17.52 2 12 2zm1.08 11.6-2.55-2.73-4.73 2.73 5.2-5.52 2.48 2.73 4.73-2.73-5.13 5.52z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">Messenger</span>' +
      '            </button>' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="facebook" aria-label="Share to Facebook">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M13.5 22v-8h2.7l.4-3h-3.1V9.1c0-.9.3-1.5 1.6-1.5h1.7V4.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.2V11H8v3h2.6v8h2.9z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">Facebook</span>' +
      '            </button>' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="email" aria-label="Share by email">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.2L4.7 7h14.6L12 12.2zm-8-3.8v8.6h16V8.4l-8 5.1-8-5.1z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">Email</span>' +
      '            </button>' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="tiktok" aria-label="Share to TikTok">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M14 3v8.2a3.2 3.2 0 1 1-2-2.97V3h5.3A4.7 4.7 0 0 0 21 6.7v2.1A6.8 6.8 0 0 1 16 6.9V14a5 5 0 1 1-4.9-5V3H14z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">TikTok</span>' +
      '            </button>' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="message" aria-label="Share by message">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h.8l.2.2v1.6L7.2 15H20V6H4z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">Message</span>' +
      '            </button>' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="whatsapp" aria-label="Share to WhatsApp">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M20.5 3.5A11 11 0 0 0 3.6 17.1L2 22l5-1.5A11 11 0 1 0 20.5 3.5zm-8.9 17a9 9 0 0 1-4.6-1.2l-.3-.2-2.9.9.9-2.8-.2-.3A9 9 0 1 1 11.6 20.5zm5-6.8c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.1-.2.1-.4.2-.7 0-.3-.2-1.3-.5-2.4-1.6-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7l.5-.6c.1-.1.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4 0-.1-.2-.2-.5-.4z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">WhatsApp</span>' +
      '            </button>' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="telegram" aria-label="Share to Telegram">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M21.6 4.3a1.3 1.3 0 0 0-1.4-.2L3.3 10.9a1.1 1.1 0 0 0 .1 2l4.2 1.4 1.6 5a1.1 1.1 0 0 0 1.9.4l2.4-2.5 4.2 3.1a1.3 1.3 0 0 0 2.1-.8l2.2-14a1.3 1.3 0 0 0-.4-1.2zM9.4 14.2l8.9-7.1-6.7 8.5-.6 2.4-.8-3.8-.8-.3z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">Telegram</span>' +
      '            </button>' +
      '            <button type="button" class="l4u-quick-share-btn" data-quick-share="more" aria-label="More share options">' +
      '              <span class="l4u-quick-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M18 16.1c-.8 0-1.5.3-2 .8L8.9 12.7c.1-.2.1-.5.1-.7s0-.5-.1-.7L16 7.1c.5.5 1.2.8 2 .8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .2 0 .5.1.7L8.1 9.8c-.5-.5-1.2-.8-2-.8-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 2-.8l7.1 4.2c-.1.2-.1.4-.1.6 0 1.7 1.3 3 3 3s3-1.3 3-3-1.3-2.9-3-2.9z"/></svg></span>' +
      '              <span class="l4u-quick-share-label">More</span>' +
      '            </button>' +
      '          </div>' +
      '        </div>' +
      '        <a id="viewPublishedPageLink" href="#" class="l4u-success-action">View Page <span>&rarr;</span></a>' +
      '        <a id="openDashboardFromSuccess" href="' + routeTo("my-pages.html") + '" class="l4u-success-action">Go to Dashboard <span>&rarr;</span></a>' +
      '      </div>' +
      '    </div>' +
      '    <div id="publishSuccessFooter" class="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-lfu-outline/18 pt-5">' +
      '      <button type="button" data-close-modal class="text-sm font-semibold text-lfu-outline">&larr; Back to Editor</button>' +
      '      <a id="createNewLetterFromSuccess" href="' + routeTo("create.html") + '" class="l4u-gradient-button rounded-full px-6 py-3 text-sm font-bold">Create New Letter</a>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="l4u-modal" data-modal="saving" hidden>' +
      '  <div class="l4u-modal-backdrop"></div>' +
      '  <div class="l4u-modal-card l4u-modal-card-uploading">' +
      '    <span class="l4u-modal-icon">&#8593;</span>' +
      '    <h2 class="mt-5 text-center font-headline text-4xl font-extrabold tracking-tight text-lfu-ink">Uploading your page...</h2>' +
      '    <p id="saveProgressLabel" class="mt-3 text-center text-sm text-lfu-outline">Preparing your manuscript...</p>' +
      '    <div class="l4u-progress-track mt-5"><div id="saveProgressBar" class="l4u-progress-bar"></div></div>' +
      '    <p id="saveProgressPercent" class="mt-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-lfu-outline">0%</p>' +
      '  </div>' +
      '</div>';
  }

  function openModal(modalName) {
    var modal = document.querySelector('.l4u-modal[data-modal="' + modalName + '"]');
    if (!modal) {
      return;
    }

    if (modalName === "signin" && isTikTokInAppBrowser()) {
      openModal("tiktok-browser-warning");
      return;
    }

    if (modalName === "signin") {
      var termsInput = document.getElementById("signinTermsAgreement");
      var termsScroll = document.getElementById("signinTermsScroll");
      var consentMessage = document.getElementById("signinConsentStatus");
      var signInButton = document.getElementById("completeSigninButton");

      if (termsInput) {
        termsInput.checked = false;
        termsInput.disabled = true;
      }

      if (termsScroll) {
        termsScroll.scrollTop = 0;
      }

      if (consentMessage) {
        consentMessage.textContent = "Scroll to the bottom of the Terms and Privacy Policy to enable agreement.";
      }

      if (signInButton) {
        signInButton.disabled = true;
      }
    }

    if (modalName === "tiktok-browser-warning") {
      var warningLinkNode = document.getElementById("tiktokBrowserLinkValue");
      var warningCopyFeedbackNode = document.getElementById("tiktokBrowserCopyFeedback");
      var warningOpenButtonNode = document.getElementById("tiktokBrowserOpenExternalButton");
      var currentUrl = String(window.location.href || "");

      if (warningLinkNode) {
        warningLinkNode.textContent = currentUrl;
      }

      if (warningCopyFeedbackNode) {
        warningCopyFeedbackNode.textContent = "";
      }

      if (warningOpenButtonNode) {
        warningOpenButtonNode.setAttribute("data-target-url", currentUrl);
      }
    }

    if (modalName === "social-support") {
      refreshSuggestedSocialComment();
      if (typeof closeSocialStepFeedback === "function") {
        closeSocialStepFeedback();
      }
    }

    if (!modalFocusRestoreElement && document.activeElement && typeof document.activeElement.focus === "function") {
      modalFocusRestoreElement = document.activeElement;
    }

    if (!modal.hasAttribute("tabindex")) {
      modal.setAttribute("tabindex", "-1");
    }

    modal.hidden = false;
    window.requestAnimationFrame(function () {
      modal.classList.add("is-open");

      var focusableNodes = getFocusableModalElements(modal);
      var focusTarget = focusableNodes.length ? focusableNodes[0] : modal;

      if (focusTarget && typeof focusTarget.focus === "function") {
        focusTarget.focus({ preventScroll: true });
      }
    });

    document.body.classList.add("l4u-lock-scroll");
  }

  function closeModal(modalName) {
    var modal = document.querySelector('.l4u-modal[data-modal="' + modalName + '"]');
    if (!modal) {
      return;
    }

    if (modalName === "social-support") {
      if (typeof closeSocialStepFeedback === "function") {
        closeSocialStepFeedback();
      }
    }

    modal.classList.remove("is-open");

    window.setTimeout(function () {
      modal.hidden = true;

      var openModals = document.querySelectorAll(".l4u-modal.is-open");
      if (!openModals.length) {
        document.body.classList.remove("l4u-lock-scroll");

        if (modalFocusRestoreElement && document.contains(modalFocusRestoreElement) && typeof modalFocusRestoreElement.focus === "function") {
          modalFocusRestoreElement.focus({ preventScroll: true });
        }

        modalFocusRestoreElement = null;
      }
    }, 180);
  }

  function closeTopModal() {
    var openModalNode = document.querySelector(".l4u-modal.is-open");
    if (!openModalNode) {
      return;
    }

    var modalName = openModalNode.getAttribute("data-modal");
    if (modalName === "saving") {
      return;
    }

    closeModal(modalName);
  }

  function getFocusableModalElements(modalNode) {
    if (!modalNode) {
      return [];
    }

    var selector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");

    return Array.prototype.slice.call(modalNode.querySelectorAll(selector)).filter(function (element) {
      return !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true";
    });
  }

  function ensureToastHost() {
    var host = document.getElementById("l4uToastHost");
    if (host) {
      return host;
    }

    host = document.createElement("div");
    host.id = "l4uToastHost";
    host.className = "l4u-toast-host";
    document.body.appendChild(host);
    return host;
  }

  function showToast(message) {
    var host = ensureToastHost();
    var toast = document.createElement("div");

    toast.className = "l4u-toast";
    toast.textContent = message;
    host.appendChild(toast);

    window.setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3200);
  }

  function syncAuthVisibility() {
    document.querySelectorAll("[data-auth-visible]").forEach(function (node) {
      var visibilityRule = node.getAttribute("data-auth-visible") || "always";
      var shouldShow = visibilityRule === "always" ||
        (visibilityRule === "signed-in" && state.signedIn) ||
        (visibilityRule === "signed-out" && !state.signedIn);

      node.classList.toggle("hidden", !shouldShow);
      node.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    });
  }

  function syncAdminVisibility() {
    document.querySelectorAll("[data-admin-visible]").forEach(function (node) {
      var shouldShow = state.signedIn && state.isAdmin;
      node.classList.toggle("hidden", !shouldShow);
      node.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    });
  }

  function syncNavIndicatorPositions() {
    document.querySelectorAll("[data-nav-group]").forEach(function (groupNode) {
      var indicator = groupNode.querySelector("[data-nav-indicator]");
      if (!indicator) {
        return;
      }

      var target = groupNode.querySelector(".l4u-nav-link.active");
      if (!target || target.classList.contains("hidden")) {
        indicator.style.opacity = "0";
        return;
      }

      var offsetLeft = Math.max(0, target.offsetLeft);

      indicator.style.width = target.offsetWidth + "px";
      indicator.style.transform = "translateX(" + offsetLeft + "px)";
      indicator.style.opacity = "1";
    });
  }

  function refreshBindings() {
    applyThemeMode();
    syncAuthVisibility();
    syncAdminVisibility();
    syncNavIndicatorPositions();

    var displayName = state.signedIn ? state.userName : "Guest";
    var initial = displayName.charAt(0).toUpperCase();
    var publicUsers = Math.max(0, toInt(state.publicStats.users, 0));
    var publicPages = Math.max(0, toInt(state.publicStats.pages, 0));

    document.querySelectorAll("[data-credits]").forEach(function (node) {
      node.textContent = String(state.credits);
    });

    document.querySelectorAll("[data-user-name]").forEach(function (node) {
      node.textContent = displayName;
    });

    document.querySelectorAll("[data-user-initial]").forEach(function (node) {
      node.textContent = initial || "G";
    });

    document.querySelectorAll("[data-public-users]").forEach(function (node) {
      node.textContent = publicUsers.toLocaleString();
    });

    document.querySelectorAll("[data-public-pages]").forEach(function (node) {
      node.textContent = publicPages.toLocaleString();
    });

    var pageName = document.body ? (document.body.getAttribute("data-page") || "") : "";
    var shouldAnimateCommunityUsers = pageName === "home" || pageName === "landing";

    if (shouldAnimateCommunityUsers) {
      animateCommunityUsersCount(publicUsers);
      animatePublicPagesCount(publicPages);
      animateFeaturedTemplatesCount(FEATURED_TEMPLATES_COUNT);
    } else {
      document.querySelectorAll("[data-public-users-compact]").forEach(function (node) {
        node.textContent = formatCompactCount(publicUsers);
      });

      document.querySelectorAll("[data-public-pages-compact]").forEach(function (node) {
        node.textContent = formatCompactCount(publicPages);
      });

      document.querySelectorAll("[data-featured-templates-compact]").forEach(function (node) {
        node.textContent = String(FEATURED_TEMPLATES_COUNT);
      });
    }

    document.querySelectorAll("[data-sync-mode]").forEach(function (node) {
      node.textContent = firebaseSyncEnabled ? "Firebase" : "Local";
    });

    var homeDraftCount = document.getElementById("homeDraftCount");
    if (homeDraftCount) {
      homeDraftCount.textContent = String(state.drafts.length);
    }

    var homeGreeting = document.getElementById("homeUserGreeting");
    if (homeGreeting) {
      homeGreeting.textContent = state.signedIn ? "Welcome back, " + displayName : "Welcome to your creative space";
    }

    var banner = document.getElementById("homeLowCreditsBanner");
    if (banner) {
      banner.classList.toggle("hidden", state.credits >= 3);
    }

    var creditLarge = document.getElementById("currentCreditsLarge");
    if (creditLarge) {
      creditLarge.textContent = String(state.credits);
    }

    var draftCounter = document.getElementById("draftCounter");
    if (draftCounter) {
      draftCounter.textContent = state.drafts.length + " published page" + (state.drafts.length === 1 ? "" : "s");
    }
  }

  function setSuccessMessage(message) {
    var target = document.getElementById("successMessage");
    if (target) {
      target.textContent = message;
    }

    openModal("success");
  }

  function buildDraftSharePayload(draftRecord) {
    var draftId = draftRecord && draftRecord.id ? draftRecord.id : "heart-v1";
    var viewerHref = getViewerPath().replace(/\/+$/, "") + "/" + encodeURIComponent(draftId);
    var viewerUrl = new URL(viewerHref, window.location.href);

    return {
      draftId: draftId,
      shareLink: viewerUrl.toString(),
      viewerHref: viewerHref,
      qrSource: getQrCodeUrl(viewerUrl.toString(), 320)
    };
  }

  function preloadImageSource(source, timeoutMs) {
    var src = String(source || "").trim();
    if (!src) {
      return Promise.resolve();
    }

    var timeout = Math.max(300, toInt(timeoutMs, 2200));

    return new Promise(function (resolve) {
      var image = new Image();
      var resolved = false;

      function finalize() {
        if (resolved) {
          return;
        }

        resolved = true;
        resolve();
      }

      var timeoutId = window.setTimeout(function () {
        finalize();
      }, timeout);

      image.onload = function () {
        window.clearTimeout(timeoutId);
        finalize();
      };

      image.onerror = function () {
        window.clearTimeout(timeoutId);
        finalize();
      };

      image.src = src;
    });
  }

  function showPublishedModal(draftRecord, syncedToCloud, options) {
    var config = options || {};
    var shouldWaitForAssets = Boolean(config.waitForAssets);
    var shareLinkNode = document.getElementById("publishShareLink");
    var titleNode = document.getElementById("publishSuccessTitle");
    var subtitleNode = document.getElementById("publishSuccessSubtitle");
    var copyButton = document.getElementById("copyShareLinkButton");
    var downloadQrButton = document.getElementById("downloadQrCodeButton");
    var viewLink = document.getElementById("viewPublishedPageLink");
    var dashboardLink = document.getElementById("openDashboardFromSuccess");
    var createNewLink = document.getElementById("createNewLetterFromSuccess");
    var quickShareButtons = document.querySelectorAll("[data-quick-share]");
    var qrImage = document.getElementById("publishQrImage");
    var sharePayload = buildDraftSharePayload(draftRecord);
    var draftId = sharePayload.draftId;
    var shareLink = sharePayload.shareLink;
    var viewerHref = sharePayload.viewerHref;
    var qrSource = sharePayload.qrSource;
    var shareTitle = config.shareTitle || (draftRecord && draftRecord.title
      ? String(draftRecord.title).trim()
      : "A Letter4U page for you");

    if (titleNode) {
      titleNode.textContent = config.title || "Your heart's letter is now live.";
    }

    if (shareLinkNode) {
      shareLinkNode.textContent = shareLink;
      shareLinkNode.setAttribute("data-share-link", shareLink);
    }

    if (subtitleNode) {
      subtitleNode.textContent = config.subtitle || (syncedToCloud
        ? "The words you've penned are now a digital keepsake, ready to be shared with those who matter most."
        : "Saved locally for now. Cloud sync will retry automatically once your connection is ready.");
    }

    if (copyButton) {
      copyButton.setAttribute("data-share-link", shareLink);
    }

    if (downloadQrButton) {
      downloadQrButton.setAttribute("data-share-link", shareLink);
      downloadQrButton.setAttribute("data-qr-src", qrSource);
      downloadQrButton.setAttribute("data-qr-filename", "letter4u-qr-" + draftId + ".png");
    }

    if (quickShareButtons && quickShareButtons.length) {
      quickShareButtons.forEach(function (buttonNode) {
        buttonNode.setAttribute("data-share-link", shareLink);
        buttonNode.setAttribute("data-share-title", shareTitle);
      });
    }

    if (viewLink) {
      viewLink.href = viewerHref;
    }

    if (dashboardLink) {
      dashboardLink.href = routeTo("my-pages.html");
    }

    if (createNewLink) {
      createNewLink.href = routeTo("create.html");
      if (config.createCtaLabel) {
        createNewLink.textContent = config.createCtaLabel;
      }
    }

    var assetsReadyPromise = Promise.resolve();

    if (qrImage) {
      if (shouldWaitForAssets) {
        assetsReadyPromise = preloadImageSource(qrSource, 2200).then(function () {
          qrImage.src = qrSource;
        });
      } else {
        qrImage.src = qrSource;
      }
    }

    return assetsReadyPromise
      .catch(function () {
        if (qrImage) {
          qrImage.src = qrSource;
        }
      })
      .then(function () {
        openModal("publish-success");

        if (!config.silentToast) {
          showToast(config.toastMessage || (syncedToCloud ? "Letter synced with cloud." : "Letter saved locally."));
        }

        return {
          shareLink: shareLink,
          viewerHref: viewerHref
        };
      });
  }

  function showLowCredits(requiredCredits, availableCredits) {
    var normalizedRequired = Math.max(0, toInt(requiredCredits, 0));
    var normalizedAvailable = typeof availableCredits === "number"
      ? Math.max(0, toInt(availableCredits, 0))
      : Math.max(0, toInt(state.credits, 0));
    var shortfall = Math.max(normalizedRequired - normalizedAvailable, 0);
    var target = document.getElementById("lowCreditsMessage");

    if (target) {
      target.textContent = "This upload needs " + normalizedRequired + " credit(s). You are short by " + shortfall + ". Earn social credits or refill now to continue.";
    }

    openModal("low-credits");
  }

  function requireCredits(creditsCost, callback, onRejected, consumeOptions) {
    var normalizedCost = Math.max(0, toInt(creditsCost, 0));
    var consumeConfig = consumeOptions && typeof consumeOptions === "object"
      ? consumeOptions
      : null;

    function reject(reason) {
      if (typeof onRejected === "function") {
        onRejected(reason || null);
      }
    }

    if (hasCloudSession()) {
      function applySyncedCredits(nextCredits) {
        state.credits = Math.max(0, toInt(nextCredits, state.credits));
        saveState();
        refreshBindings();
        emitStateUpdated();
      }

      function consumeOnce() {
        return firebaseApi.consumeCredits(state.userUid, normalizedCost, consumeConfig)
          .then(function (nextCredits) {
            applySyncedCredits(nextCredits);
            callback();
            return null;
          });
      }

      firebaseApi.ensureUserRecord(
        {
          uid: state.userUid,
          displayName: state.userName || (state.settings && state.settings.displayName ? state.settings.displayName : "Writer"),
          email: ""
        },
        0
      )
        .then(function (profile) {
          var syncedCredits = profile && typeof profile.credits === "number"
            ? Math.max(0, toInt(profile.credits, state.credits))
            : Math.max(0, toInt(state.credits, 0));

          applySyncedCredits(syncedCredits);

          if (syncedCredits < normalizedCost) {
            showLowCredits(normalizedCost, syncedCredits);
            reject({
              code: "INSUFFICIENT_CREDITS",
              availableCredits: syncedCredits,
              requiredCredits: normalizedCost
            });
            return null;
          }

          return consumeOnce()
            .catch(function (error) {
              if (error && error.code === "INSUFFICIENT_CREDITS") {
                if (Number.isFinite(Number(error && error.availableCredits))) {
                  var directAvailable = Math.max(0, toInt(error.availableCredits, state.credits));
                  applySyncedCredits(directAvailable);
                  showLowCredits(normalizedCost, directAvailable);
                  reject({
                    code: "INSUFFICIENT_CREDITS",
                    availableCredits: directAvailable,
                    requiredCredits: normalizedCost
                  });
                  return null;
                }

                return firebaseApi.ensureUserRecord(
                  {
                    uid: state.userUid,
                    displayName: state.userName || (state.settings && state.settings.displayName ? state.settings.displayName : "Writer"),
                    email: ""
                  },
                  0
                )
                  .then(function (profileAfterConflict) {
                    var syncedAfterConflict = profileAfterConflict && typeof profileAfterConflict.credits === "number"
                      ? Math.max(0, toInt(profileAfterConflict.credits, state.credits))
                      : Math.max(0, toInt(state.credits, 0));

                    applySyncedCredits(syncedAfterConflict);
                    showLowCredits(normalizedCost, syncedAfterConflict);
                    reject({
                      code: "INSUFFICIENT_CREDITS",
                      availableCredits: syncedAfterConflict,
                      requiredCredits: normalizedCost
                    });
                    return null;
                  });
              }

              throw error;
            });
        })
        .catch(function (error) {
          if (error && error.code === "AUTH_REQUIRED") {
            openModal("signin");
            showToast("Sign in again to validate credits.");
            reject({ code: "AUTH_REQUIRED" });
            return;
          }

          if (error && (
            error.code === "INVALID_CREDIT_COST" ||
            error.code === "INVALID_PUBLISH_PAYLOAD" ||
            error.code === "INVALID_LOVE_LOCK_MESSAGE" ||
            error.code === "INVALID_PIN_CODE" ||
            error.code === "INVALID_YOUTUBE_URL" ||
            error.code === "CRT_PHOTO_REQUIRED" ||
            error.code === "CRT_YOUTUBE_REQUIRED" ||
            error.code === "CREDIT_AMOUNT_REQUIRED"
          )) {
            showToast("Publish validation failed. Use youtube video links instead of music.youtube, Ex: youtu.be or youtube.com.");
            reject({
              code: error.code,
              requiredCredits: Number.isFinite(Number(error && error.requiredCredits))
                ? Math.max(0, toInt(error.requiredCredits, normalizedCost))
                : normalizedCost
            });
            return;
          }

          if (error && (
            error.code === "CREDIT_VALIDATION_SERVICE_REQUIRED" ||
            error.code === "CREDIT_SERVICE_UNAVAILABLE" ||
            error.code === "ADMIN_API_UNAVAILABLE"
          )) {
            showToast("Credit service is temporarily unavailable. Please try publishing again.");
            reject({ code: "CREDIT_SERVICE_UNAVAILABLE" });
            return;
          }

          showToast("Unable to validate credits through the credit service.");
          reject({ code: "CREDIT_VALIDATION_FAILED" });
        });
      return;
    }

    if (state.credits < normalizedCost) {
      showLowCredits(normalizedCost, state.credits);
      reject({
        code: "INSUFFICIENT_CREDITS",
        availableCredits: state.credits,
        requiredCredits: normalizedCost
      });
      return;
    }

    state.credits = Math.max(0, state.credits - normalizedCost);
    saveState();
    refreshBindings();
    emitStateUpdated();
    callback();
  }

  function startSavingFlow(onComplete) {
    if (savingFlowActive) {
      return Promise.resolve();
    }

    savingFlowActive = true;
    openModal("saving");

    var progressBar = document.getElementById("saveProgressBar");
    var progressLabel = document.getElementById("saveProgressLabel");
    var progressPercent = document.getElementById("saveProgressPercent");
    var progressValue = 0;
    var isFlowResolved = false;
    var isFlowFailed = false;
    var progressSteps = [
      "Compressing uploaded photos...",
      "Uploading letter payload...",
      "Creating your secure share link...",
      "Finalizing your page..."
    ];

    if (progressBar) {
      progressBar.style.width = "8%";
    }

    if (progressPercent) {
      progressPercent.textContent = "8%";
    }

    var completionPromise;

    try {
      completionPromise = typeof onComplete === "function"
        ? Promise.resolve(onComplete())
        : Promise.resolve();
    } catch (_error) {
      completionPromise = Promise.reject(_error);
    }

    completionPromise
      .then(function () {
        isFlowResolved = true;
      })
      .catch(function () {
        isFlowFailed = true;
      });

    function setProgress(nextValue) {
      progressValue = Math.max(0, Math.min(100, toInt(nextValue, progressValue)));

      if (progressBar) {
        progressBar.style.width = progressValue + "%";
      }

      if (progressPercent) {
        progressPercent.textContent = progressValue + "%";
      }
    }

    var timer = window.setInterval(function () {
      if (isFlowFailed) {
        window.clearInterval(timer);
        closeModal("saving");
        savingFlowActive = false;
        return;
      }

      if (isFlowResolved) {
        if (progressLabel) {
          progressLabel.textContent = "Finalizing your page...";
        }

        if (progressValue < 96) {
          setProgress(96);
        } else {
          setProgress(100);
        }

        if (progressValue >= 100) {
          window.clearInterval(timer);

          window.setTimeout(function () {
            closeModal("saving");
            savingFlowActive = false;
          }, 160);
        }

        return;
      }

      var nextProgress = Math.min(92, progressValue + Math.floor(Math.random() * 10) + 4);
      setProgress(nextProgress);

      if (progressLabel) {
        var phaseIndex = Math.min(progressSteps.length - 1, Math.floor((progressValue / 100) * progressSteps.length));
        progressLabel.textContent = progressSteps[phaseIndex];
      }
    }, 160);

    return completionPromise.catch(function () {
      return null;
    });
  }

  function clearUserSyncListeners() {
    if (creditsUnsubscribe) {
      creditsUnsubscribe();
      creditsUnsubscribe = null;
    }

    if (pagesUnsubscribe) {
      pagesUnsubscribe();
      pagesUnsubscribe = null;
    }
  }

  function waitForFirebaseBridge(timeoutMs) {
    if (firebaseReadyPromise) {
      return firebaseReadyPromise;
    }

    firebaseReadyPromise = new Promise(function (resolve) {
      var startedAt = Date.now();

      function resolveNow() {
        if (window.L4UFirebaseReady && typeof window.L4UFirebaseReady.then === "function") {
          window.L4UFirebaseReady
            .then(function (api) {
              resolve(api || null);
            })
            .catch(function () {
              resolve(null);
            });
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(null);
          return;
        }

        window.setTimeout(resolveNow, 50);
      }

      resolveNow();
    });

    return firebaseReadyPromise;
  }

  function bindSignedInUser(user) {
    if (!user) {
      return;
    }

    var previousUid = String(state.userUid || "");

    clearUserSyncListeners();

    state.signedIn = true;
    state.isAdmin = false;
    state.userUid = user.uid;
    state.userName = user.displayName || (user.email ? user.email.split("@")[0] : "Writer");
    state.credits = previousUid === user.uid
      ? Math.max(0, toInt(state.credits, 0))
      : 0;
    state.settings.displayName = state.userName;
    saveState();
    refreshBindings();
    emitStateUpdated();

    firebaseApi.ensureUserRecord(user, 0).catch(function () {
      showToast("Could not initialize your Realtime DB profile.");
    });

    firebaseApi.updateUserProfile(user.uid, {
      displayName: state.settings.displayName,
      email: user.email || ""
    }).catch(function () {
      // Non-fatal profile sync issue.
    });

    if (typeof user.getIdTokenResult === "function") {
      user.getIdTokenResult()
        .then(function (tokenResult) {
          state.isAdmin = Boolean(tokenResult && tokenResult.claims && tokenResult.claims.admin === true);
          saveState();
          refreshBindings();
          emitStateUpdated();
        })
        .catch(function () {
          state.isAdmin = false;
          saveState();
          refreshBindings();
          emitStateUpdated();
        });
    }

    creditsUnsubscribe = firebaseApi.listenUserCredits(user.uid, function (nextCredits) {
      state.credits = Math.max(0, toInt(nextCredits, state.credits));
      saveState();
      refreshBindings();
      emitStateUpdated();
    });

    pagesUnsubscribe = firebaseApi.listenUserPages(user.uid, function (pages) {
      state.drafts = Array.isArray(pages) ? pages : [];
      saveState();
      refreshBindings();
      emitStateUpdated();
    });
  }

  function handleSignedOutState(showMessage) {
    clearUserSyncListeners();

    state.signedIn = false;
    state.isAdmin = false;
    state.userUid = "";
    state.userName = "Guest";
    state.credits = 0;
    saveState();
    refreshBindings();
    emitStateUpdated();

    if (showMessage) {
      showToast("You are signed out.");
    }
  }

  function initFirebaseSync() {
    waitForFirebaseBridge(6000)
      .then(function (api) {
        if (!api) {
          return;
        }

        firebaseApi = api;
        firebaseSyncEnabled = true;
        refreshBindings();

        if (statsUnsubscribe) {
          statsUnsubscribe();
          statsUnsubscribe = null;
        }

        statsUnsubscribe = firebaseApi.listenPublicStats(function (stats) {
          state.publicStats = {
            users: Math.max(0, toInt(stats && stats.users, 0)),
            pages: Math.max(0, toInt(stats && stats.pages, 0))
          };
          saveState();
          refreshBindings();
          emitStateUpdated();
        });

        if (authUnsubscribe) {
          authUnsubscribe();
          authUnsubscribe = null;
        }

        authUnsubscribe = firebaseApi.onAuthChanged(function (user) {
          var hadSession = Boolean(state.signedIn && state.userUid);

          if (user) {
            bindSignedInUser(user);

            if (authInitialized && !hadSession) {
              closeModal("signin");
              setSuccessMessage("Signed in as " + state.userName + ".");
            }
          } else {
            handleSignedOutState(authInitialized && hadSession);
          }

          if (!authInitialized) {
            maybeAutoOpenTikTokBrowserWarning();
          }

          authInitialized = true;
        });
      })
      .catch(function () {
        showToast("Firebase initialization failed. Using local mode.");
      });
  }

  function initReveal() {
    var revealNodes = document.querySelectorAll("[data-reveal]");
    var prefersReducedMotion = false;
    var revealSequence = 0;

    if (window.matchMedia) {
      prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function revealNode(node) {
      if (!node || node.classList.contains("is-visible")) {
        return;
      }

      var delayMs = prefersReducedMotion ? 0 : Math.min(360, revealSequence * 70);
      node.style.transitionDelay = delayMs + "ms";
      node.classList.add("is-visible");
      revealSequence += 1;
    }

    revealNodes.forEach(function (node) {
      node.classList.add("l4u-reveal");
    });

    if (!("IntersectionObserver" in window)) {
      revealNodes.forEach(function (node) {
        revealNode(node);
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries
        .slice()
        .sort(function (a, b) {
          return a.boundingClientRect.top - b.boundingClientRect.top;
        })
        .forEach(function (entry) {
          if (!entry.isIntersecting) {
            return;
          }

          revealNode(entry.target);
          observer.unobserve(entry.target);
        });
    }, { threshold: 0.12 });

    revealNodes.forEach(function (node) {
      observer.observe(node);
    });
  }

  function initHomePage() {
    var heroWordMount = document.getElementById("heroMorphWord");
    var heroCanvas = document.getElementById("heroMorphCanvas");
    var heroFallback = document.getElementById("heroMorphFallback");
    var HERO_TYPING_MOBILE_MAX_WIDTH = 768;

    function shouldUseHeroTypingMode() {
      if (window.matchMedia) {
        return window.matchMedia("(max-width: " + HERO_TYPING_MOBILE_MAX_WIDTH + "px)").matches;
      }

      return Math.max(0, toInt(window.innerWidth, 1024)) <= HERO_TYPING_MOBILE_MAX_WIDTH;
    }

    function initHeroWordTyping(words, prefersReducedMotion) {
      if (!heroWordMount || !heroFallback || !Array.isArray(words) || !words.length) {
        return false;
      }

      heroWordMount.classList.remove("is-ready");
      heroWordMount.classList.add("is-mobile-typing");

      if (heroCanvas) {
        heroCanvas.setAttribute("aria-hidden", "true");
      }

      if (prefersReducedMotion) {
        heroFallback.textContent = words[0];
        heroWordMount.setAttribute("aria-label", words[0]);
        return true;
      }

      var activeWordIndex = 0;
      var typedLength = 0;
      var deleting = false;
      var typingTimer = 0;
      var typeDelayMs = 70;
      var deleteDelayMs = 44;
      var holdDelayMs = 1080;
      var switchDelayMs = 240;

      function scheduleNext(delayMs) {
        typingTimer = window.setTimeout(stepTyping, Math.max(16, delayMs));
      }

      function stepTyping() {
        var activeWord = String(words[activeWordIndex] || "");

        heroWordMount.setAttribute("aria-label", activeWord || words[0]);

        if (!deleting) {
          typedLength = Math.min(activeWord.length, typedLength + 1);
          heroFallback.textContent = activeWord.slice(0, typedLength);

          if (typedLength >= activeWord.length) {
            deleting = true;
            scheduleNext(holdDelayMs);
            return;
          }

          scheduleNext(typeDelayMs);
          return;
        }

        typedLength = Math.max(0, typedLength - 1);
        heroFallback.textContent = activeWord.slice(0, typedLength);

        if (typedLength <= 0) {
          deleting = false;
          activeWordIndex = (activeWordIndex + 1) % words.length;
          scheduleNext(switchDelayMs);
          return;
        }

        scheduleNext(deleteDelayMs);
      }

      heroFallback.textContent = "";
      heroWordMount.setAttribute("aria-label", words[0]);
      scheduleNext(250);

      window.addEventListener("beforeunload", function () {
        if (typingTimer) {
          window.clearTimeout(typingTimer);
          typingTimer = 0;
        }
      }, { once: true });

      return true;
    }

    function initHeroWordMorph() {
      if (!heroWordMount) {
        return;
      }

      var prefersReducedMotion = false;
      if (window.matchMedia) {
        prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }

      var words = ["Digitally", "Creatively", "Privately", "Intentionally", "Beautifully"];

      if (heroFallback) {
        heroFallback.textContent = words[0];
      }

      if (shouldUseHeroTypingMode()) {
        initHeroWordTyping(words, prefersReducedMotion);
        return;
      }

      heroWordMount.classList.remove("is-mobile-typing");

      if (!heroCanvas || typeof heroCanvas.getContext !== "function") {
        return;
      }

      if (prefersReducedMotion) {
        return;
      }

      var ctx = heroCanvas.getContext("2d");
      if (!ctx) {
        return;
      }

      var dpr = 1;
      var cssWidth = 0;
      var cssHeight = 0;
      var particleCount = 220;
      var particleSize = 2;
      var frameIntervalMs = 16;
      var lastPaintAt = 0;
      var userAgent = String(navigator.userAgent || "");
      var hardwareThreads = Math.max(1, toInt(navigator.hardwareConcurrency, 4));
      var rawDeviceMemory = Number(navigator.deviceMemory || 0);
      var deviceMemoryGiB = Number.isFinite(rawDeviceMemory) && rawDeviceMemory > 0 ? rawDeviceMemory : 4;
      var isAndroidDevice = /Android/i.test(userAgent);
      var isLowEndAndroid = isAndroidDevice && (hardwareThreads <= 4 || deviceMemoryGiB <= 4);
      var pointSampleDivisor = 24;
      var pointAlphaThreshold = 105;
      var wordPointCache = {};
      var particles = [];
      var heartPoints = [];
      var activeWordIndex = 0;
      var nextWordIndex = 1;
      var phase = "hold-word";
      var phaseStart = 0;
      var animationHandle = 0;
      var resizeObserver = null;
      var resizeTimer = 0;

      var phaseDurations = {
        "hold-word": 1200,
        "word-to-heart": 820,
        "hold-heart": 420,
        "heart-to-word": 860
      };

      function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
      }

      function getRenderDpr() {
        return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      }

      function configurePerformanceProfile(viewportWidth) {
        var width = Math.max(320, toInt(viewportWidth, cssWidth || 360));

        if (isLowEndAndroid) {
          frameIntervalMs = width < 768 ? 34 : 28;
          phaseDurations["hold-word"] = 1550;
          phaseDurations["word-to-heart"] = 1120;
          phaseDurations["hold-heart"] = 600;
          phaseDurations["heart-to-word"] = 1180;
          pointSampleDivisor = 18;
          pointAlphaThreshold = 118;
          return;
        }

        frameIntervalMs = width < 420 ? 18 : (width < 768 ? 16 : 15);
        phaseDurations["hold-word"] = 1250;
        phaseDurations["word-to-heart"] = 840;
        phaseDurations["hold-heart"] = 430;
        phaseDurations["heart-to-word"] = 860;
        pointSampleDivisor = width < 420 ? 28 : 30;
        pointAlphaThreshold = 100;
      }

      function easeInOut(value) {
        if (value < 0.5) {
          return 2 * value * value;
        }

        return 1 - Math.pow(-2 * value + 2, 2) / 2;
      }

      function interpolateColor(hexA, hexB, ratio) {
        var safeRatio = clamp(ratio, 0, 1);
        var a = hexA.replace("#", "");
        var b = hexB.replace("#", "");

        var ar = parseInt(a.slice(0, 2), 16);
        var ag = parseInt(a.slice(2, 4), 16);
        var ab = parseInt(a.slice(4, 6), 16);

        var br = parseInt(b.slice(0, 2), 16);
        var bg = parseInt(b.slice(2, 4), 16);
        var bb = parseInt(b.slice(4, 6), 16);

        var rr = Math.round(ar + (br - ar) * safeRatio);
        var rg = Math.round(ag + (bg - ag) * safeRatio);
        var rb = Math.round(ab + (bb - ab) * safeRatio);

        return "rgb(" + rr + ", " + rg + ", " + rb + ")";
      }

      function normalizePoints(points, targetCount) {
        var safePoints = Array.isArray(points) ? points : [];
        var count = Math.max(1, toInt(targetCount, 1));

        if (!safePoints.length) {
          return Array.from({ length: count }, function () {
            return { x: cssWidth / 2, y: cssHeight / 2 };
          });
        }

        if (safePoints.length === count) {
          return safePoints;
        }

        var normalized = [];
        var ratio = safePoints.length / count;

        for (var index = 0; index < count; index += 1) {
          var sourceIndex = Math.floor(index * ratio) % safePoints.length;
          normalized.push(safePoints[sourceIndex]);
        }

        return normalized;
      }

      function samplePoints(drawShape) {
        var sampleCanvas = document.createElement("canvas");
        sampleCanvas.width = cssWidth;
        sampleCanvas.height = cssHeight;

        var sampleCtx = sampleCanvas.getContext("2d");
        if (!sampleCtx) {
          return [];
        }

        sampleCtx.clearRect(0, 0, cssWidth, cssHeight);
        drawShape(sampleCtx, cssWidth, cssHeight);

        var imageData = sampleCtx.getImageData(0, 0, cssWidth, cssHeight).data;
        var sampleStep = Math.max(2, Math.floor(Math.min(cssWidth, cssHeight) / Math.max(8, pointSampleDivisor)));
        var points = [];

        for (var y = Math.floor(sampleStep / 2); y < cssHeight; y += sampleStep) {
          for (var x = Math.floor(sampleStep / 2); x < cssWidth; x += sampleStep) {
            var alpha = imageData[((y * cssWidth) + x) * 4 + 3];
            if (alpha >= pointAlphaThreshold) {
              points.push({ x: x, y: y });
            }
          }
        }

        return points;
      }

      function buildWordPoints(word) {
        if (wordPointCache[word]) {
          return wordPointCache[word];
        }

        var points = samplePoints(function (sampleCtx, width, height) {
          var fontSize = Math.max(26, Math.floor(height * (isLowEndAndroid ? 0.68 : 0.74)));
          var maxTextWidth = width * 0.9;
          sampleCtx.fillStyle = "#111";
          sampleCtx.textAlign = "center";
          sampleCtx.textBaseline = "middle";
          sampleCtx.font = "800 " + fontSize + "px 'Plus Jakarta Sans', sans-serif";

          var measuredWidth = sampleCtx.measureText(word).width;
          if (measuredWidth > maxTextWidth && measuredWidth > 0) {
            fontSize = Math.max(20, Math.floor(fontSize * (maxTextWidth / measuredWidth)));
            sampleCtx.font = "800 " + fontSize + "px 'Plus Jakarta Sans', sans-serif";
          }

          sampleCtx.fillText(word, width / 2, height * 0.56);
        });

        var normalized = normalizePoints(points, particleCount);
        wordPointCache[word] = normalized;
        return normalized;
      }

      function buildHeartPoints() {
        var points = [];
        var scale = Math.min(cssWidth, cssHeight) * 0.25;
        var step = 0.075;

        for (var y = 1.25; y >= -1.2; y -= step) {
          for (var x = -1.25; x <= 1.25; x += step) {
            var lhs = Math.pow((x * x + y * y - 1), 3) - (x * x * Math.pow(y, 3));
            if (lhs <= 0) {
              points.push({
                x: Math.round(cssWidth / 2 + (x * scale)),
                y: Math.round(cssHeight / 2 - (y * scale * 0.92))
              });
            }
          }
        }

        return normalizePoints(points, particleCount);
      }

      function assignTargets(targetPoints, hardSet) {
        var normalizedTargets = normalizePoints(targetPoints, particleCount);

        if (!particles.length || hardSet) {
          particles = normalizedTargets.map(function (point) {
            return {
              x: point.x,
              y: point.y,
              startX: point.x,
              startY: point.y,
              targetX: point.x,
              targetY: point.y
            };
          });
          return;
        }

        particles.forEach(function (particle, index) {
          var target = normalizedTargets[index];
          particle.startX = particle.x;
          particle.startY = particle.y;
          particle.targetX = target.x;
          particle.targetY = target.y;
        });
      }

      function resizeCanvas() {
        var bounds = heroWordMount.getBoundingClientRect();
        var measuredWidth = Math.round(bounds.width);
        var measuredHeight = Math.round(bounds.height);

        if (!measuredWidth || measuredWidth < 120) {
          return;
        }

        cssWidth = Math.max(220, measuredWidth);
        cssHeight = Math.max(84, measuredHeight || Math.round(cssWidth * 0.22));

        var viewportWidth = Math.max(320, toInt(window.innerWidth, cssWidth));
        var densityFactor = isLowEndAndroid
          ? (viewportWidth < 420 ? 0.68 : (viewportWidth < 768 ? 0.82 : 0.9))
          : (viewportWidth < 420 ? 1.06 : (viewportWidth < 768 ? 1.18 : 1.22));

        dpr = getRenderDpr();
        configurePerformanceProfile(viewportWidth);
        particleCount = Math.min(isLowEndAndroid ? 360 : 560, Math.max(isLowEndAndroid ? 130 : 200, Math.floor((cssWidth * cssHeight) / 132 * densityFactor)));
        particleSize = isLowEndAndroid
          ? (viewportWidth < 420 ? 2.2 : 2.35)
          : (viewportWidth < 420 ? 1.9 : (viewportWidth < 768 ? 2.05 : 2.2));

        heroCanvas.width = Math.round(cssWidth * dpr);
        heroCanvas.height = Math.round(cssHeight * dpr);
        heroCanvas.style.width = cssWidth + "px";
        heroCanvas.style.height = cssHeight + "px";

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        wordPointCache = {};
        heartPoints = buildHeartPoints();
        assignTargets(buildWordPoints(words[activeWordIndex]), true);
        lastPaintAt = 0;
      }

      function scheduleResize() {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
          resizeCanvas();
        }, 90);
      }

      function paint(progressRatio) {
        var ratio = clamp(progressRatio, 0, 1);
        var eased = easeInOut(ratio);

        ctx.clearRect(0, 0, cssWidth, cssHeight);

        for (var index = 0; index < particles.length; index += 1) {
          var particle = particles[index];
          particle.x = particle.startX + (particle.targetX - particle.startX) * eased;
          particle.y = particle.startY + (particle.targetY - particle.startY) * eased;

          var colorRatio = particle.x / Math.max(1, cssWidth);
          ctx.fillStyle = interpolateColor("#6d4953", "#e0afbe", colorRatio);
          ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particleSize, particleSize);
        }
      }

      function advancePhase(now) {
        if (phase === "hold-word") {
          if (now - phaseStart >= phaseDurations[phase]) {
            phase = "word-to-heart";
            phaseStart = now;
            assignTargets(heartPoints, false);
          }
          return;
        }

        if (phase === "word-to-heart") {
          if (now - phaseStart >= phaseDurations[phase]) {
            phase = "hold-heart";
            phaseStart = now;
          }
          return;
        }

        if (phase === "hold-heart") {
          if (now - phaseStart >= phaseDurations[phase]) {
            phase = "heart-to-word";
            phaseStart = now;
            assignTargets(buildWordPoints(words[nextWordIndex]), false);
          }
          return;
        }

        if (phase === "heart-to-word" && now - phaseStart >= phaseDurations[phase]) {
          activeWordIndex = nextWordIndex;
          nextWordIndex = (nextWordIndex + 1) % words.length;
          if (heroWordMount) {
            heroWordMount.setAttribute("aria-label", words[activeWordIndex]);
          }
          phase = "hold-word";
          phaseStart = now;
        }
      }

      function runAnimation(now) {
        if (!phaseStart) {
          phaseStart = now;
        }

        if (now - lastPaintAt < frameIntervalMs) {
          animationHandle = window.requestAnimationFrame(runAnimation);
          return;
        }

        lastPaintAt = now;

        advancePhase(now);

        var duration = Math.max(1, phaseDurations[phase]);
        var elapsed = now - phaseStart;
        var progressRatio = phase.indexOf("hold") === 0 ? 1 : clamp(elapsed / duration, 0, 1);
        paint(progressRatio);

        animationHandle = window.requestAnimationFrame(runAnimation);
      }

      resizeCanvas();
      heroWordMount.classList.add("is-ready");
      animationHandle = window.requestAnimationFrame(runAnimation);

      function onWindowResize() {
        scheduleResize();
      }

      window.addEventListener("resize", onWindowResize);
      window.addEventListener("orientationchange", onWindowResize);

      if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(function () {
          scheduleResize();
        });
        resizeObserver.observe(heroWordMount);
      }

      window.setTimeout(scheduleResize, 60);

      window.addEventListener("beforeunload", function () {
        if (animationHandle) {
          window.cancelAnimationFrame(animationHandle);
        }

        window.removeEventListener("resize", onWindowResize);
        window.removeEventListener("orientationchange", onWindowResize);

        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }

        window.clearTimeout(resizeTimer);
      });
    }

    initHeroWordMorph();
    refreshBindings();
  }

  function initCreatePage() {
    var templateChooser = document.getElementById("templateChooser");
    var createEditorShell = document.getElementById("createEditorShell");
    var createPageTitle = document.getElementById("createPageTitle");
    var selectedTemplateLabel = document.getElementById("selectedTemplateLabel");
    var changeTemplateButton = document.getElementById("changeTemplateButton");
    var loveTemplateFields = document.getElementById("loveTemplateFields");
    var loveTemplateClosingFields = document.getElementById("loveTemplateClosingFields");
    var crtTemplateFields = document.getElementById("crtTemplateFields");

    var titleInput = document.getElementById("draftTitle");
    var recipientInput = document.getElementById("draftRecipient");
    var dateInput = document.getElementById("draftDate");
    var pinInput = document.getElementById("draftPin");
    var messageInput = document.getElementById("draftMessage");
    var closingInput = document.getElementById("draftClosing");
    var signatureInput = document.getElementById("draftSignature");
    var youtubeInput = document.getElementById("draftYoutubeUrl");
    var youtubeLabel = document.getElementById("draftYoutubeLabel");
    var youtubeHint = document.getElementById("draftYoutubeHint");
    var customPageNameToggle = document.getElementById("customPageNameToggle");
    var customPageNameFields = document.getElementById("customPageNameFields");
    var customPageNameInput = document.getElementById("customPageNameInput");
    var customPageNameStatus = document.getElementById("customPageNameStatus");
    var voucherInput = document.getElementById("draftVoucherCode");
    var voucherStatus = document.getElementById("draftVoucherStatus");
    var draftPricingHint = document.getElementById("draftPricingHint");

    var saveButton = document.getElementById("saveDraftBtn");
    var saveStatus = document.getElementById("saveStatus");
    var photoInput = document.getElementById("photoUpload");
    var uploadDropzone = document.getElementById("uploadDropzone");
    var uploadQueue = document.getElementById("uploadQueue");
    var uploadedPhotos = document.getElementById("uploadedPhotos");
    var draftCostNode = document.getElementById("draftCostValue");
    var draftPhotoCountNode = document.getElementById("draftPhotoCount");
    var draftCharCountNode = document.getElementById("draftCharCount");
    var draftPhotoLimitNode = document.getElementById("draftPhotoLimit");
    var draftCharLimitNode = document.getElementById("draftCharLimit");
    var draftTotalPhotoSize = document.getElementById("draftTotalPhotoSize");
    var previewMainPhoto = document.getElementById("previewMainPhoto");
    var previewPhotoPlaceholder = document.getElementById("previewPhotoPlaceholder");
    var previewPinCode = document.getElementById("previewPinCode");

    if (!titleInput || !messageInput || !saveButton || !pinInput) {
      return;
    }

    var today = new Date().toISOString().slice(0, 10);
    var draftForm = state.draftForm || {};
    var stagedPhotos = [];
    var uploadBusy = false;
    var MAX_PHOTOS = 30;
    var activeTemplate = "love-lock";
    var publishBusy = false;
    var customPageNameCheckTimer = 0;
    var customPageNameCheckToken = 0;
    var customPageNameState = {
      checkedName: "",
      available: false,
      valid: false,
      checking: false,
      checkError: false
    };
    var voucherCheckTimer = 0;
    var voucherCheckToken = 0;
    var voucherState = {
      checkedCode: "",
      valid: false,
      checking: false,
      checkError: false
    };
    var createSupportGateState = {
      uid: "",
      checked: false,
      pending: false,
      shown: false
    };

    function resetCreateEntryGateModals() {
      ["low-credits", "social-support"].forEach(function (modalName) {
        var modalNode = document.querySelector('.l4u-modal[data-modal="' + modalName + '"]');

        if (!modalNode) {
          return;
        }

        modalNode.classList.remove("is-open");
        modalNode.hidden = true;
      });

      if (!document.querySelector(".l4u-modal.is-open")) {
        document.body.classList.remove("l4u-lock-scroll");
      }
    }

    function ensureCreateEntrySupportGate() {
      var currentUid = state.signedIn ? String(state.userUid || "") : "";

      if (currentUid !== createSupportGateState.uid) {
        createSupportGateState.uid = currentUid;
        createSupportGateState.checked = false;
        createSupportGateState.pending = false;
        createSupportGateState.shown = false;
      }

      if (!currentUid || !hasCloudSession() || !firebaseApi || typeof firebaseApi.getSupportRewardStatus !== "function") {
        return;
      }

      if (Math.max(0, toInt(state.credits, 0)) > 0) {
        return;
      }

      if (createSupportGateState.checked || createSupportGateState.pending) {
        return;
      }

      createSupportGateState.pending = true;

      firebaseApi.getSupportRewardStatus(currentUid)
        .then(function (statusPayload) {
          createSupportGateState.pending = false;
          createSupportGateState.checked = true;

          var claimed = Boolean(statusPayload && statusPayload.claimed);
          var syncedCredits = Number.isFinite(Number(statusPayload && statusPayload.credits))
            ? Math.max(0, toInt(statusPayload.credits, state.credits))
            : Math.max(0, toInt(state.credits, 0));

          if (syncedCredits !== state.credits) {
            state.credits = syncedCredits;
            saveState();
            refreshBindings();
            emitStateUpdated();
          }

          if (claimed || syncedCredits > 0 || createSupportGateState.shown) {
            return;
          }

          openModal("social-support");
          createSupportGateState.shown = true;

          var socialStatusNode = document.getElementById("socialSupportStatus");
          if (socialStatusNode) {
            socialStatusNode.textContent = "Complete these 6 steps to unlock your one-time free credit before creating a page.";
          }
        })
        .catch(function () {
          createSupportGateState.pending = false;
        });
    }

    resetCreateEntryGateModals();

    titleInput.value = draftForm.title || "";
    recipientInput.value = draftForm.recipient || "";
    dateInput.value = draftForm.date || today;
    pinInput.value = String(draftForm.pinCode || "").replace(/\D/g, "").slice(0, 4);
    messageInput.value = draftForm.message || "";
    closingInput.value = draftForm.closing || "With love,";
    signatureInput.value = draftForm.signature || "Your Name";
    if (youtubeInput) {
      youtubeInput.value = String(draftForm.youtubeUrl || "").trim();
    }
    if (customPageNameToggle) {
      customPageNameToggle.checked = Boolean(draftForm.customPageNameEnabled);
    }
    if (customPageNameInput) {
      customPageNameInput.value = String(draftForm.customPageName || "").replace(/[^A-Za-z0-9]/g, "").slice(0, CUSTOM_PAGE_NAME_MAX_LENGTH);
    }
    if (voucherInput) {
      voucherInput.value = String(draftForm.voucherCode || "").trim().slice(0, 40);
    }

    function isValidTemplate(value) {
      return value === "love-lock" || value === "crt-retro";
    }

    function normalizeTemplate(value) {
      return isValidTemplate(value) ? value : "love-lock";
    }

    function getTemplateFromQuery() {
      var params = new URLSearchParams(window.location.search);
      var rawTemplate = params.get("template") || "";
      return isValidTemplate(rawTemplate) ? rawTemplate : "";
    }

    function writeTemplateToQuery(template) {
      var url = new URL(window.location.href);
      url.searchParams.set("template", template);
      window.history.replaceState({}, "", url.toString());
    }

    function isYouTubeUrl(value) {
      var trimmed = String(value || "").trim();
      if (!trimmed) {
        return false;
      }

      try {
        var parsed = new URL(trimmed);
        var host = String(parsed.hostname || "").toLowerCase();
        return host.indexOf("youtube.com") !== -1 || host.indexOf("youtu.be") !== -1;
      } catch (_error) {
        return false;
      }
    }

    function normalizePinInput() {
      pinInput.value = String(pinInput.value || "").replace(/\D/g, "").slice(0, 4);
    }

    function formatBytes(bytes) {
      var safeBytes = Math.max(0, toInt(bytes, 0));

      if (safeBytes >= 1024 * 1024) {
        return (safeBytes / (1024 * 1024)).toFixed(2) + " MB";
      }

      if (safeBytes >= 1024) {
        return (safeBytes / 1024).toFixed(1) + " KB";
      }

      return safeBytes + " B";
    }

    function applyTemplateDefaults(template) {
      if (template === "love-lock") {
        if (!titleInput.value.trim()) {
          titleInput.value = "For Your Eyes Only";
        }
        if (!recipientInput.value.trim()) {
          recipientInput.value = "My Love";
        }
        if (!String(pinInput.value || "").trim()) {
          pinInput.value = "2580";
        }
        if (!messageInput.value.trim()) {
          messageInput.value = "This letter is pin-locked for you. Every word here is intentional, private, and written from the heart.";
        }
        closingInput.value = closingInput.value || "With love,";
      }

      if (template === "crt-retro") {
        if (!titleInput.value.trim()) {
          titleInput.value = "Retro TV Memory Reel";
        }
        if (!messageInput.value.trim()) {
          messageInput.value = "CRT slideshow memory page.";
        }
      }

      normalizePinInput();
    }

    function syncTemplateUi() {
      var isLove = activeTemplate === "love-lock";

      if (selectedTemplateLabel) {
        selectedTemplateLabel.textContent = isLove ? "Love Letter (PIN Lock)" : "CRT TV Slideshow";
      }

      if (createPageTitle) {
        createPageTitle.textContent = isLove
          ? "Create your heart's letter."
          : "Build your CRT memory slideshow.";
      }

      if (loveTemplateFields) {
        loveTemplateFields.classList.toggle("hidden", !isLove);
      }

      if (loveTemplateClosingFields) {
        loveTemplateClosingFields.classList.toggle("hidden", !isLove);
      }

      if (crtTemplateFields) {
        crtTemplateFields.classList.toggle("hidden", isLove);
      }

      if (youtubeLabel) {
        youtubeLabel.textContent = isLove ? "YouTube Music Link (Optional)" : "YouTube Music Link (Required)";
      }

      if (youtubeHint) {
        youtubeHint.textContent = isLove
          ? "Optional for Love Letter. You can skip this if you do not want background music."
          : "Required for CRT Slideshow. Use a valid YouTube URL.";
      }

      if (youtubeInput) {
        youtubeInput.required = !isLove;
      }
    }

    function showTemplateChooser() {
      if (templateChooser) {
        templateChooser.classList.remove("hidden");
      }

      if (createEditorShell) {
        createEditorShell.classList.add("hidden");
      }

      if (createPageTitle) {
        createPageTitle.textContent = "Choose your creation template.";
      }
    }

    function showEditorForTemplate(template, shouldApplyDefaults) {
      activeTemplate = normalizeTemplate(template);

      if (templateChooser) {
        templateChooser.classList.add("hidden");
      }

      if (createEditorShell) {
        createEditorShell.classList.remove("hidden");
      }

      if (shouldApplyDefaults) {
        applyTemplateDefaults(activeTemplate);
      }

      writeTemplateToQuery(activeTemplate);
      syncTemplateUi();
      updatePreview();
      updateCostBindings();
    }

    function normalizeCustomPageNameValue(value) {
      return String(value || "")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, CUSTOM_PAGE_NAME_MAX_LENGTH);
    }

    function getCurrentCustomPageName() {
      return normalizeCustomPageNameValue(customPageNameInput ? customPageNameInput.value : "");
    }

    function isCustomPageNameFeatureEnabled() {
      return Boolean(customPageNameToggle && customPageNameToggle.checked);
    }

    function isValidCustomPageName(name) {
      var value = String(name || "").trim();
      var pattern = new RegExp("^[A-Za-z0-9]{" + CUSTOM_PAGE_NAME_MIN_LENGTH + "," + CUSTOM_PAGE_NAME_MAX_LENGTH + "}$");
      return pattern.test(value);
    }

    function getVoucherCodeValue() {
      return String(voucherInput ? voucherInput.value : "").trim();
    }

    function setFieldStatus(node, message, mode) {
      if (!node) {
        return;
      }

      var text = String(message || "").trim();
      var color = "#817476";
      var icon = "";

      if (mode === "good") {
        color = "#15803d";
        icon = "&#10003; ";
      } else if (mode === "bad") {
        color = "#dc2626";
        icon = "&#10005; ";
      }

      node.style.color = color;
      node.innerHTML = (icon ? ("<span aria-hidden=\"true\">" + icon + "</span>") : "") + escapeHtml(text);
    }

    function getBaseDraftCost() {
      if (activeTemplate === "crt-retro") {
        return calculateDraftCredits(activeTemplate, 0, stagedPhotos.length);
      }

      var messageLength = (messageInput.value || "").trim().length;
      return calculateDraftCredits(activeTemplate, messageLength, stagedPhotos.length);
    }

    function getCurrentDraftPricing() {
      var baseCost = getBaseDraftCost();
      var customPageNameEnabled = isCustomPageNameFeatureEnabled();
      var customPageName = customPageNameEnabled ? getCurrentCustomPageName() : "";
      var customPageNameCredits = customPageNameEnabled ? CUSTOM_PAGE_NAME_EXTRA_CREDITS : 0;
      var totalBeforeVoucher = baseCost + customPageNameCredits;
      var voucherCode = getVoucherCodeValue();
      var voucherCheckedForCurrentCode = Boolean(
        voucherCode &&
        voucherState.checkedCode === voucherCode &&
        !voucherState.checking
      );
      var voucherValid = voucherCheckedForCurrentCode && voucherState.valid;
      var voucherEligible = totalBeforeVoucher >= VOUCHER_MINIMUM_REQUIRED_CREDITS;
      var voucherApplied = voucherValid && voucherEligible;
      var voucherDiscountCredits = voucherApplied ? VOUCHER_DISCOUNT_CREDITS : 0;
      var requiredCredits = Math.max(1, totalBeforeVoucher - voucherDiscountCredits);

      return {
        baseCost: baseCost,
        requiredCredits: requiredCredits,
        customPageNameEnabled: customPageNameEnabled,
        customPageName: customPageName,
        customPageNameCredits: customPageNameCredits,
        totalBeforeVoucher: totalBeforeVoucher,
        voucherCode: voucherCode,
        voucherCheckedForCurrentCode: voucherCheckedForCurrentCode,
        voucherValid: voucherValid,
        voucherEligible: voucherEligible,
        voucherApplied: voucherApplied,
        voucherDiscountCredits: voucherDiscountCredits
      };
    }

    function updateCustomPageNameStatusMessage() {
      if (!customPageNameStatus) {
        return;
      }

      var enabled = isCustomPageNameFeatureEnabled();

      if (customPageNameFields) {
        customPageNameFields.classList.toggle("hidden", !enabled);
      }

      if (!enabled) {
        setFieldStatus(customPageNameStatus, "Custom name is off. Default page_###### naming will be used.", "neutral");
        return;
      }

      var customName = getCurrentCustomPageName();

      if (customPageNameInput && customPageNameInput.value !== customName) {
        customPageNameInput.value = customName;
      }

      if (!customName) {
        setFieldStatus(customPageNameStatus, "Enter a custom page name to check availability.", "neutral");
        return;
      }

      if (!isValidCustomPageName(customName)) {
        setFieldStatus(
          customPageNameStatus,
          "Custom name must be " + CUSTOM_PAGE_NAME_MIN_LENGTH + " to " + CUSTOM_PAGE_NAME_MAX_LENGTH + " letters/numbers only.",
          "bad"
        );
        return;
      }

      if (customPageNameState.checking && customPageNameState.checkedName === customName) {
        setFieldStatus(customPageNameStatus, "Checking availability...", "neutral");
        return;
      }

      if (customPageNameState.checkError && customPageNameState.checkedName === customName) {
        setFieldStatus(customPageNameStatus, "Could not check availability right now. You can still try publishing.", "bad");
        return;
      }

      if (customPageNameState.valid && customPageNameState.checkedName === customName) {
        if (customPageNameState.available) {
          setFieldStatus(customPageNameStatus, "Available", "good");
        } else {
          setFieldStatus(customPageNameStatus, "Not available. Pick a different custom page name.", "bad");
        }
        return;
      }

      setFieldStatus(customPageNameStatus, "Waiting to check availability...", "neutral");
    }

    function updateVoucherStatusMessage() {
      if (!voucherStatus) {
        return;
      }

      var pricing = getCurrentDraftPricing();
      var voucherCode = pricing.voucherCode;

      if (!voucherCode) {
        setFieldStatus(voucherStatus, "No voucher entered yet.", "neutral");
        return;
      }

      if (voucherState.checking && voucherState.checkedCode === voucherCode) {
        setFieldStatus(voucherStatus, "Checking voucher...", "neutral");
        return;
      }

      if (voucherState.checkError && voucherState.checkedCode === voucherCode) {
        setFieldStatus(voucherStatus, "Voucher check is unavailable. Publish will still validate server-side.", "bad");
        return;
      }

      if (!pricing.voucherCheckedForCurrentCode) {
        setFieldStatus(voucherStatus, "Waiting to verify voucher code...", "neutral");
        return;
      }

      if (!pricing.voucherValid) {
        setFieldStatus(voucherStatus, "Voucher code is not valid.", "bad");
        return;
      }

      if (!pricing.voucherEligible) {
        setFieldStatus(voucherStatus, "Voucher is valid, but page total must be 2 credits or more.", "bad");
        return;
      }

      setFieldStatus(voucherStatus, "Voucher is active. 1 credit discount will be applied.", "good");
    }

    function updateCostBindings() {
      var pricing = getCurrentDraftPricing();
      var currentCost = pricing.requiredCredits;
      var textLength = activeTemplate === "crt-retro"
        ? (titleInput.value || "").trim().length
        : (messageInput.value || "").trim().length;
      var totalPayloadSize = calculateTotalPhotosPayloadSize();
      var maxAllowedBytes = 900000;
      var payloadExceeded = totalPayloadSize > maxAllowedBytes;

      if (draftCostNode) {
        draftCostNode.textContent = String(currentCost);
      }

      if (draftCharCountNode) {
        draftCharCountNode.textContent = String(textLength);
      }

      if (draftPhotoCountNode) {
        draftPhotoCountNode.textContent = String(stagedPhotos.length);
      }

      if (draftPhotoLimitNode) {
        draftPhotoLimitNode.textContent = String(activeTemplate === "love-lock" ? LOVE_LOCK_FIRST_CREDIT_PHOTOS : PHOTOS_PER_CREDIT);
      }

      if (draftCharLimitNode) {
        draftCharLimitNode.textContent = String(getTemplateCharacterCreditLimit(activeTemplate));
      }

      if (draftTotalPhotoSize) {
        var sizeSpan = draftTotalPhotoSize.querySelector("span");
        if (sizeSpan) {
          sizeSpan.textContent = formatBytes(totalPayloadSize);
        }
        var sizeClass = payloadExceeded ? "text-red-500" : "text-lfu-outline";
        draftTotalPhotoSize.className = "mt-3 text-xs " + sizeClass;
      }

      if (draftPricingHint) {
        var hint = "Base " + pricing.baseCost + " credit" + (pricing.baseCost === 1 ? "" : "s");
        if (pricing.customPageNameEnabled) {
          hint += " + " + CUSTOM_PAGE_NAME_EXTRA_CREDITS + " custom name";
        }

        if (pricing.voucherApplied) {
          hint += " - " + pricing.voucherDiscountCredits + " voucher";
        }

        hint += " = " + pricing.requiredCredits + " credit" + (pricing.requiredCredits === 1 ? "" : "s") + ".";
        draftPricingHint.textContent = hint;
      }

      updateCustomPageNameStatusMessage();
      updateVoucherStatusMessage();

      if (saveButton) {
        var prefix = activeTemplate === "crt-retro" ? "Create CRT Page" : "Save & Generate Link";
        var buttonText = prefix + " (" + currentCost + " Credit" + (currentCost === 1 ? "" : "s") + ")";
        if (payloadExceeded) {
          buttonText += " - Size limit exceeded";
          saveButton.disabled = true;
        } else {
          saveButton.disabled = publishBusy;
        }
        saveButton.textContent = buttonText;
      }
    }

    function runCustomPageNameAvailabilityCheck(customName) {
      var normalizedName = normalizeCustomPageNameValue(customName);

      customPageNameState.checkedName = normalizedName;
      customPageNameState.available = false;
      customPageNameState.valid = false;
      customPageNameState.checking = true;
      customPageNameState.checkError = false;
      updateCustomPageNameStatusMessage();

      if (!firebaseApi || typeof firebaseApi.checkCustomPageNameAvailability !== "function") {
        customPageNameState.checking = false;
        customPageNameState.checkError = true;
        updateCustomPageNameStatusMessage();

        return Promise.resolve({
          pageName: normalizedName,
          valid: true,
          available: true,
          checkError: true
        });
      }

      return firebaseApi.checkCustomPageNameAvailability(normalizedName)
        .then(function (payload) {
          var responseName = normalizeCustomPageNameValue(payload && payload.pageName ? payload.pageName : normalizedName);
          var responseValid = payload && payload.valid === false
            ? false
            : isValidCustomPageName(responseName);

          customPageNameState.checkedName = responseName;
          customPageNameState.valid = responseValid;
          customPageNameState.available = responseValid && Boolean(payload && payload.available);
          customPageNameState.checking = false;
          customPageNameState.checkError = false;
          updateCostBindings();

          return {
            pageName: responseName,
            valid: customPageNameState.valid,
            available: customPageNameState.available,
            checkError: false
          };
        })
        .catch(function () {
          customPageNameState.checkedName = normalizedName;
          customPageNameState.valid = true;
          customPageNameState.available = true;
          customPageNameState.checking = false;
          customPageNameState.checkError = true;
          updateCostBindings();

          return {
            pageName: normalizedName,
            valid: true,
            available: true,
            checkError: true
          };
        });
    }

    function scheduleCustomPageNameAvailabilityCheck() {
      window.clearTimeout(customPageNameCheckTimer);

      if (!isCustomPageNameFeatureEnabled()) {
        customPageNameState.checkedName = "";
        customPageNameState.available = false;
        customPageNameState.valid = false;
        customPageNameState.checking = false;
        customPageNameState.checkError = false;
        updateCostBindings();
        return;
      }

      var customName = getCurrentCustomPageName();

      if (!customName || !isValidCustomPageName(customName)) {
        customPageNameState.checkedName = customName;
        customPageNameState.available = false;
        customPageNameState.valid = false;
        customPageNameState.checking = false;
        customPageNameState.checkError = false;
        updateCostBindings();
        return;
      }

      customPageNameState.checkedName = customName;
      customPageNameState.available = false;
      customPageNameState.valid = true;
      customPageNameState.checking = true;
      customPageNameState.checkError = false;
      updateCustomPageNameStatusMessage();

      var requestToken = ++customPageNameCheckToken;
      customPageNameCheckTimer = window.setTimeout(function () {
        runCustomPageNameAvailabilityCheck(customName)
          .then(function (result) {
            if (requestToken !== customPageNameCheckToken) {
              return;
            }

            if (!result.checkError) {
              updateCostBindings();
            }
          });
      }, 260);
    }

    function runVoucherValidation(code) {
      var normalizedCode = String(code || "").trim();

      voucherState.checkedCode = normalizedCode;
      voucherState.valid = false;
      voucherState.checking = true;
      voucherState.checkError = false;
      updateVoucherStatusMessage();

      if (!firebaseApi || typeof firebaseApi.checkVoucherCode !== "function") {
        voucherState.checking = false;
        voucherState.checkError = true;
        updateVoucherStatusMessage();

        return Promise.resolve({
          code: normalizedCode,
          valid: false,
          checkError: true
        });
      }

      return firebaseApi.checkVoucherCode(normalizedCode)
        .then(function (payload) {
          voucherState.checkedCode = normalizedCode;
          voucherState.valid = Boolean(payload && payload.valid === true);
          voucherState.checking = false;
          voucherState.checkError = false;
          updateCostBindings();

          return {
            code: normalizedCode,
            valid: voucherState.valid,
            checkError: false
          };
        })
        .catch(function () {
          voucherState.checkedCode = normalizedCode;
          voucherState.valid = false;
          voucherState.checking = false;
          voucherState.checkError = true;
          updateCostBindings();

          return {
            code: normalizedCode,
            valid: false,
            checkError: true
          };
        });
    }

    function scheduleVoucherValidation() {
      window.clearTimeout(voucherCheckTimer);

      var code = getVoucherCodeValue();
      if (!code) {
        voucherState.checkedCode = "";
        voucherState.valid = false;
        voucherState.checking = false;
        voucherState.checkError = false;
        updateCostBindings();
        return;
      }

      voucherState.checkedCode = code;
      voucherState.valid = false;
      voucherState.checking = true;
      voucherState.checkError = false;
      updateVoucherStatusMessage();

      var requestToken = ++voucherCheckToken;
      voucherCheckTimer = window.setTimeout(function () {
        runVoucherValidation(code)
          .then(function () {
            if (requestToken !== voucherCheckToken) {
              return;
            }

            updateCostBindings();
          });
      }, 260);
    }

    function ensureCustomPageNameAvailabilityForPublish() {
      if (!isCustomPageNameFeatureEnabled()) {
        return Promise.resolve({ ok: true, customPageName: "", uncertain: false });
      }

      var customName = getCurrentCustomPageName();

      if (!isValidCustomPageName(customName)) {
        updateCostBindings();
        showToast("Custom page name must be 4 to 15 letters or numbers.");
        return Promise.resolve({ ok: false, customPageName: customName, uncertain: false });
      }

      if (
        customPageNameState.checkedName === customName &&
        customPageNameState.valid &&
        customPageNameState.available &&
        !customPageNameState.checkError
      ) {
        return Promise.resolve({ ok: true, customPageName: customName, uncertain: false });
      }

      if (
        customPageNameState.checkedName === customName &&
        customPageNameState.valid &&
        !customPageNameState.available &&
        !customPageNameState.checkError
      ) {
        showToast("Custom page name is already in use.");
        return Promise.resolve({ ok: false, customPageName: customName, uncertain: false });
      }

      return runCustomPageNameAvailabilityCheck(customName)
        .then(function (result) {
          if (!result.valid) {
            showToast("Custom page name format is invalid.");
            return { ok: false, customPageName: customName, uncertain: false };
          }

          if (!result.available && !result.checkError) {
            showToast("Custom page name is already in use.");
            return { ok: false, customPageName: customName, uncertain: false };
          }

          return {
            ok: true,
            customPageName: customName,
            uncertain: Boolean(result.checkError)
          };
        });
    }

    function ensureVoucherValidationForPublish() {
      var voucherCode = getVoucherCodeValue();
      if (!voucherCode) {
        return Promise.resolve({ ok: true, voucherCode: "", uncertain: false });
      }

      if (
        voucherState.checkedCode === voucherCode &&
        !voucherState.checking &&
        !voucherState.checkError
      ) {
        return Promise.resolve({ ok: true, voucherCode: voucherCode, uncertain: false });
      }

      return runVoucherValidation(voucherCode)
        .then(function (result) {
          return {
            ok: true,
            voucherCode: voucherCode,
            uncertain: Boolean(result && result.checkError)
          };
        });
    }

    function ensurePublishOptionsReady() {
      return ensureCustomPageNameAvailabilityForPublish()
        .then(function (customNameResult) {
          if (!customNameResult || !customNameResult.ok) {
            return null;
          }

          return ensureVoucherValidationForPublish()
            .then(function (voucherResult) {
              if (!voucherResult || !voucherResult.ok) {
                return null;
              }

              return {
                customNameUncertain: Boolean(customNameResult.uncertain),
                voucherUncertain: Boolean(voucherResult.uncertain)
              };
            });
        });
    }

    function setPublishBusy(isBusy, statusText) {
      publishBusy = Boolean(isBusy);

      if (saveButton) {
        saveButton.disabled = publishBusy;
      }

      if (saveStatus && typeof statusText === "string" && statusText) {
        saveStatus.textContent = statusText;
      }

      if (!publishBusy) {
        updateCostBindings();
      }
    }

    function collectDraftForm() {
      var youtubeUrl = youtubeInput ? youtubeInput.value.trim() : "";
      var customPageNameEnabled = isCustomPageNameFeatureEnabled();
      var customPageName = customPageNameEnabled ? getCurrentCustomPageName() : "";
      var voucherCode = getVoucherCodeValue();

      if (activeTemplate === "crt-retro") {
        return {
          templateType: "crt-retro",
          title: titleInput.value.trim(),
          recipient: "",
          date: dateInput.value || today,
          pinCode: "",
          message: "",
          closing: "",
          signature: "",
          youtubeUrl: youtubeUrl,
          customPageNameEnabled: customPageNameEnabled,
          customPageName: customPageName,
          voucherCode: voucherCode
        };
      }

      return {
        templateType: "love-lock",
        title: titleInput.value.trim(),
        recipient: recipientInput.value.trim(),
        date: dateInput.value,
        pinCode: String(pinInput.value || "").replace(/\D/g, "").slice(0, 4),
        message: messageInput.value.trim(),
        closing: closingInput.value,
        signature: signatureInput.value.trim() || "Your Name",
        youtubeUrl: youtubeUrl,
        customPageNameEnabled: customPageNameEnabled,
        customPageName: customPageName,
        voucherCode: voucherCode
      };
    }

    function collectDraftPhotosForSave() {
      return stagedPhotos.map(function (photo) {
        return {
          id: photo.id,
          name: photo.name,
          mimeType: photo.mimeType,
          width: photo.width,
          height: photo.height,
          sizeBytes: photo.sizeBytes,
          originalSizeBytes: photo.originalSizeBytes,
          dataUrl: String(photo && photo.dataUrl ? photo.dataUrl : "")
        };
      });
    }

    function calculateTotalPhotosPayloadSize() {
      var totalBytes = 0;
      stagedPhotos.forEach(function (photo) {
        if (photo.dataUrl && typeof photo.dataUrl === "string") {
          totalBytes += photo.dataUrl.length;
        }
      });
      return totalBytes;
    }

    function renderUploadedPhotos() {
      if (!uploadedPhotos) {
        return;
      }

      uploadedPhotos.innerHTML = stagedPhotos.map(function (photo) {
        var reduction = photo.originalSizeBytes > 0
          ? Math.max(0, Math.round((1 - (photo.sizeBytes / photo.originalSizeBytes)) * 100))
          : 0;

        return "" +
          '<article class="l4u-photo-thumb l4u-photo-thumb-rich">' +
          '  <img alt="Compressed memory photo" src="' + escapeHtml(photo.dataUrl) + '" />' +
          '  <button type="button" data-remove-photo="' + escapeHtml(photo.id) + '" class="l4u-photo-remove" aria-label="Remove photo">×</button>' +
          '  <p class="l4u-photo-meta">' + reduction + '% smaller • ' + formatBytes(photo.sizeBytes) + '</p>' +
          '</article>';
      }).join("");
    }

    function renderUploadQueue(statusRows) {
      if (!uploadQueue) {
        return;
      }

      var rows = Array.isArray(statusRows)
        ? statusRows
        : stagedPhotos.map(function (photo) {
          return {
            name: photo.name,
            status: "Compressed to " + formatBytes(photo.sizeBytes)
          };
        });

      if (!rows.length) {
        uploadQueue.innerHTML = "";
        return;
      }

      uploadQueue.innerHTML = rows.map(function (row) {
        return "" +
          '<div class="l4u-upload-row">' +
          '  <span class="l4u-upload-name">' + escapeHtml(row.name) + '</span>' +
          '  <span class="l4u-upload-status">' + escapeHtml(row.status) + '</span>' +
          '</div>';
      }).join("");
    }

    function compressImageFile(file) {
      return new Promise(function (resolve, reject) {
        var allowedTypes = {
          "image/png": true,
          "image/jpeg": true
        };

        if (!file || !file.type || !allowedTypes[String(file.type).toLowerCase()]) {
          reject(new Error("Only PNG and JPG/JPEG files are supported."));
          return;
        }

        var reader = new FileReader();

        reader.onload = function (event) {
          var image = new Image();

          image.onload = function () {
            var maxDimension = 640;
            var sourceWidth = image.width || 1;
            var sourceHeight = image.height || 1;
            var scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
            var targetWidth = Math.max(1, Math.round(sourceWidth * scale));
            var targetHeight = Math.max(1, Math.round(sourceHeight * scale));

            var canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            var ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Canvas is not available."));
              return;
            }

            ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

            canvas.toBlob(function (blob) {
              if (!blob) {
                reject(new Error("Image compression failed."));
                return;
              }

              var compressedReader = new FileReader();
              compressedReader.onload = function (loadEvent) {
                resolve({
                  id: "photo_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
                  name: file.name.replace(/\.[^/.]+$/, "") + ".jpg",
                  mimeType: "image/jpeg",
                  width: targetWidth,
                  height: targetHeight,
                  originalSizeBytes: toInt(file.size, 0),
                  sizeBytes: toInt(blob.size, 0),
                  dataUrl: String(loadEvent.target && loadEvent.target.result ? loadEvent.target.result : "")
                });
              };
              compressedReader.onerror = function () {
                reject(new Error("Compressed image read failed."));
              };
              compressedReader.readAsDataURL(blob);
            }, "image/jpeg", 0.40);
          };

          image.onerror = function () {
            reject(new Error("Invalid image."));
          };

          image.src = String(event.target && event.target.result ? event.target.result : "");
        };

        reader.onerror = function () {
          reject(new Error("File read failed."));
        };

        reader.readAsDataURL(file);
      });
    }

    function updatePreviewPhoto() {
      if (!previewMainPhoto || !previewPhotoPlaceholder) {
        return;
      }

      var firstPhoto = stagedPhotos.length ? stagedPhotos[0] : null;

      if (firstPhoto && firstPhoto.dataUrl) {
        previewMainPhoto.src = firstPhoto.dataUrl;
        previewMainPhoto.classList.remove("hidden");
        previewPhotoPlaceholder.classList.add("hidden");
        return;
      }

      previewMainPhoto.classList.add("hidden");
      previewMainPhoto.removeAttribute("src");
      previewPhotoPlaceholder.classList.add("hidden");
    }

    function stagePhotoBatch(fileList) {
      if (uploadBusy) {
        return;
      }

      var allowedTypes = {
        "image/png": true,
        "image/jpeg": true
      };

      var allFiles = Array.from(fileList || []);

      var files = allFiles.filter(function (file) {
        return file && file.type && allowedTypes[String(file.type).toLowerCase()];
      });

      var skippedUnsupported = Math.max(0, allFiles.length - files.length);

      if (!files.length) {
        if (skippedUnsupported > 0) {
          showToast("Only PNG and JPG/JPEG are allowed. GIF files are not accepted.");
        }
        return;
      }

      var availableSlots = Math.max(0, MAX_PHOTOS - stagedPhotos.length);
      if (!availableSlots) {
        showToast("Maximum of " + MAX_PHOTOS + " photos reached.");
        return;
      }

      var selectedFiles = files.slice(0, availableSlots);
      var queueRows = selectedFiles.map(function (file) {
        return {
          name: file.name,
          status: "Compressing..."
        };
      });

      if (files.length > selectedFiles.length) {
        showToast("Only " + availableSlots + " more photo(s) can be added.");
      }

      if (skippedUnsupported > 0) {
        showToast(skippedUnsupported + " file(s) skipped. Only PNG and JPG/JPEG are allowed.");
      }

      uploadBusy = true;
      if (uploadDropzone) {
        uploadDropzone.classList.add("is-busy");
      }

      renderUploadQueue(queueRows);

      Promise.all(selectedFiles.map(function (file, index) {
        return compressImageFile(file)
          .then(function (compressedPhoto) {
            queueRows[index].status = "Compressed to " + formatBytes(compressedPhoto.sizeBytes);
            renderUploadQueue(queueRows);
            return compressedPhoto;
          })
          .catch(function () {
            queueRows[index].status = "Skipped";
            renderUploadQueue(queueRows);
            return null;
          });
      }))
        .then(function (results) {
          var validPhotos = results.filter(Boolean);

          if (validPhotos.length) {
            stagedPhotos = stagedPhotos.concat(validPhotos);
            
            var maxAllowedBytes = 900000;
            var totalSize = calculateTotalPhotosPayloadSize();
            var removedCount = 0;
            
            while (totalSize > maxAllowedBytes && stagedPhotos.length > 0) {
              stagedPhotos.shift();
              removedCount++;
              totalSize = calculateTotalPhotosPayloadSize();
            }
            
            if (removedCount > 0) {
              showToast("Size limit reached. Removed " + removedCount + " oldest photo(s) to make room for new uploads.");
            }
            
            renderUploadedPhotos();
            renderUploadQueue();
            updatePreview();
            updateCostBindings();
            scheduleAutosave();
            showToast(validPhotos.length + " photo(s) compressed and staged.");
          }
        })
        .finally(function () {
          uploadBusy = false;

          if (uploadDropzone) {
            uploadDropzone.classList.remove("is-busy");
            uploadDropzone.classList.remove("is-dragging");
          }

          if (photoInput) {
            photoInput.value = "";
          }
        });
    }

    function updatePreview() {
      var preview = collectDraftForm();

      var previewTitle = document.getElementById("previewTitle");
      var previewRecipient = document.getElementById("previewRecipient");
      var previewDate = document.getElementById("previewDate");
      var previewMessage = document.getElementById("previewMessage");
      var previewClosing = document.getElementById("previewClosing");
      var previewSignature = document.getElementById("previewSignature");

      if (previewTitle) {
        previewTitle.textContent = preview.title || (activeTemplate === "crt-retro" ? "Untitled CRT Slideshow" : "Untitled Letter");
      }

      if (previewDate) {
        previewDate.textContent = formatDate(preview.date);
      }

      if (activeTemplate === "crt-retro") {
        if (previewRecipient) {
          previewRecipient.textContent = "CRT Slideshow";
        }

        if (previewPinCode) {
          previewPinCode.textContent = isYouTubeUrl(preview.youtubeUrl) ? "MUSIC: LINKED" : "MUSIC: ADD LINK";
        }

        if (previewMessage) {
          var photoText = stagedPhotos.length
            ? stagedPhotos.length + " photo(s) ready for playback."
            : "Upload at least 1 photo to start the slideshow.";
          var musicText = isYouTubeUrl(preview.youtubeUrl)
            ? " YouTube music is linked."
            : " Add a YouTube music URL to continue.";
          previewMessage.textContent = photoText + musicText;
        }

        if (previewClosing) {
          previewClosing.textContent = "Now Playing";
        }

        if (previewSignature) {
          previewSignature.textContent = preview.title || "CRT Memory Reel";
        }
      } else {
        if (previewRecipient) {
          previewRecipient.textContent = preview.recipient ? "Dear " + preview.recipient + "," : "Dear recipient,";
        }

        if (previewPinCode) {
          previewPinCode.textContent = "PIN: " + (/^\d{4}$/.test(preview.pinCode) ? preview.pinCode : "----");
        }

        if (previewMessage) {
          previewMessage.textContent = preview.message || "Start writing your message and your preview will appear here in real time.";
        }

        if (previewClosing) {
          previewClosing.textContent = preview.closing || "With love,";
        }

        if (previewSignature) {
          previewSignature.textContent = preview.signature || "Your Name";
        }
      }

      updatePreviewPhoto();
    }

    var autosaveTimer = null;

    function scheduleAutosave() {
      if (!state.settings.autoSave) {
        return;
      }

      window.clearTimeout(autosaveTimer);
      autosaveTimer = window.setTimeout(function () {
        state.draftForm = collectDraftForm();
        saveState();

        if (saveStatus) {
          saveStatus.textContent = "Auto-saved";
        }
      }, 280);
    }

    [titleInput, recipientInput, dateInput, pinInput, messageInput, closingInput, signatureInput, youtubeInput].forEach(function (inputNode) {
      if (!inputNode) {
        return;
      }

      inputNode.addEventListener("input", function () {
        if (inputNode === pinInput) {
          normalizePinInput();
        }

        updatePreview();
        updateCostBindings();
        scheduleAutosave();
      });
    });

    if (customPageNameToggle) {
      customPageNameToggle.addEventListener("change", function () {
        updateCostBindings();
        scheduleCustomPageNameAvailabilityCheck();
        scheduleAutosave();
      });
    }

    if (customPageNameInput) {
      customPageNameInput.addEventListener("input", function () {
        var normalizedValue = getCurrentCustomPageName();
        if (customPageNameInput.value !== normalizedValue) {
          customPageNameInput.value = normalizedValue;
        }

        scheduleCustomPageNameAvailabilityCheck();
        updateCostBindings();
        scheduleAutosave();
      });
    }

    if (voucherInput) {
      voucherInput.addEventListener("input", function () {
        var normalizedVoucher = String(voucherInput.value || "").trim().slice(0, 40);
        if (voucherInput.value !== normalizedVoucher) {
          voucherInput.value = normalizedVoucher;
        }

        scheduleVoucherValidation();
        updateCostBindings();
        scheduleAutosave();
      });
    }

    function handleTemplateSelection(node) {
      if (!node) {
        return;
      }

      var template = node.getAttribute("data-create-template") || "love-lock";
      showEditorForTemplate(template, true);
    }

    if (templateChooser) {
      templateChooser.addEventListener("click", function (event) {
        var trigger = event.target.closest("[data-create-template]");
        if (!trigger || !templateChooser.contains(trigger)) {
          return;
        }

        handleTemplateSelection(trigger);
      });

      templateChooser.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        var trigger = event.target.closest("[data-template-card]");
        if (!trigger || !templateChooser.contains(trigger)) {
          return;
        }

        event.preventDefault();
        handleTemplateSelection(trigger);
      });
    }

    if (changeTemplateButton) {
      changeTemplateButton.addEventListener("click", function () {
        showTemplateChooser();
      });
    }

    if (photoInput && uploadDropzone && uploadedPhotos) {
      uploadDropzone.addEventListener("click", function () {
        if (uploadBusy) {
          return;
        }
        photoInput.click();
      });

      uploadDropzone.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!uploadBusy) {
            photoInput.click();
          }
        }
      });

      uploadDropzone.addEventListener("dragover", function (event) {
        event.preventDefault();
        if (!uploadBusy) {
          uploadDropzone.classList.add("is-dragging");
        }
      });

      uploadDropzone.addEventListener("dragleave", function () {
        uploadDropzone.classList.remove("is-dragging");
      });

      uploadDropzone.addEventListener("drop", function (event) {
        event.preventDefault();
        uploadDropzone.classList.remove("is-dragging");
        stagePhotoBatch(event.dataTransfer ? event.dataTransfer.files : []);
      });

      photoInput.addEventListener("change", function () {
        stagePhotoBatch(photoInput.files || []);
      });

      uploadedPhotos.addEventListener("click", function (event) {
        var removeButton = event.target.closest("[data-remove-photo]");
        if (!removeButton) {
          return;
        }

        var photoId = removeButton.getAttribute("data-remove-photo");
        stagedPhotos = stagedPhotos.filter(function (photo) {
          return photo.id !== photoId;
        });

        renderUploadedPhotos();
        renderUploadQueue();
        updatePreview();
        updateCostBindings();
        scheduleAutosave();
      });
    }

    saveButton.addEventListener("click", function () {
      if (publishBusy) {
        showToast("Publishing is already in progress.");
        return;
      }

      var draft = collectDraftForm();
      var pricing = getCurrentDraftPricing();
      var requiredCredits = pricing.requiredCredits;

      if (!draft.title) {
        if (saveStatus) {
          saveStatus.textContent = "Add a title before publishing.";
        }
        showToast("A title is required.");
        return;
      }

      if (draft.templateType === "love-lock") {
        if (draft.message.length < 12) {
          if (saveStatus) {
            saveStatus.textContent = "Add at least 12 characters in your love letter message.";
          }
          showToast("Love Letter requires a longer message.");
          return;
        }

        if (!/^\d{4}$/.test(draft.pinCode)) {
          if (saveStatus) {
            saveStatus.textContent = "Pin lock must be exactly 4 numbers.";
          }
          showToast("Add a valid 4-digit pin lock before publishing.");
          return;
        }

        if (draft.youtubeUrl && !isYouTubeUrl(draft.youtubeUrl)) {
          if (saveStatus) {
            saveStatus.textContent = "YouTube link is optional, but must be valid when provided.";
          }
          showToast("Please provide a valid YouTube URL.");
          return;
        }
      }

      if (draft.templateType === "crt-retro") {
        if (!stagedPhotos.length) {
          if (saveStatus) {
            saveStatus.textContent = "CRT slideshow requires at least 1 picture.";
          }
          showToast("Upload at least 1 picture for CRT Slideshow.");
          return;
        }

        if (!isYouTubeUrl(draft.youtubeUrl)) {
          if (saveStatus) {
            saveStatus.textContent = "CRT slideshow requires a valid YouTube music link.";
          }
          showToast("Add a valid YouTube music URL for CRT Slideshow.");
          return;
        }
      }

      if (!hasCloudSession()) {
        if (saveStatus) {
          saveStatus.textContent = "Sign in with Google to publish this page to Firestore.";
        }
        openModal("signin");
        showToast("Sign in first to publish and create a public page.");
        return;
      }

      var totalPayloadSize = calculateTotalPhotosPayloadSize();
      var maxAllowedBytes = 900000;
      if (totalPayloadSize > maxAllowedBytes) {
        if (saveStatus) {
          saveStatus.textContent = "Photos exceed size limit. Current: " + formatBytes(totalPayloadSize) + " (Max: " + formatBytes(maxAllowedBytes) + "). Remove some photos and try again.";
        }
        showToast("Your photos are too large to publish. Remove " + Math.ceil(stagedPhotos.length * 0.3) + "-" + Math.ceil(stagedPhotos.length * 0.5) + " photos and try again.");
        return;
      }

      setPublishBusy(true, "Validating custom name and voucher...");

      ensurePublishOptionsReady()
        .then(function (prepublishOptionState) {
          if (!prepublishOptionState) {
            setPublishBusy(false);
            return;
          }

          draft = collectDraftForm();
          pricing = getCurrentDraftPricing();
          requiredCredits = pricing.requiredCredits;

          if (pricing.customPageNameEnabled && !isValidCustomPageName(pricing.customPageName)) {
            if (saveStatus) {
              saveStatus.textContent = "Custom page name must be 4 to 15 letters or numbers.";
            }
            setPublishBusy(false);
            return;
          }

          var publishPageOptions = {
            customPageNameEnabled: pricing.customPageNameEnabled,
            customPageName: pricing.customPageNameEnabled ? pricing.customPageName : "",
            voucherCode: pricing.voucherCode
          };

          var photosForPublish = collectDraftPhotosForSave();
          var photosForCreditValidation = photosForPublish.map(function (photo, index) {
            return {
              id: String(photo && photo.id ? photo.id : "photo_" + index),
              name: String(photo && photo.name ? photo.name : ""),
              mimeType: String(photo && photo.mimeType ? photo.mimeType : ""),
              width: Math.max(1, toInt(photo && photo.width, 1)),
              height: Math.max(1, toInt(photo && photo.height, 1)),
              sizeBytes: Math.max(0, toInt(photo && photo.sizeBytes, 0))
            };
          });
          var normalizedDraftForPublish = Object.assign({}, draft);

          if (normalizedDraftForPublish.templateType === "crt-retro") {
            normalizedDraftForPublish.recipient = "CRT Audience";
            normalizedDraftForPublish.pinCode = "";
            normalizedDraftForPublish.message = "CRT slideshow with " + photosForPublish.length + " photo(s).";
            normalizedDraftForPublish.closing = "";
            normalizedDraftForPublish.signature = "";
          }

          var publishValidationPayload = {
            templateType: normalizedDraftForPublish.templateType,
            title: normalizedDraftForPublish.title,
            message: normalizedDraftForPublish.message,
            pinCode: normalizedDraftForPublish.pinCode,
            youtubeUrl: normalizedDraftForPublish.youtubeUrl,
            photos: photosForCreditValidation
          };

          function continuePublishFlow() {
            setPublishBusy(true, "Publishing securely...");

            startSavingFlow(function () {
              var now = Date.now();
              var targetPageId = pricing.customPageNameEnabled
                ? pricing.customPageName
                : ("page_" + now);

              var draftRecord = Object.assign({}, draft, {
                id: targetPageId,
                createdAt: new Date(now).toISOString(),
                createdAtMs: now,
                updatedAtMs: now,
                creditsUsed: requiredCredits,
                photos: photosForPublish
              });

              draftRecord = Object.assign({}, draftRecord, normalizedDraftForPublish);
              draftRecord.id = targetPageId;

              state.draftForm = draft;

              saveState();
              refreshBindings();
              emitStateUpdated();

              if (saveStatus) {
                saveStatus.textContent = "Publishing via Cloud Functions...";
              }

              return firebaseApi.savePage(state.userUid, draftRecord, {
                publishPayload: publishValidationPayload,
                pageOptions: publishPageOptions
              })
                .then(function (saveResult) {
                  var nextCredits = Number.isFinite(Number(saveResult && saveResult.credits))
                    ? Math.max(0, toInt(saveResult.credits, state.credits))
                    : Math.max(0, toInt(state.credits, 0));
                  var consumedCredits = Number.isFinite(Number(saveResult && saveResult.requiredCredits))
                    ? Math.max(1, toInt(saveResult.requiredCredits, requiredCredits))
                    : requiredCredits;

                  if (saveResult && saveResult.id) {
                    draftRecord.id = String(saveResult.id);
                  }

                  draftRecord.creditsUsed = consumedCredits;

                  if (nextCredits !== state.credits) {
                    state.credits = nextCredits;
                    saveState();
                    refreshBindings();
                    emitStateUpdated();
                  }

                  if (saveStatus) {
                    saveStatus.textContent = "Preparing your success card...";
                  }

                  return showPublishedModal(draftRecord, true, {
                    waitForAssets: true
                  });
                })
                .then(function () {
                  if (saveStatus) {
                    saveStatus.textContent = "Published to Firestore.";
                  }

                  setPublishBusy(false);
                })
                .catch(function (error) {
                  var isPayloadTooLarge = Boolean(error && error.code === "PAGE_PAYLOAD_TOO_LARGE");
                  var isInsufficientCredits = Boolean(error && error.code === "INSUFFICIENT_CREDITS");
                  var isCustomNameTaken = Boolean(error && error.code === "CUSTOM_PAGE_NAME_TAKEN");
                  var isCustomNameValidation = Boolean(error && (
                    error.code === "INVALID_CUSTOM_PAGE_NAME" ||
                    error.code === "CUSTOM_PAGE_NAME_REQUIRED" ||
                    error.code === "CUSTOM_PAGE_NAME_FLAG_REQUIRED"
                  ));
                  var isValidationFailure = Boolean(error && (
                    error.code === "INVALID_PUBLISH_PAYLOAD" ||
                    error.code === "INVALID_LOVE_LOCK_MESSAGE" ||
                    error.code === "INVALID_PIN_CODE" ||
                    error.code === "INVALID_YOUTUBE_URL" ||
                    error.code === "CRT_PHOTO_REQUIRED" ||
                    error.code === "CRT_YOUTUBE_REQUIRED" ||
                    error.code === "INVALID_CREDIT_COST" ||
                    isCustomNameValidation
                  ));

                  if (isInsufficientCredits) {
                    var availableCredits = Number.isFinite(Number(error && error.availableCredits))
                      ? Math.max(0, toInt(error.availableCredits, state.credits))
                      : Math.max(0, toInt(state.credits, 0));
                    var requiredFromError = Number.isFinite(Number(error && error.requiredCredits))
                      ? Math.max(1, toInt(error.requiredCredits, requiredCredits))
                      : requiredCredits;

                    state.credits = availableCredits;
                    saveState();
                    refreshBindings();
                    emitStateUpdated();
                    showLowCredits(requiredFromError, availableCredits);

                    if (saveStatus) {
                      saveStatus.textContent = "Not enough credits. Required " + requiredFromError + ", available " + availableCredits + ".";
                    }

                    setPublishBusy(false);
                    return;
                  }

                  if (isCustomNameTaken) {
                    if (saveStatus) {
                      saveStatus.textContent = "Custom page name is not available. Please choose another name.";
                    }

                    showToast("Custom page name is already taken.");
                    customPageNameState.checkedName = getCurrentCustomPageName();
                    customPageNameState.valid = true;
                    customPageNameState.available = false;
                    customPageNameState.checking = false;
                    customPageNameState.checkError = false;
                    updateCostBindings();
                    setPublishBusy(false);
                    return;
                  }

                  if (saveStatus) {
                    saveStatus.textContent = isPayloadTooLarge
                      ? "Photos are too large for this publish request. Reduce total photo size and try again."
                      : (isValidationFailure
                        ? "Publish validation failed. Please review your content and try again."
                        : "Could not publish to Firestore. Please try again.");
                  }

                  showToast(isPayloadTooLarge
                    ? "Upload payload too large. Keep photos under the total size limit and try again."
                    : (isValidationFailure
                      ? "Publish validation failed. Please review your content and try again."
                      : "Publish failed. No public page was created."));

                  setPublishBusy(false);
                });
            });
          }

          setPublishBusy(true, "Syncing server credit balance...");

          firebaseApi.ensureUserRecord(
            {
              uid: state.userUid,
              displayName: state.userName || (state.settings && state.settings.displayName ? state.settings.displayName : "Writer"),
              email: ""
            },
            0
          )
            .then(function (profile) {
              var previousCredits = Math.max(0, toInt(state.credits, 0));
              var syncedCredits = profile && typeof profile.credits === "number"
                ? Math.max(0, toInt(profile.credits, previousCredits))
                : previousCredits;
              var shouldSkipClientCreditGate = Boolean(prepublishOptionState && prepublishOptionState.voucherUncertain);

              state.credits = syncedCredits;
              saveState();
              refreshBindings();
              emitStateUpdated();

              if (syncedCredits !== previousCredits) {
                showToast("Credits synced from server: " + syncedCredits + ".");
              }

              if (!shouldSkipClientCreditGate && syncedCredits < requiredCredits) {
                showLowCredits(requiredCredits, syncedCredits);
                if (saveStatus) {
                  saveStatus.textContent = "Not enough credits. Required " + requiredCredits + ", available " + syncedCredits + ".";
                }
                setPublishBusy(false);
                return;
              }

              continuePublishFlow();
            })
            .catch(function (error) {
              setPublishBusy(false);

              if (error && error.code === "AUTH_REQUIRED") {
                openModal("signin");
                showToast("Sign in again to sync your server credits.");
                if (saveStatus) {
                  saveStatus.textContent = "Session expired. Sign in again.";
                }
                return;
              }

              showToast("Could not sync credits from server. Please try again.");
              if (saveStatus) {
                saveStatus.textContent = "Could not sync server credits.";
              }
            });
        })
        .catch(function () {
          setPublishBusy(false);
          showToast("Could not validate page options. Please try again.");
          if (saveStatus) {
            saveStatus.textContent = "Could not validate custom options.";
          }
        });
    });

    var queryParams = new URLSearchParams(window.location.search);
    var pageMode = String(queryParams.get("mode") || "").toLowerCase();
    var templateFromState = isValidTemplate(draftForm.templateType) ? draftForm.templateType : "";
    var templateFromQuery = getTemplateFromQuery();

    if (pageMode === "edit") {
      showEditorForTemplate(templateFromQuery || templateFromState || "love-lock", false);
    } else {
      showTemplateChooser();
    }

    renderUploadedPhotos();
    renderUploadQueue();
    updatePreview();
    updateCostBindings();
    scheduleCustomPageNameAvailabilityCheck();
    scheduleVoucherValidation();
    scheduleAutosave();
    refreshBindings();
    ensureCreateEntrySupportGate();
    document.addEventListener("l4u:state-updated", ensureCreateEntrySupportGate);
  }

  function initMyPages() {
    var listNode = document.getElementById("draftList");
    var searchNode = document.getElementById("draftSearch");

    if (!listNode) {
      return;
    }

    function renderList() {
      var query = (searchNode ? searchNode.value : "").toLowerCase().trim();

      var filtered = state.drafts.filter(function (draft) {
        if (!query) {
          return true;
        }

        var text = (draft.title + " " + draft.recipient + " " + draft.message).toLowerCase();
        return text.indexOf(query) !== -1;
      });

      if (!filtered.length) {
        listNode.innerHTML = "" +
          '<div class="l4u-empty rounded-3xl p-8 text-center">' +
          '  <p class="font-headline text-xl font-bold text-lfu-primary">No pages found</p>' +
          '  <p class="mt-2 text-sm text-lfu-outline">Publish your first letter from the Create page.</p>' +
          '  <a href="' + routeTo("create.html") + '" class="mt-5 inline-flex rounded-full bg-lfu-primary px-5 py-3 text-xs font-bold uppercase tracking-[0.1em] text-white">Open Create</a>' +
          '</div>';
        return;
      }

      listNode.innerHTML = filtered.map(function (draft) {
        return "" +
          '<article class="l4u-surface-glass l4u-my-pages-card rounded-3xl p-5">' +
          '  <div class="flex flex-wrap items-start justify-between gap-3 l4u-my-pages-card-head">' +
          '    <div class="l4u-my-pages-card-main">' +
          '      <p class="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-lfu-outline">' + formatDate(draft.date || draft.createdAt) + '</p>' +
          '      <h3 class="mt-1 font-headline text-xl font-bold text-lfu-primary l4u-my-pages-card-title">' + escapeHtml(draft.title || "Untitled") + '</h3>' +
          '      <p class="text-sm text-lfu-muted l4u-my-pages-card-recipient">' + escapeHtml(draft.recipient || "No recipient") + '</p>' +
          '    </div>' +
          '    <div class="flex flex-wrap items-center justify-end gap-2 l4u-my-pages-card-actions">' +
          '      <button type="button" data-draft-action="edit" data-draft-id="' + escapeHtml(draft.id) + '" class="rounded-full bg-lfu-primary-soft px-4 py-2 text-[0.66rem] font-bold uppercase tracking-[0.1em] text-lfu-primary">Edit</button>' +
          '      <button type="button" data-draft-action="copy-link" data-draft-id="' + escapeHtml(draft.id) + '" class="rounded-full bg-lfu-primary-soft px-4 py-2 text-[0.66rem] font-bold uppercase tracking-[0.1em] text-lfu-primary">Copy Link</button>' +
          '      <button type="button" data-draft-action="show-qr" data-draft-id="' + escapeHtml(draft.id) + '" class="rounded-full bg-lfu-primary-soft px-4 py-2 text-[0.66rem] font-bold uppercase tracking-[0.1em] text-lfu-primary">Show QR</button>' +
          '      <button type="button" data-draft-action="delete" data-draft-id="' + escapeHtml(draft.id) + '" class="rounded-full bg-white px-4 py-2 text-[0.66rem] font-bold uppercase tracking-[0.1em] text-lfu-outline">Delete</button>' +
          '    </div>' +
          '  </div>' +
          '  <p class="mt-4 max-h-20 overflow-hidden text-sm text-lfu-outline l4u-my-pages-card-message">' + escapeHtml((draft.message || "").slice(0, 220)) + '</p>' +
          '</article>';
      }).join("");
    }

    if (searchNode) {
      searchNode.addEventListener("input", renderList);
    }

    document.addEventListener("l4u:state-updated", renderList);

    listNode.addEventListener("click", function (event) {
      var target = event.target.closest("[data-draft-action]");
      if (!target) {
        return;
      }

      var action = target.getAttribute("data-draft-action");
      var draftId = target.getAttribute("data-draft-id");
      var foundDraft = state.drafts.find(function (draft) {
        return draft.id === draftId;
      });

      if (action === "copy-link") {
        if (!foundDraft) {
          return;
        }

        var sharePayload = buildDraftSharePayload(foundDraft);
        copyToClipboard(sharePayload.shareLink)
          .then(function () {
            showToast("Share link copied.");
          })
          .catch(function () {
            showToast("Could not copy link automatically.");
          });
        return;
      }

      if (action === "show-qr") {
        if (!foundDraft) {
          return;
        }

        showPublishedModal(foundDraft, true, {
          title: "Share this page",
          subtitle: "Copy the link or scan this QR code to share your published page.",
          silentToast: true
        });
        return;
      }

      if (action === "delete") {
        function removeLocalDraft() {
          state.drafts = state.drafts.filter(function (draft) {
            return draft.id !== draftId;
          });

          saveState();
          refreshBindings();
          emitStateUpdated();
          renderList();
          showToast("Page removed.");
        }

        if (hasCloudSession()) {
          firebaseApi.deletePage(draftId)
            .then(function () {
              removeLocalDraft();
            })
            .catch(function () {
              showToast("Could not delete page from Firestore.");
            });
          return;
        }

        removeLocalDraft();
        return;
      }

      if (action === "edit") {
        if (!foundDraft) {
          return;
        }

        state.draftForm = {
          templateType: foundDraft.templateType || "love-lock",
          title: foundDraft.title || "",
          recipient: foundDraft.recipient || "",
          date: foundDraft.date || "",
          pinCode: foundDraft.pinCode || "",
          message: foundDraft.message || "",
          closing: foundDraft.closing || "With love,",
          signature: foundDraft.signature || "Your Name",
          youtubeUrl: foundDraft.youtubeUrl || ""
        };

        saveState();
        window.location.href = routeTo("create.html") + "?mode=edit&template=" + encodeURIComponent(state.draftForm.templateType || "love-lock");
      }
    });

    renderList();
    refreshBindings();
  }

  function initShop() {
    var statusNode = document.getElementById("shopStatus");
    var summaryNode = document.getElementById("manualPackSummary");
    var manualStatusNode = document.getElementById("manualPaymentStatus");
    var uidNode = document.getElementById("manualCheckoutUid");
    var copyUidButton = document.getElementById("manualCopyUidButton");
    var currencyButtons = document.querySelectorAll("[data-currency-toggle]");
    var priceNodes = document.querySelectorAll("[data-shop-price]");

    function applyShopCurrency(currency) {
      var activeCurrency = currency === "usd" ? "usd" : "php";

      priceNodes.forEach(function (node) {
        var phpPrice = node.getAttribute("data-price-php") || "";
        var usdPrice = node.getAttribute("data-price-usd") || phpPrice;
        node.textContent = activeCurrency === "usd" ? usdPrice : phpPrice;
      });

      document.querySelectorAll("[data-buy-pack]").forEach(function (button) {
        var phpPrice = button.getAttribute("data-pack-price-php") || button.getAttribute("data-pack-price") || "";
        var usdPrice = button.getAttribute("data-pack-price-usd") || phpPrice;
        button.setAttribute("data-pack-price", activeCurrency === "usd" ? usdPrice : phpPrice);
      });

      if (pendingPack && pendingPack.label) {
        var selectedButton = document.querySelector('[data-buy-pack][data-pack-label="' + pendingPack.label + '"]');
        if (selectedButton) {
          pendingPack.price = selectedButton.getAttribute("data-pack-price") || pendingPack.price;
          if (summaryNode) {
            summaryNode.textContent = "Selected pack: " + pendingPack.label + " (" + pendingPack.credits + " credits, " + pendingPack.price + ").";
          }
        }
      }

      currencyButtons.forEach(function (button) {
        var isActive = button.getAttribute("data-currency-toggle") === activeCurrency;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function updateManualCheckoutIdentity() {
      if (uidNode) {
        uidNode.textContent = state.signedIn && state.userUid ? state.userUid : "Not signed in";
      }

      if (copyUidButton) {
        copyUidButton.disabled = !(state.signedIn && state.userUid);
      }
    }

    if (copyUidButton) {
      copyUidButton.addEventListener("click", function () {
        var uidValue = state.signedIn && state.userUid ? state.userUid : "";

        if (!uidValue) {
          if (manualStatusNode) {
            manualStatusNode.textContent = "Sign in first so your UID appears here.";
          }
          openModal("signin");
          return;
        }

        copyToClipboard(uidValue)
          .then(function () {
            if (manualStatusNode) {
              manualStatusNode.textContent = "UID copied. Send it with your selected pack.";
            }
            showToast("UID copied.");
          })
          .catch(function () {
            if (manualStatusNode) {
              manualStatusNode.textContent = "Could not copy UID automatically.";
            }
          });
      });
    }

    document.addEventListener("l4u:state-updated", updateManualCheckoutIdentity);

    document.querySelectorAll("[data-buy-pack]").forEach(function (button) {
      button.addEventListener("click", function () {
        pendingPack = {
          label: button.getAttribute("data-pack-label"),
          credits: Number(button.getAttribute("data-pack-credits")),
          price: button.getAttribute("data-pack-price")
        };

        if (summaryNode) {
          summaryNode.textContent = "Selected pack: " + pendingPack.label + " (" + pendingPack.credits + " credits, " + pendingPack.price + ").";
        }

        if (manualStatusNode) {
          manualStatusNode.textContent = state.signedIn && state.userUid
            ? "Copy your UID, then message one of the contacts to buy this pack."
            : "Sign in first, then copy your UID and message one of the contacts.";
        }

        updateManualCheckoutIdentity();
        openModal("manual-payment");
        if (statusNode) {
          statusNode.textContent = "Manual checkout opened. Send your UID to confirm your purchase.";
        }
      });
    });

    currencyButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        applyShopCurrency(button.getAttribute("data-currency-toggle"));
      });
    });

    applyShopCurrency("php");

    updateManualCheckoutIdentity();

    refreshBindings();
  }

  function initSettings() {
    var form = document.getElementById("settingsForm");
    var displayNameInput = document.getElementById("settingDisplayName");
    var darkModeInput = document.getElementById("settingDarkMode");
    var autosaveInput = document.getElementById("settingAutosave");
    var digestInput = document.getElementById("settingDigest");
    var uidNode = document.getElementById("settingAccountUid");
    var copyUidButton = document.getElementById("copyAccountUidButton");
    var statusNode = document.getElementById("settingsStatus");
    var signOutButton = document.getElementById("signOutButton");

    if (!form || !displayNameInput || !darkModeInput || !autosaveInput || !digestInput) {
      return;
    }

    displayNameInput.value = state.settings.displayName || state.userName;
    darkModeInput.checked = Boolean(state.settings.darkMode);
    autosaveInput.checked = Boolean(state.settings.autoSave);
    digestInput.checked = Boolean(state.settings.weeklyDigest);

    function updateUidDisplay() {
      if (!uidNode) {
        return;
      }

      uidNode.textContent = state.signedIn && state.userUid ? state.userUid : "Not signed in";

      if (copyUidButton) {
        copyUidButton.disabled = !(state.signedIn && state.userUid);
      }
    }

    function applySettingsFromInputs() {
      state.settings.displayName = displayNameInput.value.trim() || "Guest";
      state.settings.darkMode = darkModeInput.checked;
      state.settings.autoSave = autosaveInput.checked;
      state.settings.weeklyDigest = digestInput.checked;

      if (state.signedIn) {
        state.userName = state.settings.displayName;
      }

      saveState();
      refreshBindings();
      emitStateUpdated();

      if (hasCloudSession()) {
        firebaseApi.updateUserProfile(state.userUid, {
          displayName: state.settings.displayName
        }).catch(function () {
          if (statusNode) {
            statusNode.textContent = "Saved locally. Cloud profile update failed.";
          }
        });
      }

      if (statusNode) {
        statusNode.textContent = "Preferences auto-saved.";
      }
    }

    var autoSaveTimer = null;

    function scheduleAutoSave(delayMs) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = window.setTimeout(function () {
        applySettingsFromInputs();
      }, Math.max(0, toInt(delayMs, 200)));
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      scheduleAutoSave(0);
    });

    displayNameInput.addEventListener("input", function () {
      scheduleAutoSave(250);
    });

    [darkModeInput, autosaveInput, digestInput].forEach(function (inputNode) {
      inputNode.addEventListener("change", function () {
        scheduleAutoSave(0);
      });
    });

    document.addEventListener("l4u:state-updated", updateUidDisplay);

    if (copyUidButton) {
      copyUidButton.addEventListener("click", function () {
        var uidValue = state.signedIn && state.userUid ? state.userUid : "";

        if (!uidValue) {
          if (statusNode) {
            statusNode.textContent = "Sign in first to copy your UID.";
          }
          return;
        }

        copyToClipboard(uidValue)
          .then(function () {
            if (statusNode) {
              statusNode.textContent = "Account UID copied.";
            }
            showToast("UID copied.");
          })
          .catch(function () {
            if (statusNode) {
              statusNode.textContent = "Could not copy UID automatically.";
            }
          });
      });
    }

    if (signOutButton) {
      signOutButton.addEventListener("click", function () {
        if (firebaseSyncEnabled && firebaseApi) {
          firebaseApi.signOutUser().catch(function () {
            showToast("Sign-out failed. Please try again.");
          });
          return;
        }

        handleSignedOutState(true);
      });
    }

    updateUidDisplay();

    if (statusNode) {
      statusNode.textContent = "Auto-save is enabled for this page.";
    }

    refreshBindings();
  }

  function initStatesPage() {
    var savingButton = document.getElementById("stateSavingButton");
    var creditsButton = document.getElementById("stateLowCreditsButton");
    var successButton = document.getElementById("stateSuccessButton");
    var resetButton = document.getElementById("stateResetButton");
    var snapshotNode = document.getElementById("stateSnapshot");

    function renderSnapshot() {
      if (!snapshotNode) {
        return;
      }

      snapshotNode.textContent =
        "Signed In: " + state.signedIn +
        " | Credits: " + state.credits +
        " | Drafts: " + state.drafts.length +
        " | Public users: " + Math.max(0, toInt(state.publicStats.users, 0)) +
        " | Public pages: " + Math.max(0, toInt(state.publicStats.pages, 0)) +
        " | Sync: " + (firebaseSyncEnabled ? "Firebase" : "Local");
    }

    if (savingButton) {
      savingButton.addEventListener("click", function () {
        startSavingFlow(function () {
          setSuccessMessage("Saving animation completed.");
        });
      });
    }

    if (creditsButton) {
      creditsButton.addEventListener("click", function () {
        showLowCredits(5);
      });
    }

    if (successButton) {
      successButton.addEventListener("click", function () {
        setSuccessMessage("Success modal opened from States page.");
      });
    }

    if (resetButton) {
      resetButton.addEventListener("click", function () {
        state = cloneDefaultState();
        saveState();
        refreshBindings();
        emitStateUpdated();
        renderSnapshot();
        showToast("Demo state reset.");
      });
    }

    document.addEventListener("l4u:state-updated", renderSnapshot);

    renderSnapshot();
    refreshBindings();
  }

  function copyToClipboard(text) {
    if (!text) {
      return Promise.resolve();
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve) {
      var helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "readonly");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      document.body.removeChild(helper);
      resolve();
    });
  }

  function buildQuickShareMessage(shareTitle, shareLink) {
    var title = String(shareTitle || "").trim();
    var link = String(shareLink || "").trim();

    if (!title) {
      return link;
    }

    return title + " " + link;
  }

  function buildFacebookShareQuote(shareTitle) {
    var title = String(shareTitle || "").trim();
    if (!title) {
      title = "A Letter4U page";
    }

    return "I just created \"" + title + "\" on Letter4U. Check it out:";
  }

  function openQuickShareTarget(target, shareLink, shareTitle) {
    var normalizedTarget = String(target || "").trim().toLowerCase();
    var normalizedLink = String(shareLink || "").trim();
    var normalizedTitle = String(shareTitle || "A Letter4U page for you").trim();

    if (!normalizedLink) {
      showToast("Share link is not ready yet.");
      return;
    }

    var shareMessage = buildQuickShareMessage(normalizedTitle, normalizedLink);
    var encodedLink = encodeURIComponent(normalizedLink);
    var encodedTitle = encodeURIComponent(normalizedTitle);
    var encodedMessage = encodeURIComponent(shareMessage);

    function openExternalShare(url) {
      if (!url) {
        return false;
      }

      if (/^(mailto:|sms:)/i.test(url)) {
        window.location.href = url;
        return true;
      }

      var popup = window.open(url, "_blank", "noopener,noreferrer");
      return Boolean(popup);
    }

    if (normalizedTarget === "more") {
      if (navigator.share && typeof navigator.share === "function") {
        navigator.share({
          title: normalizedTitle,
          text: shareMessage,
          url: normalizedLink
        }).catch(function () {
          copyToClipboard(normalizedLink)
            .then(function () {
              showToast("Share link copied.");
            })
            .catch(function () {
              showToast("Could not copy link automatically.");
            });
        });
        return;
      }

      copyToClipboard(normalizedLink)
        .then(function () {
          showToast("Share link copied.");
        })
        .catch(function () {
          showToast("Could not copy link automatically.");
        });
      return;
    }

    if (normalizedTarget === "tiktok") {
      copyToClipboard(normalizedLink)
        .then(function () {
          showToast("Link copied. Paste it in TikTok to share.");
        })
        .catch(function () {
          showToast("Open TikTok and paste your share link.");
        });

      openExternalShare("https://www.tiktok.com/");
      return;
    }

    if (normalizedTarget === "messenger") {
      if (navigator.share && typeof navigator.share === "function") {
        navigator.share({
          title: normalizedTitle,
          text: shareMessage,
          url: normalizedLink
        }).catch(function () {
          var openedMessenger = openExternalShare("https://www.messenger.com/");

          copyToClipboard(normalizedLink)
            .then(function () {
              if (openedMessenger) {
                showToast("Link copied. Paste it in Messenger chat.");
                return;
              }
              showToast("Link copied for Messenger.");
            })
            .catch(function () {
              showToast("Open Messenger and paste your share link.");
            });
        });
        return;
      }

      var openedMessengerFallback = openExternalShare("https://www.messenger.com/");
      copyToClipboard(normalizedLink)
        .then(function () {
          if (openedMessengerFallback) {
            showToast("Link copied. Paste it in Messenger chat.");
            return;
          }

          showToast("Link copied for Messenger.");
        })
        .catch(function () {
          showToast("Open Messenger and paste your share link.");
        });
      return;
    }

    var shareHref = "";

    if (normalizedTarget === "facebook") {
      var facebookQuote = buildFacebookShareQuote(normalizedTitle);
      shareHref = "https://www.facebook.com/sharer/sharer.php?u=" + encodedLink + "&quote=" + encodeURIComponent(facebookQuote);
    } else if (normalizedTarget === "email") {
      shareHref = "mailto:?subject=" + encodedTitle + "&body=" + encodedMessage;
    } else if (normalizedTarget === "message") {
      shareHref = "sms:?&body=" + encodedMessage;
    } else if (normalizedTarget === "whatsapp") {
      shareHref = "https://wa.me/?text=" + encodedMessage;
    } else if (normalizedTarget === "telegram") {
      shareHref = "https://t.me/share/url?url=" + encodedLink + "&text=" + encodedTitle;
    }

    if (!openExternalShare(shareHref)) {
      showToast("Pop-up blocked. Allow pop-ups to continue sharing.");
    }
  }

  function wireGlobalEvents() {
    document.addEventListener("click", function (event) {
      var openTrigger = event.target.closest("[data-open-modal]");
      if (openTrigger) {
        event.preventDefault();
        openModal(openTrigger.getAttribute("data-open-modal"));
        return;
      }

      var closeTrigger = event.target.closest("[data-close-modal]");
      if (closeTrigger) {
        event.preventDefault();
        var parentModal = closeTrigger.closest(".l4u-modal");
        if (parentModal) {
          closeModal(parentModal.getAttribute("data-modal"));
        }
        return;
      }

      var linkNode = event.target.closest("a[href]");
      if (shouldShowPageLoaderForNavigation(linkNode, event)) {
        event.preventDefault();
        clearPageNavigationTimer();
        showPageLoader();

        pageNavigationTimer = window.setTimeout(function () {
          pageNavigationTimer = 0;
          window.requestAnimationFrame(function () {
            window.location.assign(linkNode.href);
          });
        }, 48);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Tab") {
        var activeModal = document.querySelector(".l4u-modal.is-open");

        if (activeModal) {
          var focusableNodes = getFocusableModalElements(activeModal);

          if (!focusableNodes.length) {
            event.preventDefault();
            activeModal.focus({ preventScroll: true });
            return;
          }

          var firstFocusable = focusableNodes[0];
          var lastFocusable = focusableNodes[focusableNodes.length - 1];
          var activeElement = document.activeElement;

          if (!activeModal.contains(activeElement)) {
            event.preventDefault();
            firstFocusable.focus({ preventScroll: true });
            return;
          }

          if (event.shiftKey && activeElement === firstFocusable) {
            event.preventDefault();
            lastFocusable.focus({ preventScroll: true });
            return;
          }

          if (!event.shiftKey && activeElement === lastFocusable) {
            event.preventDefault();
            firstFocusable.focus({ preventScroll: true });
            return;
          }
        }
      }

      if (event.key === "Escape") {
        closeTopModal();
      }
    });

    window.addEventListener("pageshow", function () {
      maybeAutoOpenTikTokBrowserWarning();
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        maybeAutoOpenTikTokBrowserWarning();
      }
    });

    window.addEventListener("beforeunload", function () {
      showPageLoader();
      clearPageNavigationTimer();
    });

    var signInButton = document.getElementById("completeSigninButton");
    var termsScroll = document.getElementById("signinTermsScroll");
    var termsAgreement = document.getElementById("signinTermsAgreement");
    var consentStatus = document.getElementById("signinConsentStatus");
    var tiktokBrowserOpenExternalButton = document.getElementById("tiktokBrowserOpenExternalButton");
    var tiktokBrowserCopyLinkButton = document.getElementById("tiktokBrowserCopyLinkButton");
    var tiktokBrowserCopyFeedback = document.getElementById("tiktokBrowserCopyFeedback");

    function hasScrolledToTermsBottom() {
      if (!termsScroll) {
        return true;
      }

      return termsScroll.scrollTop + termsScroll.clientHeight >= termsScroll.scrollHeight - 8;
    }

    function updateSigninButtonState() {
      if (!signInButton) {
        return;
      }

      var termsReady = hasScrolledToTermsBottom();

      if (termsAgreement) {
        termsAgreement.disabled = !termsReady;

        if (!termsReady) {
          termsAgreement.checked = false;
        }
      }

      var consentGiven = Boolean(termsReady && termsAgreement && termsAgreement.checked);
      signInButton.disabled = !consentGiven;

      if (consentStatus) {
        if (!termsReady) {
          consentStatus.textContent = "Scroll to the bottom of the Terms and Privacy Policy to enable agreement.";
        } else {
          consentStatus.textContent = consentGiven
            ? "Ready to continue with Google."
            : "Check the agreement box to continue.";
        }
      }
    }

    if (termsScroll) {
      termsScroll.addEventListener("scroll", updateSigninButtonState);
    }

    if (termsAgreement) {
      termsAgreement.addEventListener("change", updateSigninButtonState);
    }

    updateSigninButtonState();

    if (signInButton) {
      signInButton.addEventListener("click", function () {
        if (!termsAgreement || termsAgreement.disabled || !termsAgreement.checked) {
          updateSigninButtonState();
          return;
        }

        if (isTikTokInAppBrowser()) {
          closeModal("signin");
          openModal("tiktok-browser-warning");
          return;
        }

        if (firebaseSyncEnabled && firebaseApi) {
          signInButton.disabled = true;

          if (consentStatus) {
            consentStatus.textContent = "Opening Google sign-in...";
          }

          firebaseApi.signInWithGoogle()
            .then(function () {
              closeModal("signin");
            })
            .catch(function (error) {
              if (isLikelyPopupBlockedInAppError(error)) {
                closeModal("signin");
                openModal("tiktok-browser-warning");
                return;
              }

              showToast("Google sign-in failed: " + (error && error.message ? error.message : "unknown error"));
            })
            .finally(function () {
              updateSigninButtonState();
            });

          return;
        }

        var fallbackName = state.settings.displayName && state.settings.displayName.trim()
          ? state.settings.displayName.trim()
          : "Writer";

        state.signedIn = true;
        state.isAdmin = false;
        state.userName = fallbackName;
        state.settings.displayName = fallbackName;

        saveState();
        refreshBindings();
        emitStateUpdated();
        closeModal("signin");
        setSuccessMessage("Signed in as " + fallbackName + ".");
        updateSigninButtonState();
      });
    }

    if (tiktokBrowserOpenExternalButton) {
      tiktokBrowserOpenExternalButton.addEventListener("click", function () {
        var currentUrl = String(window.location.href || "");
        var targetUrl = String(tiktokBrowserOpenExternalButton.getAttribute("data-target-url") || currentUrl || "");
        var opened = false;

        try {
          opened = Boolean(window.open(targetUrl, "_blank", "noopener,noreferrer"));
        } catch (_error) {
          opened = false;
        }

        if (tiktokBrowserCopyFeedback) {
          tiktokBrowserCopyFeedback.textContent = opened
            ? "If it still opened inside TikTok, copy the link and paste it in Chrome or Safari."
            : "Could not open a new tab automatically. Copy the link and paste it in Chrome or Safari.";
        }
      });
    }

    if (tiktokBrowserCopyLinkButton) {
      tiktokBrowserCopyLinkButton.addEventListener("click", function () {
        var currentUrl = String(window.location.href || "");

        copyToClipboard(currentUrl)
          .then(function () {
            if (tiktokBrowserCopyFeedback) {
              tiktokBrowserCopyFeedback.textContent = "Link copied. Open Chrome or Safari and paste it in the address bar.";
            }
          })
          .catch(function () {
            if (tiktokBrowserCopyFeedback) {
              tiktokBrowserCopyFeedback.textContent = "Copy failed. Press and hold the link above to copy manually.";
            }
          });
      });
    }

    var lowCreditsTasksButton = document.getElementById("lowCreditsTasksButton");
    var socialProgressBar = document.getElementById("socialSupportProgressBar");
    var socialProgressText = document.getElementById("socialSupportProgressText");
    var socialStatusNode = document.getElementById("socialSupportStatus");
    var socialVerifyButton = document.getElementById("socialVerifyButton");
    var socialSuggestedComment = document.getElementById("socialSuggestedComment");
    var socialCommentCopyButton = document.getElementById("socialCommentCopyButton");
    var socialFeedbackModal = document.getElementById("socialStepFeedbackModal");
    var socialFeedbackKicker = document.getElementById("socialFeedbackKicker");
    var socialFeedbackTitle = document.getElementById("socialFeedbackTitle");
    var socialFeedbackMessage = document.getElementById("socialFeedbackMessage");
    var socialFeedbackOkButton = document.getElementById("socialFeedbackOkButton");
    var socialStepButtons = Array.prototype.slice.call(document.querySelectorAll("[data-support-step-index]"));
    var SOCIAL_SUPPORT_STEP_COUNT = 6;
    var INSTAGRAM_STEP_START_INDEX = 3;
    var socialStepCards = [
      document.getElementById("socialStepCard0"),
      document.getElementById("socialStepCard1"),
      document.getElementById("socialStepCard2"),
      document.getElementById("socialStepCard3"),
      document.getElementById("socialStepCard4"),
      document.getElementById("socialStepCard5")
    ];
    var socialStepStates = [
      document.getElementById("socialStepState0"),
      document.getElementById("socialStepState1"),
      document.getElementById("socialStepState2"),
      document.getElementById("socialStepState3"),
      document.getElementById("socialStepState4"),
      document.getElementById("socialStepState5")
    ];
    var socialStepTitle0 = document.getElementById("socialStepTitle0");
    var socialStepTitle3 = document.getElementById("socialStepTitle3");

    function createSocialSupportCompletionState(fillValue) {
      return Array.from({ length: SOCIAL_SUPPORT_STEP_COUNT }, function () {
        return Boolean(fillValue);
      });
    }

    var socialStepLinks = getDefaultSocialSupportLinks();
    var socialTaskState = {
      completed: createSocialSupportCompletionState(false),
      pendingStep: -1,
      hiddenStartedAt: 0,
      stepStartedAt: 0,
      requiredSeconds: 5,
      rewardPending: false,
      rewardGranted: false,
      supportClaimChecked: false,
      supportClaimedAt: 0
    };
    var socialPendingCompletionTimer = 0;
    var socialCompletionGraceMs = 900;

    if (socialSuggestedComment) {
      applySuggestedSocialComment(activeSuggestedSocialComment);
      refreshSuggestedSocialComment();
    }
    var supportStateUserUid = "";

    function getDefaultSocialSupportLinks() {
      return [
        DEFAULT_SUPPORT_GATE_TIKTOK_PROFILE_LINK,
        DEFAULT_SUPPORT_GATE_TIKTOK_VIDEO_LINK,
        DEFAULT_SUPPORT_GATE_TIKTOK_VIDEO_LINK,
        DEFAULT_SUPPORT_GATE_INSTAGRAM_PROFILE_LINK,
        DEFAULT_SUPPORT_GATE_INSTAGRAM_VIDEO_LINK,
        DEFAULT_SUPPORT_GATE_INSTAGRAM_VIDEO_LINK
      ];
    }

    function getSocialStepPlatform(index) {
      return index >= INSTAGRAM_STEP_START_INDEX ? "Instagram" : "TikTok";
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

    function getSupportTikTokHandle(url) {
      try {
        var parsed = new URL(url);
        var path = String(parsed.pathname || "");
        var segments = path.split("/").filter(Boolean);
        var firstSegment = segments.length ? segments[0] : "";

        if (firstSegment && firstSegment.charAt(0) === "@") {
          return firstSegment;
        }
      } catch (_error) {
        // Ignore invalid URL parsing for title label.
      }

      return "";
    }

    function getSupportInstagramHandle(url) {
      try {
        var parsed = new URL(url);
        var path = String(parsed.pathname || "");
        var segments = path.split("/").filter(Boolean);
        var firstSegment = segments.length ? segments[0] : "";

        if (!firstSegment) {
          return "";
        }

        var reserved = ["p", "reel", "reels", "tv", "stories", "explore"];
        if (reserved.indexOf(firstSegment.toLowerCase()) !== -1) {
          return "";
        }

        return "@" + firstSegment.replace(/^@+/, "");
      } catch (_error) {
        // Ignore invalid URL parsing for title label.
      }

      return "";
    }

    function getTikTokProfileUrl(url) {
      try {
        var parsed = new URL(url);
        var segments = String(parsed.pathname || "").split("/").filter(Boolean);
        var firstSegment = segments.length ? segments[0] : "";

        if (firstSegment && firstSegment.charAt(0) === "@") {
          return parsed.origin + "/" + firstSegment;
        }
      } catch (_error) {
        // Ignore profile parsing failures.
      }

      return String(url || "");
    }

    function updateSupportStepTitle(linkUrl) {
      if (!socialStepTitle0) {
        return;
      }

      var handle = getSupportTikTokHandle(linkUrl);
      if (handle) {
        socialStepTitle0.textContent = "Step 1: Follow " + handle;
        return;
      }

      socialStepTitle0.textContent = "Step 1: Follow on TikTok";
    }

    function updateInstagramStepTitle(linkUrl) {
      if (!socialStepTitle3) {
        return;
      }

      var handle = getSupportInstagramHandle(linkUrl);
      if (handle) {
        socialStepTitle3.textContent = "Step 4: Follow " + handle + " on Instagram";
        return;
      }

      socialStepTitle3.textContent = "Step 4: Follow on Instagram";
    }

    function applySupportGateTikTokLink(url) {
      var normalizedUrl = normalizeSupportGateTikTokUrl(url);

      if (normalizedUrl) {
        var profileUrl = getTikTokProfileUrl(normalizedUrl) || normalizedUrl;
        socialStepLinks[0] = profileUrl;
        socialStepLinks[1] = normalizedUrl;
        socialStepLinks[2] = normalizedUrl;
        updateSupportStepTitle(profileUrl);
        return;
      }

      socialStepLinks[0] = DEFAULT_SUPPORT_GATE_TIKTOK_PROFILE_LINK;
      socialStepLinks[1] = DEFAULT_SUPPORT_GATE_TIKTOK_VIDEO_LINK;
      socialStepLinks[2] = DEFAULT_SUPPORT_GATE_TIKTOK_VIDEO_LINK;
      updateSupportStepTitle(DEFAULT_SUPPORT_GATE_TIKTOK_PROFILE_LINK);
    }

    function applySupportGateInstagramVideoLink(url) {
      var normalizedUrl = normalizeSupportGateInstagramVideoUrl(url);

      socialStepLinks[3] = DEFAULT_SUPPORT_GATE_INSTAGRAM_PROFILE_LINK;
      socialStepLinks[4] = normalizedUrl || DEFAULT_SUPPORT_GATE_INSTAGRAM_VIDEO_LINK;
      socialStepLinks[5] = normalizedUrl || DEFAULT_SUPPORT_GATE_INSTAGRAM_VIDEO_LINK;
      updateInstagramStepTitle(DEFAULT_SUPPORT_GATE_INSTAGRAM_PROFILE_LINK);
    }

    function resolveSupportGateConfigApi() {
      if (firebaseApi && typeof firebaseApi.getSupportGateConfig === "function") {
        return Promise.resolve(firebaseApi);
      }

      if (window.L4UFirebase && typeof window.L4UFirebase.getSupportGateConfig === "function") {
        return Promise.resolve(window.L4UFirebase);
      }

      if (window.L4UFirebaseReady && typeof window.L4UFirebaseReady.then === "function") {
        return window.L4UFirebaseReady
          .then(function (api) {
            return api || null;
          })
          .catch(function () {
            return null;
          });
      }

      return Promise.resolve(null);
    }

    function refreshSupportGateLinksFromConfig() {
      return resolveSupportGateConfigApi()
        .then(function (api) {
          if (!api || typeof api.getSupportGateConfig !== "function") {
            applySupportGateTikTokLink("");
            applySupportGateInstagramVideoLink("");
            return null;
          }

          return api.getSupportGateConfig()
            .then(function (configPayload) {
              var configRecord = configPayload && typeof configPayload === "object" ? configPayload : {};
              applySupportGateTikTokLink(configRecord.tiktokUrl);
              applySupportGateInstagramVideoLink(configRecord.instagramVideoUrl);
              return configRecord;
            })
            .catch(function () {
              applySupportGateTikTokLink("");
              applySupportGateInstagramVideoLink("");
              return null;
            });
        })
        .catch(function () {
          applySupportGateTikTokLink("");
          applySupportGateInstagramVideoLink("");
          return null;
        });
    }

    applySupportGateTikTokLink("");
    applySupportGateInstagramVideoLink("");
    refreshSupportGateLinksFromConfig();

    function clearSocialCooldown() {
      socialTaskState.hiddenStartedAt = 0;
      socialTaskState.stepStartedAt = 0;
    }

    function closeSocialStepFeedback() {
      if (!socialFeedbackModal) {
        return;
      }

      socialFeedbackModal.classList.remove("is-open", "is-success", "is-warning");
      socialFeedbackModal.hidden = true;
    }

    function openSocialStepFeedback(type, title, message) {
      if (!socialFeedbackModal) {
        return;
      }

      var kind = String(type || "status").toLowerCase();
      socialFeedbackModal.classList.remove("is-success", "is-warning");

      if (kind === "success") {
        socialFeedbackModal.classList.add("is-success");
      } else if (kind === "warning") {
        socialFeedbackModal.classList.add("is-warning");
      }

      if (socialFeedbackKicker) {
        socialFeedbackKicker.textContent = kind === "success" ? "Step Completed" : "Return Timing";
      }

      if (socialFeedbackTitle) {
        socialFeedbackTitle.textContent = String(title || "Support Status");
      }

      if (socialFeedbackMessage) {
        socialFeedbackMessage.textContent = String(message || "Step status updated.");
      }

      socialFeedbackModal.hidden = false;
      socialFeedbackModal.classList.add("is-open");

      window.requestAnimationFrame(function () {
        if (socialFeedbackOkButton && typeof socialFeedbackOkButton.focus === "function") {
          socialFeedbackOkButton.focus({ preventScroll: true });
        }
      });
    }

    function stopSocialPendingCompletionTimer() {
      if (!socialPendingCompletionTimer) {
        return;
      }

      window.clearInterval(socialPendingCompletionTimer);
      socialPendingCompletionTimer = 0;
    }

    function getPendingStepElapsedMs(nowInput) {
      var now = Number.isFinite(Number(nowInput)) ? Number(nowInput) : Date.now();
      var fromHiddenMs = socialTaskState.hiddenStartedAt
        ? Math.max(0, now - socialTaskState.hiddenStartedAt)
        : 0;
      var fromStartMs = socialTaskState.stepStartedAt
        ? Math.max(0, now - socialTaskState.stepStartedAt)
        : 0;

      return Math.max(fromHiddenMs, fromStartMs);
    }

    function getPendingStepRequiredMs() {
      return Math.max(1000, socialTaskState.requiredSeconds * 1000);
    }

    function getPendingStepRemainingMs(nowInput) {
      return Math.max(0, getPendingStepRequiredMs() - getPendingStepElapsedMs(nowInput));
    }

    function completePendingSocialStepIfEligible(nowInput) {
      if (socialTaskState.pendingStep === -1 || socialTaskState.rewardPending || socialTaskState.rewardGranted) {
        return false;
      }

      var elapsedMs = getPendingStepElapsedMs(nowInput);
      var requiredMs = getPendingStepRequiredMs();

      if ((elapsedMs + socialCompletionGraceMs) < requiredMs) {
        return false;
      }

      var completedStepIndex = socialTaskState.pendingStep;

      socialTaskState.completed[completedStepIndex] = true;
      socialTaskState.pendingStep = -1;
      clearSocialCooldown();
      stopSocialPendingCompletionTimer();
      updateSocialSupportUi();

      if (socialStatusNode) {
        socialStatusNode.textContent = "Step " + (completedStepIndex + 1) + " completed. Continue to the next step.";
      }

      var completedCount = getSocialCompletedCount();

      if (completedCount < SOCIAL_SUPPORT_STEP_COUNT) {
        openSocialStepFeedback(
          "success",
          "Step " + (completedStepIndex + 1) + " Success",
          "Great! Step " + (completedStepIndex + 1) + " is complete. Tap OK, then continue to Step " + (completedStepIndex + 2) + "."
        );
      } else {
        openSocialStepFeedback(
          "success",
          "All Steps Complete",
          "Nice work. All support steps are done. Tap OK, then verify support to claim your credit."
        );
      }

      if (completedCount >= SOCIAL_SUPPORT_STEP_COUNT) {
        grantSocialSupportUnlock();
      }

      return true;
    }

    function ensureSocialPendingCompletionTimer() {
      stopSocialPendingCompletionTimer();

      if (socialTaskState.pendingStep === -1 || socialTaskState.rewardPending || socialTaskState.rewardGranted) {
        return;
      }

      socialPendingCompletionTimer = window.setInterval(function () {
        completePendingSocialStepIfEligible(Date.now());
      }, 350);
    }

    function resetSocialTaskFlow() {
      stopSocialPendingCompletionTimer();
      clearSocialCooldown();
      if (typeof closeSocialStepFeedback === "function") {
        closeSocialStepFeedback();
      }
      socialTaskState.completed = createSocialSupportCompletionState(false);
      socialTaskState.pendingStep = -1;
      socialTaskState.rewardPending = false;
      socialTaskState.rewardGranted = false;
      socialTaskState.supportClaimChecked = false;
      socialTaskState.supportClaimedAt = 0;
    }

    function applySupportClaimStatus(statusPayload) {
      var payload = statusPayload && typeof statusPayload === "object" ? statusPayload : {};
      var claimed = Boolean(payload.claimed);
      var claimedAt = Number.isFinite(Number(payload.claimedAt))
        ? Math.max(0, toInt(payload.claimedAt, 0))
        : 0;

      socialTaskState.supportClaimChecked = true;
      socialTaskState.supportClaimedAt = claimedAt;

      if (!claimed) {
        return;
      }

      socialTaskState.rewardPending = false;
      socialTaskState.rewardGranted = true;
      socialTaskState.pendingStep = -1;
      socialTaskState.completed = createSocialSupportCompletionState(true);
      stopSocialPendingCompletionTimer();
      clearSocialCooldown();

      if (Number.isFinite(Number(payload.credits))) {
        state.credits = Math.max(0, toInt(payload.credits, state.credits));
        saveState();
        refreshBindings();
        emitStateUpdated();
      }
    }

    function syncSupportClaimStateFromStore() {
      if (!hasCloudSession() || !firebaseApi || typeof firebaseApi.getSupportRewardStatus !== "function") {
        socialTaskState.supportClaimChecked = false;
        updateSocialSupportUi();
        return Promise.resolve(null);
      }

      return firebaseApi.getSupportRewardStatus(state.userUid)
        .then(function (statusPayload) {
          applySupportClaimStatus(statusPayload);
          updateSocialSupportUi();
          return statusPayload;
        })
        .catch(function () {
          socialTaskState.supportClaimChecked = false;
          updateSocialSupportUi();
          return null;
        });
    }

    function handleSupportSessionChange() {
      var currentUid = state.signedIn ? String(state.userUid || "") : "";

      if (currentUid === supportStateUserUid) {
        return;
      }

      supportStateUserUid = currentUid;
      resetSocialTaskFlow();

      if (!currentUid) {
        updateSocialSupportUi();
        return;
      }

      syncSupportClaimStateFromStore();
    }

    function getSocialCompletedCount() {
      return socialTaskState.completed.reduce(function (sum, isDone) {
        return sum + (isDone ? 1 : 0);
      }, 0);
    }

    function canStartSocialStep(index) {
      if (index <= 0) {
        return true;
      }

      return Boolean(socialTaskState.completed[index - 1]);
    }

    function updateSocialSupportUi() {
      var completedCount = getSocialCompletedCount();
      var progressRatio = completedCount / SOCIAL_SUPPORT_STEP_COUNT;

      if (socialProgressBar) {
        socialProgressBar.style.width = Math.round(progressRatio * 100) + "%";
      }

      if (socialProgressText) {
        socialProgressText.textContent = completedCount + " / " + SOCIAL_SUPPORT_STEP_COUNT;
      }

      socialStepButtons.forEach(function (buttonNode) {
        var index = toInt(buttonNode.getAttribute("data-support-step-index"), -1);
        if (index < 0 || index >= SOCIAL_SUPPORT_STEP_COUNT) {
          return;
        }

        var isCompleted = Boolean(socialTaskState.completed[index]);
        var isPending = socialTaskState.pendingStep === index;
        var isUnlocked = canStartSocialStep(index);
        var isBlockedByCurrent = socialTaskState.pendingStep !== -1 && !isPending;
        var isLocked = !isUnlocked;
        var isDisabled = socialTaskState.rewardGranted || isCompleted || isLocked || isBlockedByCurrent;
        var cardNode = socialStepCards[index];
        var stateNode = socialStepStates[index];

        buttonNode.disabled = isDisabled;

        if (isCompleted) {
          buttonNode.textContent = socialTaskState.rewardGranted ? "Already Claimed" : "Completed";
        } else if (isPending) {
          buttonNode.textContent = "Reopen " + getSocialStepPlatform(index);
        } else if (isLocked) {
          buttonNode.textContent = "Step " + (index + 1) + " Locked";
        } else {
          buttonNode.textContent = "Open " + getSocialStepPlatform(index);
        }

        if (stateNode) {
          if (isCompleted) {
            stateNode.textContent = socialTaskState.rewardGranted
              ? "Reward already claimed"
              : "Completed";
          } else if (isPending) {
            var remainingMs = getPendingStepRemainingMs(Date.now());
            var remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
            stateNode.textContent = socialTaskState.hiddenStartedAt
              ? (remainingSeconds > 0
                ? "Timing... " + remainingSeconds + "s left"
                : "Timing complete. Return here to continue")
              : "Open " + getSocialStepPlatform(index) + " and stay there for at least " + socialTaskState.requiredSeconds + "s";
          } else if (isLocked) {
            stateNode.textContent = "Complete Step " + index + " first";
          } else {
            stateNode.textContent = "Ready";
          }
        }

        if (cardNode) {
          cardNode.classList.toggle("is-complete", isCompleted);
          cardNode.classList.toggle("is-pending", isPending);
          cardNode.classList.toggle("is-locked", isLocked);
        }
      });

      if (socialVerifyButton) {
        socialVerifyButton.disabled = socialTaskState.rewardGranted || socialTaskState.rewardPending || socialTaskState.pendingStep !== -1 || completedCount < SOCIAL_SUPPORT_STEP_COUNT;
        socialVerifyButton.textContent = socialTaskState.rewardGranted
          ? "Already Claimed"
          : socialTaskState.rewardPending
            ? "Verifying..."
            : "Verify Support";
      }

      if (socialStatusNode) {
        if (socialTaskState.rewardGranted) {
          socialStatusNode.textContent = "This account already claimed the one-time social support reward.";
        } else if (socialTaskState.rewardPending) {
          socialStatusNode.textContent = "All steps complete. Verifying unlock now...";
        } else if (socialTaskState.pendingStep !== -1) {
          socialStatusNode.textContent = "Step " + (socialTaskState.pendingStep + 1) + " is in progress. Switch to " + getSocialStepPlatform(socialTaskState.pendingStep) + " and stay for " + socialTaskState.requiredSeconds + "s before returning. Returning too fast resets the step.";
        } else if (completedCount >= SOCIAL_SUPPORT_STEP_COUNT) {
          socialStatusNode.textContent = "All steps done. Unlock should verify automatically; tap Verify Support if needed.";
        } else if (!state.signedIn || !hasCloudSession()) {
          socialStatusNode.textContent = "Sign in to validate one-time reward eligibility.";
        } else {
          socialStatusNode.textContent = "Each step needs at least " + socialTaskState.requiredSeconds + "s on the opened social app before you return.";
        }
      }
    }

    function grantSocialSupportUnlock() {
      if (socialTaskState.rewardGranted || socialTaskState.rewardPending) {
        updateSocialSupportUi();
        return;
      }

      if (!hasCloudSession() || !firebaseApi || typeof firebaseApi.claimSupportReward !== "function") {
        if (socialStatusNode) {
          socialStatusNode.textContent = "Sign in first to verify one-time support reward eligibility.";
        }
        openModal("signin");
        updateSocialSupportUi();
        return;
      }

      socialTaskState.rewardPending = true;
      updateSocialSupportUi();

      function applyUnlockCredits(nextCredits, claimedAt, alreadyClaimed) {
        socialTaskState.rewardPending = false;
        socialTaskState.rewardGranted = true;
        socialTaskState.supportClaimChecked = true;
        socialTaskState.supportClaimedAt = Math.max(0, toInt(claimedAt, Date.now()));
        socialTaskState.completed = createSocialSupportCompletionState(true);
        socialTaskState.pendingStep = -1;
        stopSocialPendingCompletionTimer();
        clearSocialCooldown();
        state.credits = Math.max(0, toInt(nextCredits, state.credits));
        saveState();
        refreshBindings();
        emitStateUpdated();
        updateSocialSupportUi();
        if (alreadyClaimed) {
          showToast("Support reward was already claimed on this account.");
          return;
        }

        closeModal("social-support");
        showToast("Support verified. 1 free credit unlocked.");
      }

      firebaseApi.claimSupportReward(state.userUid)
        .then(function (result) {
          var payload = result && typeof result === "object" ? result : {};
          var nextCredits = Number.isFinite(Number(payload.credits))
            ? Math.max(0, toInt(payload.credits, state.credits))
            : Math.max(0, toInt(state.credits, 0));
          var claimedAt = Number.isFinite(Number(payload.claimedAt))
            ? Math.max(0, toInt(payload.claimedAt, Date.now()))
            : Date.now();
          var alreadyClaimed = Boolean(payload.alreadyClaimed);

          applyUnlockCredits(nextCredits, claimedAt, alreadyClaimed);
        })
        .catch(function () {
          socialTaskState.rewardPending = false;
          updateSocialSupportUi();
          if (socialStatusNode) {
            socialStatusNode.textContent = "Verification finished, but unlock sync failed. Please retry Verify Support.";
          }
        });
    }

    function startSocialStep(index) {
      if (index < 0 || index >= SOCIAL_SUPPORT_STEP_COUNT) {
        return;
      }

      if (socialTaskState.rewardGranted) {
        updateSocialSupportUi();
        return;
      }

      if (socialTaskState.completed[index] || !canStartSocialStep(index)) {
        updateSocialSupportUi();
        return;
      }

      if (socialTaskState.pendingStep !== -1 && socialTaskState.pendingStep !== index) {
        updateSocialSupportUi();
        return;
      }

      if (typeof closeSocialStepFeedback === "function") {
        closeSocialStepFeedback();
      }

      var defaultLinks = getDefaultSocialSupportLinks();
      var targetUrl = socialStepLinks[index] || defaultLinks[index] || DEFAULT_SUPPORT_GATE_TIKTOK_PROFILE_LINK;
      var alreadyPending = socialTaskState.pendingStep === index;

      if (!alreadyPending) {
        socialTaskState.pendingStep = index;
        socialTaskState.stepStartedAt = Date.now();
        socialTaskState.hiddenStartedAt = 0;
      }
      ensureSocialPendingCompletionTimer();

      var openedWindow = window.open(targetUrl, "_blank", "noopener,noreferrer");

      if (openedWindow && typeof openedWindow.focus === "function") {
        try {
          openedWindow.focus();
        } catch (_error) {
          // Ignore focus issues.
        }
      }

      updateSocialSupportUi();

      if (socialStatusNode) {
        if (openedWindow) {
          socialStatusNode.textContent = getSocialStepPlatform(index) + " opened. Stay there for at least " + socialTaskState.requiredSeconds + "s, then return here.";
        } else {
          socialStatusNode.textContent = "If " + getSocialStepPlatform(index) + " did not open automatically, open it in another tab and stay there for at least " + socialTaskState.requiredSeconds + "s before returning.";
        }
      }
    }

    function handleSocialVisibilityChange() {
      if (socialTaskState.pendingStep === -1 || socialTaskState.rewardPending || socialTaskState.rewardGranted) {
        stopSocialPendingCompletionTimer();
        return;
      }

      if (document.hidden) {
        if (!socialTaskState.stepStartedAt) {
          socialTaskState.stepStartedAt = Date.now();
        }

        socialTaskState.hiddenStartedAt = Date.now();
        ensureSocialPendingCompletionTimer();
        updateSocialSupportUi();
        return;
      }

      if (!socialTaskState.hiddenStartedAt) {
        completePendingSocialStepIfEligible(Date.now());
        return;
      }

      var pendingIndex = socialTaskState.pendingStep;
      var remainingMs = getPendingStepRemainingMs(Date.now());
      var remainingSecondsValue = Math.max(0.1, Math.ceil(remainingMs / 100) / 10);
      var remainingSecondsText = String(remainingSecondsValue).replace(/\.0$/, "");

      if (completePendingSocialStepIfEligible(Date.now())) {
        return;
      }

      socialTaskState.hiddenStartedAt = 0;
      ensureSocialPendingCompletionTimer();
      updateSocialSupportUi();

      if (socialStatusNode) {
        socialStatusNode.textContent = "Step " + (pendingIndex + 1) + " is still in progress (" + remainingSecondsText + "s left). Reopen " + getSocialStepPlatform(pendingIndex) + " and stay a bit longer, then return.";
      }

      openSocialStepFeedback(
        "warning",
        "Returned Too Quickly",
        "You came back too quickly. Stay on " + getSocialStepPlatform(pendingIndex) + " for about " + remainingSecondsText + " more second" + (remainingSecondsText === "1" ? "" : "s") + ", then return."
      );
    }

    function handleSocialWindowFocus() {
      completePendingSocialStepIfEligible(Date.now());
    }

    socialStepButtons.forEach(function (buttonNode) {
      buttonNode.addEventListener("click", function () {
        var index = toInt(buttonNode.getAttribute("data-support-step-index"), -1);
        startSocialStep(index);
      });
    });

    if (socialCommentCopyButton) {
      socialCommentCopyButton.addEventListener("click", function () {
        var commentText = "";

        if (socialSuggestedComment) {
          commentText = String(
            socialSuggestedComment.getAttribute("data-full-comment") ||
            socialSuggestedComment.textContent ||
            ""
          ).trim();
        }

        if (!commentText) {
          commentText = activeSuggestedSocialComment;
        }

        copyToClipboard(commentText)
          .then(function () {
            showToast("Suggested comment copied.");
          })
          .catch(function () {
            showToast("Could not copy comment automatically.");
          });
      });
    }

    if (socialFeedbackModal) {
      socialFeedbackModal.addEventListener("click", function (event) {
        if (event.target && event.target.closest("[data-social-feedback-close]")) {
          closeSocialStepFeedback();
        }
      });
    }

    if (socialFeedbackOkButton) {
      socialFeedbackOkButton.addEventListener("click", function () {
        closeSocialStepFeedback();
      });
    }

    if (lowCreditsTasksButton) {
      lowCreditsTasksButton.addEventListener("click", function () {
        closeModal("low-credits");
        openModal("social-support");
        refreshSupportGateLinksFromConfig();

        if (socialStatusNode) {
          socialStatusNode.textContent = "Checking one-time reward eligibility...";
        }

        syncSupportClaimStateFromStore().then(function () {
          updateSocialSupportUi();
        });
      });
    }

    if (socialVerifyButton) {
      socialVerifyButton.addEventListener("click", function () {
        if (getSocialCompletedCount() >= SOCIAL_SUPPORT_STEP_COUNT) {
          grantSocialSupportUnlock();
        }
      });
    }

    document.addEventListener("visibilitychange", handleSocialVisibilityChange);
    window.addEventListener("focus", handleSocialWindowFocus);
    window.addEventListener("pageshow", handleSocialWindowFocus);
    document.addEventListener("l4u:state-updated", handleSupportSessionChange);

    handleSupportSessionChange();

    updateSocialSupportUi();

    var copyShareLinkButton = document.getElementById("copyShareLinkButton");

    if (copyShareLinkButton) {
      copyShareLinkButton.addEventListener("click", function () {
        var shareLink = copyShareLinkButton.getAttribute("data-share-link") || "";

        copyToClipboard(shareLink)
          .then(function () {
            showToast("Share link copied.");
          })
          .catch(function () {
            showToast("Could not copy link automatically.");
          });
      });
    }

    var quickShareButtons = document.querySelectorAll("[data-quick-share]");
    if (quickShareButtons && quickShareButtons.length) {
      quickShareButtons.forEach(function (buttonNode) {
        buttonNode.addEventListener("click", function () {
          var quickShareTarget = buttonNode.getAttribute("data-quick-share") || "";
          var shareLink = buttonNode.getAttribute("data-share-link") || "";
          var shareTitle = buttonNode.getAttribute("data-share-title") || "A Letter4U page for you";

          openQuickShareTarget(quickShareTarget, shareLink, shareTitle);
        });
      });
    }

    var downloadQrCodeButton = document.getElementById("downloadQrCodeButton");
    if (downloadQrCodeButton) {
      downloadQrCodeButton.addEventListener("click", function () {
        var qrSource = downloadQrCodeButton.getAttribute("data-qr-src") || "";
        var qrFilename = downloadQrCodeButton.getAttribute("data-qr-filename") || "letter4u-qr.png";

        if (!qrSource) {
          showToast("QR code is still loading.");
          return;
        }

        fetch(qrSource, { mode: "cors" })
          .then(function (response) {
            if (!response.ok) {
              throw new Error("QR_DOWNLOAD_FAILED");
            }
            return response.blob();
          })
          .then(function (blob) {
            var blobUrl = URL.createObjectURL(blob);
            var anchor = document.createElement("a");

            anchor.href = blobUrl;
            anchor.download = qrFilename;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);

            window.setTimeout(function () {
              URL.revokeObjectURL(blobUrl);
            }, 1000);

            showToast("QR code downloaded.");
          })
          .catch(function () {
            var fallback = document.createElement("a");
            fallback.href = qrSource;
            fallback.target = "_blank";
            fallback.rel = "noopener noreferrer";
            document.body.appendChild(fallback);
            fallback.click();
            document.body.removeChild(fallback);
            showToast("Opened QR code in a new tab.");
          });
      });
    }
  }

  function bootstrap() {
    initPageLoaderTransitions();
    applyThemeMode();

    renderNavigation();
    renderFooter();
    renderModals();
    wireGlobalEvents();
    maybeAutoOpenTikTokBrowserWarning();
    initReveal();

    var page = document.body ? document.body.getAttribute("data-page") : "";

    if (page === "home" || page === "landing") {
      initHomePage();
    }

    if (page === "create") {
      initCreatePage();
    }

    if (page === "my-pages") {
      initMyPages();
    }

    if (page === "shop") {
      initShop();
    }

    if (page === "settings") {
      initSettings();
    }

    if (page === "states") {
      initStatesPage();
    }

    refreshBindings();
    initFirebaseSync();
  }

  bootstrap();
})();
