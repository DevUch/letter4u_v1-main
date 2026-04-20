const admin = require("firebase-admin");
const functions = require("firebase-functions");

if (!admin.apps.length) {
  admin.initializeApp();
}

const LOVE_LOCK_FIRST_CREDIT_CHARACTERS = 300;
const LOVE_LOCK_FIRST_CREDIT_PHOTOS = 2;
const LOVE_LOCK_CHARACTERS_PER_CREDIT = 550;
const DEFAULT_CHARACTERS_PER_CREDIT = 300;
const PHOTOS_PER_CREDIT = 4;
const MAX_PAGE_PHOTOS = 30;
const MAX_PAGE_TITLE_CHARACTERS = 200;
const MAX_PAGE_MESSAGE_CHARACTERS = 5000;
const CUSTOM_PAGE_NAME_EXTRA_CREDITS = 2;
const CUSTOM_PAGE_NAME_MIN_LENGTH = 4;
const CUSTOM_PAGE_NAME_MAX_LENGTH = 15;
const VOUCHER_DISCOUNT_CREDITS = 1;
const VOUCHER_MINIMUM_REQUIRED_CREDITS = 2;
const DEFAULT_KENJI_VOUCHER_CODE = "KENJI";
const PUBLIC_PAGES_BASELINE = 958;

function toSafeInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.floor(parsed);
  }
  return fallback;
}

function requireAuth(context) {
  if (!context || !context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "AUTH_REQUIRED", {
      code: "AUTH_REQUIRED"
    });
  }

  return context.auth.uid;
}

function isAdminContext(context) {
  return Boolean(context && context.auth && context.auth.token && context.auth.token.admin === true);
}

function sanitizeName(value, fallback) {
  const candidate = String(value || fallback || "").trim();
  return candidate.slice(0, 80);
}

function sanitizeEmail(value) {
  return String(value || "").trim().slice(0, 254);
}

function isValidEmail(value) {
  if (!value) {
    return true;
  }

  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
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

function isYouTubeUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }

  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)/i.test(normalized);
}

function normalizePhotos(photos) {
  if (!Array.isArray(photos)) {
    return [];
  }

  return photos.slice(0, MAX_PAGE_PHOTOS).map((photo, index) => ({
    id: String(photo && photo.id ? photo.id : `photo_${index}`).slice(0, 140),
    name: String(photo && photo.name ? photo.name : "image.jpg").slice(0, 120),
    mimeType: String(photo && photo.mimeType ? photo.mimeType : "image/jpeg").slice(0, 60),
    width: Math.max(1, toSafeInteger(photo && photo.width, 1)),
    height: Math.max(1, toSafeInteger(photo && photo.height, 1)),
    sizeBytes: Math.max(0, toSafeInteger(photo && photo.sizeBytes, 0)),
    originalSizeBytes: Math.max(0, toSafeInteger(photo && photo.originalSizeBytes, 0)),
    dataUrl: String(photo && photo.dataUrl ? photo.dataUrl : "")
  }));
}

function normalizePageWritePayload(payload) {
  const record = payload && typeof payload === "object" ? payload : {};
  const now = Date.now();
  const createdAtMs = Math.max(0, toSafeInteger(record.createdAtMs, now));
  const updatedAtMs = Math.max(createdAtMs, toSafeInteger(record.updatedAtMs, now));
  const pageId = String(record.id || `page_${now}`).trim().slice(0, 140);

  return {
    id: pageId,
    templateType: normalizeTemplateType(record.templateType),
    title: String(record.title || "").slice(0, MAX_PAGE_TITLE_CHARACTERS),
    recipient: String(record.recipient || "").slice(0, 120),
    date: String(record.date || "").slice(0, 80),
    pinCode: String(record.pinCode || "").replace(/\D/g, "").slice(0, 4),
    message: String(record.message || "").slice(0, MAX_PAGE_MESSAGE_CHARACTERS),
    closing: String(record.closing || "With love,").slice(0, 120),
    signature: String(record.signature || "Your Name").slice(0, 120),
    youtubeUrl: String(record.youtubeUrl || "").slice(0, 420),
    photos: normalizePhotos(record.photos),
    isPublished: true,
    createdAt: String(record.createdAt || new Date(createdAtMs).toISOString()).slice(0, 80),
    createdAtMs,
    updatedAtMs
  };
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
    return { code: "INVALID_PUBLISH_PAYLOAD" };
  }

  const normalizedOptions = normalizePageOptions(options);
  const normalizedPageId = String(pageIdInput || "").trim();

  const titleLength = normalized.title.trim().length;
  const messageLength = normalized.message.trim().length;

  if (titleLength < 1 || titleLength > MAX_PAGE_TITLE_CHARACTERS) {
    return { code: "INVALID_PUBLISH_PAYLOAD" };
  }

  if (messageLength < 1 || messageLength > MAX_PAGE_MESSAGE_CHARACTERS) {
    return { code: "INVALID_PUBLISH_PAYLOAD" };
  }

  const photoCount = Math.max(0, normalized.photos.length);
  const photoCredits = Math.max(1, Math.ceil(Math.max(1, photoCount) / PHOTOS_PER_CREDIT));
  let baseRequiredCredits = 1;

  if (normalized.templateType === "love-lock") {
    if (messageLength < 12) {
      return { code: "INVALID_LOVE_LOCK_MESSAGE" };
    }

    if (!/^\d{4}$/.test(normalized.pinCode)) {
      return { code: "INVALID_PIN_CODE" };
    }

    if (normalized.youtubeUrl && !isYouTubeUrl(normalized.youtubeUrl)) {
      return { code: "INVALID_YOUTUBE_URL" };
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
      return { code: "CRT_PHOTO_REQUIRED" };
    }

    if (!isYouTubeUrl(normalized.youtubeUrl)) {
      return { code: "CRT_YOUTUBE_REQUIRED" };
    }

    const textCredits = Math.max(
      1,
      Math.ceil(Math.max(1, messageLength) / DEFAULT_CHARACTERS_PER_CREDIT)
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
    return { code: "CUSTOM_PAGE_NAME_FLAG_REQUIRED" };
  }

  let customPageName = "";
  if (customNameRequested) {
    customPageName = normalizeCustomPageName(normalizedOptions.customPageName || customNameFromId);

    if (!customPageName) {
      return { code: "CUSTOM_PAGE_NAME_REQUIRED" };
    }

    if (!isValidCustomPageName(customPageName)) {
      return { code: "INVALID_CUSTOM_PAGE_NAME" };
    }

    if (customNameByIdRequested && customPageName !== customNameFromId) {
      return { code: "INVALID_CUSTOM_PAGE_NAME" };
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

function toHttpsErrorByCode(code, details) {
  const normalizedCode = String(code || "INVALID_PUBLISH_PAYLOAD");
  const baseDetails = details && typeof details === "object" ? details : {};

  if (normalizedCode === "INSUFFICIENT_CREDITS") {
    return new functions.https.HttpsError("failed-precondition", normalizedCode, {
      code: normalizedCode,
      ...baseDetails
    });
  }

  if (normalizedCode === "CUSTOM_PAGE_NAME_TAKEN") {
    return new functions.https.HttpsError("failed-precondition", normalizedCode, {
      code: normalizedCode,
      ...baseDetails
    });
  }

  if (normalizedCode === "PAGE_FORBIDDEN" || normalizedCode === "ADMIN_REQUIRED") {
    return new functions.https.HttpsError("permission-denied", normalizedCode, {
      code: normalizedCode,
      ...baseDetails
    });
  }

  if (normalizedCode === "PAGE_NOT_FOUND") {
    return new functions.https.HttpsError("not-found", normalizedCode, {
      code: normalizedCode,
      ...baseDetails
    });
  }

  return new functions.https.HttpsError("invalid-argument", normalizedCode, {
    code: normalizedCode,
    ...baseDetails
  });
}

async function adjustPublicPagesCounter(deltaInput) {
  const delta = toSafeInteger(deltaInput, 0);
  if (!delta) {
    return;
  }

  const statsRef = admin.database().ref("publicStats");

  await statsRef.transaction((current) => {
    const record = current && typeof current === "object" ? current : {};
    const currentUsers = Math.max(0, toSafeInteger(record.users, 0));
    const currentPages = Math.max(0, toSafeInteger(record.pages, PUBLIC_PAGES_BASELINE));

    return {
      users: currentUsers,
      pages: Math.max(PUBLIC_PAGES_BASELINE, currentPages + delta),
      updatedAt: Date.now()
    };
  });
}

async function ensureUserRecordInternal(uid, payload) {
  const initialCredits = Math.max(0, toSafeInteger(payload && payload.initialCredits, 0));
  const displayName = sanitizeName(payload && payload.displayName, "Writer");
  const email = sanitizeEmail(payload && payload.email);
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
    next.credits = Math.max(0, toSafeInteger(next.credits, initialCredits));

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
  return {
    credits: value && typeof value === "object" ? Math.max(0, toSafeInteger(value.credits, 0)) : 0
  };
}

async function consumeCreditsInternal(uid, amountInput) {
  const amount = Math.max(0, toSafeInteger(amountInput, 0));
  const creditsRef = admin.database().ref(`users/${uid}/credits`);
  let canConsume = false;

  const result = await creditsRef.transaction((current) => {
    const base = Math.max(0, toSafeInteger(current, 0));
    canConsume = base >= amount;
    return canConsume ? base - amount : base;
  });

  const finalSnapshot = result && result.snapshot ? result.snapshot : await creditsRef.get();
  const credits = Math.max(0, toSafeInteger(finalSnapshot && finalSnapshot.val(), 0));

  if (!result || !result.committed || !canConsume) {
    return {
      ok: false,
      credits
    };
  }

  return {
    ok: true,
    credits
  };
}

async function refundCreditsInternal(uid, amountInput) {
  const amount = Math.max(0, toSafeInteger(amountInput, 0));
  if (!amount) {
    return;
  }

  const creditsRef = admin.database().ref(`users/${uid}/credits`);
  await creditsRef.transaction((current) => {
    const base = Math.max(0, toSafeInteger(current, 0));
    return Math.max(0, base + amount);
  });
}

async function saveUserPageInternal(uid, payload, isAdminActor, writeOptions) {
  const options = writeOptions && typeof writeOptions === "object" ? writeOptions : {};
  const enforceUniqueId = options.enforceUniqueId === true;
  const normalized = normalizePageWritePayload(payload);

  if (!normalized.id) {
    throw toHttpsErrorByCode("PAGE_ID_REQUIRED");
  }

  const pageRef = admin.firestore().collection("pages").doc(normalized.id);
  let created = false;

  await admin.firestore().runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(pageRef);

    if (existingSnapshot.exists) {
      if (enforceUniqueId) {
        throw toHttpsErrorByCode("CUSTOM_PAGE_NAME_TAKEN");
      }

      const existingData = existingSnapshot.data() || {};
      const ownerUid = String(existingData.uid || "").trim();

      if (!isAdminActor && ownerUid && ownerUid !== uid) {
        throw toHttpsErrorByCode("PAGE_FORBIDDEN");
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

  return {
    id: normalized.id,
    created,
    normalized
  };
}

async function deleteUserPageInternal(uid, pageIdInput, isAdminActor) {
  const pageId = String(pageIdInput || "").trim();
  if (!pageId) {
    throw toHttpsErrorByCode("PAGE_ID_REQUIRED");
  }

  const pageRef = admin.firestore().collection("pages").doc(pageId);
  const snapshot = await pageRef.get();

  if (!snapshot.exists) {
    throw toHttpsErrorByCode("PAGE_NOT_FOUND");
  }

  const data = snapshot.data() || {};
  const ownerUid = String(data.uid || "").trim();

  if (!isAdminActor && ownerUid && ownerUid !== uid) {
    throw toHttpsErrorByCode("PAGE_FORBIDDEN");
  }

  await pageRef.delete();
  return { id: pageId };
}

exports.ensureUserRecord = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  return ensureUserRecordInternal(uid, data && typeof data === "object" ? data : {});
});

exports.updateUserProfile = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const payload = data && typeof data === "object" ? data : {};
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : {};

  const displayName = sanitizeName(profile.displayName, "");
  const email = sanitizeEmail(profile.email);

  if (!displayName) {
    throw toHttpsErrorByCode("PROFILE_INVALID_DISPLAY_NAME");
  }

  if (!isValidEmail(email)) {
    throw toHttpsErrorByCode("PROFILE_INVALID_EMAIL");
  }

  await admin.database().ref(`users/${uid}`).update({
    displayName,
    email,
    updatedAt: Date.now()
  });

  return {
    ok: true,
    displayName,
    email
  };
});

exports.checkCustomPageNameAvailability = functions.https.onCall(async (data) => {
  const payload = data && typeof data === "object" ? data : {};
  const pageName = normalizeCustomPageName(payload.pageName);

  if (!isValidCustomPageName(pageName)) {
    return {
      pageName,
      valid: false,
      available: false
    };
  }

  const pageSnapshot = await admin.firestore().collection("pages").doc(pageName).get();

  return {
    pageName,
    valid: true,
    available: !pageSnapshot.exists
  };
});

exports.checkVoucherCode = functions.https.onCall(async (data) => {
  const payload = data && typeof data === "object" ? data : {};
  const voucherCode = String(payload.voucherCode || "").trim().slice(0, 40);

  return {
    valid: voucherCode ? isVoucherCodeValid(voucherCode) : false
  };
});

exports.consumeCredits = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const payload = data && typeof data === "object" ? data : {};
  const pageOptions = normalizePageOptions(payload.pageOptions);
  const pageId = String(payload.pageId || "").trim();
  let amount = Math.max(0, toSafeInteger(payload.amount, 0));

  if (payload.publishPayload !== undefined) {
    const requiredCreditsResult = calculateRequiredCreditsForPublish(
      payload.publishPayload,
      pageOptions,
      pageId
    );
    if (requiredCreditsResult && requiredCreditsResult.code) {
      throw toHttpsErrorByCode(requiredCreditsResult.code);
    }

    const requiredCredits = Math.max(1, toSafeInteger(requiredCreditsResult.requiredCredits, 1));
    if (amount > 0 && amount !== requiredCredits) {
      throw toHttpsErrorByCode("INVALID_CREDIT_COST", {
        requiredCredits
      });
    }
    amount = requiredCredits;
  }

  if (amount <= 0) {
    throw toHttpsErrorByCode("CREDIT_AMOUNT_REQUIRED");
  }

  const consumeResult = await consumeCreditsInternal(uid, amount);
  if (!consumeResult.ok) {
    throw toHttpsErrorByCode("INSUFFICIENT_CREDITS", {
      credits: consumeResult.credits,
      requiredCredits: amount
    });
  }

  await admin.database().ref(`users/${uid}/updatedAt`).set(Date.now());

  return {
    credits: consumeResult.credits,
    consumedCredits: amount
  };
});

exports.publishPage = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const requestPayload = data && typeof data === "object" ? data : {};
  let normalizedPayload = normalizePageWritePayload(requestPayload.payload);
  const pageOptions = normalizePageOptions(requestPayload.pageOptions);
  const publishValidationPayload = requestPayload.publishPayload && typeof requestPayload.publishPayload === "object"
    ? requestPayload.publishPayload
    : normalizedPayload;

  const requiredCreditsResult = calculateRequiredCreditsForPublish(
    publishValidationPayload,
    pageOptions,
    normalizedPayload.id
  );
  if (requiredCreditsResult && requiredCreditsResult.code) {
    throw toHttpsErrorByCode(requiredCreditsResult.code);
  }

  if (requiredCreditsResult.customPageNameEnabled) {
    normalizedPayload = {
      ...normalizedPayload,
      id: requiredCreditsResult.customPageName
    };
  }

  const requiredCredits = Math.max(1, toSafeInteger(requiredCreditsResult && requiredCreditsResult.requiredCredits, 1));
  const consumeResult = await consumeCreditsInternal(uid, requiredCredits);

  if (!consumeResult.ok) {
    throw toHttpsErrorByCode("INSUFFICIENT_CREDITS", {
      credits: consumeResult.credits,
      requiredCredits
    });
  }

  try {
    const saveResult = await saveUserPageInternal(
      uid,
      normalizedPayload,
      isAdminContext(context),
      {
        enforceUniqueId: requiredCreditsResult.customPageNameEnabled
      }
    );

    if (saveResult.created) {
      await adjustPublicPagesCounter(1);
    }

    await admin.database().ref(`users/${uid}/updatedAt`).set(Date.now());

    return {
      id: saveResult.id,
      created: saveResult.created,
      credits: consumeResult.credits,
      consumedCredits: requiredCredits,
      requiredCredits,
      voucherApplied: Boolean(requiredCreditsResult.voucherApplied),
      customPageNameEnabled: Boolean(requiredCreditsResult.customPageNameEnabled)
    };
  } catch (error) {
    await refundCreditsInternal(uid, requiredCredits).catch(() => {
      // Best effort refund if page write fails.
    });

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError("internal", "PUBLISH_FAILED", {
      code: "PUBLISH_FAILED"
    });
  }
});

exports.deletePage = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const payload = data && typeof data === "object" ? data : {};
  const result = await deleteUserPageInternal(uid, payload.pageId, isAdminContext(context));
  await adjustPublicPagesCounter(-1);
  await admin.database().ref(`users/${uid}/updatedAt`).set(Date.now());
  return result;
});

exports.claimSupportReward = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);
  const userRef = admin.database().ref(`users/${uid}`);
  const now = Date.now();

  const result = await userRef.transaction((current) => {
    const currentRecord = current && typeof current === "object" ? current : {};
    const alreadyClaimed = currentRecord.supportRewardClaimed === true ||
      (typeof currentRecord.supportRewardClaimedAt === "number" && currentRecord.supportRewardClaimedAt > 0);

    if (alreadyClaimed) {
      return;
    }

    const baseCredits = Math.max(0, toSafeInteger(currentRecord.credits, 0));

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
  const credits = Math.max(0, toSafeInteger(record.credits, 0));

  return {
    claimed,
    alreadyClaimed: !Boolean(result && result.committed),
    claimedAt,
    credits
  };
});

exports.incrementCredits = functions.https.onCall(async (data, context) => {
  requireAuth(context);

  if (!isAdminContext(context)) {
    throw toHttpsErrorByCode("ADMIN_REQUIRED");
  }

  const payload = data && typeof data === "object" ? data : {};
  const targetUid = String(payload.uid || "").trim();
  const amount = Math.max(0, toSafeInteger(payload.amount, payload.delta));

  if (!targetUid) {
    throw toHttpsErrorByCode("TARGET_UID_REQUIRED");
  }

  if (amount <= 0) {
    throw toHttpsErrorByCode("CREDIT_AMOUNT_REQUIRED");
  }

  const creditsRef = admin.database().ref(`users/${targetUid}/credits`);

  const transactionResult = await creditsRef.transaction((current) => {
    const base = Math.max(0, toSafeInteger(current, 0));
    return Math.max(0, base + amount);
  });

  const credits = transactionResult && transactionResult.snapshot
    ? Math.max(0, toSafeInteger(transactionResult.snapshot.val(), 0))
    : 0;

  await admin.database().ref(`users/${targetUid}/updatedAt`).set(Date.now());

  return {
    uid: targetUid,
    credits
  };
});

exports.adminAdjustCredits = exports.incrementCredits;
