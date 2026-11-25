# Me-Nasoma (Read-Aloud): Library, Transcribe & Admin

A monolithic FastAPI application serving three static Next.js applications from a single server on port `8000`:

| Route | Description | Source Folder |
| :--- | :--- | :--- |
| `/` | PDF Library & AI Read-Aloud Reader | `frontend/` |
| `/transcribe/` | Audio & Sermon Transcription Engine | `frontend-stt/` |
| `/admin/` | User Management, Access Control & Usage | `frontend-admin/` |
| `/api/...` | FastAPI Backend & PostgreSQL API | `backend/` |

---

## 1. Prerequisites (One-Time Setup)

Install these tools before setting up the project:

1. **Python 3.11+**
2. **Node.js 18+**
3. **FFmpeg** (required for splitting and processing long audio files):
   ```powershell
   winget install ffmpeg
   ```
   > **Important:** Completely close and reopen VS Code (or your terminal) after installing FFmpeg so your system `PATH` updates. Verify with `ffmpeg -version`.

---

## 2. Environment Configuration

### A. Backend (`backend/.env`)
Copy `backend/.env.example` to `backend/.env` and configure your keys:

```env
# Database (PostgreSQL / Supabase Pooler)
DATABASE_URL=postgresql+psycopg://postgres.<project-ref>:<password>@[aws-0-eu-west-1.pooler.supabase.com:5432/postgres](https://aws-0-eu-west-1.pooler.supabase.com:5432/postgres)

# Security & Access
SECRET_KEY=replace-with-a-long-random-secret-string
INVITE_CODE=choose-a-code-for-friends
ADMIN_EMAILS=your-admin-email@example.com
DEFAULT_APPS=library,transcribe

# Transcription (Groq Whisper API - free key from [https://console.groq.com/keys](https://console.groq.com/keys))
GROQ_API_KEY=gsk_your_actual_groq_api_key_here
TRANSCRIBE_ENGINE=groq
GROQ_CHAT_MODEL=openai/gpt-oss-120b   # voice Q&A, same Groq key
MAX_AUDIO_MB=600

# Storage & CORS
STORAGE_DIR=./storage
STORAGE_BACKEND=local
MAX_UPLOAD_MB=100
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002
```

### B. Frontends (`frontend/.env.local`, `frontend-admin/.env.local`, `frontend-stt/.env.local`)
In **all three** frontend folders, create `.env.local` (from `.env.local.example`) and leave `NEXT_PUBLIC_API_URL` **blank** so all screens send requests to the same origin (`http://127.0.0.1:8000`) without CORS errors:

```env
NEXT_PUBLIC_API_URL=
```

> **Note:** Ensure `frontend/next.config.js` includes `output: "export"` so `npm run build` generates the static `out/` directory served by FastAPI.

---

## 3. First-Time Installation & Static Builds

Run these commands from the project root (`readaloud-pdf-app`):

### Step 1: Set up the Python virtual environment
```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
cd backend
pip install -r requirements.txt
cd ..
```

### Step 2: Build all three static frontends
FastAPI serves the compiled `out/` folders from each frontend. Run this during initial setup and **any time you edit frontend code**:
```powershell
cd frontend; npm install; npm run build; cd ..
cd frontend-admin; npm install; npm run build; cd ..
cd frontend-stt; npm install; npm run build; cd ..
```

Verify that all three `out/` folders exist (must return `True` three times):
```powershell
Test-Path frontend\out, frontend-admin\out, frontend-stt\out
```

---

## 4. Daily Startup Command (Running the App)

Whenever you want to start the application for normal use or testing (without frontend code changes), run from the project root:

```powershell
# 1. Activate the Python virtual environment
.\backend\.venv\Scripts\Activate.ps1

# 2. Start the FastAPI server
cd backend
python -m uvicorn app.main:app --port 8000
```

Wait until you see:
```text
INFO:     Application startup complete.
INFO:     Uvicorn running on [http://127.0.0.1:8000](http://127.0.0.1:8000)
```

---

## 5. First-Time Sign-In & Testing

Always access the app via **`http://127.0.0.1:8000`** (do not mix `localhost` and `127.0.0.1`, and do not open `/admin/` or `/transcribe/` on `npm run dev` ports):

1. **Verify Backend Health:** Open `http://127.0.0.1:8000/api/health` $\rightarrow$ returns `{"ok":true}`.
2. **Create Your Admin Account:**
   - Open `http://127.0.0.1:8000/`.
   - Click **I have an invite code** (passwords are created on first registration, not stored in `.env`).
   - Enter your `INVITE_CODE` from `backend/.env`, an email listed in `ADMIN_EMAILS`, and choose your password.
3. **Open the Apps:**
   - **Library & Reader:** `http://127.0.0.1:8000/`
   - **Admin Dashboard:** `http://127.0.0.1:8000/admin/`
   - **Transcription Engine:** `http://127.0.0.1:8000/transcribe/`

---

## Voice Assistant (hands-free)

Tap the **mic orb** on the player bar (or press **Ctrl+Space**), say one command, and it runs.

**Hands-free mode:** turn on the **Hands-free** pill in the reader, or the checkbox in the sermon editor. Then say **"Hey Nasoma"** ("Hey assistant" also works), either alone or followed by a command, e.g. "Hey Nasoma, go to page 42". Reading pauses as soon as the wake word is heard and resumes after the command. The setting is remembered on the device. While you dictate a note, the words appear live under it as you speak. Playback pauses while the mic listens and resumes afterwards. It works in Chrome and Edge, which have live speech recognition. The answers to questions use the same `GROQ_API_KEY`.

| Say | Book reader | Sermon editor |
| :--- | :--- | :--- |
| "Pause" / "Resume" | Reading stops or starts | Audio stops or starts |
| "Read faster", "Slow down", "Speed 1.25" | Changes speed by 0.25, or sets it | Same (up to 2x) |
| "Go to page 42" / "Go to minute 5" | Jumps to the page | Jumps to the minute |
| "Bookmark this paragraph" | 🔖 note pinned to the page and paragraph | 🔖 note at the current time |
| "Switch to dark / light / sepia mode" | Changes the theme in all apps | Same |
| "Open notes and write …" / "Take a note …" | Opens the notes drawer and types what you say, stamped with the page and paragraph | Opens Notes and types what you say, stamped with the mm:ss time |
| "Stop note" (or tap the mic, or stay quiet for 8 s) | Ends the note | Ends the note |
| "Next / previous paragraph" | Moves one paragraph | Jumps to the next or previous paragraph's time |
| "Next / previous page" | Turns the page | Says sermons have no pages |
| "Skip forward 30 seconds", "Go back", "Rewind" | Moves one paragraph forward or back | Skips by that many seconds (default 10) |
| "Show my notes" / "Close notes" | Opens or closes the notes drawer | Opens or closes the Notes panel |
| "Go to my last note" | Jumps to the page of your latest note | Jumps to that note's time |
| "Delete that note" | Deletes the open note | Deletes the latest note |
| "Stop" (hands-free, while an answer is spoken) | Cuts the answer off | Cuts the answer off |
| "Stop listening" / "Hands-free on" | Turns hands-free off or on | Same |
| "What did Sir Elvin say about faith in this message?" | Spoken answer taken only from pages ±2 around yours | Spoken answer taken only from the transcript |

If the answer isn't in the text, the assistant says *"The text doesn't say."* Run the parser check with `node frontend/lib/voice.check.mjs`. Run the backend tests with `cd backend; pytest`.

> `frontend/lib/voice.js`, `useVoice.js` and `theme.js` are copied into `frontend-stt/lib/`. Edit both copies.

---

## 6. Troubleshooting Quick Reference

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| **`404 Not Found` on `/`, `/admin/`, or `/transcribe/`** | Frontend static `out/` folder was not built before starting Uvicorn. | Run `npm run build` in the missing frontend folder, verify with `Test-Path`, and restart Uvicorn. |
| **Redirected back to `/` when opening `/admin/` or `/transcribe/`** | Not signed in, or your email is not in `ADMIN_EMAILS` / `DEFAULT_APPS`. | Sign in at `http://127.0.0.1:8000/` first, and verify `ADMIN_EMAILS` in `backend/.env`. |
| **`Failed to fetch` on `/admin/` or `/transcribe/`** | `NEXT_PUBLIC_API_URL` had `http://localhost:8000` baked into the build while browsing on `127.0.0.1`. | Clear `NEXT_PUBLIC_API_URL=` in all `.env.local` files, rebuild the frontends, and restart Uvicorn. |
| **`The transcription key was rejected`** | Missing, expired, or mistyped `GROQ_API_KEY` in `backend/.env`. | Generate a fresh `gsk_...` key at [console.groq.com/keys](https://console.groq.com/keys), paste it into `backend/.env` without quotes, and restart Uvicorn. |
| **Audio splitting fails / `ffmpeg not recognized`** | FFmpeg is not installed or VS Code wasn't restarted after installation. | Run `winget install ffmpeg` and restart VS Code. |
| **Old UI or cached PDF text showing** | Service Worker or IndexedDB cached an older build. | Open Chrome DevTools (`F12`) $\rightarrow$ **Application** $\rightarrow$ **Storage** $\rightarrow$ **Clear site data**, then hard-refresh (`Ctrl + Shift + R`). |