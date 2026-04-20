import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDatabase,
  get,
  onValue,
  ref,
  runTransaction,
  update
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWii3OacfznJgv4ycOPTFXXiQSKuiWL7s",
  authDomain: "letter4u-bd394.firebaseapp.com",
  projectId: "letter4u-bd394",
  storageBucket: "letter4u-bd394.firebasestorage.app",
  messagingSenderId: "744593124519",
  appId: "1:744593124519:web:7e01e33af2a788af2abf82",
  measurementId: "G-ZBK52KV5KX"
};

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);
const realtimeDb = getDatabase(app);
const auth = getAuth(app);
const cloudFunctions = getFunctions(app);

function shouldUseFunctionsEmulator() {
  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLocalHost = hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    /\.localhost$/i.test(hostname);

  if (!isLocalHost) {
    return false;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const queryFlag = String(
      params.get("emulators") || params.get("useEmulators") || ""
    ).trim().toLowerCase();

    if (queryFlag === "1" || queryFlag === "true" || queryFlag === "yes") {
      return true;
    }
  } catch (_error) {
    // Ignore URL parsing issues.
  }

  try {
    const storedFlag = String(window.localStorage.getItem("l4u.useFirebaseEmulators") || "")
      .trim()
      .toLowerCase();

    return storedFlag === "1" || storedFlag === "true" || storedFlag === "yes";
  } catch (_error) {
    return false;
  }
}

if (shouldUseFunctionsEmulator()) {
  connectFunctionsEmulator(cloudFunctions, "127.0.0.1", 5001);
}

analyticsIsSupported()
  .then((supported) => {
    if (supported) {
      getAnalytics(app);
    }
  })
  .catch(() => {
    // Analytics is optional in unsupported environments.
  });

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

function isPassthroughAdminApiCode(code) {
  return code === "INSUFFICIENT_CREDITS" ||
    code === "AUTH_REQUIRED" ||
    code === "ADMIN_API_UNAVAILABLE" ||
    code === "ADMIN_REQUIRED" ||
    code === "PAGE_PAYLOAD_TOO_LARGE" ||
    code === "PAGE_ID_REQUIRED" ||
    code === "PAGE_NOT_FOUND" ||
    code === "PAGE_FORBIDDEN" ||
    code === "PUBLISH_FAILED" ||
    code === "INVALID_PAGE_PAYLOAD" ||
    code === "INVALID_CREDIT_COST" ||
    code === "CREDIT_AMOUNT_REQUIRED" ||
    code === "INVALID_PUBLISH_PAYLOAD" ||
    code === "INVALID_LOVE_LOCK_MESSAGE" ||
    code === "INVALID_PIN_CODE" ||
    code === "INVALID_YOUTUBE_URL" ||
    code === "CRT_PHOTO_REQUIRED" ||
    code === "CRT_YOUTUBE_REQUIRED" ||
    code === "INVALID_CUSTOM_PAGE_NAME" ||
    code === "CUSTOM_PAGE_NAME_REQUIRED" ||
    code === "CUSTOM_PAGE_NAME_FLAG_REQUIRED" ||
    code === "CUSTOM_PAGE_NAME_TAKEN" ||
    code === "PROFILE_INVALID_DISPLAY_NAME" ||
    code === "PROFILE_INVALID_EMAIL" ||
    code === "TARGET_UID_REQUIRED";
}

function toSafeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function isLocalCreditFallbackAllowed() {
  const protocol = String(window.location.protocol || "").toLowerCase();
  return protocol === "http:" || protocol === "https:";
}

function normalizeAdminApiError(error) {
  const code = String(error && error.code ? error.code : "");

  if (isPassthroughAdminApiCode(code)) {
    return error;
  }

  const normalized = new Error("ADMIN_API_UNAVAILABLE");
  normalized.code = "ADMIN_API_UNAVAILABLE";
  return normalized;
}

function normalizeCallableError(error) {
  const details = error && error.details && typeof error.details === "object"
    ? error.details
    : {};
  const detailCode = String(details && details.code ? details.code : "").trim();
  const rawFirebaseCode = String(error && error.code ? error.code : "").trim();
  const firebaseCode = rawFirebaseCode
    .replace(/^functions\//i, "")
    .toLowerCase();
  const messageCode = String(error && error.message ? error.message : "").trim();
  let normalizedCode = detailCode;

  if (!normalizedCode && firebaseCode) {
    if (firebaseCode === "unauthenticated") {
      normalizedCode = "AUTH_REQUIRED";
    } else if (
      firebaseCode === "unavailable" ||
      firebaseCode === "not-found" ||
      firebaseCode === "internal" ||
      firebaseCode === "unknown" ||
      firebaseCode === "deadline-exceeded"
    ) {
      normalizedCode = "ADMIN_API_UNAVAILABLE";
    } else {
      normalizedCode = firebaseCode.replace(/-/g, "_").toUpperCase();
    }
  }

  if (!normalizedCode && messageCode) {
    normalizedCode = messageCode
      .replace(/^firebase:\s*/i, "")
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
  }

  if (!normalizedCode) {
    normalizedCode = "ADMIN_API_UNAVAILABLE";
  }

  const normalized = new Error(normalizedCode);
  normalized.code = normalizedCode;

  if (Number.isFinite(Number(details && details.requiredCredits))) {
    normalized.requiredCredits = Math.max(0, Math.floor(Number(details.requiredCredits)));
  }

  if (Number.isFinite(Number(details && details.credits))) {
    normalized.availableCredits = Math.max(0, Math.floor(Number(details.credits)));
  }

  return normalized;
}

async function callCloudFunction(functionName, payload) {
  try {
    const callable = httpsCallable(cloudFunctions, functionName);
    const result = await callable(payload || {});
    return result && typeof result.data === "object" ? result.data : {};
  } catch (error) {
    throw normalizeCallableError(error);
  }
}

function parseCreditsConsumeResponse(payload) {
  var responsePayload = payload && typeof payload === "object" ? payload : {};
  var responseCode = String(responsePayload.code || "");

  if (responseCode === "INSUFFICIENT_CREDITS") {
    var insufficientError = new Error("INSUFFICIENT_CREDITS");
    insufficientError.code = "INSUFFICIENT_CREDITS";

    if (Number.isFinite(Number(responsePayload.credits))) {
      insufficientError.availableCredits = Math.max(0, Math.floor(Number(responsePayload.credits)));
    }

    if (Number.isFinite(Number(responsePayload.requiredCredits))) {
      insufficientError.requiredCredits = Math.max(0, Math.floor(Number(responsePayload.requiredCredits)));
    }

    throw insufficientError;
  }

  if (responseCode) {
    var genericError = new Error(responseCode);
    genericError.code = responseCode;

    if (Number.isFinite(Number(responsePayload.requiredCredits))) {
      genericError.requiredCredits = Math.max(0, Math.floor(Number(responsePayload.requiredCredits)));
    }

    if (Number.isFinite(Number(responsePayload.credits))) {
      genericError.availableCredits = Math.max(0, Math.floor(Number(responsePayload.credits)));
    }

    throw genericError;
  }

  return {
    credits: typeof responsePayload.credits === "number" ? Math.max(0, responsePayload.credits) : 0,
    consumedCredits: Number.isFinite(Number(responsePayload.consumedCredits))
      ? Math.max(0, Math.floor(Number(responsePayload.consumedCredits)))
      : 0,
    requiredCredits: Number.isFinite(Number(responsePayload.requiredCredits))
      ? Math.max(0, Math.floor(Number(responsePayload.requiredCredits)))
      : null
  };
}

function sanitizePublishPayloadForCreditValidation(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const photos = Array.isArray(payload.photos)
    ? payload.photos.map((photo, index) => ({
      id: String(photo && photo.id ? photo.id : `photo_${index}`),
      name: String(photo && photo.name ? photo.name : ""),
      mimeType: String(photo && photo.mimeType ? photo.mimeType : ""),
      width: Math.max(1, Math.floor(toSafeNumber(Number(photo && photo.width), 1))),
      height: Math.max(1, Math.floor(toSafeNumber(Number(photo && photo.height), 1))),
      sizeBytes: Math.max(0, Math.floor(toSafeNumber(Number(photo && photo.sizeBytes), 0)))
    }))
    : [];

  return {
    templateType: String(payload.templateType || "") === "crt-retro" ? "crt-retro" : "love-lock",
    title: String(payload.title || ""),
    message: String(payload.message || ""),
    pinCode: String(payload.pinCode || "").replace(/\D/g, "").slice(0, 4),
    youtubeUrl: String(payload.youtubeUrl || "").trim(),
    photos
  };
}

function sanitizePageOptionsForPublish(options) {
  if (!options || typeof options !== "object") {
    return null;
  }

  const customPageNameEnabled = options.customPageNameEnabled === true;
  const customPageName = String(options.customPageName || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 15);

  return {
    customPageNameEnabled,
    customPageName,
    voucherCode: String(options.voucherCode || "").trim().slice(0, 40)
  };
}

async function callPublicApi(endpoint, payload) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {})
    });
  } catch (_error) {
    const serviceError = new Error("ADMIN_API_UNAVAILABLE");
    serviceError.code = "ADMIN_API_UNAVAILABLE";
    throw serviceError;
  }

  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }

  if (!response.ok) {
    const apiCode = String(body && body.code ? body.code : "");
    if (apiCode) {
      const apiError = new Error(apiCode);
      apiError.code = apiCode;
      throw apiError;
    }

    const serviceError = new Error("ADMIN_API_UNAVAILABLE");
    serviceError.code = "ADMIN_API_UNAVAILABLE";
    throw serviceError;
  }

  return body || {};
}

async function callLocalAdminCreditApi(endpoint, payload) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const authError = new Error("AUTH_REQUIRED");
    authError.code = "AUTH_REQUIRED";
    throw authError;
  }

  let idToken = "";
  try {
    idToken = await currentUser.getIdToken();
  } catch (_error) {
    const authError = new Error("AUTH_REQUIRED");
    authError.code = "AUTH_REQUIRED";
    throw authError;
  }

  let response;
  try {
    response = await fetch("/api/credits/" + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken
      },
      body: JSON.stringify(payload || {})
    });
  } catch (_error) {
    const serviceError = new Error("ADMIN_API_UNAVAILABLE");
    serviceError.code = "ADMIN_API_UNAVAILABLE";
    throw serviceError;
  }

  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }

  if (!response.ok) {
    const apiCode = String(body && body.code ? body.code : "");

    if (response.status === 401 || apiCode === "AUTH_REQUIRED") {
      const authError = new Error("AUTH_REQUIRED");
      authError.code = "AUTH_REQUIRED";
      throw authError;
    }

    if (response.status === 409 || apiCode === "INSUFFICIENT_CREDITS") {
      const creditError = new Error("INSUFFICIENT_CREDITS");
      creditError.code = "INSUFFICIENT_CREDITS";

      if (body && Number.isFinite(Number(body.credits))) {
        creditError.availableCredits = Math.max(0, Math.floor(Number(body.credits)));
      }

      throw creditError;
    }

    if (apiCode) {
      const apiError = new Error(apiCode);
      apiError.code = apiCode;

      if (Number.isFinite(Number(body && body.requiredCredits))) {
        apiError.requiredCredits = Math.max(0, Math.floor(Number(body.requiredCredits)));
      }

      if (Number.isFinite(Number(body && body.credits))) {
        apiError.availableCredits = Math.max(0, Math.floor(Number(body.credits)));
      }

      throw apiError;
    }

    const serviceError = new Error("ADMIN_API_UNAVAILABLE");
    serviceError.code = "ADMIN_API_UNAVAILABLE";
    throw serviceError;
  }

  return body || {};
}

async function callLocalPageApi(endpoint, payload) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const authError = new Error("AUTH_REQUIRED");
    authError.code = "AUTH_REQUIRED";
    throw authError;
  }

  let idToken = "";
  try {
    idToken = await currentUser.getIdToken();
  } catch (_error) {
    const authError = new Error("AUTH_REQUIRED");
    authError.code = "AUTH_REQUIRED";
    throw authError;
  }

  let response;
  try {
    response = await fetch("/api/pages/" + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken
      },
      body: JSON.stringify(payload || {})
    });
  } catch (_error) {
    const serviceError = new Error("ADMIN_API_UNAVAILABLE");
    serviceError.code = "ADMIN_API_UNAVAILABLE";
    throw serviceError;
  }

  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }

  if (!response.ok) {
    const apiCode = String(body && body.code ? body.code : "");

    if (response.status === 401 || apiCode === "AUTH_REQUIRED") {
      const authError = new Error("AUTH_REQUIRED");
      authError.code = "AUTH_REQUIRED";
      throw authError;
    }

    if (response.status === 413 || apiCode === "PAGE_PAYLOAD_TOO_LARGE") {
      const payloadError = new Error("PAGE_PAYLOAD_TOO_LARGE");
      payloadError.code = "PAGE_PAYLOAD_TOO_LARGE";
      throw payloadError;
    }

    if (apiCode) {
      const apiError = new Error(apiCode);
      apiError.code = apiCode;
      throw apiError;
    }

    const serviceError = new Error("ADMIN_API_UNAVAILABLE");
    serviceError.code = "ADMIN_API_UNAVAILABLE";
    throw serviceError;
  }

  return body || {};
}

async function ensureUserRecordDirect(user, initialCredits) {
  const userRef = ref(realtimeDb, `users/${user.uid}`);

  const result = await runTransaction(userRef, (current) => {
    if (!current || typeof current !== "object") {
      return {
        credits: Math.max(0, toSafeNumber(initialCredits, 0)),
        displayName: String(user && user.displayName ? user.displayName : "Writer").slice(0, 80),
        email: String(user && user.email ? user.email : "").slice(0, 254),
        updatedAt: Date.now()
      };
    }

    const next = { ...current };

    if (typeof next.credits !== "number") {
      next.credits = Math.max(0, toSafeNumber(initialCredits, 0));
    }

    if (user && user.displayName) {
      next.displayName = String(user.displayName).slice(0, 80);
    }

    if (user && user.email) {
      next.email = String(user.email).slice(0, 254);
    }

    next.updatedAt = Date.now();

    return next;
  });

  const snapshotValue = result && result.snapshot ? result.snapshot.val() : null;
  return {
    credits: snapshotValue && typeof snapshotValue.credits === "number" ? Math.max(0, snapshotValue.credits) : 0
  };
}

async function incrementCreditsDirect(uid, amount) {
  const creditRef = ref(realtimeDb, `users/${uid}/credits`);
  const delta = Math.max(0, toSafeNumber(amount, 0));

  const result = await runTransaction(creditRef, (current) => {
    const base = typeof current === "number" ? current : 0;
    return Math.max(0, base + delta);
  });

  return result && result.snapshot && typeof result.snapshot.val() === "number"
    ? Math.max(0, result.snapshot.val())
    : 0;
}

async function consumeCreditsDirect(uid, amount) {
  const required = Math.max(0, toSafeNumber(amount, 0));
  const creditRef = ref(realtimeDb, `users/${uid}/credits`);

  const result = await runTransaction(creditRef, (current) => {
    const base = typeof current === "number" ? current : 0;

    if (base < required) {
      return;
    }

    return base - required;
  });

  if (!result || !result.committed) {
    const creditError = new Error("INSUFFICIENT_CREDITS");
    creditError.code = "INSUFFICIENT_CREDITS";
    throw creditError;
  }

  return result.snapshot && typeof result.snapshot.val() === "number"
    ? Math.max(0, result.snapshot.val())
    : 0;
}

function normalizePhotosPayload(photos) {
  if (!Array.isArray(photos)) {
    return [];
  }

  return photos.slice(0, 30).map((photo, index) => {
    const rawDataUrl = typeof photo.dataUrl === "string" ? photo.dataUrl : "";
    const embeddedDataUrl = rawDataUrl;

    return {
      id: String(photo.id || `photo_${Date.now()}_${index}`),
      name: String(photo.name || `image_${index + 1}.jpg`).slice(0, 120),
      mimeType: "image/jpeg",
      width: Math.max(1, toSafeNumber(photo.width, 1)),
      height: Math.max(1, toSafeNumber(photo.height, 1)),
      sizeBytes: Math.max(0, toSafeNumber(photo.sizeBytes, 0)),
      originalSizeBytes: Math.max(0, toSafeNumber(photo.originalSizeBytes, 0)),
      dataUrl: embeddedDataUrl
    };
  });
}

function normalizePagePayload(payload) {
  const rawTemplate = String(payload && payload.templateType ? payload.templateType : "love-lock");
  const templateType = rawTemplate === "crt-retro" ? "crt-retro" : "love-lock";

  return {
    id: String(payload.id || "page_" + Date.now()),
    templateType,
    title: String(payload.title || "").slice(0, 200),
    recipient: String(payload.recipient || "").slice(0, 120),
    date: String(payload.date || ""),
    pinCode: String(payload.pinCode || "").replace(/\D/g, "").slice(0, 4),
    message: String(payload.message || "").slice(0, 5000),
    closing: String(payload.closing || "With love,").slice(0, 120),
    signature: String(payload.signature || "Your Name").slice(0, 120),
    youtubeUrl: String(payload.youtubeUrl || "").slice(0, 420),
    photos: normalizePhotosPayload(payload.photos),
    isPublished: true,
    createdAt: String(payload.createdAt || new Date().toISOString()),
    createdAtMs: toSafeNumber(payload.createdAtMs, Date.now()),
    updatedAtMs: Date.now()
  };
}

async function ensureUserRecord(user, initialCredits = 0) {
  try {
    const payload = await callCloudFunction("ensureUserRecord", {
      initialCredits: Math.max(0, toSafeNumber(initialCredits, 0)),
      displayName: String(user && user.displayName ? user.displayName : "Writer").slice(0, 80),
      email: String(user && user.email ? user.email : "").slice(0, 254)
    });

    return {
      credits: typeof payload.credits === "number" ? Math.max(0, payload.credits) : 0
    };
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  const fallbackPayload = await callLocalAdminCreditApi("ensure", {
    initialCredits: Math.max(0, toSafeNumber(initialCredits, 0)),
    displayName: String(user && user.displayName ? user.displayName : "Writer").slice(0, 80),
    email: String(user && user.email ? user.email : "").slice(0, 254)
  });

  return {
    credits: typeof fallbackPayload.credits === "number" ? Math.max(0, fallbackPayload.credits) : 0
  };
}

function listenUserCredits(uid, callback) {
  const creditRef = ref(realtimeDb, `users/${uid}/credits`);

  return onValue(creditRef, (snapshot) => {
    const raw = snapshot.val();
    const nextCredits = typeof raw === "number" ? Math.max(0, raw) : 0;
    callback(nextCredits);
  });
}

function listenPublicStats(callback) {
  const statsRef = ref(realtimeDb, "publicStats");

  return onValue(statsRef, (snapshot) => {
    const stats = snapshot.val() || {};
    callback({
      users: typeof stats.users === "number" ? Math.max(0, Math.floor(stats.users)) : 0,
      pages: typeof stats.pages === "number" ? Math.max(0, Math.floor(stats.pages)) : 0
    });
  });
}

async function incrementCredits(uid, amount) {
  try {
    const payload = await callCloudFunction("incrementCredits", {
      uid: String(uid || "").trim(),
      amount: Math.max(0, toSafeNumber(amount, 0))
    });

    return typeof payload.credits === "number" ? Math.max(0, payload.credits) : 0;
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  const fallbackPayload = await callLocalAdminCreditApi("increment", {
    amount: Math.max(0, toSafeNumber(amount, 0))
  });

  return typeof fallbackPayload.credits === "number" ? Math.max(0, fallbackPayload.credits) : 0;
}

async function consumeCredits(uid, amount, options) {
  const consumeOptions = options && typeof options === "object" ? options : {};
  const publishPayload = sanitizePublishPayloadForCreditValidation(consumeOptions.publishPayload);
  const requestBody = {
    amount: Math.max(0, toSafeNumber(amount, 0))
  };

  if (publishPayload) {
    requestBody.publishPayload = publishPayload;
  }

  try {
    const payload = await callCloudFunction("consumeCredits", requestBody);
    const parsed = parseCreditsConsumeResponse(payload);
    return parsed.credits;
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  const fallbackPayload = await callLocalAdminCreditApi("consume", requestBody);
  const parsedFallback = parseCreditsConsumeResponse(fallbackPayload);
  return parsedFallback.credits;
}

function parseSupportRewardStatus(snapshotValue) {
  const record = snapshotValue && typeof snapshotValue === "object" ? snapshotValue : {};
  const claimedAt = typeof record.supportRewardClaimedAt === "number" && record.supportRewardClaimedAt > 0
    ? Math.floor(record.supportRewardClaimedAt)
    : 0;
  const claimedFlag = record.supportRewardClaimed === true;
  const credits = typeof record.credits === "number" ? Math.max(0, Math.floor(record.credits)) : 0;

  return {
    claimed: Boolean(claimedFlag || claimedAt > 0),
    claimedAt,
    credits
  };
}

async function getSupportRewardStatus(uid) {
  const userRef = ref(realtimeDb, `users/${uid}`);
  const snapshot = await get(userRef);
  return parseSupportRewardStatus(snapshot ? snapshot.val() : null);
}

function parseSupportGateConfig(snapshotValue) {
  const value = snapshotValue && typeof snapshotValue === "object" ? snapshotValue : {};
  const tiktokUrl = typeof value.tiktokUrl === "string" ? value.tiktokUrl.trim() : "";
  const instagramVideoUrl = typeof value.instagramVideoUrl === "string" ? value.instagramVideoUrl.trim() : "";

  return {
    tiktokUrl,
    instagramVideoUrl
  };
}

async function getSupportGateConfig() {
  const configRef = ref(realtimeDb, "publicConfig/supportGate");
  const snapshot = await get(configRef);
  return parseSupportGateConfig(snapshot ? snapshot.val() : null);
}

async function claimSupportRewardDirect(uid) {
  const userRef = ref(realtimeDb, `users/${uid}`);
  const now = Date.now();

  const result = await runTransaction(userRef, (current) => {
    const currentRecord = current && typeof current === "object" ? current : {};
    const alreadyClaimed = currentRecord.supportRewardClaimed === true ||
      (typeof currentRecord.supportRewardClaimedAt === "number" && currentRecord.supportRewardClaimedAt > 0);

    if (alreadyClaimed) {
      return;
    }

    const baseCredits = typeof currentRecord.credits === "number" ? currentRecord.credits : 0;

    return {
      ...currentRecord,
      credits: Math.max(0, baseCredits + 1),
      supportRewardClaimed: true,
      supportRewardClaimedAt: now,
      updatedAt: now
    };
  });

  const status = parseSupportRewardStatus(result && result.snapshot ? result.snapshot.val() : null);

  return {
    claimed: status.claimed,
    alreadyClaimed: !Boolean(result && result.committed),
    claimedAt: status.claimedAt,
    credits: status.credits
  };
}

async function claimSupportReward(uid) {
  try {
    const payload = await callCloudFunction("claimSupportReward", {
      uid: String(uid || "").trim()
    });

    return {
      claimed: Boolean(payload && payload.claimed),
      alreadyClaimed: Boolean(payload && payload.alreadyClaimed),
      claimedAt: Number.isFinite(Number(payload && payload.claimedAt))
        ? Math.max(0, Math.floor(Number(payload.claimedAt)))
        : 0,
      credits: Number.isFinite(Number(payload && payload.credits))
        ? Math.max(0, Math.floor(Number(payload.credits)))
        : 0
    };
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  const fallbackPayload = await callLocalAdminCreditApi("support-claim", {
    uid: String(uid || "").trim()
  });

  return {
    claimed: Boolean(fallbackPayload && fallbackPayload.claimed),
    alreadyClaimed: Boolean(fallbackPayload && fallbackPayload.alreadyClaimed),
    claimedAt: Number.isFinite(Number(fallbackPayload && fallbackPayload.claimedAt))
      ? Math.max(0, Math.floor(Number(fallbackPayload.claimedAt)))
      : 0,
    credits: Number.isFinite(Number(fallbackPayload && fallbackPayload.credits))
      ? Math.max(0, Math.floor(Number(fallbackPayload.credits)))
      : 0
  };
}

function listenUserPages(uid, callback) {
  const pagesQuery = query(collection(firestore, "pages"), where("uid", "==", uid));

  return onSnapshot(pagesQuery, (snapshot) => {
    const pages = [];

    snapshot.forEach((item) => {
      const data = item.data() || {};
      pages.push({
        id: item.id,
        templateType: String(data.templateType || "") === "crt-retro" ? "crt-retro" : "love-lock",
        title: String(data.title || ""),
        recipient: String(data.recipient || ""),
        date: String(data.date || ""),
        pinCode: String(data.pinCode || ""),
        message: String(data.message || ""),
        closing: String(data.closing || "With love,"),
        signature: String(data.signature || "Your Name"),
        youtubeUrl: String(data.youtubeUrl || ""),
        photos: normalizePhotosPayload(data.photos),
        isPublished: Boolean(data.isPublished),
        createdAt: String(data.createdAt || ""),
        createdAtMs: toSafeNumber(data.createdAtMs, 0),
        updatedAtMs: toSafeNumber(data.updatedAtMs, 0)
      });
    });

    pages.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    callback(pages);
  });
}

async function getPageById(pageId) {
  const safePageId = String(pageId || "").trim();

  if (!safePageId) {
    return null;
  }

  const pageRef = doc(firestore, "pages", safePageId);
  const pageSnapshot = await getDoc(pageRef);

  if (!pageSnapshot.exists()) {
    return null;
  }

  const data = pageSnapshot.data() || {};

  return {
    id: pageSnapshot.id,
    uid: String(data.uid || ""),
    templateType: String(data.templateType || "") === "crt-retro" ? "crt-retro" : "love-lock",
    title: String(data.title || ""),
    recipient: String(data.recipient || ""),
    date: String(data.date || ""),
    pinCode: String(data.pinCode || ""),
    message: String(data.message || ""),
    closing: String(data.closing || "With love,"),
    signature: String(data.signature || "Your Name"),
    youtubeUrl: String(data.youtubeUrl || ""),
    photos: normalizePhotosPayload(data.photos),
    isPublished: Boolean(data.isPublished),
    createdAt: String(data.createdAt || ""),
    createdAtMs: toSafeNumber(data.createdAtMs, 0),
    updatedAtMs: toSafeNumber(data.updatedAtMs, 0)
  };
}

async function checkCustomPageNameAvailability(pageName) {
  const normalizedName = String(pageName || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 15);

  if (!normalizedName || normalizedName.length < 4) {
    return {
      pageName: normalizedName,
      valid: false,
      available: false
    };
  }

  try {
    const payload = await callCloudFunction("checkCustomPageNameAvailability", {
      pageName: normalizedName
    });

    return {
      pageName: String(payload && payload.pageName ? payload.pageName : normalizedName),
      valid: payload && payload.valid === false ? false : true,
      available: Boolean(payload && payload.available === true)
    };
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  const fallbackPayload = await callPublicApi("/api/pages/check-id", {
    pageName: normalizedName
  });

  return {
    pageName: String(fallbackPayload && fallbackPayload.pageName ? fallbackPayload.pageName : normalizedName),
    valid: fallbackPayload && fallbackPayload.valid === false ? false : true,
    available: Boolean(fallbackPayload && fallbackPayload.available === true)
  };
}

async function checkVoucherCode(voucherCode) {
  const normalizedCode = String(voucherCode || "").trim().slice(0, 40);
  if (!normalizedCode) {
    return {
      code: "",
      valid: false
    };
  }

  try {
    const payload = await callCloudFunction("checkVoucherCode", {
      voucherCode: normalizedCode
    });

    return {
      code: normalizedCode,
      valid: Boolean(payload && payload.valid === true)
    };
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  const fallbackPayload = await callPublicApi("/api/credits/voucher/check", {
    voucherCode: normalizedCode
  });

  return {
    code: normalizedCode,
    valid: Boolean(fallbackPayload && fallbackPayload.valid === true)
  };
}

async function savePage(uid, payload, options) {
  const safePayload = normalizePagePayload(payload);
  const saveOptions = options && typeof options === "object" ? options : {};
  const publishPayload = sanitizePublishPayloadForCreditValidation(saveOptions.publishPayload || safePayload);
  const pageOptions = sanitizePageOptionsForPublish(saveOptions.pageOptions);

  try {
    const response = await callCloudFunction("publishPage", {
      uid: String(uid || "").trim(),
      payload: safePayload,
      publishPayload: publishPayload || undefined,
      pageOptions: pageOptions || undefined
    });

    return {
      payload: safePayload,
      id: String(response && response.id ? response.id : safePayload.id),
      created: Boolean(response && response.created),
      credits: Number.isFinite(Number(response && response.credits))
        ? Math.max(0, Math.floor(Number(response.credits)))
        : null,
      requiredCredits: Number.isFinite(Number(response && response.requiredCredits))
        ? Math.max(0, Math.floor(Number(response.requiredCredits)))
        : null
    };
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  var consumePayload = await callLocalAdminCreditApi("consume", {
    amount: 0,
    publishPayload: publishPayload || undefined,
    pageOptions: pageOptions || undefined,
    pageId: String(safePayload && safePayload.id ? safePayload.id : "")
  });
  var consumeResult = parseCreditsConsumeResponse(consumePayload);

  try {
    const saveResponse = await callLocalPageApi("save", {
      payload: safePayload
    });

    return {
      payload: safePayload,
      id: String(saveResponse && saveResponse.id ? saveResponse.id : safePayload.id),
      created: Boolean(saveResponse && saveResponse.created),
      credits: consumeResult.credits,
      requiredCredits: consumeResult.requiredCredits || consumeResult.consumedCredits || null
    };
  } catch (saveError) {
    if (consumeResult.consumedCredits > 0) {
      try {
        await callLocalAdminCreditApi("increment", {
          amount: consumeResult.consumedCredits
        });
      } catch (_refundError) {
        // Best-effort refund only.
      }
    }

    const normalizedSaveError = normalizeAdminApiError(saveError);
    throw normalizedSaveError || saveError;
  }
}

async function deletePage(pageId) {
  const safePageId = String(pageId || "").trim();
  if (!safePageId) {
    return;
  }

  try {
    await callCloudFunction("deletePage", {
      pageId: safePageId
    });
    return;
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  await callLocalPageApi("delete", {
    pageId: safePageId
  });
}

async function updateUserProfile(uid, profile) {
  const nextProfile = {
    displayName: profile && typeof profile.displayName === "string"
      ? profile.displayName.slice(0, 80)
      : "",
    email: profile && typeof profile.email === "string"
      ? profile.email.slice(0, 254)
      : ""
  };

  try {
    await callCloudFunction("updateUserProfile", {
      uid: String(uid || "").trim(),
      profile: nextProfile
    });
    return;
  } catch (error) {
    const normalized = normalizeAdminApiError(error);

    if (normalized && normalized.code !== "ADMIN_API_UNAVAILABLE") {
      throw normalized;
    }

    if (!isLocalCreditFallbackAllowed()) {
      throw normalized || error;
    }
  }

  await callLocalAdminCreditApi("ensure", {
    initialCredits: 0,
    displayName: nextProfile.displayName || "Writer",
    email: nextProfile.email || ""
  });
}

const firebaseApi = {
  app,
  auth,
  firestore,
  realtimeDb,
  onAuthChanged(callback) {
    return onAuthStateChanged(auth, callback);
  },
  signInWithGoogle() {
    return signInWithPopup(auth, googleProvider).then((result) => result.user);
  },
  signOutUser() {
    return signOut(auth);
  },
  ensureUserRecord,
  listenUserCredits,
  listenPublicStats,
  incrementCredits,
  consumeCredits,
  getSupportRewardStatus,
  getSupportGateConfig,
  claimSupportReward,
  listenUserPages,
  getPageById,
  checkCustomPageNameAvailability,
  checkVoucherCode,
  savePage,
  deletePage,
  updateUserProfile
};

window.L4UFirebase = firebaseApi;
window.L4UFirebaseReady = Promise.resolve(firebaseApi);
