# Read-Aloud PDF: Getting Started (VS Code)

Everything runs on your own computer, free. You need ONE terminal for setup and ONE for running.

## 0. Install once
- VS Code:      https://code.visualstudio.com
- Python 3.11+: https://www.python.org/downloads  (Windows: tick "Add python.exe to PATH")
- Node.js 18+:  already installed
- PostgreSQL:   https://www.postgresql.org/download  (remember the password you set for the "postgres" user)
- Use Chrome or Edge for testing (best voices and offline support).

## 1. Open the project
1. Unzip `readaloud-pdf-app.zip`.
2. VS Code > File > Open Folder > choose the `readaloud-pdf-app` folder.
3. Open a terminal: Terminal > New Terminal (Ctrl + `).

## 2. Create the database (once)
Windows (PowerShell). Replace 16 with your PostgreSQL version:
    & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE readaloud;"
Mac / Linux:
    psql -U postgres -c "CREATE DATABASE readaloud;"
(It asks for the postgres password.) Alternative: open pgAdmin, right-click Databases > Create > name it `readaloud`.

## 3. Set up the backend (once)
Windows (PowerShell):
    cd backend
    python -m venv .venv
    .venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    copy .env.example .env
If PowerShell blocks the activate step, run this once, then try again:
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Mac / Linux:
    cd backend
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env

Now open `backend/.env` in VS Code and edit:
- DATABASE_URL   -> put your postgres password:  postgresql+psycopg://postgres:YOURPASSWORD@localhost:5432/readaloud
- SECRET_KEY     -> any long random text. To make one:  python -c "import secrets; print(secrets.token_hex(32))"
- INVITE_CODE    -> a code you choose and give to friends

## 4. Build the frontend (once, and again after any frontend change)
Open a second terminal (the + button in the terminal panel):
    cd frontend
    npm install
    npm run build

## 5. Run the app
In the backend terminal (the one where `(.venv)` shows at the start of the line):
    cd backend          (skip if you are already in backend)
    python -m uvicorn app.main:app --port 8000
Open http://localhost:8000 in Chrome.
Stop the server with Ctrl + C. Next time you only need step 5 (activate the venv first).

Shortcut: Terminal > Run Task... has "Frontend: build" and "Backend: run (port 8000)".

## 6. Test with the 2 sample PDFs (in the `samples` folder)
1. Click "I have an invite code", enter an email, a password (8+ characters) and your INVITE_CODE.
2. Click "+ Add PDF" and upload `Sample-1-Garden-Notes.pdf`, then `Sample-2-Money-Basics.pdf`.
3. Open one with "Listen". Check:
   [ ] The text appears, one paragraph highlighted.
   [ ] Play starts reading; Pause stops it.
   [ ] Next / Previous paragraph work (also while playing).
   [ ] Speed slider changes the speed; the Voice list changes the voice.
   [ ] Page arrows (top right) move between pages.
   [ ] Tap any paragraph to start from there.
   [ ] Pencil button opens notes; type a note; audio keeps playing; badge says "Saved on device".
   [ ] "Pin to current paragraph" works; "Show all notes" lists notes.
   [ ] Close the tab, reopen the PDF: it resumes where you stopped, and the note is still there.
   [ ] Offline: with the page loaded, turn off Wi-Fi (or DevTools > Network > Offline), add a note, turn Wi-Fi on:
       the badge changes to "Saved and synced".
4. Test with your own PDFs too (text PDFs; scanned ones will show a "no readable text" message).

## Development mode (live reload, optional)
Terminal 1 (backend):  python -m uvicorn app.main:app --reload --port 8000
Terminal 2 (frontend): cd frontend ; copy .env.local.example .env.local   (Mac/Linux: cp) ; npm run dev
Open http://localhost:3000   (the offline service worker only works in the built version on :8000)

## Troubleshooting
- "KeyError: DATABASE_URL" or "SECRET_KEY": the .env file is missing or not in the `backend` folder.
- "password authentication failed": the password in DATABASE_URL is wrong.
- "connection refused": PostgreSQL is not running (start the PostgreSQL service).
- "database readaloud does not exist": redo step 2.
- Blank page at :8000: run `npm run build` in `frontend` (step 4).
- PDF will not open / worker error: make sure `frontend/public/pdf.worker.min.js` exists (run `npm install` again), then rebuild.
- No voices or no sound: use Chrome or Edge, and click Play once (browsers need a click before speaking).
- You changed frontend code but nothing changed: rebuild, then hard refresh (Ctrl+Shift+R). If it still shows the old version:
  DevTools (F12) > Application > Service Workers > Unregister, then refresh.
- Port 8000 already in use: use `--port 8001` and open that port instead.
- Paste any other error message to Claude and it will be fixed.
