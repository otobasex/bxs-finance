# BXS Financial Dashboard

## Deploy in 5 steps

### 1. Install dependencies
```bash
npm install
```

### 2. Test locally
```bash
npm run dev
```
Open http://localhost:5173 — everything works except AI features (those need the proxy, which runs on Vercel).

### 3. Push to GitHub
```bash
git init
git add .
git commit -m "init"
```
Create a new repo at github.com, then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/bxs-finance.git
git push -u origin main
```

### 4. Deploy to Vercel
1. Go to vercel.com → Add New → Project
2. Import your `bxs-finance` GitHub repo
3. Leave all build settings as defaults (Vercel detects Vite automatically)
4. Before clicking Deploy, go to **Environment Variables** and add:
   ```
   ANTHROPIC_API_KEY = sk-ant-...your key...
   ```
5. Click Deploy

### 5. Done
Your dashboard is live at `bxs-finance.vercel.app`

---

## How the proxy works

All Claude API calls go through `/api/claude` (the file at `api/claude.js`).
This runs as a Vercel serverless function, so your API key never touches the browser.

- **AI Categorise** → `/api/claude` → Anthropic API
- **PDF upload** → `/api/claude` → Anthropic API (with base64 PDF)
- **CSV upload** → parsed locally in the browser, no API call needed

## Getting your Anthropic API key

1. Go to console.anthropic.com
2. Settings → API Keys → Create Key
3. Copy it and paste into Vercel's environment variables
