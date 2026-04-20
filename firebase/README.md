# Firebase Setup

This project uses Firebase client SDK on the frontend and Firebase Admin SDK for secured setup tasks and credit mutations.

## Client runtime usage

- Google sign-in uses Firebase Authentication.
- User pages are stored in Firestore collection `pages`.
- Credits are stored in Realtime Database at `users/{uid}/credits`.
- Credits are read live with the normal Firebase client SDK, but credit writes are performed through Cloud Functions using Admin SDK.
- Public integer counters are stored in Realtime Database at `publicStats/{users,pages}`.

## Security files

- Firestore rules: `firebase/firestore.rules`
- Realtime Database rules: `firebase/database.rules.json`

## Admin scripts

- `firebase/admin/setup-admin.js`
- `firebase/admin/sync-stats.js`

These scripts require a service account key.

## Cloud Functions (Admin SDK credit updates)

- Source: `functions/index.js`
- Deployed functions:
   - `ensureUserRecord`
   - `incrementCredits`
   - `consumeCredits`
   - `adminAdjustCredits` (admin claim required)

These functions update Realtime Database credits with Admin SDK so client code does not directly mutate credit balances.

### Service account placement

Use either:

1. Environment variable `GOOGLE_APPLICATION_CREDENTIALS` pointing to the JSON key file.
2. File path `firebase/admin/serviceAccountKey.json`.

### Setup flow

1. Install dependencies: `npm install`
2. Optional: grant admin claim for a UID and initialize stats:
   - `npm run firebase:admin:setup -- <UID>`
3. Sync public counters at any time:
   - `npm run firebase:admin:sync-stats`
4. Deploy functions and rules:
   - `npx firebase-tools deploy --only functions,firestore:rules,database`

## Data visibility model

- Users can read their own `users/{uid}` record in Realtime DB.
- Users can update profile fields, but direct credit value changes are restricted.
- Users can read/write only Firestore page documents where `uid == auth.uid`.
- Public users/pages totals are exposed as integers under `publicStats`.
- Admin (custom claim `admin: true`) can manage all records.
