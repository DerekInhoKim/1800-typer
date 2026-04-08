# 1800-TYPER — Deploy Guide

Two pieces to deploy:
1. **Server** → Railway (free) — handles multiplayer + leaderboard
2. **Frontend** → Netlify (free) — the HTML file your team visits

---

## Step 1 — Deploy the Server to Railway

### Option A: GitHub (recommended)
1. Create a new GitHub repo, push this entire folder to it
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select your repo — Railway auto-detects Node.js
4. In project Settings → Variables, no env vars needed (PORT is set automatically)
5. Click **Deploy** — takes ~1 minute
6. Go to Settings → Networking → Generate Domain
7. Copy your Railway URL (looks like `https://1800-typer-server-production.up.railway.app`)

### Option B: Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway domain
```

---

## Step 2 — Update the Frontend with Your Server URL

Open `index.html` and find this line near the top of the `<script>`:

```js
: 'https://YOUR-RAILWAY-URL.railway.app'; // <-- replace after deploy
```

Replace `YOUR-RAILWAY-URL.railway.app` with your actual Railway domain.

---

## Step 3 — Deploy Frontend to Netlify

1. Rename `index.html` if desired (keep it as `index.html` for Netlify)
2. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
3. Drag and drop just the `index.html` file
4. Create/log into your free Netlify account to claim the site
5. In Site Settings → Change site name → set to `1800-typer` (or similar)
6. Share the URL: `https://1800-typer.netlify.app`

---

## Features

### Solo Test
- 15s / 30s / 60s / 2min modes
- Words, Quote, Code content modes
- Live WPM, accuracy, chars, errors
- Session history with personal best highlighting
- Submit score to global leaderboard

### Multiplayer
- Create a room → share the 4-letter code
- Up to 8 players per room
- 3-second countdown, then race live
- Real-time progress bars for all racers
- Podium results screen at the end
- Host can start a rematch

### Leaderboard
- Global persistent leaderboard (top 100)
- Filter by All Time or Today
- Shows WPM, raw WPM, accuracy, errors, mode, date

---

## Local Development

```bash
npm install
npm run dev   # starts server on port 3001
```

Open `index.html` directly in your browser — it auto-connects to localhost:3001.
