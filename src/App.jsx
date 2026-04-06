import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { supabase } from "./supabase.js";

/* ─── DEFAULT CATEGORIES ─── */
const DEFAULT_CATEGORIES = [
  { id: "income",    name: "Income",              color: "#22c55e", icon: "↓" },
  { id: "transfers", name: "Transfers Out",        color: "#E31A51", icon: "→" },
  { id: "food",      name: "Food & Delivery",      color: "#F27067", icon: "🍔" },
  { id: "travel",    name: "Travel",               color: "#8b5cf6", icon: "✈" },
  { id: "utilities", name: "Utilities",            color: "#0ea5e9", icon: "⚡" },
  { id: "airtime",   name: "Airtime & Data",       color: "#f59e0b", icon: "📱" },
  { id: "subs",      name: "Subscriptions",        color: "#6366f1", icon: "▶" },
  { id: "savings",   name: "Savings & Investment", color: "#14b8a6", icon: "🏦" },
  { id: "fees",      name: "Bank Fees",            color: "#94a3b8", icon: "🏛" },
  { id: "shopping",  name: "Shopping",             color: "#ec4899", icon: "🛍" },
  { id: "rent",      name: "Rent",                 color: "#a855f7", icon: "🏠" },
  { id: "business",  name: "Business",             color: "#3b82f6", icon: "💼" },
  { id: "other",     name: "Other",                color: "#7A756E", icon: "•"  },
];

function buildCatMap(cats) {
  const m = {};
  cats.forEach(c => { m[c.name] = { color: c.color, bg: c.color + "18", icon: c.icon }; });
  return m;
}

/* ─── FY MONTHS: March → February ─── */
const FY_MONTHS = ["Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb"];
const ALL_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// FY 2025/26 = Mar 2025 – Feb 2026 (startYear = 2025).
// FY 2026/27 = Mar 2026 – Feb 2027 (startYear = 2026).
// In Apr 2026 (m=3, y=2026): month >= 2 → startYear = 2026. ✓ (we're in FY 2026/27)
// In Jan 2026 (m=0, y=2026): month < 2  → startYear = 2025. ✓ (we're still in FY 2025/26)
function currentFYStartYear() {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  return m >= 2 ? y : y - 1;
}

function getFYMonths(startYear) {
  return FY_MONTHS.map(mn => {
    const monthIdx = ALL_MONTHS.indexOf(mn);
    const year = monthIdx >= 2 ? startYear : startYear + 1;
    return { month: monthIdx, year, label: `${mn} ${year}` };
  });
}

// All FY start years present in data, plus current FY, newest first
function getAllFYStartYears(allTransactions) {
  const current = currentFYStartYear();
  const fromTxs = new Set(
    allTransactions.map(t => {
      const d = new Date(t.date);
      const m = d.getMonth();
      const y = d.getFullYear();
      return m >= 2 ? y : y - 1;
    })
  );
  fromTxs.add(current);
  return [...fromTxs].sort((a, b) => b - a);
}

/* ─── FALLBACK CATEGORISER ─── */
function categoriseFallback(description, isCredit, catNames) {
  const d = description.toLowerCase();
  if (isCredit) return "Income";
  if (d.includes("rent") || d.includes("rental")) return catNames.includes("Rent") ? "Rent" : "Other";
  if (d.includes("investment") || d.includes("saving")) return catNames.includes("Savings & Investment") ? "Savings & Investment" : "Other";
  if (d.includes("mr d") || d.includes("food") || d.includes("zulzi") || d.includes("pizza") || d.includes("pnp") || d.includes("barbe") || d.includes("checkers") || d.includes("woolworths")) return catNames.includes("Food & Delivery") ? "Food & Delivery" : "Other";
  if (d.includes("travel") || d.includes("plane") || d.includes("uber") || d.includes("flight")) return catNames.includes("Travel") ? "Travel" : "Other";
  if (d.includes("electricity") || d.includes("prepaid elec")) return catNames.includes("Utilities") ? "Utilities" : "Other";
  if (d.includes("airtime") || d.includes("data")) return catNames.includes("Airtime & Data") ? "Airtime & Data" : "Other";
  if (d.includes("app store") || d.includes("netflix") || d.includes("spotify") || d.includes("subscription")) return catNames.includes("Subscriptions") ? "Subscriptions" : "Other";
  if (d.includes("takealot") || d.includes("amazon")) return catNames.includes("Shopping") ? "Shopping" : "Other";
  if (d.includes("fee") || d.includes("charge") || d.includes("monthly account") || d.includes("service fee")) return catNames.includes("Bank Fees") ? "Bank Fees" : "Other";
  if (d.includes("hosting") || d.includes("dv8") || d.includes("ginger") || d.includes("akpabio") || d.includes("technology")) return catNames.includes("Business") ? "Business" : "Other";
  if (d.includes("transfer to") || d.includes("send") || d.includes("payment to") || d.includes("pmt to") || d.includes("payshap")) return catNames.includes("Transfers Out") ? "Transfers Out" : "Other";
  return "Other";
}

/* ─── AI CATEGORISER ─── */
async function categoriseWithAI(transactions, catNames) {
  const toClassify = transactions.filter(t => !t.isCredit);
  if (!toClassify.length) return transactions;
  const validCats = catNames.filter(c => c !== "Income");
  const prompt = `You are a South African bank statement categoriser. Categorise each transaction into exactly one of these categories: ${validCats.join(", ")}
Rules:
- "Transfers Out" = personal transfers to own/other accounts
- "Savings & Investment" = investment or savings transfers
- "Rent" = rent payments
- "Food & Delivery" = restaurants, food delivery, groceries
- "Travel" = transport, flights, Uber, travel bookings
- "Utilities" = electricity, water, prepaid
- "Airtime & Data" = airtime, data, mobile top-up
- "Subscriptions" = streaming, software, digital content
- "Shopping" = retail, Takealot, Amazon
- "Bank Fees" = bank charges, service fees, monthly account fee
- "Business" = business expenses, software, hosting, contractors
- "Other" = anything that doesn't fit above
Return ONLY a JSON array with "id" and "category" fields. No markdown, no explanation.
Transactions:
${toClassify.map(t => `{"id":${t.id},"desc":"${t.description}","amount":${t.amount}}`).join("\n")}`;
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await response.json();
  const text = data.content?.map(c => c.text || "").join("") || "";
  const results = JSON.parse(text.replace(/```json|```/g, "").trim());
  const map = {};
  results.forEach(r => { map[r.id] = r.category; });
  return transactions.map(t => ({ ...t, category: t.isCredit ? "Income" : (map[t.id] || t.category), aiCategorised: !t.isCredit && !!map[t.id] }));
}

/* ─── PARSE STATEMENT ─── */
function parseStatement(text, catNames) {
  const transactions = [];
  const monthMap = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const normalized = text.replace(/\s+/g, " ").trim();
  const chunks = normalized.split(/(?=\b\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/);
  const dateRe = /^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(.+?)\s+([\d,]+\.\d{2})(Cr)?\s+([\d,]+\.\d{2})(Cr)?/;
  for (const chunk of chunks) {
    const m = chunk.trim().match(dateRe);
    if (!m) continue;
    const day = parseInt(m[1]), month = monthMap[m[2]], desc = m[3].trim();
    const amount = parseFloat(m[4].replace(/,/g, "")), isCredit = m[5] === "Cr";
    const year = month >= 11 ? 2025 : 2026;
    transactions.push({ id: transactions.length, date: new Date(year, month, day), dateStr: `${m[2]} ${day}`, description: desc, amount, isCredit, category: categoriseFallback(desc, isCredit, catNames), aiCategorised: false, manualCategory: null });
  }
  return transactions;
}

function detectPeriodLabel(transactions) {
  if (!transactions.length) return "Imported";
  const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const months = [...new Set(transactions.map(t => `${mn[t.date.getMonth()]} ${t.date.getFullYear()}`))];
  return months.join(" – ");
}

function sortStatements(stmts) {
  return [...stmts].sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    if (a.sortOrder != null) return -1;
    if (b.sortOrder != null) return 1;
    const aMin = a.transactions.length ? Math.min(...a.transactions.map(t => t.date.getTime())) : 0;
    const bMin = b.transactions.length ? Math.min(...b.transactions.map(t => t.date.getTime())) : 0;
    return aMin - bMin;
  });
}

/* ─── SPREADSHEET PARSER ─── */
async function parseSpreadsheet(file) {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const XLSX = window.XLSX;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  if (rows.length < 2) return [];
  const MNS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const formatDate = (raw) => {
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw)) return `${String(raw.getDate()).padStart(2,"0")} ${MNS[raw.getMonth()]}`;
    const s = String(raw).trim();
    const m0 = s.match(/^(\d{1,2})\s+([A-Za-z]{3})/);
    if (m0) { const mo = MNS.findIndex(m => m.toLowerCase() === m0[2].toLowerCase()); if (mo !== -1) return `${String(parseInt(m0[1])).padStart(2,"0")} ${MNS[mo]}`; }
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m1) { const d=parseInt(m1[1]),mo=parseInt(m1[2])-1; if(mo>=0&&mo<12) return `${String(d).padStart(2,"0")} ${MNS[mo]}`; }
    const m2 = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (m2) { const mo=parseInt(m2[2])-1,d=parseInt(m2[3]); if(mo>=0&&mo<12) return `${String(d).padStart(2,"0")} ${MNS[mo]}`; }
    return null;
  };
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cells = rows[i].map(c => String(c).toLowerCase().trim());
    const hasDate = cells.some(c => c === "date");
    const hasAmt  = cells.some(c => c.includes("amount") || c.includes("debit") || c.includes("credit"));
    const hasDesc = cells.some(c => c.includes("desc") || c.includes("narrat") || c.includes("detail") || c.includes("transaction") || c.includes("particular"));
    if (hasDate && (hasAmt || hasDesc)) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];
  const headers = rows[headerIdx].map(h => String(h).toLowerCase().trim());
  const col = (terms) => headers.findIndex(h => terms.some(t => h.includes(t)));
  const dateIdx = col(["date"]);
  const descIdx = col(["description","narration","details","reference","particular","transaction","desc"]);
  const amtIdx  = col(["amount"]);
  const credIdx = col(["credit","deposit","money in"]);
  const debIdx  = col(["debit","withdrawal","money out"]);
  if (dateIdx === -1) return [];
  const resolvedDescIdx = descIdx !== -1 ? descIdx : 2;
  const results = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[dateIdx];
    const desc = String(row[resolvedDescIdx] || "").trim();
    const dateStr = formatDate(dateRaw);
    if (!dateStr || !desc || desc.toLowerCase() === "description") continue;
    let amount = 0, isCredit = false;
    if (credIdx !== -1 && debIdx !== -1) {
      const credRaw = String(row[credIdx] || "").replace(/[^\d.]/g, "");
      const debRaw  = String(row[debIdx]  || "").replace(/[^\d.]/g, "");
      const cred = parseFloat(credRaw) || 0;
      const deb  = parseFloat(debRaw)  || 0;
      if (cred > 0) { amount = cred; isCredit = true; }
      else if (deb > 0) { amount = deb; isCredit = false; }
      else continue;
    } else if (amtIdx !== -1) {
      const raw = String(row[amtIdx] || "").trim();
      if (!raw) continue;
      const hasCr = /cr$/i.test(raw);
      const num = parseFloat(raw.replace(/[^\d.\-]/g, "")) || 0;
      if (num === 0) continue;
      isCredit = hasCr;
      amount = Math.abs(num);
    } else continue;
    if (amount === 0) continue;
    results.push(`${dateStr} ${desc} ${amount.toFixed(2)}${isCredit ? "Cr" : ""} 0.00`);
  }
  return results.join("\n");
}

/* ─── LOGIN SCREEN ─── */
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const handleGoogle = async () => {
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) { setError(error.message); setLoading(false); }
  };

  const handleEmail = async () => {
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setLoading(true); setError(null);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage("Check your email for a confirmation link.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Incorrect email or password.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#E31A51", marginBottom: 10 }}>Base X Studio</div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 900, fontSize: 28, letterSpacing: "-0.03em", textTransform: "uppercase", color: "#0A0A0A" }}>Financial<br />Dashboard</div>
        </div>
        <div style={{ background: "#F5F5F5", border: "1px solid rgba(0,0,0,0.10)", borderRadius: 24, padding: 32, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.4)", marginBottom: 4 }}>
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </div>
          <button onClick={handleGoogle} disabled={loading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px", borderRadius: 12, border: "1.5px solid rgba(0,0,0,0.10)", background: "white", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600, color: "#0A0A0A", transition: "all 0.15s" }}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
            Continue with Google
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.3)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
          </div>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email address"
            style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.10)", background: "white", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "#0A0A0A", outline: "none" }} />
          <input value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleEmail()} type="password" placeholder="Password"
            style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.10)", background: "white", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "#0A0A0A", outline: "none" }} />
          {error && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#E31A51", padding: "8px 12px", background: "rgba(227,26,81,0.06)", borderRadius: 8 }}>{error}</div>}
          {message && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#14b8a6", padding: "8px 12px", background: "rgba(20,184,166,0.06)", borderRadius: 8 }}>{message}</div>}
          <button onClick={handleEmail} disabled={loading} style={{ padding: "13px", borderRadius: 100, background: "linear-gradient(135deg, #E31A51, #FF5C7A)", border: "none", color: "white", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 12px rgba(227,26,81,0.3)", marginTop: 4 }}>
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
          <div style={{ textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 4 }}>
            {mode === "login" ? (
              <span>No account? <button onClick={() => { setMode("signup"); setError(null); }} style={{ background: "none", border: "none", color: "#E31A51", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", fontWeight: 700 }}>Sign up</button></span>
            ) : (
              <span>Have an account? <button onClick={() => { setMode("login"); setError(null); }} style={{ background: "none", border: "none", color: "#E31A51", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", fontWeight: 700 }}>Sign in</button></span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.25)", letterSpacing: "0.06em" }}>
          Private access only · Base X Studio 2026
        </div>
      </div>
    </div>
  );
}

function fmt(n, short = false) {
  if (short && n >= 1000) return "R\u00A0" + (n / 1000).toFixed(1) + "k";
  return "R\u00A0" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── YEAR CHART ─── */
function YearChart({ allTransactions, selectedMonth, onSelectMonth, dark }) {
  const [tooltip, setTooltip] = useState(null);
  const [fyStartYear, setFyStartYear] = useState(() => currentFYStartYear());

  const fyYears = useMemo(() => getAllFYStartYears(allTransactions), [allTransactions]);
  const fyMonths = useMemo(() => getFYMonths(fyStartYear), [fyStartYear]);

  const canGoBack = fyYears.some(y => y < fyStartYear);
  const canGoFwd  = fyYears.some(y => y > fyStartYear);

  const prevFY = () => {
    const older = fyYears.filter(y => y < fyStartYear);
    if (older.length) { setFyStartYear(Math.max(...older)); onSelectMonth(null); }
  };
  const nextFY = () => {
    const newer = fyYears.filter(y => y > fyStartYear);
    if (newer.length) { setFyStartYear(Math.min(...newer)); onSelectMonth(null); }
  };

  const monthData = useMemo(() => {
    return fyMonths.map(({ month, year, label }) => {
      const txs = allTransactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === month && d.getFullYear() === year;
      });
      const income = txs.filter(t => t.isCredit).reduce((s, t) => s + t.amount, 0);
      const spend  = txs.filter(t => !t.isCredit).reduce((s, t) => s + t.amount, 0);
      return { month, year, label, income, spend, net: income - spend, hasTxs: txs.length > 0 };
    });
  }, [allTransactions, fyMonths]);

  const maxVal = Math.max(...monthData.map(m => Math.max(m.income, m.spend)), 1);
  const totalIncome = monthData.reduce((s, m) => s + m.income, 0);
  const totalSpend  = monthData.reduce((s, m) => s + m.spend, 0);

  return (
    <div style={{ background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: "var(--r-xl)", padding: "20px 24px 16px", marginBottom: 14, position: "relative", overflow: "visible" }}>
      {/* bg grid lines — full width, top to bottom */}
      <div style={{ position: "absolute", left: 24, right: 24, top: 52, bottom: 40, pointerEvents: "none", zIndex: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{ width: "100%", height: "1px", background: "rgba(0,0,0,0.06)" }} />
        ))}
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, position: "relative", zIndex: 1 }}>
        <div>
          {/* FY Navigator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <button onClick={prevFY} disabled={!canGoBack} style={{ background: "transparent", border: "none", cursor: canGoBack ? "pointer" : "default", color: canGoBack ? "var(--ink-mid)" : "var(--cream-border)", fontSize: 16, lineHeight: 1, padding: "0 2px", transition: "color 0.15s" }}>‹</button>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-light)" }}>
              Financial Year · {fyStartYear}/{fyStartYear + 1}
            </div>
            <button onClick={nextFY} disabled={!canGoFwd} style={{ background: "transparent", border: "none", cursor: canGoFwd ? "pointer" : "default", color: canGoFwd ? "var(--ink-mid)" : "var(--cream-border)", fontSize: 16, lineHeight: 1, padding: "0 2px", transition: "color 0.15s" }}>›</button>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <div>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)" }}>Income  </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, color: "#16a34a" }}>{fmt(totalIncome, true)}</span>
            </div>
            <div>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)" }}>Spend  </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, color: "#E31A51" }}>{fmt(totalSpend, true)}</span>
            </div>
            <div>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)" }}>Net  </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, color: totalIncome - totalSpend >= 0 ? "#16a34a" : "#E31A51" }}>{fmt(totalIncome - totalSpend, true)}</span>
            </div>
          </div>
        </div>
        {selectedMonth && (
          <button onClick={() => onSelectMonth(null)} style={{ background: "var(--cream)", border: "1px solid var(--cream-border)", borderRadius: 100, padding: "4px 12px", color: "var(--ink-mid)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", cursor: "pointer", textTransform: "uppercase" }}>
            Clear ✕
          </button>
        )}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 100, position: "relative", zIndex: 1 }}>
        {monthData.map((m, i) => {
          const isSelected = selectedMonth && selectedMonth.month === m.month && selectedMonth.year === m.year;
          const incomeH = m.income > 0 ? Math.max((m.income / maxVal) * 100, 3) : 0;
          const spendH  = m.spend  > 0 ? Math.max((m.spend  / maxVal) * 100, 3) : 0;
          const isEmpty = !m.hasTxs;

          return (
            <div
              key={i}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: isEmpty ? "default" : "pointer", gap: 3, position: "relative" }}
              onClick={() => !isEmpty && onSelectMonth(isSelected ? null : m)}
              onMouseEnter={() => !isEmpty && setTooltip(i)}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Tooltip */}
              {tooltip === i && (
                <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "var(--ink)", border: "none", borderRadius: 10, padding: "10px 12px", zIndex: 20, pointerEvents: "none", minWidth: 130, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.9)", marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#4ade80", marginBottom: 2 }}>↑ {fmt(m.income, true)}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#f87171", marginBottom: 2 }}>↓ {fmt(m.spend, true)}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: m.net >= 0 ? "#4ade80" : "#f87171", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 4, marginTop: 4 }}>
                    {m.net >= 0 ? "+" : ""}{fmt(m.net, true)}
                  </div>
                </div>
              )}

              {/* Bar pair — thinner, brighter */}
              <div style={{ width: "100%", display: "flex", gap: 1, alignItems: "flex-end", height: 90 }}>
                {/* Income bar */}
                <div style={{
                  flex: 1,
                  height: isEmpty ? 2 : `${incomeH}%`,
                  background: isEmpty ? "rgba(0,0,0,0.06)" : isSelected ? "#16a34a" : "#22c55e",
                  borderRadius: "2px 2px 0 0",
                  transition: "all 0.25s ease",
                  opacity: isEmpty ? 1 : isSelected ? 1 : selectedMonth ? 0.35 : 0.85,
                  minHeight: isEmpty ? 2 : undefined,
                }} />
                {/* Spend bar */}
                <div style={{
                  flex: 1,
                  height: isEmpty ? 2 : `${spendH}%`,
                  background: isEmpty ? "rgba(0,0,0,0.06)" : isSelected ? "#E31A51" : "#f87171",
                  borderRadius: "2px 2px 0 0",
                  transition: "all 0.25s ease",
                  opacity: isEmpty ? 1 : isSelected ? 1 : selectedMonth ? 0.35 : 0.85,
                  minHeight: isEmpty ? 2 : undefined,
                }} />
              </div>

              {/* Month label */}
              <div style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 8, fontWeight: isSelected ? 700 : 400,
                color: isSelected ? "var(--ink)" : isEmpty ? "var(--cream-border)" : "var(--ink-faint)",
                letterSpacing: "0.04em", textTransform: "uppercase",
                transition: "color 0.2s",
                paddingTop: 4,
              }}>
                {ALL_MONTHS[m.month].slice(0,3)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected month indicator */}
      {selectedMonth && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--cream-border)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.06em" }}>
          Showing  <span style={{ color: "var(--ink)", fontWeight: 700 }}>{selectedMonth.label}</span>  below · Click bar again or Clear to see full year
        </div>
      )}
    </div>
  );
}

/* ─── PILL TICKER ─── */
function PillTicker({ categories, catMap, activeCategory, setActiveCategory }) {
  const trackRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [manualOffset, setManualOffset] = useState(0);
  const pills = [...categories, ...categories];
  const onDown = useCallback(e => { drag.current = { active: true, startX: e.clientX, startOffset: manualOffset }; setIsDragging(true); }, [manualOffset]);
  const onMove = useCallback(e => { if (!drag.current.active) return; const dx = e.clientX - drag.current.startX; setManualOffset(drag.current.startOffset + dx); }, []);
  const onUp = useCallback(() => { drag.current.active = false; setIsDragging(false); }, []);
  useEffect(() => { window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp); return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }; }, [onMove, onUp]);
  if (!categories.length) return null;
  return (
    <div className={`pill-ticker-wrap${isDragging ? " dragging" : ""}`} onMouseDown={onDown}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 32, background: "linear-gradient(to right, var(--cream-card), transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 32, background: "linear-gradient(to left, var(--cream-card), transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div ref={trackRef} className="pill-ticker-track" style={isDragging ? { transform: `translateX(${manualOffset}px)`, animation: "none" } : undefined}>
        {pills.map(([cat], i) => { const cfg = catMap[cat] || { color: "#7A756E", icon: "•" }; const isActive = activeCategory === cat; return <button key={`${cat}-${i}`} className={`cat-chip${isActive ? " active" : ""}`} onClick={e => { if (Math.abs(drag.current.startX - e.clientX) < 4) setActiveCategory(isActive ? null : cat); }} style={isActive ? { background: cfg.color, borderColor: "transparent" } : {}}>{cfg.icon} {cat}</button>; })}
      </div>
    </div>
  );
}

/* ─── EDIT TRANSACTION MODAL ─── */
function EditTxModal({ transaction, categories, catMap, onSave, onClose }) {
  const [desc, setDesc] = useState(transaction.description);
  const [amount, setAmount] = useState(String(transaction.amount));
  const [isCredit, setIsCredit] = useState(transaction.isCredit);
  const [dateStr, setDateStr] = useState(transaction.dateStr);
  const [category, setCategory] = useState(transaction.manualCategory || transaction.category);
  const MN = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const handleSave = () => {
    const amt = parseFloat(amount.replace(/[^0-9.]/g, ""));
    if (!amt || !desc.trim()) return;
    const parts = dateStr.trim().split(" ");
    let day, mon;
    if (isNaN(parseInt(parts[0]))) { mon = parts[0]; day = parseInt(parts[1]); }
    else { day = parseInt(parts[0]); mon = parts[1]; }
    const monthIdx = MN[mon] ?? transaction.date.getMonth();
    const year = transaction.date.getFullYear();
    const newDate = new Date(year, monthIdx, day || transaction.date.getDate());
    onSave({ ...transaction, description: desc.trim(), amount: amt, isCredit, dateStr: dateStr.trim(), date: newDate, manualCategory: category !== transaction.category ? category : transaction.manualCategory });
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 20, padding: 28, width: 420, zIndex: 101, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Edit Transaction</div>
          <button onClick={onClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: "var(--ink-light)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Description</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Amount</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'IBM Plex Mono', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 4, padding: "3px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)" }}>
            <button onClick={() => setIsCredit(false)} style={{ padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, background: !isCredit ? "#FFD6C2" : "transparent", color: !isCredit ? "#8B3A00" : "var(--ink-faint)", transition: "all 0.15s" }}>Debit</button>
            <button onClick={() => setIsCredit(true)}  style={{ padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, background: isCredit  ? "#BFEFDF" : "transparent", color: isCredit  ? "#1A5C3A" : "var(--ink-faint)", transition: "all 0.15s" }}>Credit</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Date</label>
          <input value={dateStr} onChange={e => setDateStr(e.target.value)} placeholder="08 Dec" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Category</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, maxHeight: 200, overflowY: "auto" }}>
            {categories.filter(c => c.name !== "Income" || isCredit).map(c => {
              const cfg = catMap[c.name] || { color: "#7A756E", bg: "#7A756E18" };
              const isActive = category === c.name;
              return (
                <button key={c.id} onClick={() => setCategory(c.name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: `1px solid ${isActive ? cfg.color : "var(--cream-border)"}`, background: isActive ? cfg.bg : "transparent", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: isActive ? cfg.color : "var(--ink-mid)", transition: "all 0.1s" }}>
                  {c.icon} <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-mid)", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "10px", borderRadius: 100, background: "var(--charcoal)", border: "none", color: "white", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

/* ─── IMPORT MODAL (kept from original) ─── */
function ImportModal({ open, onClose, onImport }) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [processing, setProcessing] = useState(false);

  const processFile = async (file) => {
    setProcessing(true);
    setFileName(file.name);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "csv" || ext === "xlsx" || ext === "xls") {
        const result = await parseSpreadsheet(file);
        setText(Array.isArray(result) ? result.join("\n") : result);
      } else {
        const t = await file.text();
        setText(t);
      }
    } catch { setText(""); alert("Could not read file."); }
    setProcessing(false);
  };

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(3px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 24, padding: 32, width: 520, maxWidth: "95vw", zIndex: 101, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Import Statement</div>
          <button onClick={onClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", color: "var(--ink-light)", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={async e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) await processFile(f); }}
          style={{ border: `2px dashed ${dragging ? "var(--red)" : "var(--cream-border)"}`, borderRadius: 14, padding: "28px 20px", textAlign: "center", transition: "all 0.15s", background: dragging ? "rgba(227,26,81,0.04)" : "var(--cream)", cursor: "pointer" }}
          onClick={() => document.getElementById("file-input-hidden").click()}
        >
          <input id="file-input-hidden" type="file" accept=".txt,.csv,.xlsx,.xls" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) await processFile(f); }} />
          {processing ? (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)" }}>Processing…</div>
          ) : fileName ? (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-mid)", fontWeight: 600 }}>📄 {fileName}</div>
          ) : (
            <>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)" }}>Drop file or click to browse</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "var(--ink-faint)", marginTop: 4, opacity: 0.6 }}>TXT · CSV · XLSX · XLS</div>
            </>
          )}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Or paste statement text</div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={6} placeholder="Paste your bank statement text here…" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.7, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--cream-border)", background: "var(--cream)", color: "var(--ink)", resize: "vertical", outline: "none" }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "11px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-mid)", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => { if (text.trim()) { onImport(text); setText(""); setFileName(""); } }} disabled={!text.trim()} style={{ flex: 2, padding: "11px", borderRadius: 100, background: text.trim() ? "var(--grad)" : "var(--cream-border)", border: "none", color: text.trim() ? "white" : "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, cursor: text.trim() ? "pointer" : "not-allowed", transition: "all 0.15s" }}>Import Statement</button>
        </div>
      </div>
    </div>
  );
}

/* ─── CATEGORY PICKER ─── */
function CategoryPicker({ transaction, categories, onSelect, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 20, padding: 24, width: 360, zIndex: 101, boxShadow: "0 16px 48px rgba(0,0,0,0.16)" }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)", marginBottom: 4 }}>Re-categorise</div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", marginBottom: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{transaction.description}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {categories.filter(c => c.name !== "Income").map(c => (
            <button key={c.id} onClick={() => onSelect(c.name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: "var(--ink-mid)", transition: "all 0.1s" }}>
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── CATEGORY MANAGER ─── */
function CategoryManager({ categories, onSave, onClose }) {
  const [cats, setCats] = useState(categories.map(c => ({ ...c })));
  const [deletedName, setDeletedName] = useState(null);
  const [reassignTo, setReassignTo] = useState(null);
  const ICONS = ["↓","→","🍔","✈","⚡","📱","▶","🏦","🏛","🛍","🏠","💼","•","🎓","🏥","🚗","💇","🎮","📦","🍷","🏋","🐾"];
  const add = () => setCats(prev => [...prev, { id: `cat_${Date.now()}`, name: "New Category", color: "#7A756E", icon: "•" }]);
  const remove = (id) => {
    const cat = cats.find(c => c.id === id);
    if (!cat) return;
    setDeletedName(cat.name);
    setReassignTo(cats.find(c => c.id !== id)?.name || null);
    setCats(prev => prev.filter(c => c.id !== id));
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(3px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 24, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "80vh", overflow: "auto", zIndex: 201, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Manage Categories</div>
          <button onClick={onClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", color: "var(--ink-light)", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {cats.map(c => (
            <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: 12, background: "var(--cream)", border: "1px solid var(--cream-border)" }}>
              <select value={c.icon} onChange={e => setCats(prev => prev.map(x => x.id === c.id ? { ...x, icon: e.target.value } : x))} style={{ background: "transparent", border: "none", fontSize: 16, cursor: "pointer", outline: "none" }}>
                {ICONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
              </select>
              <input value={c.name} onChange={e => setCats(prev => prev.map(x => x.id === c.id ? { ...x, name: e.target.value } : x))} style={{ flex: 1, background: "transparent", border: "none", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
              <input type="color" value={c.color} onChange={e => setCats(prev => prev.map(x => x.id === c.id ? { ...x, color: e.target.value } : x))} style={{ width: 28, height: 28, padding: 2, border: "1px solid var(--cream-border)", borderRadius: 6, cursor: "pointer", background: "transparent" }} />
              <button onClick={() => remove(c.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: 16, padding: "0 4px" }}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={add} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px dashed var(--cream-border)", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)", cursor: "pointer" }}>+ Add Category</button>
          <button onClick={() => onSave(cats, deletedName, reassignTo)} style={{ flex: 2, padding: "10px", borderRadius: 100, background: "var(--charcoal)", border: "none", color: "white", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

/* ─── CUSTOM DATE RANGE PICKER ─── */
function CustomRangePicker({ onApply, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState("");
  const [to, setTo]   = useState(today);
  const canApply = from && to && from <= to;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 20, padding: 28, width: 360, zIndex: 101, boxShadow: "0 16px 48px rgba(0,0,0,0.16)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Custom Date Range</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-mid)", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => canApply && onApply(from, to)} disabled={!canApply} style={{ flex: 2, padding: "10px", borderRadius: 100, background: canApply ? "var(--charcoal)" : "var(--cream-border)", border: "none", color: canApply ? "white" : "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, cursor: canApply ? "pointer" : "not-allowed" }}>Apply Range</button>
        </div>
      </div>
    </div>
  );
}

/* ─── DASHBOARD PANEL ─── */
function DashboardPanel({ userId, workspace, categories, catMap, dark }) {
  const [statements, setStatements]     = useState([]);
  const [activeStmt, setActiveStmt]     = useState(0);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch]             = useState("");
  const [showImport, setShowImport]     = useState(false);
  const [txView, setTxView]             = useState("list");
  const [selectedDay, setSelectedDay]   = useState(null);
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiStatus, setAiStatus]         = useState(null);
  const [pickerTx, setPickerTx]         = useState(null);
  const [editTx, setEditTx]             = useState(null);
  const [dbLoading, setDbLoading]       = useState(true);

  // Navigation mode
  const [navMode, setNavMode]           = useState("calendar"); // "calendar" | "statement"
  const [selectedMonth, setSelectedMonth] = useState(null);    // { month, year, label }
  const [customRange, setCustomRange]   = useState(null);      // { from, to } ISO strings
  const [showCustomRange, setShowCustomRange] = useState(false);

  const catNames = categories.map(c => c.name);

  /* Load statements */
  useEffect(() => {
    const load = async () => {
      setDbLoading(true);
      const { data: stmts } = await supabase.from("statements").select("*").eq("user_id", userId).eq("workspace", workspace).order("created_at");
      if (!stmts || !stmts.length) { setStatements([]); setDbLoading(false); return; }
      const results = await Promise.all(stmts.map(async s => {
        const { data: txs } = await supabase.from("transactions").select("*").eq("statement_id", s.id).order("local_id");
        const transactions = (txs || []).map(t => ({ ...t, id: t.local_id, date: new Date(t.date), dateStr: t.date_str, isCredit: t.is_credit, aiCategorised: t.ai_categorised, manualCategory: t.manual_category }));
        return { id: s.id, label: s.label, sortOrder: s.sort_order ?? null, transactions };
      }));
      setStatements(sortStatements(results));
      setDbLoading(false);
    };
    load();
  }, [userId, workspace]);

  /* All transactions flat (for calendar mode) */
  const allTransactions = useMemo(() => statements.flatMap(s => s.transactions), [statements]);

  /* Active transaction set based on nav mode */
  const transactions = useMemo(() => {
    if (navMode === "statement") {
      if (customRange) {
        const from = new Date(customRange.from);
        const to   = new Date(customRange.to + "T23:59:59");
        return allTransactions.filter(t => new Date(t.date) >= from && new Date(t.date) <= to);
      }
      return (statements[activeStmt] || statements[0])?.transactions || [];
    }
    // Calendar mode
    if (selectedMonth) {
      return allTransactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === selectedMonth.month && d.getFullYear() === selectedMonth.year;
      });
    }
    return allTransactions; // no month selected = full year aggregate
  }, [navMode, statements, activeStmt, allTransactions, selectedMonth, customRange]);

  const summary = useMemo(() => {
    const income = transactions.filter(t => t.isCredit).reduce((s, t) => s + t.amount, 0);
    const spend  = transactions.filter(t => !t.isCredit).reduce((s, t) => s + t.amount, 0);
    const byCategory = {};
    transactions.filter(t => !t.isCredit).forEach(t => { const c = t.manualCategory || t.category; byCategory[c] = (byCategory[c] || 0) + t.amount; });
    return { income, spend, net: income - spend, sorted: Object.entries(byCategory).sort((a, b) => b[1] - a[1]) };
  }, [transactions]);

  const filtered = useMemo(() => transactions.filter(t => {
    const c = t.manualCategory || t.category;
    if (activeCategory && c !== activeCategory) return false;
    if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [transactions, activeCategory, search]);

  /* Import */
  const handleImport = async (text) => {
    const parsed = parseStatement(text, catNames);
    if (!parsed.length) { alert("No transactions found."); return; }
    const label = detectPeriodLabel(parsed);
    const { data: newStmt } = await supabase.from("statements").insert({ user_id: userId, workspace, label }).select().single();
    if (!newStmt) { alert("Failed to save statement."); return; }
    const txRows = parsed.map(t => ({ statement_id: newStmt.id, local_id: t.id, date: t.date.toISOString(), date_str: t.dateStr, description: t.description, amount: t.amount, is_credit: t.isCredit, category: t.category, ai_categorised: false, manual_category: null }));
    await supabase.from("transactions").insert(txRows);
    const newEntry = { id: newStmt.id, label, sortOrder: null, transactions: parsed };
    setStatements(prev => sortStatements([...prev, newEntry]));
    setActiveStmt(statements.length);
    setShowImport(false); setAiStatus(null);
  };

  const handleAICategorise = async () => {
    setAiLoading(true); setAiStatus(null);
    try {
      const stmtTransactions = navMode === "statement" ? transactions : (statements[activeStmt] || statements[0])?.transactions || [];
      const updated = await categoriseWithAI(stmtTransactions, catNames);
      const stmtId = (statements[activeStmt] || statements[0])?.id;
      if (stmtId) {
        for (const t of updated) {
          await supabase.from("transactions").update({ category: t.category, ai_categorised: t.aiCategorised }).eq("statement_id", stmtId).eq("local_id", t.id);
        }
      }
      setStatements(prev => prev.map((s, i) => i === activeStmt ? { ...s, transactions: updated } : s));
      setAiStatus("done");
    } catch { setAiStatus("error"); } finally { setAiLoading(false); }
  };

  const handleManualCategory = async (cat) => {
    if (!pickerTx) return;
    const stmtId = statements.find(s => s.transactions.some(t => t.id === pickerTx.id))?.id;
    if (stmtId) await supabase.from("transactions").update({ manual_category: cat }).eq("statement_id", stmtId).eq("local_id", pickerTx.id);
    setStatements(prev => prev.map(s => ({ ...s, transactions: s.transactions.map(t => t.id === pickerTx.id ? { ...t, manualCategory: cat } : t) })));
    setPickerTx(null);
  };

  const handleEditSave = async (updated) => {
    const stmtId = statements.find(s => s.transactions.some(t => t.id === updated.id))?.id;
    if (stmtId) {
      await supabase.from("transactions").update({
        description: updated.description, amount: updated.amount, is_credit: updated.isCredit,
        date_str: updated.dateStr, date: updated.date.toISOString(), manual_category: updated.manualCategory,
      }).eq("statement_id", stmtId).eq("local_id", updated.id);
    }
    setStatements(prev => prev.map(s => ({ ...s, transactions: s.transactions.map(t => t.id === updated.id ? { ...t, ...updated } : t) })));
    setEditTx(null);
  };

  const removeStatement = async (idx) => {
    const s = statements[idx];
    if (!window.confirm(`Delete "${s.label}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("statements").delete().eq("id", s.id);
    if (error) { alert("Delete failed."); return; }
    setStatements(prev => prev.filter((_, i) => i !== idx));
    setActiveStmt(prev => { if (idx < prev) return prev - 1; if (idx === prev) return Math.max(0, prev - 1); return prev; });
  };

  const moveStatement = async (idx, dir) => {
    const next = idx + dir;
    if (next < 0 || next >= statements.length) return;
    const reordered = [...statements];
    [reordered[idx], reordered[next]] = [reordered[next], reordered[idx]];
    const withOrder = reordered.map((s, i) => ({ ...s, sortOrder: i }));
    setStatements(withOrder); setActiveStmt(next);
    await Promise.all(withOrder.map(s => supabase.from("statements").update({ sort_order: s.sortOrder }).eq("id", s.id)));
  };

  const netPositive = summary.net >= 0;
  const aiCount = transactions.filter(t => t.aiCategorised).length;
  const manualCount = transactions.filter(t => t.manualCategory).length;

  // Label for what's currently shown
  const contextLabel = useMemo(() => {
    if (navMode === "calendar") {
      if (selectedMonth) return selectedMonth.label;
      const startYear = currentFYStartYear();
      return `FY ${startYear}/${startYear + 1} · All Months`;
    }
    if (customRange) return `${customRange.from} → ${customRange.to}`;
    return (statements[activeStmt] || statements[0])?.label || "No statements";
  }, [navMode, selectedMonth, statements, activeStmt, customRange]);

  if (dbLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 80, gap: 12 }}>
      <div className="ai-spinner" />
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)" }}>Loading statements…</span>
    </div>
  );

  return (
    <div style={{ position: "relative" }}>

      {/* ── NAV MODE TOGGLE ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 100, padding: 3, gap: 2 }}>
          {[["calendar","📅 Calendar"],["statement","🗂 Statement"]].map(([mode, label]) => (
            <button key={mode} onClick={() => { setNavMode(mode); setSelectedMonth(null); setCustomRange(null); setActiveCategory(null); setSearch(""); }} style={{ padding: "5px 14px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: navMode === mode ? "var(--charcoal)" : "transparent", color: navMode === mode ? "white" : "var(--ink-faint)", transition: "all 0.2s" }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-faint)", paddingLeft: 4 }}>{contextLabel}</div>
      </div>

      {/* ── CALENDAR MODE: YEAR CHART ── */}
      {navMode === "calendar" && statements.length > 0 && (
        <YearChart
          allTransactions={allTransactions}
          selectedMonth={selectedMonth}
          onSelectMonth={m => { setSelectedMonth(m); setActiveCategory(null); setSearch(""); }}
          dark={dark}
        />
      )}

      {/* ── STATEMENT MODE: PERIOD TABS ── */}
      {navMode === "statement" && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          {statements.map((s, i) => {
            const isActive = !customRange && i === activeStmt;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", borderRadius: 100, border: "1px solid var(--cream-border)", background: isActive ? "var(--cream-card)" : "transparent", overflow: "hidden", transition: "all 0.15s" }}>
                {isActive && statements.length > 1 && (
                  <button onClick={() => moveStatement(i, -1)} disabled={i === 0} style={{ padding: "5px 6px 5px 10px", background: "transparent", border: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "var(--cream-border)" : "var(--ink-faint)", fontSize: 10 }}>‹</button>
                )}
                <button onClick={() => { setActiveStmt(i); setCustomRange(null); setActiveCategory(null); setSearch(""); setAiStatus(null); }} style={{ padding: isActive && statements.length > 1 ? "5px 4px" : "5px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: isActive ? "var(--ink)" : "var(--ink-faint)", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{s.label}</button>
                {isActive && statements.length > 1 && (
                  <button onClick={() => moveStatement(i, 1)} disabled={i === statements.length - 1} style={{ padding: "5px 6px", background: "transparent", border: "none", cursor: i === statements.length - 1 ? "default" : "pointer", color: i === statements.length - 1 ? "var(--cream-border)" : "var(--ink-faint)", fontSize: 10 }}>›</button>
                )}
                <button onClick={() => removeStatement(i)} style={{ padding: "5px 10px 5px 4px", background: "transparent", border: "none", cursor: "pointer", color: isActive ? "var(--ink-faint)" : "rgba(0,0,0,0.15)", fontSize: 11 }}>✕</button>
              </div>
            );
          })}
          {/* Custom range button */}
          <button onClick={() => setShowCustomRange(true)} style={{ padding: "5px 14px", borderRadius: 100, border: `1px solid ${customRange ? "var(--red)" : "var(--cream-border)"}`, background: customRange ? "rgba(227,26,81,0.06)" : "transparent", color: customRange ? "var(--red)" : "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: customRange ? 700 : 400, cursor: "pointer", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
            {customRange ? `📅 ${customRange.from} → ${customRange.to} ✕` : "📅 Custom Range"}
          </button>
          {customRange && <button onClick={() => setCustomRange(null)} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "var(--ink-faint)" }}>Clear</button>}
          <button onClick={() => setShowImport(true)} style={{ padding: "5px 12px", borderRadius: 100, border: "1px dashed var(--cream-border)", background: "transparent", color: "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer" }}>+ Add</button>
        </div>
      )}

      {!statements.length && (
        <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.06em" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🗂️</div>
          No statements yet.<br />
          <button onClick={() => setShowImport(true)} style={{ marginTop: 16, padding: "8px 20px", borderRadius: 100, background: "var(--grad)", border: "none", color: "white", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Import your first statement</button>
        </div>
      )}

      {statements.length > 0 && <>
        {/* AI Status */}
        {(aiLoading || aiStatus) && (
          <div style={{ marginBottom: 12, padding: "10px 18px", borderRadius: 10, background: aiLoading ? "rgba(99,102,241,0.08)" : aiStatus === "done" ? "rgba(20,184,166,0.08)" : "rgba(227,26,81,0.08)", border: `1px solid ${aiLoading ? "rgba(99,102,241,0.2)" : aiStatus === "done" ? "rgba(20,184,166,0.2)" : "rgba(227,26,81,0.2)"}`, display: "flex", alignItems: "center", gap: 10 }}>
            {aiLoading && <div className="ai-spinner" />}
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: aiLoading ? "#6366f1" : aiStatus === "done" ? "#14b8a6" : "#E31A51" }}>
              {aiLoading ? "Claude is categorising your transactions…" : aiStatus === "done" ? `✓ AI categorised ${aiCount} transactions${manualCount > 0 ? ` · ${manualCount} manually overridden` : ""}` : "⚠ AI categorisation failed — using keyword matching"}
            </span>
          </div>
        )}

        {/* KPI CARDS — animate on change */}
        <div className="fade-up bento-top" style={{ animationDelay: "0.05s" }} key={`${navMode}-${selectedMonth?.label}-${customRange?.from}-${activeStmt}`}>
          <div style={{ padding: "20px 20px 18px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #BFEFDF 60%, #DCF2F8)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 10 }}>Income</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 40, fontWeight: 700, color: "#0A0A0A", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", flex: 1 }}>{fmt(summary.income, true)}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 14 }}>{transactions.filter(t => t.isCredit).length} credits</div>
          </div>
          <div style={{ padding: "20px 20px 18px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #FFD6C2 0%, #FFB3C6 100%)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 10 }}>Spend</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 40, fontWeight: 700, color: "#0A0A0A", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", flex: 1 }}>{fmt(summary.spend, true)}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 14 }}>{transactions.filter(t => !t.isCredit).length} debits</div>
          </div>
          <div className="net-hero-inner" style={{ borderRadius: "var(--r-xl)", padding: "20px 28px 18px", background: netPositive ? "var(--charcoal)" : "#C0392B", boxShadow: netPositive ? "0 2px 24px rgba(13,11,9,0.14)" : "0 2px 24px rgba(192,57,43,0.25)", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.75)", marginBottom: 10 }}>{netPositive ? "Net Surplus" : "Net Deficit"}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 40, fontWeight: 700, color: "white", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", flex: 1 }}>{fmt(Math.abs(summary.net), true)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.18)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min((summary.spend / (summary.income || 1)) * 100, 100).toFixed(1)}%`, background: "rgba(255,255,255,0.6)", borderRadius: 2, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>{((summary.spend / (summary.income || 1)) * 100).toFixed(0)}% spend ratio</div>
            </div>
          </div>
        </div>

        {/* CATEGORY */}
        <div className="fade-up" style={{ animationDelay: "0.1s", marginBottom: 12 }}>
          <div className="stat-card" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Spend by Category</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {activeCategory && <button onClick={() => setActiveCategory(null)} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--red)", letterSpacing: "0.04em" }}>Clear ✕</button>}
                <button onClick={handleAICategorise} disabled={aiLoading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 100, background: aiLoading ? "transparent" : "var(--cream)", border: `1px solid ${aiLoading ? "rgba(99,102,241,0.2)" : "var(--cream-border)"}`, color: aiLoading ? "#6366f1" : "var(--ink-mid)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", cursor: aiLoading ? "not-allowed" : "pointer", transition: "all 0.2s" }}>
                  {aiLoading ? <><div className="ai-spinner-sm" style={{ borderTopColor: "#6366f1", borderColor: "rgba(99,102,241,0.2)" }} /> Thinking…</> : "✦ AI Categorise"}
                </button>
              </div>
            </div>
            {(() => {
              const spendOnly = summary.sorted, total = spendOnly.reduce((s,[,v]) => s+v, 0);
              const size=200, cx=100, cy=100, outerR=80, innerR=50; let angle=-Math.PI/2;
              const slices = spendOnly.map(([cat,amount]) => {
                const frac=amount/total, sa=angle, ea=angle+frac*2*Math.PI; angle=ea;
                const x1=cx+outerR*Math.cos(sa),y1=cy+outerR*Math.sin(sa),x2=cx+outerR*Math.cos(ea),y2=cy+outerR*Math.sin(ea);
                const ix1=cx+innerR*Math.cos(ea),iy1=cy+innerR*Math.sin(ea),ix2=cx+innerR*Math.cos(sa),iy2=cy+innerR*Math.sin(sa);
                const d=`M ${x1} ${y1} A ${outerR} ${outerR} 0 ${frac>0.5?1:0} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${frac>0.5?1:0} 0 ${ix2} ${iy2} Z`;
                return {cat,amount,frac,d};
              });
              return (
                <div className="donut-layout">
                  <div className="donut-container" style={{ flexShrink: 0 }}>
                    <svg viewBox={`0 0 ${size} ${size}`} className="donut-svg">
                      {slices.map(({cat,d}) => { const cfg=catMap[cat]||{color:"#7A756E"}; const isA=activeCategory===cat; return <path key={cat} d={d} fill={cfg.color} opacity={activeCategory&&!isA?0.15:1} style={{cursor:"pointer",transition:"opacity 0.2s"}} onClick={() => setActiveCategory(activeCategory===cat?null:cat)} />; })}
                      <text x={cx} y={cy-8} textAnchor="middle" style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fill:"var(--ink-light)",fontWeight:700}}>SPEND</text>
                      <text x={cx} y={cy+10} textAnchor="middle" style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fill:"var(--ink)",fontWeight:700}}>{fmt(total,true)}</text>
                    </svg>
                  </div>
                  <div className="donut-legend" style={{ flex:1, minWidth:160 }}>
                    {slices.map(({cat,amount,frac}) => { const cfg=catMap[cat]||{color:"#7A756E",bg:"#7A756E18"}; const isA=activeCategory===cat; return (
                      <div key={cat} onClick={() => setActiveCategory(activeCategory===cat?null:cat)} style={{cursor:"pointer",padding:"6px 0",borderRadius:6,background:isA?cfg.bg:"transparent",border:`1px solid ${isA?cfg.color+"22":"transparent"}`,opacity:activeCategory&&!isA?0.35:1,transition:"all 0.15s"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                          <div style={{width:7,height:7,borderRadius:2,background:cfg.color,flexShrink:0}} />
                          <div style={{flex:1,fontFamily:"'Inter',sans-serif",fontSize:11,fontWeight:600,color:isA?cfg.color:"var(--ink-mid)"}}>{cat}</div>
                          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:700,color:isA?cfg.color:"var(--ink)"}}>{(frac*100).toFixed(0)}%</div>
                          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:"var(--ink-faint)"}}>{fmt(amount,true)}</div>
                        </div>
                        <div style={{height:3,background:"var(--cream-border)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${(frac*100).toFixed(1)}%`,background:cfg.color,borderRadius:2,transition:"width 0.6s cubic-bezier(0.4,0,0.2,1)"}} /></div>
                      </div>
                    ); })}
                  </div>
                </div>
              );
            })()}
            <PillTicker categories={summary.sorted} catMap={catMap} activeCategory={activeCategory} setActiveCategory={setActiveCategory} />
          </div>
        </div>

        {/* TRANSACTIONS */}
        <div className="fade-up stat-card" style={{ animationDelay: "0.15s", overflow: "hidden", padding: 0 }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--cream-border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>
                Transactions {activeCategory ? <span style={{ color: "var(--red)", marginLeft: 8 }}>{activeCategory}</span> : null}
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)", marginTop: 3 }}>{filtered.length} of {transactions.length}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {txView === "list" && <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" />}
              <div style={{ display: "flex", gap: 4 }}>
                {[["list","List"],["calendar","Calendar"]].map(([v,lbl]) => <button key={v} onClick={() => { setTxView(v); setSelectedDay(null); }} style={{ padding: "4px 12px", borderRadius: 100, border: "1px solid var(--cream-border)", background: txView===v?"var(--cream-card)":"transparent", color: txView===v?"var(--ink)":"var(--ink-faint)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, cursor: "pointer", transition: "all 0.15s" }}>{lbl}</button>)}
              </div>
            </div>
          </div>

          {txView === "list" && (
            <div style={{ overflowY: "auto", maxHeight: 520 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--cream)" }}>{[["Date","left"],["Description","left"],["Category","left"],["Amount","right"],["","right"]].map(([h,align]) => <th key={h} style={{ padding:"10px 20px",textAlign:align,fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--ink-faint)",borderBottom:"1px solid var(--cream-border)" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.map(t => { const cat=t.manualCategory||t.category; const cfg=catMap[cat]||{color:"#7A756E",bg:"#7A756E18",icon:"•"}; return (
                    <tr key={t.id} className="tx-row">
                      <td style={{ padding:"11px 20px",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:"var(--ink-faint)",whiteSpace:"nowrap" }}>{t.dateStr}</td>
                      <td style={{ padding:"11px 20px",fontFamily:"'Inter',sans-serif",fontSize:13,color:"var(--ink-mid)",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{t.description}</td>
                      <td style={{ padding:"11px 20px" }}><button onClick={() => !t.isCredit && setPickerTx(t)} style={{ background:cfg.bg,color:cfg.color,padding:"3px 10px",borderRadius:100,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:600,letterSpacing:"0.04em",whiteSpace:"nowrap",border:`1px solid ${t.manualCategory?cfg.color+"66":"transparent"}`,cursor:t.isCredit?"default":"pointer",display:"inline-flex",alignItems:"center",gap:4,transition:"all 0.15s" }}>{cfg.icon} {cat}{t.manualCategory&&<span style={{fontSize:8,opacity:0.7}}>✎</span>}{t.aiCategorised&&!t.manualCategory&&<span style={{fontSize:8,opacity:0.7}}>✦</span>}</button></td>
                      <td style={{ padding:"11px 20px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:600,color:t.isCredit?"#3D8C6F":"var(--red)",whiteSpace:"nowrap" }}>{t.isCredit?"+":"−"}{fmt(t.amount)}</td>
                      <td style={{ padding:"11px 12px 11px 4px",textAlign:"right" }}>
                        <button onClick={() => setEditTx(t)} style={{ background:"transparent",border:"1px solid var(--cream-border)",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"var(--ink-faint)" }}>✎</button>
                      </td>
                    </tr>
                  ); })}
                </tbody>
              </table>
              {!filtered.length && <div style={{ padding:"48px 24px",textAlign:"center",color:"var(--ink-faint)",fontFamily:"'IBM Plex Mono',monospace",fontSize:11 }}>No transactions match your filter.</div>}
              <div style={{ padding:"10px 20px",borderTop:"1px solid var(--cream-border)",display:"flex",gap:16,flexWrap:"wrap" }}>
                {[["✦ AI categorised","#6366f1"],["✎ Manually overridden","#14b8a6"],["Click any category to re-categorise","var(--ink-faint)"]].map(([lbl,color]) => <span key={lbl} style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color,letterSpacing:"0.06em" }}>{lbl}</span>)}
              </div>
            </div>
          )}

          {txView === "calendar" && (() => {
            const byDay={};
            transactions.forEach(t => { const key=t.date.toISOString().slice(0,10); if(!byDay[key])byDay[key]={spend:0,income:0,txs:[]}; if(t.isCredit)byDay[key].income+=t.amount; else byDay[key].spend+=t.amount; byDay[key].txs.push(t); });
            const maxDaySpend=Math.max(...Object.values(byDay).map(d=>d.spend),1);
            const monthList=[...new Set(transactions.map(t=>`${t.date.getFullYear()}-${t.date.getMonth()}`))]
              .map(s=>{const[y,m]=s.split('-').map(Number);return{year:y,month:m};}).sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month);
            const DAYS=['Su','Mo','Tu','We','Th','Fr','Sa'],MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const selectedTxs=selectedDay?(byDay[selectedDay]?.txs||[]):[];
            return (
              <div style={{ padding:"20px 24px" }}>
                <div className="cal-months-wrap">
                  {monthList.map(({year,month}) => {
                    const firstDay=new Date(year,month,1).getDay(),dim=new Date(year,month+1,0).getDate();
                    const cells=[...Array(firstDay).fill(null),...Array.from({length:dim},(_,i)=>i+1)];
                    return (
                      <div key={`${year}-${month}`} className="cal-month-wrap">
                        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--ink-light)",marginBottom:10}}>{MN[month]} {year}</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>{DAYS.map(d=><div key={d} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8,fontWeight:700,color:"var(--ink-faint)",textAlign:"center",padding:"2px 0"}}>{d}</div>)}</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
                          {cells.map((day,i) => {
                            if(!day)return<div key={`e${i}`}/>;
                            const key=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                            const data=byDay[key];const isSel=selectedDay===key;
                            const si=data?data.spend/maxDaySpend:0,isNP=data&&data.income>data.spend;
                            let bg="var(--cream)",border="var(--cream-border)";
                            if(data){if(isNP){bg=`rgba(191,239,223,${0.2+si*0.4})`;border=`rgba(61,140,111,${0.2+si*0.3})`;}else{bg=`rgba(255,179,198,${0.2+si*0.5})`;border=`rgba(192,57,43,${0.2+si*0.4})`;}}
                            if(isSel){bg="var(--charcoal)";border="var(--charcoal)";}
                            return <div key={key} onClick={()=>data&&setSelectedDay(isSel?null:key)} style={{aspectRatio:"1",borderRadius:5,background:bg,border:`1px solid ${border}`,cursor:data?"pointer":"default",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",transition:"all 0.15s",padding:2}}>
                              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:isSel?700:400,color:isSel?"white":data?"var(--ink)":"var(--ink-faint)",lineHeight:1}}>{day}</div>
                              {data&&<div style={{width:3,height:3,borderRadius:"50%",background:isSel?"rgba(255,255,255,0.6)":isNP?"#3D8C6F":"#C0392B",marginTop:2}}/>}
                            </div>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:16,marginTop:20,paddingTop:16,borderTop:"1px solid var(--cream-border)",flexWrap:"wrap"}}>
                  {[{color:"rgba(255,179,198,0.6)",label:"Spend day"},{color:"rgba(191,239,223,0.6)",label:"Net positive day"},{color:"var(--charcoal)",label:"Selected"}].map(({color,label})=>(
                    <div key={label} style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:12,height:12,borderRadius:3,background:color}}/><span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"var(--ink-faint)"}}>{label}</span></div>
                  ))}
                </div>
                {selectedDay&&(
                  <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid var(--cream-border)"}}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--ink-light)",marginBottom:12}}>{selectedDay} · {selectedTxs.length} transaction{selectedTxs.length!==1?"s":""}</div>
                    {selectedTxs.map(t=>{const cat=t.manualCategory||t.category;const cfg=catMap[cat]||{color:"#7A756E",bg:"#7A756E18",icon:"•"};return(
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid var(--cream-border)"}}>
                        <span style={{background:cfg.bg,color:cfg.color,padding:"2px 8px",borderRadius:100,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cat}</span>
                        <span style={{flex:1,fontFamily:"'Inter',sans-serif",fontSize:13,color:"var(--ink-mid)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</span>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:600,color:t.isCredit?"#3D8C6F":"var(--red)",whiteSpace:"nowrap"}}>{t.isCredit?"+":"−"}{fmt(t.amount)}</span>
                      </div>
                    );})}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </>}

      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
      {pickerTx && <CategoryPicker transaction={pickerTx} categories={categories} onSelect={handleManualCategory} onClose={() => setPickerTx(null)} />}
      {editTx && <EditTxModal transaction={editTx} categories={categories} catMap={catMap} onSave={handleEditSave} onClose={() => setEditTx(null)} />}
      {showCustomRange && <CustomRangePicker onApply={(from, to) => { setCustomRange({ from, to }); setShowCustomRange(false); setActiveCategory(null); setSearch(""); }} onClose={() => setShowCustomRange(false)} />}

      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 40 }}>
        <button className="fab-import" onClick={() => setShowImport(true)} title="Import Statement"><span className="fab-icon">+</span><span className="fab-label">Import Statement</span></button>
      </div>
    </div>
  );
}

/* ─── ROOT ─── */
export default function App() {
  const [session, setSession] = useState(undefined);
  const [accessDenied, setAccessDenied] = useState(false);
  const [dark, setDark] = useState(false);
  const [workspace, setWorkspace] = useState("professional");
  const [showCatManager, setShowCatManager] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const catMap = useMemo(() => buildCatMap(categories), [categories]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const allowed = await checkAllowed(session.user.email);
        if (!allowed) { await supabase.auth.signOut(); setAccessDenied(true); setSession(null); }
        else { setSession(session); await loadCategories(setCategories); }
      } else { setSession(null); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const allowed = await checkAllowed(session.user.email);
        if (!allowed) { await supabase.auth.signOut(); setAccessDenied(true); setSession(null); }
        else { setSession(session); await loadCategories(setCategories); }
      } else { setSession(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const checkAllowed = async (email) => {
    const { data } = await supabase.from("allowed_users").select("email").eq("email", email).single();
    return !!data;
  };

  const loadCategories = async (setter) => {
    const { data } = await supabase.from("categories").select("*").order("sort_order");
    if (data && data.length) setter(data.map(c => ({ id: c.id, name: c.name, color: c.color, icon: c.icon })));
  };

  const handleSaveCategories = async (newCats, deletedName, reassignTo) => {
    await supabase.from("categories").upsert(newCats.map((c, i) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, sort_order: i })));
    const newIds = newCats.map(c => c.id);
    const removed = categories.filter(c => !newIds.includes(c.id));
    for (const c of removed) await supabase.from("categories").delete().eq("id", c.id);
    if (deletedName && reassignTo) {
      await supabase.from("transactions").update({ category: reassignTo }).eq("category", deletedName);
      await supabase.from("transactions").update({ manual_category: reassignTo }).eq("manual_category", deletedName);
    }
    setCategories(newCats);
    setShowCatManager(false);
  };

  const isPro = workspace === "professional";
  const eyebrow = isPro ? "Base X Studio" : "Otoabasi Bassey";
  const accountLabel = isPro ? "FNB Gold Business" : "FNB Personal Account";

  if (session === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B0B0B0", letterSpacing: "0.08em", gap: 12 }}>
      <div style={{ width: 16, height: 16, border: "2px solid rgba(227,26,81,0.2)", borderTopColor: "#E31A51", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      Loading…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!session) return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;900&display=swap');`}</style>
      {accessDenied && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: "#E31A51", color: "white", padding: "10px 20px", borderRadius: 100, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, zIndex: 999 }}>
          Access denied — your email is not on the approved list.
        </div>
      )}
      <LoginScreen />
    </>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;900&family=Noto+Serif:ital,wght@0,400;0,600;1,400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --cream: #FFFFFF; --cream-card: #F5F5F5; --cream-border: rgba(0,0,0,0.10);
          --ink: #0A0A0A; --ink-mid: #3A3A3A; --ink-light: #767676; --ink-faint: #B0B0B0;
          --red: #E31A51; --grad: linear-gradient(135deg, #E31A51, #FF5C7A);
          --charcoal: #111111; --r-sm: 8px; --r-md: 12px; --r-lg: 18px; --r-xl: 24px;
        }
        .dark { --cream: #141210; --cream-card: #1C1917; --cream-border: rgba(255,255,255,0.08); --ink: #F5F1ED; --ink-mid: #C4BDB6; --ink-light: #8A8279; --ink-faint: #6A6560; --charcoal: #2C2926; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--cream-border); border-radius: 4px; }
        .cat-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 100px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; border: 1px solid var(--cream-border); background: var(--cream-card); color: var(--ink-mid); transition: all 0.15s; white-space: nowrap; }
        .cat-chip:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .cat-chip.active { color: white; border-color: transparent; }
        .tx-row { border-bottom: 1px solid var(--cream-border); transition: background 0.1s; }
        .tx-row:hover { background: var(--cream); }
        .tx-row:last-child { border-bottom: none; }
        .stat-card { background: var(--cream-card); border: 1px solid var(--cream-border); border-radius: var(--r-xl); box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .search-input { padding: 8px 14px; background: var(--cream-card); border: 1px solid var(--cream-border); border-radius: 100px; font-family: 'Inter', sans-serif; font-size: 12px; color: var(--ink); outline: none; width: 200px; }
        .search-input::placeholder { color: var(--ink-faint); }
        .bento-top { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .bento-top .net-hero-inner { grid-column: 1 / -1; }
        @media (min-width: 640px) { .bento-top { grid-template-columns: 1fr 1fr 2fr; } .bento-top .net-hero-inner { grid-column: auto; } }
        .donut-container { width: 200px; height: 200px; }
        .donut-svg { width: 100%; height: 100%; display: block; }
        .donut-layout { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
        @media (max-width: 639px) { .donut-container { width: 280px; height: 280px; margin: 0 auto; } .donut-layout { flex-direction: column; align-items: center; } .donut-legend { width: 100%; } }
        .pill-ticker-wrap { position: relative; overflow: hidden; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--cream-border); cursor: grab; user-select: none; }
        .pill-ticker-wrap:active { cursor: grabbing; }
        .pill-ticker-track { display: flex; gap: 6px; width: max-content; animation: ticker 28s linear infinite; }
        .pill-ticker-wrap:hover .pill-ticker-track, .pill-ticker-wrap.dragging .pill-ticker-track { animation-play-state: paused; }
        @keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .cal-month-wrap { min-width: 220px; flex: 1; }
        .cal-months-wrap { display: flex; gap: 32px; flex-wrap: wrap; width: 100%; }
        @media (max-width: 639px) { .cal-months-wrap { flex-direction: column; } .cal-month-wrap { min-width: 0; width: 100%; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.4s ease both; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .ai-spinner { width: 14px; height: 14px; border: 2px solid rgba(99,102,241,0.25); border-top-color: #6366f1; border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0; }
        .ai-spinner-sm { width: 10px; height: 10px; border: 1.5px solid rgba(255,255,255,0.35); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0; }
        .ws-toggle { display: flex; align-items: center; background: transparent; border: 1.5px solid rgba(0,0,0,0.14); border-radius: 100px; padding: 3px; gap: 2px; }
        .ws-toggle-opt { padding: 5px 9px; border-radius: 100px; border: none; cursor: pointer; font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-weight: 700; transition: all 0.2s; white-space: nowrap; line-height: 1; }
        .ws-toggle-opt.active { background: var(--cream-card); color: var(--ink); box-shadow: 0 0 0 1.5px var(--cream-border); }
        .ws-toggle-opt:not(.active) { background: transparent; color: var(--ink-faint); opacity: 0.5; }
        .ws-toggle-opt:not(.active):hover { opacity: 1; }
        .fab-import { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 100px; background: linear-gradient(135deg, #E31A51, #FF5C7A); border: none; cursor: pointer; overflow: hidden; box-shadow: 0 4px 20px rgba(227,26,81,0.4); transition: width 0.3s cubic-bezier(0.4,0,0.2,1), background 0.25s ease, box-shadow 0.2s; white-space: nowrap; gap: 0; }
        .fab-import:hover { width: 168px; background: linear-gradient(135deg, #252220, #3D3A36); box-shadow: 0 6px 28px rgba(13,11,9,0.35); gap: 8px; }
        .fab-icon { font-size: 22px; font-weight: 300; color: white; line-height: 1; flex-shrink: 0; }
        .fab-label { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 700; color: white; letter-spacing: 0.04em; max-width: 0; overflow: hidden; opacity: 0; transition: max-width 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s 0.1s; white-space: nowrap; }
        .fab-import:hover .fab-label { max-width: 120px; opacity: 1; }
      `}</style>

      <div className={dark ? "dark" : ""} style={{ background: "var(--cream)", minHeight: "100vh", padding: "48px 28px 80px", fontFamily: "'Inter', sans-serif", transition: "background 0.3s, color 0.3s" }}>
        <div className="fade-up" style={{ marginBottom: 28 }}>
          <div style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 32, padding: "5px 12px", borderRadius: 100, background: "var(--cream-card)", border: "1px solid var(--cream-border)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.04em", color: "var(--ink-faint)" }}>
            <span style={{ color: isPro ? "var(--red)" : "var(--ink)", fontWeight: 700, textTransform: "uppercase" }}>{eyebrow}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{accountLabel}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{session.user.email}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 26, fontWeight: 900, letterSpacing: "-0.01em", color: "var(--ink)", lineHeight: 1.1 }}>Hello, {eyebrow} 👋</div>
              <div style={{ fontFamily: "'Noto Serif', serif", fontSize: 14, color: "var(--ink-light)", marginTop: 5, fontStyle: "italic" }}>Welcome to your financial dashboard.</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <div className="ws-toggle">
                <button className={`ws-toggle-opt${isPro ? " active" : ""}`} onClick={() => setWorkspace("professional")} title="Professional">💼</button>
                <button className={`ws-toggle-opt${!isPro ? " active" : ""}`} onClick={() => setWorkspace("personal")} title="Personal">👤</button>
              </div>
              <div className="ws-toggle">
                <button className={`ws-toggle-opt${!dark ? " active" : ""}`} onClick={() => setDark(false)} title="Light mode">☀️</button>
                <button className={`ws-toggle-opt${dark ? " active" : ""}`} onClick={() => setDark(true)} title="Dark mode">🌙</button>
              </div>
              <button onClick={() => setShowCatManager(true)} title="Manage categories" style={{ background: "transparent", border: "1.5px solid rgba(0,0,0,0.14)", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", color: "var(--ink-faint)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>🗂️</button>
              <button onClick={() => supabase.auth.signOut()} title="Sign out" style={{ background: "transparent", border: "1.5px solid rgba(0,0,0,0.14)", borderRadius: 100, padding: "5px 12px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: "var(--ink-faint)", letterSpacing: "0.05em" }}>Sign out</button>
            </div>
          </div>
        </div>

        <DashboardPanel key={workspace} userId={session.user.id} workspace={workspace} categories={categories} catMap={catMap} dark={dark} />
        {showCatManager && <CategoryManager categories={categories} onSave={handleSaveCategories} onClose={() => setShowCatManager(false)} />}
      </div>
    </>
  );
}
