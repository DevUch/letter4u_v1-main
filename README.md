# Letter4U Frontend Website

This project is a working multi-page frontend app with Firebase integration.

## Core stack

- Tailwind CSS (CDN)
- Vanilla JavaScript app controller
- Firebase Web SDK (Auth, Firestore, Realtime Database)
- Firebase Admin SDK scripts and Cloud Functions for secured write tasks

## Project structure

- `index.html` root entry page
- `pages/` app routes
- `css/site.css` shared styling
- `scripts/site.js` app logic and state flow
- `scripts/firebase-client.js` Firebase client bridge
- `scripts/tailwind-theme.js` Tailwind tokens and theme extension
- `firebase/` rules and admin tooling

## Runtime data model

- Firestore: page documents in `pages` collection
- Realtime Database: user credits at `users/{uid}/credits`
- Realtime Database: public integer totals at `publicStats/users` and `publicStats/pages`
- Credits are viewed in realtime via Firebase client SDK, while credit writes go through Admin SDK callable functions

## Authentication

- Google Sign-In uses Firebase Auth popup flow
- On sign-in, frontend syncs profile + credits in Realtime Database
- On sign-out, app falls back to local mode

## Credit update flow

- Frontend reads credits live from Realtime Database listener
- Frontend requests credit mutation via callable Cloud Functions
- Cloud Functions mutate credit balances using Firebase Admin SDK

## Security model

- Firestore rules in `firebase/firestore.rules`
- Realtime DB rules in `firebase/database.rules.json`
- Users can only access their own records
- Public users/pages totals are read-only integers for clients
- Admin claim (`admin: true`) can manage global counters and protected updates

## Install

```bash
npm install
```

## Run localhost

```bash
npm run serve
```

Then open the URL printed by `serve` (usually `http://localhost:3000`).

## Vercel CLI integration

The project uses Vercel CLI through npx.

Use Node.js 22 LTS for the cleanest install/build output (some transitive packages warn on Node 24).

```bash
npm run vercel:dev
```

Use this to preview the app in Vercel's local runtime.

```bash
npm run vercel:deploy
```

Creates a preview deployment.

```bash
npm run vercel:prod
```

Creates a production deployment.

## Firebase deploy setup

1. Place service account key at `firebase/admin/serviceAccountKey.json`, or set `GOOGLE_APPLICATION_CREDENTIALS`.
2. Grant admin claim (optional but recommended):

```bash
npm run firebase:admin:setup -- <UID>
```

3. Sync global public stats:

```bash
npm run firebase:admin:sync-stats
```

4. Deploy security rules:

```bash
npx firebase-tools deploy --only functions,firestore:rules,database
```

## Notes

- Firebase config currently points to project `letter4u-bd394`.
- Prototype folders were removed to keep only production app structure.
