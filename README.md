# BXS Financial Dashboard v2

## What's new
- Google + email/password login
- Whitelist — only approved emails can access
- All data stored in Supabase, syncs across all devices

## Deploy

### 1. Install dependencies
```bash
npm install
```

### 2. Push to GitHub
```bash
git add .
git commit -m "v2 with supabase auth"
git push
```

### 3. Update Vercel environment variables
Go to your Vercel project → Settings → Environment Variables and add:

```
ANTHROPIC_API_KEY      = sk-ant-...
VITE_SUPABASE_URL      = https://moyxrlytxpijjhvwcxap.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGci...
```

Then go to Deployments → click the three dots on the latest → Redeploy.

### 4. Add your Vercel URL to Supabase allowed redirects
In Supabase → Authentication → URL Configuration:
- Site URL: https://your-app.vercel.app
- Redirect URLs: https://your-app.vercel.app

### 5. Add your Vercel URL to Google OAuth
In Google Cloud Console → APIs & Services → Credentials → your OAuth client:
- Authorised JavaScript origins: https://your-app.vercel.app
- Authorised redirect URIs: https://moyxrlytxpijjhvwcxap.supabase.co/auth/v1/callback
