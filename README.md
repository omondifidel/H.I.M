# Read-Aloud PDF (backend + frontend, Stage 3)

Needs: Python 3.11+, PostgreSQL (local, or a free Neon/Supabase database), Node.js 18+.

## How to run
See GETTING-STARTED.md for the full step-by-step (VS Code, Windows / Mac / Linux).

## What works now
Sign up with invite code, library (upload, search, delete, save offline), reader with
paragraph splitting, play/pause, previous/next paragraph, speed, voice choice, page
arrows, resume where you stopped, lock-screen controls.
Stage 3: pencil notes (bottom sheet over the page, audio keeps playing), notes saved on
the device as you type, pinned to a paragraph if you want, synced to the server when
online (newer edit wins), and an offline app shell (service worker, installable).

## Offline notes
- Open the app once online, open each PDF once, then it also loads without internet.
- The service worker only runs in the production build (npm run build), not npm run dev.
- On http://localhost it works. On other devices offline install needs https.

## Next
Polish and fixes from your testing, then Capacitor packaging for Android.
