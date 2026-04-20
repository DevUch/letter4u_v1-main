const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const projectId = "letter4u-bd394";
const databaseURL = "https://letter4u-bd394-default-rtdb.firebaseio.com";
const PUBLIC_USERS_BASELINE = 577;
const PUBLIC_PAGES_BASELINE = 958;

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
  const localPath = path.join(__dirname, "serviceAccountKey.json");

  if (envValue) {
    if (fs.existsSync(envValue)) {
      return normalizeServiceAccountPayload(require(envValue));
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

  return normalizeServiceAccountPayload(require(localPath));
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

function toSafeInt(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.floor(parsed);
  }

  return fallback;
}

async function countRealtimeUsers(rtdb) {
  const snapshot = await rtdb.ref("users").get();
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

async function main() {
  initAdmin();

  const auth = admin.auth();
  const firestore = admin.firestore();
  const rtdb = admin.database();

  const targetAdminUid = process.argv[2];
  if (targetAdminUid) {
    await auth.setCustomUserClaims(targetAdminUid, { admin: true });
    console.log(`Granted admin claim to UID: ${targetAdminUid}`);
  }

  const realtimeUserCount = await countRealtimeUsers(rtdb);
  const pagesAggregate = await firestore.collection("pages").count().get();
  const firestorePageCount = Math.max(0, toSafeInt(pagesAggregate && pagesAggregate.data().count, 0));

  const userCount = Math.max(0, PUBLIC_USERS_BASELINE + realtimeUserCount);
  const pageCount = Math.max(0, PUBLIC_PAGES_BASELINE + firestorePageCount);

  await rtdb.ref("publicStats").set({
    users: userCount,
    pages: pageCount,
    updatedAt: Date.now()
  });

  console.log("Admin setup complete.");
  console.log(
    `publicStats.users = ${userCount} (base ${PUBLIC_USERS_BASELINE} + realtime users ${realtimeUserCount})`
  );
  console.log(
    `publicStats.pages = ${pageCount} (base ${PUBLIC_PAGES_BASELINE} + firestore pages ${firestorePageCount})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
