const fs = require("fs");
const path = require("path");
const express = require("express");
const admin = require("firebase-admin");

const projectId = "letter4u-bd394";
const databaseURL = "https://letter4u-bd394-default-rtdb.firebaseio.com";
const workspaceRoot = path.resolve(process.cwd());
const DAY_MS = 24 * 60 * 60 * 1000;
const LOVE_LOCK_FIRST_CREDIT_CHARACTERS = 300;
const LOVE_LOCK_FIRST_CREDIT_PHOTOS = 2;
const LOVE_LOCK_CHARACTERS_PER_CREDIT = 550;
const DEFAULT_CHARACTERS_PER_CREDIT = 300;
const PHOTOS_PER_CREDIT = 4;
const MAX_PAGE_PHOTOS = 30;
const MAX_PAGE_TITLE_CHARACTERS = 200;
const MAX_PAGE_MESSAGE_CHARACTERS = 5000;
const CUSTOM_PAGE_NAME_EXTRA_CREDITS = 5;
const CUSTOM_PAGE_NAME_MIN_LENGTH = 4;
const CUSTOM_PAGE_NAME_MAX_LENGTH = 15;
const VOUCHER_DISCOUNT_CREDITS = 1;
const VOUCHER_MINIMUM_REQUIRED_CREDITS = 2;
const DEFAULT_KENJI_VOUCHER_CODE = "KENJI";
const API_JSON_BODY_LIMIT = "2mb";
const PUBLIC_USERS_BASELINE = 577;
const PUBLIC_PAGES_BASELINE = 958;
const ADMIN_AUTH_LIST_BATCH_SIZE = 1000;
const ADMIN_USER_SEARCH_RESULT_LIMIT = 50;

let publicStatsSyncStarted = false;

function toSafeInt(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.floor(parsed);
  }
  return fallback;
}

function normalizeServiceAccountPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const normalized = { ...payload };

  if (typeof normalized.private_key === "string") {
    normalized.private_key = normalized.private_key.replace(/\\n/g, "\n");
  }

  return normalized;
}

function parseServiceAccountFromJson(rawValue) {
  try {
    return normalizeServiceAccountPayload(JSON.parse(rawValue));
  } catch (_error) {
    return null;
  }
}

function loadServiceAccount() {
  const envValue = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  const localPath = path.join(workspaceRoot, "firebase", "admin", "serviceAccountKey.json");

  if (envValue) {
    if (fs.existsSync(envValue)) {
      const rawFile = fs.readFileSync(envValue, "utf8");
      return normalizeServiceAccountPayload(JSON.parse(rawFile));
    }

    const jsonPayload = parseServiceAccountFromJson(envValue);
    if (jsonPayload) {
      return jsonPayload;
    }

    const decodedPayload = parseServiceAccountFromJson(Buffer.from(envValue, "base64").toString("utf8"));
    if (decodedPayload) {
      return decodedPayload;
    }

    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS is set, but it is not a valid file path, JSON, or base64 JSON service account payload."
    );
  }

  if (!fs.existsSync(localPath)) {
    throw new Error(
      "Service account key not found. Set GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json in firebase/admin/."
    );
  }

  const localRaw = fs.readFileSync(localPath, "utf8");
  return normalizeServiceAccountPayload(JSON.parse(localRaw));
}

function initAdmin() {
  if (admin.apps.length) {
    return;
  }

  const serviceAccount = loadServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
    databaseURL
  });
}

function countUsersFromSnapshot(snapshot) {
  if (!snapshot || !snapshot.exists()) {
    return 0;
  }

  if (typeof snapshot.numChildren === "function") {
    return Math.max(0, toSafeInt(snapshot.numChildren(), 0));
  }

  const value = snapshot.val();
  if (!value || typeof value !== "object") {
    return 0;
  }

  return Math.max(0, toSafeInt(Object.keys(value).length, 0));
}

function startPublicStatsRealtimeSync() {
  const rtdb = admin.database();
  const usersRef = rtdb.ref("users");
  const publicStatsRef = rtdb.ref("publicStats");

  let latestUsers = null;
  let lastPublishedUsers = null;
  let writeTimer = null;

  function clearWriteTimer() {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
  }

  async function publishStats() {
    if (!Number.isFinite(latestUsers)) {
      return;
    }

    const users = Math.max(0, PUBLIC_USERS_BASELINE + toSafeInt(latestUsers, 0));

    if (users === lastPublishedUsers) {
      return;
    }

    await publicStatsRef.transaction((current) => {
      const record = current && typeof current === "object" ? current : {};
      const pages = Math.max(0, toSafeInt(record.pages, PUBLIC_PAGES_BASELINE));

      return {
        users,
        pages,
        updatedAt: Date.now()
      };
    });

    lastPublishedUsers = users;
    console.log(`[admin-api] Synced publicStats users=${users}`);
  }

  function schedulePublish() {
    clearWriteTimer();
    writeTimer = setTimeout(() => {
      publishStats().catch((error) => {
        console.error("[admin-api] publicStats sync error", error);
      });
    }, 120);
  }

  usersRef.on(
    "value",
    (snapshot) => {
      latestUsers = countUsersFromSnapshot(snapshot);
      schedulePublish();
    },
    (error) => {
      console.error("[admin-api] users listener error", error);
    }
  );
}

function ensurePublicStatsSync() {
  if (publicStatsSyncStarted) {
    return;
  }

  publicStatsSyncStarted = true;

  try {
    startPublicStatsRealtimeSync();
  } catch (error) {
    publicStatsSyncStarted = false;
    console.error("[admin-api] publicStats sync init error", error);
  }
}

async function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({ code: "AUTH_REQUIRED" });
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.user = decoded;
    next();
  } catch (_error) {
    res.status(401).json({ code: "AUTH_REQUIRED" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.admin !== true) {
    res.status(403).json({ code: "ADMIN_REQUIRED" });
    return;
  }

  next();
}

function startOfDayMs(inputMs) {
  const value = Number.isFinite(Number(inputMs)) ? Number(inputMs) : Date.now();
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function parseAuthCreatedAtMs(userRecord) {
  const raw = userRecord && userRecord.metadata ? userRecord.metadata.creationTime : "";
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAdminUsersOffset(pageTokenInput) {
  const raw = String(pageTokenInput || "").trim();
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.floor(parsed));
}

function parsePageCreatedAtMs(pageData) {
  const direct = toSafeInt(pageData && pageData.createdAtMs, NaN);
  if (Number.isFinite(direct)) {
    return Math.max(0, direct);
  }

  const fromIso = Date.parse(String(pageData && pageData.createdAt ? pageData.createdAt : ""));
  if (Number.isFinite(fromIso)) {
    return Math.max(0, Math.floor(fromIso));
  }

  return 0;
}

function normalizeTemplateType(value) {
  return String(value || "") === "crt-retro" ? "crt-retro" : "love-lock";
}

function isDefaultGeneratedPageId(value) {
  return /^page_\d{6,140}$/.test(String(value || "").trim());
}

function normalizeCustomPageName(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, CUSTOM_PAGE_NAME_MAX_LENGTH);
}

function isValidCustomPageName(value) {
  const pattern = new RegExp(`^[A-Za-z0-9]{${CUSTOM_PAGE_NAME_MIN_LENGTH},${CUSTOM_PAGE_NAME_MAX_LENGTH}}$`);
  return pattern.test(String(value || "").trim());
}

function normalizePageOptions(options) {
  const payload = options && typeof options === "object" ? options : {};
  const customPageNameEnabled = payload.customPageNameEnabled === true;
  const customPageName = normalizeCustomPageName(payload.customPageName);

  return {
    customPageNameEnabled,
    customPageName,
    voucherCode: String(payload.voucherCode || "").trim().slice(0, 40)
  };
}

function getConfiguredVoucherCodes() {
  const envPrimaryCode = String(process.env.L4U_VOUCHER_KENJI || "").trim();
  const envListRaw = String(process.env.L4U_VOUCHER_CODES || "").trim();
  const envCodes = envListRaw
    ? envListRaw.split(",").map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const knownCodes = [envPrimaryCode || DEFAULT_KENJI_VOUCHER_CODE].concat(envCodes);

  return knownCodes.filter((code, index, list) => list.indexOf(code) === index);
}

function isVoucherCodeValid(voucherCode) {
  const value = String(voucherCode || "").trim();
  if (!value) {
    return false;
  }

  return getConfiguredVoucherCodes().some((code) => value === code);
}

function normalizeSupportGateTikTokUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  let withProtocol = raw;
  if (!/^https?:\/\//i.test(withProtocol)) {
    withProtocol = "https://" + withProtocol.replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(withProtocol);
    const protocol = String(parsed.protocol || "").toLowerCase();
    const hostname = String(parsed.hostname || "").toLowerCase();

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
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  let withProtocol = raw;
  if (!/^https?:\/\//i.test(withProtocol)) {
    withProtocol = "https://" + withProtocol.replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(withProtocol);
    const protocol = String(parsed.protocol || "").toLowerCase();
    const hostname = String(parsed.hostname || "").toLowerCase();

    if ((protocol !== "https:" && protocol !== "http:") || hostname.indexOf("instagram.com") === -1) {
      return "";
    }

    const pathName = String(parsed.pathname || "");
    if (!/^\/(p|reel|reels|tv)\//i.test(pathName)) {
      return "";
    }

    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

async function getSupportGateConfigAdmin() {
  const snapshot = await admin.database().ref("publicConfig/supportGate").get();
  const value = snapshot && typeof snapshot.val === "function" ? snapshot.val() : null;
  const record = value && typeof value === "object" ? value : {};

  return {
    tiktokUrl: normalizeSupportGateTikTokUrl(record.tiktokUrl),
    instagramVideoUrl: normalizeSupportGateInstagramVideoUrl(record.instagramVideoUrl),
    updatedAt: Math.max(0, toSafeInt(record.updatedAt, 0)),
    updatedBy: String(record.updatedBy || "")
  };
}

async function updateSupportGateConfigAdmin(payload, actorUid) {
  const requestPayload = payload && typeof payload === "object" ? payload : {};
  const rawUrl = String(requestPayload.tiktokUrl || "").trim();
  const normalizedUrl = normalizeSupportGateTikTokUrl(rawUrl);
  const rawInstagramVideoUrl = String(requestPayload.instagramVideoUrl || "").trim();
  const normalizedInstagramVideoUrl = normalizeSupportGateInstagramVideoUrl(rawInstagramVideoUrl);

  if (rawUrl && !normalizedUrl) {
    return { code: "INVALID_TIKTOK_URL", status: 400 };
  }

  if (rawInstagramVideoUrl && !normalizedInstagramVideoUrl) {
    return { code: "INVALID_INSTAGRAM_VIDEO_URL", status: 400 };
  }

  const nextPayload = {
    tiktokUrl: normalizedUrl,
    instagramVideoUrl: normalizedInstagramVideoUrl,
    updatedAt: Date.now(),
    updatedBy: String(actorUid || "")
  };

  await admin.database().ref("publicConfig/supportGate").set(nextPayload);
  return nextPayload;
}

function isYouTubeUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }

  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)/i.test(normalized);
}

function normalizePublishPayloadForCreditValidation(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    templateType: normalizeTemplateType(payload.templateType),
    title: String(payload.title || ""),
    message: String(payload.message || ""),
    pinCode: String(payload.pinCode || "").replace(/\D/g, "").slice(0, 4),
    youtubeUrl: String(payload.youtubeUrl || "").trim(),
    photos: Array.isArray(payload.photos) ? payload.photos.slice(0, MAX_PAGE_PHOTOS) : []
  };
}

function calculateRequiredCreditsForPublish(payload, options, pageIdInput) {
  const normalized = normalizePublishPayloadForCreditValidation(payload);
  if (!normalized) {
    return { code: "INVALID_PUBLISH_PAYLOAD", status: 400 };
  }

  const normalizedOptions = normalizePageOptions(options);
  const normalizedPageId = String(pageIdInput || "").trim();

  const titleLength = normalized.title.trim().length;
  const messageLength = normalized.message.trim().length;

  if (titleLength < 1 || titleLength > MAX_PAGE_TITLE_CHARACTERS) {
    return { code: "INVALID_PUBLISH_PAYLOAD", status: 400 };
  }

  if (messageLength < 1 || messageLength > MAX_PAGE_MESSAGE_CHARACTERS) {
    return { code: "INVALID_PUBLISH_PAYLOAD", status: 400 };
  }

  const photoCount = Math.max(0, normalized.photos.length);
  const photoCredits = Math.max(1, Math.ceil(Math.max(1, photoCount) / PHOTOS_PER_CREDIT));
  let baseRequiredCredits = 1;

  if (normalized.templateType === "love-lock") {
    if (messageLength < 12) {
      return { code: "INVALID_LOVE_LOCK_MESSAGE", status: 400 };
    }

    if (!/^\d{4}$/.test(normalized.pinCode)) {
      return { code: "INVALID_PIN_CODE", status: 400 };
    }

    if (normalized.youtubeUrl && !isYouTubeUrl(normalized.youtubeUrl)) {
      return { code: "INVALID_YOUTUBE_URL", status: 400 };
    }

    const textCredits = messageLength <= LOVE_LOCK_FIRST_CREDIT_CHARACTERS
      ? 1
      : 1 + Math.ceil((messageLength - LOVE_LOCK_FIRST_CREDIT_CHARACTERS) / LOVE_LOCK_CHARACTERS_PER_CREDIT);
    const loveLockPhotoCredits = photoCount <= LOVE_LOCK_FIRST_CREDIT_PHOTOS
      ? 1
      : 1 + Math.ceil((photoCount - LOVE_LOCK_FIRST_CREDIT_PHOTOS) / PHOTOS_PER_CREDIT);

    baseRequiredCredits = Math.max(textCredits, loveLockPhotoCredits);
  } else {
    if (!photoCount) {
      return { code: "CRT_PHOTO_REQUIRED", status: 400 };
    }

    if (!isYouTubeUrl(normalized.youtubeUrl)) {
      return { code: "CRT_YOUTUBE_REQUIRED", status: 400 };
    }

    const textCredits = Math.max(
      1,
      Math.ceil(Math.max(1, normalized.message.trim().length) / DEFAULT_CHARACTERS_PER_CREDIT)
    );

    baseRequiredCredits = Math.max(textCredits, photoCredits);
  }

  const customNameFromId = !isDefaultGeneratedPageId(normalizedPageId)
    ? normalizeCustomPageName(normalizedPageId)
    : "";
  const customNameByIdRequested = Boolean(customNameFromId);
  const customNameRequested = normalizedOptions.customPageNameEnabled ||
    Boolean(normalizedOptions.customPageName) ||
    customNameByIdRequested;

  if (!customNameRequested && normalizedPageId && !isDefaultGeneratedPageId(normalizedPageId)) {
    return { code: "CUSTOM_PAGE_NAME_FLAG_REQUIRED", status: 400 };
  }

  let customPageName = "";
  if (customNameRequested) {
    customPageName = normalizeCustomPageName(normalizedOptions.customPageName || customNameFromId);

    if (!customPageName) {
      return { code: "CUSTOM_PAGE_NAME_REQUIRED", status: 400 };
    }

    if (!isValidCustomPageName(customPageName)) {
      return { code: "INVALID_CUSTOM_PAGE_NAME", status: 400 };
    }

    if (customNameByIdRequested && customPageName !== customNameFromId) {
      return { code: "INVALID_CUSTOM_PAGE_NAME", status: 400 };
    }
  }

  const customPageNameCredits = customNameRequested ? CUSTOM_PAGE_NAME_EXTRA_CREDITS : 0;
  const totalBeforeVoucher = baseRequiredCredits + customPageNameCredits;
  const voucherCode = String(normalizedOptions.voucherCode || "").trim();
  const voucherValid = voucherCode ? isVoucherCodeValid(voucherCode) : false;
  const voucherEligible = totalBeforeVoucher >= VOUCHER_MINIMUM_REQUIRED_CREDITS;
  const voucherApplied = voucherValid && voucherEligible;
  const voucherDiscountCredits = voucherApplied ? VOUCHER_DISCOUNT_CREDITS : 0;
  const requiredCredits = Math.max(1, totalBeforeVoucher - voucherDiscountCredits);

  return {
    requiredCredits,
    baseRequiredCredits,
    templateType: normalized.templateType,
    customPageNameEnabled: customNameRequested,
    customPageName,
    customPageNameCredits,
    voucherApplied,
    voucherValid,
    voucherDiscountCredits,
    totalBeforeVoucher
  };
}

function normalizeAdminPhotos(photos) {
  if (!Array.isArray(photos)) {
    return [];
  }

  return photos.map((photo, index) => ({
    id: String(photo && photo.id ? photo.id : `photo_${index}`),
    name: String(photo && photo.name ? photo.name : "image.jpg"),
    mimeType: String(photo && photo.mimeType ? photo.mimeType : "image/jpeg"),
    width: Math.max(1, toSafeInt(photo && photo.width, 1)),
    height: Math.max(1, toSafeInt(photo && photo.height, 1)),
    sizeBytes: Math.max(0, toSafeInt(photo && photo.sizeBytes, 0)),
    originalSizeBytes: Math.max(0, toSafeInt(photo && photo.originalSizeBytes, 0)),
    dataUrl: String(photo && photo.dataUrl ? photo.dataUrl : "")
  }));
}

function normalizePageWritePayload(payload) {
  const record = payload && typeof payload === "object" ? payload : {};
  const now = Date.now();
  const createdAtMs = Math.max(0, toSafeInt(record.createdAtMs, now));
  const updatedAtMs = Math.max(createdAtMs, toSafeInt(record.updatedAtMs, now));
  const pageId = String(record.id || `page_${now}`).trim().slice(0, 140);

  return {
    id: pageId,
    templateType: normalizeTemplateType(record.templateType),
    title: String(record.title || ""),
    recipient: String(record.recipient || "").slice(0, 120),
    date: String(record.date || "").slice(0, 80),
    pinCode: String(record.pinCode || "").replace(/\D/g, "").slice(0, 4),
    message: String(record.message || ""),
    closing: String(record.closing || "With love,").slice(0, 120),
    signature: String(record.signature || "Your Name").slice(0, 120),
    youtubeUrl: String(record.youtubeUrl || "").slice(0, 420),
    photos: normalizeAdminPhotos(record.photos),
    isPublished: true,
    createdAt: String(record.createdAt || new Date(createdAtMs).toISOString()),
    createdAtMs,
    updatedAtMs
  };
}

async function adjustPublicPagesCounter(deltaInput) {
  const delta = toSafeInt(deltaInput, 0);
  if (!delta) {
    return;
  }

  const statsRef = admin.database().ref("publicStats");

  await statsRef.transaction((current) => {
    const record = current && typeof current === "object" ? current : {};
    const currentUsers = Math.max(0, toSafeInt(record.users, PUBLIC_USERS_BASELINE));
    const currentPages = Math.max(0, toSafeInt(record.pages, PUBLIC_PAGES_BASELINE));

    return {
      users: currentUsers,
      pages: Math.max(PUBLIC_PAGES_BASELINE, currentPages + delta),
      updatedAt: Date.now()
    };
  });
}

async function saveUserPage(uid, payload, options) {
  const normalized = normalizePageWritePayload(payload);
  const isAdminActor = Boolean(options && options.isAdmin === true);
  const enforceUniqueId = Boolean(options && options.enforceUniqueId === true) || !isDefaultGeneratedPageId(normalized.id);
  const titleLength = normalized.title.trim().length;
  const messageLength = normalized.message.trim().length;

  if (!normalized.id) {
    return { code: "PAGE_ID_REQUIRED", status: 400 };
  }

  if (titleLength < 1 || titleLength > MAX_PAGE_TITLE_CHARACTERS) {
    return { code: "INVALID_PUBLISH_PAYLOAD", status: 400 };
  }

  if (messageLength < 1 || messageLength > MAX_PAGE_MESSAGE_CHARACTERS) {
    return { code: "INVALID_PUBLISH_PAYLOAD", status: 400 };
  }

  const pageRef = admin.firestore().collection("pages").doc(normalized.id);
  let created = false;

  try {
    await admin.firestore().runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(pageRef);

      if (existingSnapshot.exists) {
        if (enforceUniqueId) {
          const customTakenError = new Error("CUSTOM_PAGE_NAME_TAKEN");
          customTakenError.code = "CUSTOM_PAGE_NAME_TAKEN";
          throw customTakenError;
        }

        const existingData = existingSnapshot.data() || {};
        const ownerUid = String(existingData.uid || "").trim();

        if (!isAdminActor && ownerUid && ownerUid !== uid) {
          const forbiddenError = new Error("PAGE_FORBIDDEN");
          forbiddenError.code = "PAGE_FORBIDDEN";
          throw forbiddenError;
        }

        created = false;
      } else {
        created = true;
      }

      transaction.set(
        pageRef,
        {
          uid,
          templateType: normalized.templateType,
          title: normalized.title,
          recipient: normalized.recipient,
          date: normalized.date,
          pinCode: normalized.pinCode,
          message: normalized.message,
          closing: normalized.closing,
          signature: normalized.signature,
          youtubeUrl: normalized.youtubeUrl,
          photos: normalized.photos,
          isPublished: true,
          createdAt: normalized.createdAt,
          createdAtMs: normalized.createdAtMs,
          updatedAtMs: normalized.updatedAtMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });
  } catch (error) {
    if (error && error.code === "CUSTOM_PAGE_NAME_TAKEN") {
      return { code: "CUSTOM_PAGE_NAME_TAKEN", status: 409 };
    }

    if (error && error.code === "PAGE_FORBIDDEN") {
      return { code: "PAGE_FORBIDDEN", status: 403 };
    }

    throw error;
  }

  if (created) {
    await adjustPublicPagesCounter(1);
  }

  return {
    id: normalized.id,
    created
  };
}

async function deleteUserPage(uid, pageIdInput, options) {
  const pageId = String(pageIdInput || "").trim();
  const isAdminActor = Boolean(options && options.isAdmin === true);

  if (!pageId) {
    return { code: "PAGE_ID_REQUIRED", status: 400 };
  }

  const pageRef = admin.firestore().collection("pages").doc(pageId);
  const snapshot = await pageRef.get();

  if (!snapshot.exists) {
    return { code: "PAGE_NOT_FOUND", status: 404 };
  }

  const data = snapshot.data() || {};
  const ownerUid = String(data.uid || "").trim();

  if (!isAdminActor && ownerUid && ownerUid !== uid) {
    return { code: "PAGE_FORBIDDEN", status: 403 };
  }

  await pageRef.delete();
  await adjustPublicPagesCounter(-1);

  return { id: pageId };
}

async function readUserProfile(uid) {
  const snapshot = await admin.database().ref(`users/${uid}`).get();
  const value = snapshot && typeof snapshot.val === "function" ? snapshot.val() : null;
  return value && typeof value === "object" ? value : {};
}

async function listAllAuthUsers() {
  const users = [];
  let userPageToken = undefined;

  do {
    const batch = await admin.auth().listUsers(ADMIN_AUTH_LIST_BATCH_SIZE, userPageToken);
    users.push(...(Array.isArray(batch && batch.users) ? batch.users : []));
    userPageToken = batch && batch.pageToken ? batch.pageToken : undefined;
  } while (userPageToken);

  return users;
}

function matchesAdminUserSearch(userRecord, normalizedQuery) {
  if (!normalizedQuery) {
    return false;
  }

  const uid = String(userRecord && userRecord.uid ? userRecord.uid : "").toLowerCase();
  if (uid.indexOf(normalizedQuery) !== -1) {
    return true;
  }

  const email = String(userRecord && userRecord.email ? userRecord.email : "").toLowerCase();
  if (email.indexOf(normalizedQuery) !== -1) {
    return true;
  }

  const displayName = String(userRecord && userRecord.displayName ? userRecord.displayName : "").toLowerCase();
  return displayName.indexOf(normalizedQuery) !== -1;
}

function serializeAdminUser(authUser, profile) {
  const profileValue = profile && typeof profile === "object" ? profile : {};
  const createdAtMs = parseAuthCreatedAtMs(authUser);

  return {
    uid: String(authUser && authUser.uid ? authUser.uid : ""),
    email: String(authUser && authUser.email ? authUser.email : ""),
    displayName: String(
      profileValue.displayName ||
      (authUser && authUser.displayName ? authUser.displayName : "") ||
      ""
    ).slice(0, 80),
    credits: Math.max(0, toSafeInt(profileValue.credits, 0)),
    createdAtMs,
    createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : "",
    disabled: Boolean(authUser && authUser.disabled),
    lastSignInAt: String(authUser && authUser.metadata && authUser.metadata.lastSignInTime ? authUser.metadata.lastSignInTime : "")
  };
}

function serializeAdminPageSummary(id, data) {
  const createdAtMs = parsePageCreatedAtMs(data);
  const photos = Array.isArray(data && data.photos) ? data.photos : [];

  return {
    id: String(id || ""),
    uid: String(data && data.uid ? data.uid : ""),
    templateType: normalizeTemplateType(data && data.templateType),
    title: String(data && data.title ? data.title : ""),
    recipient: String(data && data.recipient ? data.recipient : ""),
    date: String(data && data.date ? data.date : ""),
    createdAtMs,
    createdAt: String(data && data.createdAt ? data.createdAt : (createdAtMs ? new Date(createdAtMs).toISOString() : "")),
    updatedAtMs: Math.max(0, toSafeInt(data && data.updatedAtMs, createdAtMs)),
    photoCount: photos.length,
    isPublished: Boolean(data && data.isPublished),
    youtubeUrl: String(data && data.youtubeUrl ? data.youtubeUrl : "")
  };
}

async function buildAdminOverview(daysInput) {
  const dayCount = Math.max(7, Math.min(14, toSafeInt(daysInput, 7)));
  const todayStart = startOfDayMs(Date.now());
  const rangeStart = todayStart - ((dayCount - 1) * DAY_MS);
  const rangeEnd = todayStart + DAY_MS;

  const buckets = [];
  for (let index = 0; index < dayCount; index += 1) {
    const dayStart = rangeStart + (index * DAY_MS);
    buckets.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      label: new Date(dayStart).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      users: 0,
      pages: 0,
      dayStart,
      dayEnd: dayStart + DAY_MS
    });
  }

  let totalUsers = 0;
  let usersToday = 0;
  let userPageToken = undefined;

  do {
    const batch = await admin.auth().listUsers(1000, userPageToken);
    totalUsers += batch.users.length;

    batch.users.forEach((userRecord) => {
      const createdAtMs = parseAuthCreatedAtMs(userRecord);
      if (!createdAtMs) {
        return;
      }

      if (createdAtMs >= todayStart && createdAtMs < rangeEnd) {
        usersToday += 1;
      }

      if (createdAtMs >= rangeStart && createdAtMs < rangeEnd) {
        const bucketIndex = Math.floor((createdAtMs - rangeStart) / DAY_MS);
        if (bucketIndex >= 0 && bucketIndex < buckets.length) {
          buckets[bucketIndex].users += 1;
        }
      }
    });

    userPageToken = batch.pageToken;
  } while (userPageToken);

  const pageCountAggregate = await admin.firestore().collection("pages").count().get();
  const totalPages = Math.max(0, toSafeInt(pageCountAggregate && pageCountAggregate.data().count, 0));

  const pagesWeekSnapshot = await admin
    .firestore()
    .collection("pages")
    .where("createdAtMs", ">=", rangeStart)
    .get();

  let pagesToday = 0;

  pagesWeekSnapshot.forEach((docSnapshot) => {
    const data = docSnapshot.data() || {};
    const createdAtMs = parsePageCreatedAtMs(data);
    if (!createdAtMs || createdAtMs >= rangeEnd) {
      return;
    }

    if (createdAtMs >= todayStart) {
      pagesToday += 1;
    }

    if (createdAtMs >= rangeStart) {
      const bucketIndex = Math.floor((createdAtMs - rangeStart) / DAY_MS);
      if (bucketIndex >= 0 && bucketIndex < buckets.length) {
        buckets[bucketIndex].pages += 1;
      }
    }
  });

  return {
    totals: {
      users: totalUsers,
      pages: totalPages
    },
    today: {
      users: usersToday,
      pages: pagesToday
    },
    series: buckets.map((bucket) => ({
      date: bucket.date,
      label: bucket.label,
      users: bucket.users,
      pages: bucket.pages
    }))
  };
}

async function listAdminUsers(limitInput, pageTokenInput) {
  const limit = Math.max(1, Math.min(50, toSafeInt(limitInput, 20)));
  const offset = parseAdminUsersOffset(pageTokenInput);
  const authUsers = await listAllAuthUsers();

  authUsers.sort((a, b) => parseAuthCreatedAtMs(b) - parseAuthCreatedAtMs(a));

  const pageUsers = authUsers.slice(offset, offset + limit);
  const users = await Promise.all(pageUsers.map(async (userRecord) => {
    const profile = await readUserProfile(userRecord.uid);
    return serializeAdminUser(userRecord, profile);
  }));

  const nextOffset = offset + pageUsers.length;
  const hasMore = nextOffset < authUsers.length;

  return {
    users,
    nextPageToken: hasMore ? String(nextOffset) : null,
    totalUsers: authUsers.length
  };
}

async function searchAdminUsers(queryInput, limitInput) {
  const query = String(queryInput || "").trim();
  const normalizedQuery = query.toLowerCase();
  const limit = Math.max(1, Math.min(100, toSafeInt(limitInput, ADMIN_USER_SEARCH_RESULT_LIMIT)));

  if (!query) {
    return {
      query,
      users: [],
      totalMatches: 0,
      limitApplied: limit
    };
  }

  const authUsers = await listAllAuthUsers();
  const matchedUsers = authUsers
    .filter((userRecord) => matchesAdminUserSearch(userRecord, normalizedQuery))
    .sort((a, b) => parseAuthCreatedAtMs(b) - parseAuthCreatedAtMs(a));

  const selectedUsers = matchedUsers.slice(0, limit);
  const users = await Promise.all(selectedUsers.map(async (userRecord) => {
    const profile = await readUserProfile(userRecord.uid);
    return serializeAdminUser(userRecord, profile);
  }));

  return {
    query,
    users,
    totalMatches: matchedUsers.length,
    limitApplied: limit
  };
}

async function adjustUserCreditsAdmin(payload) {
  const uid = String(payload && payload.uid ? payload.uid : "").trim();
  if (!uid) {
    return { code: "TARGET_UID_REQUIRED", status: 400 };
  }

  const operation = String(payload && payload.operation ? payload.operation : "add").toLowerCase();
  const amount = toSafeInt(payload && payload.amount, 0);
  const creditRef = admin.database().ref(`users/${uid}/credits`);

  const transactionResult = await creditRef.transaction((current) => {
    const base = Math.max(0, toSafeInt(current, 0));

    if (operation === "set") {
      return Math.max(0, amount);
    }

    if (operation === "reduce") {
      return Math.max(0, base - Math.abs(amount));
    }

    if (operation === "adjust") {
      return Math.max(0, base + amount);
    }

    return Math.max(0, base + Math.abs(amount));
  });

  const credits = transactionResult && transactionResult.snapshot
    ? Math.max(0, toSafeInt(transactionResult.snapshot.val(), 0))
    : 0;

  await admin.database().ref(`users/${uid}/updatedAt`).set(Date.now());

  return {
    uid,
    credits,
    operation
  };
}

async function listAdminPages(limitInput, cursorCreatedAtMsInput) {
  const limit = Math.max(1, Math.min(50, toSafeInt(limitInput, 20)));
  const cursorCreatedAtMs = toSafeInt(cursorCreatedAtMsInput, NaN);

  let pageQuery = admin.firestore().collection("pages").orderBy("createdAtMs", "desc");
  if (Number.isFinite(cursorCreatedAtMs)) {
    pageQuery = pageQuery.where("createdAtMs", "<", cursorCreatedAtMs);
  }

  const snapshot = await pageQuery.limit(limit + 1).get();
  const allDocs = snapshot.docs;
  const hasMore = allDocs.length > limit;
  const docs = hasMore ? allDocs.slice(0, limit) : allDocs;

  const pages = docs.map((docSnapshot) => serializeAdminPageSummary(docSnapshot.id, docSnapshot.data() || {}));
  const nextCursorCreatedAtMs = hasMore && pages.length ? pages[pages.length - 1].createdAtMs : null;

  return {
    pages,
    hasMore,
    nextCursorCreatedAtMs
  };
}

async function getAdminPageById(pageIdInput) {
  const pageId = String(pageIdInput || "").trim();
  if (!pageId) {
    return null;
  }

  const docSnapshot = await admin.firestore().collection("pages").doc(pageId).get();
  if (!docSnapshot.exists) {
    return null;
  }

  const data = docSnapshot.data() || {};
  const summary = serializeAdminPageSummary(docSnapshot.id, data);

  return {
    ...summary,
    pinCode: String(data.pinCode || ""),
    message: String(data.message || ""),
    closing: String(data.closing || ""),
    signature: String(data.signature || ""),
    photos: normalizeAdminPhotos(data.photos)
  };
}

async function deleteAdminPage(pageIdInput) {
  return deleteUserPage("", pageIdInput, { isAdmin: true });
}

async function ensureUserRecord(uid, payload) {
  const initialCredits = Math.max(0, toSafeInt(payload && payload.initialCredits, 0));
  const displayName = String(payload && payload.displayName ? payload.displayName : "Writer").slice(0, 80);
  const email = String(payload && payload.email ? payload.email : "").slice(0, 254);
  const userRef = admin.database().ref(`users/${uid}`);

  const result = await userRef.transaction((current) => {
    if (!current || typeof current !== "object") {
      return {
        credits: initialCredits,
        displayName,
        email,
        updatedAt: Date.now()
      };
    }

    const next = { ...current };

    next.credits = Math.max(0, toSafeInt(next.credits, initialCredits));

    if (displayName) {
      next.displayName = displayName;
    }

    if (email) {
      next.email = email;
    }

    next.updatedAt = Date.now();

    return next;
  });

  const value = result && result.snapshot ? result.snapshot.val() : null;
  const credits = value && typeof value === "object"
    ? Math.max(0, toSafeInt(value.credits, 0))
    : 0;

  return { credits };
}

async function incrementCredits(uid, payload) {
  const amount = Math.max(0, toSafeInt(payload && payload.amount, 0));
  const creditRef = admin.database().ref(`users/${uid}/credits`);

  const result = await creditRef.transaction((current) => {
    const base = Math.max(0, toSafeInt(current, 0));
    return Math.max(0, base + amount);
  });

  const credits = result && result.snapshot
    ? Math.max(0, toSafeInt(result.snapshot.val(), 0))
    : 0;

  await admin.database().ref(`users/${uid}/updatedAt`).set(Date.now());

  return { credits };
}

async function consumeCredits(uid, payload) {
  const requestPayload = payload && typeof payload === "object" ? payload : {};
  const pageOptions = normalizePageOptions(requestPayload.pageOptions);
  const pageId = String(requestPayload.pageId || "").trim();
  let amount = Math.max(0, toSafeInt(requestPayload.amount, 0));

  if (requestPayload.publishPayload !== undefined) {
    const requiredCreditsResult = calculateRequiredCreditsForPublish(
      requestPayload.publishPayload,
      pageOptions,
      pageId
    );
    if (requiredCreditsResult && requiredCreditsResult.code) {
      return requiredCreditsResult;
    }

    const requiredCredits = Math.max(1, toSafeInt(requiredCreditsResult && requiredCreditsResult.requiredCredits, 1));
    if (amount > 0 && amount !== requiredCredits) {
      return {
        code: "INVALID_CREDIT_COST",
        status: 400,
        requiredCredits
      };
    }

    amount = requiredCredits;
  }

  if (amount <= 0) {
    return { code: "CREDIT_AMOUNT_REQUIRED", status: 400 };
  }

  const creditRef = admin.database().ref(`users/${uid}/credits`);
  let canConsume = false;

  const result = await creditRef.transaction((current) => {
    const base = Math.max(0, toSafeInt(current, 0));

    canConsume = base >= amount;
    return canConsume ? base - amount : base;
  });

  const finalSnapshot = result && result.snapshot ? result.snapshot : await creditRef.get();
  const finalCredits = Math.max(0, toSafeInt(finalSnapshot && finalSnapshot.val(), 0));

  if (!result || !result.committed) {
    if (finalCredits < amount) {
      return { code: "INSUFFICIENT_CREDITS", status: 409, credits: finalCredits, requiredCredits: amount };
    }

    throw new Error("CREDIT_TX_FAILED");
  }

  if (!canConsume) {
    return { code: "INSUFFICIENT_CREDITS", status: 409, credits: finalCredits, requiredCredits: amount };
  }

  const credits = finalCredits;

  await admin.database().ref(`users/${uid}/updatedAt`).set(Date.now());

  return {
    credits,
    consumedCredits: amount
  };
}

async function claimSupportReward(uid) {
  const userRef = admin.database().ref(`users/${uid}`);
  const now = Date.now();

  const result = await userRef.transaction((current) => {
    const currentRecord = current && typeof current === "object" ? current : {};
    const alreadyClaimed = currentRecord.supportRewardClaimed === true ||
      (typeof currentRecord.supportRewardClaimedAt === "number" && currentRecord.supportRewardClaimedAt > 0);

    if (alreadyClaimed) {
      return;
    }

    const baseCredits = Math.max(0, toSafeInt(currentRecord.credits, 0));

    return {
      ...currentRecord,
      credits: baseCredits + 1,
      supportRewardClaimed: true,
      supportRewardClaimedAt: now,
      updatedAt: now
    };
  });

  const value = result && result.snapshot ? result.snapshot.val() : null;
  const record = value && typeof value === "object" ? value : {};
  const claimedAt = typeof record.supportRewardClaimedAt === "number" && record.supportRewardClaimedAt > 0
    ? Math.floor(record.supportRewardClaimedAt)
    : 0;
  const claimed = Boolean(record.supportRewardClaimed === true || claimedAt > 0);
  const credits = Math.max(0, toSafeInt(record.credits, 0));

  return {
    claimed,
    alreadyClaimed: !Boolean(result && result.committed),
    claimedAt,
    credits
  };
}

function normalizeRewritePath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: API_JSON_BODY_LIMIT }));

app.use((req, _res, next) => {
  try {
    const parsedUrl = new URL(req.url, "http://localhost");
    const rawPath = normalizeRewritePath(parsedUrl.searchParams.get("path"));

    if (rawPath) {
      parsedUrl.searchParams.delete("path");
      const normalizedPath = "/" + rawPath.replace(/^\/+/, "");
      const nextQuery = parsedUrl.searchParams.toString();
      req.url = normalizedPath + (nextQuery ? "?" + nextQuery : "");
      next();
      return;
    }

    if (parsedUrl.pathname === "/api/index") {
      const nextQuery = parsedUrl.searchParams.toString();
      req.url = "/" + (nextQuery ? "?" + nextQuery : "");
    }
  } catch (_error) {
    // Keep original URL if parsing fails.
  }

  next();
});

app.use((req, res, next) => {
  try {
    initAdmin();
    ensurePublicStatsSync();
    next();
  } catch (error) {
    console.error("[admin-api] init error", error);
    res.status(500).json({ code: "ADMIN_API_CONFIG_ERROR" });
  }
});

app.get("/", (_req, res) => {
  res.json({ ok: true, mode: "admin-sdk-vercel" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: "admin-sdk-vercel" });
});

app.post("/pages/check-id", async (req, res) => {
  try {
    const pageName = normalizeCustomPageName(req.body && req.body.pageName);

    if (!isValidCustomPageName(pageName)) {
      res.json({
        pageName,
        valid: false,
        available: false
      });
      return;
    }

    const pageSnapshot = await admin.firestore().collection("pages").doc(pageName).get();
    res.json({
      pageName,
      valid: true,
      available: !pageSnapshot.exists
    });
  } catch (error) {
    console.error("[admin-api] custom page id check error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/credits/voucher/check", async (req, res) => {
  try {
    const voucherCode = String(req.body && req.body.voucherCode ? req.body.voucherCode : "").trim().slice(0, 40);
    res.json({
      valid: voucherCode ? isVoucherCodeValid(voucherCode) : false
    });
  } catch (error) {
    console.error("[admin-api] voucher check error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/credits/ensure", requireAuth, async (req, res) => {
  try {
    const payload = await ensureUserRecord(req.user.uid, req.body || {});
    res.json(payload);
  } catch (error) {
    console.error("[admin-api] ensure error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/credits/increment", requireAuth, async (req, res) => {
  try {
    const payload = await incrementCredits(req.user.uid, req.body || {});
    res.json(payload);
  } catch (error) {
    console.error("[admin-api] increment error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/credits/consume", requireAuth, async (req, res) => {
  try {
    const payload = await consumeCredits(req.user.uid, req.body || {});

    if (payload && payload.code) {
      if (payload.code === "INSUFFICIENT_CREDITS") {
        const insufficientBody = {
          ok: false,
          code: "INSUFFICIENT_CREDITS",
          credits: Math.max(0, toSafeInt(payload.credits, 0))
        };

        if (Number.isFinite(Number(payload.requiredCredits))) {
          insufficientBody.requiredCredits = Math.max(0, toSafeInt(payload.requiredCredits, 0));
        }

        res.status(200).json(insufficientBody);
        return;
      }

      const errorBody = {
        code: String(payload.code)
      };

      if (Number.isFinite(Number(payload.requiredCredits))) {
        errorBody.requiredCredits = Math.max(0, toSafeInt(payload.requiredCredits, 0));
      }

      if (Number.isFinite(Number(payload.credits))) {
        errorBody.credits = Math.max(0, toSafeInt(payload.credits, 0));
      }

      res.status(payload.status || 400).json(errorBody);
      return;
    }

    res.json(Object.assign({ ok: true }, payload));
  } catch (error) {
    console.error("[admin-api] consume error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/credits/support-claim", requireAuth, async (req, res) => {
  try {
    const payload = await claimSupportReward(req.user.uid);
    res.json(Object.assign({ ok: true }, payload));
  } catch (error) {
    console.error("[admin-api] support claim error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/pages/save", requireAuth, async (req, res) => {
  try {
    const payload = await saveUserPage(req.user.uid, req.body && req.body.payload, {
      isAdmin: Boolean(req.user && req.user.admin === true)
    });

    if (payload && payload.code) {
      res.status(payload.status || 400).json({ code: payload.code });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error("[admin-api] page save error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/pages/delete", requireAuth, async (req, res) => {
  try {
    const payload = await deleteUserPage(
      req.user.uid,
      req.body && req.body.pageId,
      { isAdmin: Boolean(req.user && req.user.admin === true) }
    );

    if (payload && payload.code) {
      res.status(payload.status || 400).json({ code: payload.code });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error("[admin-api] page delete error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.get("/admin/overview", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await buildAdminOverview(req.query && req.query.days);
    res.json(payload);
  } catch (error) {
    console.error("[admin-api] overview error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.get("/admin/config/support-gate", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const payload = await getSupportGateConfigAdmin();
    res.json(payload);
  } catch (error) {
    console.error("[admin-api] support gate config read error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/admin/config/support-gate", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await updateSupportGateConfigAdmin(req.body || {}, req.user && req.user.uid);
    if (payload && payload.code) {
      res.status(payload.status || 400).json({ code: payload.code });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error("[admin-api] support gate config write error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await listAdminUsers(
      req.query && req.query.limit,
      req.query && req.query.pageToken
    );
    res.json(payload);
  } catch (error) {
    console.error("[admin-api] users list error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.get("/admin/users/search", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await searchAdminUsers(
      req.query && (req.query.q || req.query.uid || req.query.email),
      req.query && req.query.limit
    );
    res.json(payload);
  } catch (error) {
    console.error("[admin-api] users search error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.post("/admin/users/credits/adjust", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await adjustUserCreditsAdmin(req.body || {});
    if (payload && payload.code) {
      res.status(payload.status || 400).json({ code: payload.code });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error("[admin-api] credits adjust error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.get("/admin/pages", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await listAdminPages(
      req.query && req.query.limit,
      req.query && req.query.cursorCreatedAtMs
    );
    res.json(payload);
  } catch (error) {
    console.error("[admin-api] pages list error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.get("/admin/pages/:pageId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await getAdminPageById(req.params && req.params.pageId);
    if (!payload) {
      res.status(404).json({ code: "PAGE_NOT_FOUND" });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error("[admin-api] page detail error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.delete("/admin/pages/:pageId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = await deleteAdminPage(req.params && req.params.pageId);
    if (payload && payload.code) {
      res.status(payload.status || 400).json({ code: payload.code });
      return;
    }

    res.json(payload);
  } catch (error) {
    console.error("[admin-api] page delete error", error);
    res.status(500).json({ code: "ADMIN_API_ERROR" });
  }
});

app.use((error, _req, res, next) => {
  if (error && (error.type === "entity.too.large" || error.status === 413)) {
    res.status(413).json({ code: "PAGE_PAYLOAD_TOO_LARGE" });
    return;
  }

  next(error);
});

app.use((_req, res) => {
  res.status(404).json({ code: "ADMIN_API_NOT_FOUND" });
});

module.exports = (req, res) => {
  app(req, res);
};
