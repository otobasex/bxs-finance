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


/* ─── PDF PARSER (AI-powered via Claude document vision) ─── */
async function parsePDFWithAI(file, catNames, onStatus) {
  onStatus("Reading PDF…");
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });

  onStatus("Sending to Claude — extracting transactions…");
  const prompt = `You are parsing a South African FNB bank statement PDF. Extract every transaction and return ONLY a JSON array — no markdown, no explanation, nothing else.

Each object must have exactly these fields:
- "date": "DD Mon YYYY" format, e.g. "09 Feb 2026"
- "description": full transaction description string
- "debit": number (money out) or null
- "credit": number (money in) or null

Rules:
- Amounts with "Cr" suffix are credits (money in)
- Amounts without "Cr" are debits (money out)  
- Opening/Closing Balance lines are NOT transactions — skip them
- Bank charge accrual column values are NOT transaction amounts — ignore them
- Include bank fee rows (#Monthly Account Fee, #Service Fees etc) as debits
- Include reversal/refund rows as credits
- Every row in the Transactions table must appear exactly once

Return only the JSON array.`;

  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: prompt }
        ]
      }]
    }),
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = await response.json();
  const raw = data.content?.map(c => c.text || "").join("") || "";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  onStatus("Building transactions…");
  const monthMap = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const transactions = [];
  for (const row of parsed) {
    const parts = String(row.date || "").trim().split(" ");
    if (parts.length < 3) continue;
    const day = parseInt(parts[0]);
    const monthIdx = monthMap[parts[1]];
    const year = parseInt(parts[2]);
    if (isNaN(day) || monthIdx === undefined || isNaN(year)) continue;
    const isCredit = !!(row.credit && row.credit > 0);
    const amount = isCredit ? parseFloat(row.credit) : parseFloat(row.debit);
    if (!amount || amount <= 0) continue;
    const desc = String(row.description || "").trim();
    if (!desc) continue;
    const dateStr = `${parts[1]} ${day}`;
    transactions.push({
      id: transactions.length,
      date: new Date(year, monthIdx, day),
      dateStr,
      description: desc,
      amount,
      isCredit,
      category: categoriseFallback(desc, isCredit, catNames),
      aiCategorised: false,
      manualCategory: null,
    });
  }
  return transactions;
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
    const fyStart = currentFYStartYear();
    const year = month >= 2 ? fyStart : fyStart + 1;
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
// Returns structured transaction array directly — no fragile text round-trip
async function parseSpreadsheet(file, catNames) {
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
  const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

  // Parse a raw cell value into { day, monthIdx, year } — handles Date objects and all common string formats
  const parseDate = (raw) => {
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw)) return { day: raw.getDate(), monthIdx: raw.getMonth(), year: raw.getFullYear() };
    const s = String(raw).trim();
    // "09 Feb 2026" or "9 Feb 2026" or "09 Feb"
    const m0 = s.match(/^(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?/);
    if (m0) {
      const mi = monthMap[m0[2].toLowerCase()];
      if (mi !== undefined) {
        const year = m0[3] ? parseInt(m0[3]) : (mi >= 2 ? currentFYStartYear() : currentFYStartYear() + 1);
        return { day: parseInt(m0[1]), monthIdx: mi, year };
      }
    }
    // "09/02/2026" or "09-02-2026" (DD/MM/YYYY)
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m1) {
      const d=parseInt(m1[1]), mi=parseInt(m1[2])-1, y=parseInt(m1[3]);
      if (mi >= 0 && mi < 12) return { day: d, monthIdx: mi, year: y < 100 ? 2000 + y : y };
    }
    // "2026/02/09" (YYYY/MM/DD)
    const m2 = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (m2) {
      const mi=parseInt(m2[2])-1, d=parseInt(m2[3]);
      if (mi >= 0 && mi < 12) return { day: d, monthIdx: mi, year: parseInt(m2[1]) };
    }
    return null;
  };

  // Find header row
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

  const transactions = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const parsed = parseDate(row[dateIdx]);
    if (!parsed) continue;
    const desc = String(row[resolvedDescIdx] || "").trim();
    if (!desc || desc.toLowerCase() === "description") continue;

    let amount = 0, isCredit = false;
    if (credIdx !== -1 && debIdx !== -1) {
      const cred = parseFloat(String(row[credIdx] || "").replace(/[^\d.]/g, "")) || 0;
      const deb  = parseFloat(String(row[debIdx]  || "").replace(/[^\d.]/g, "")) || 0;
      if (cred > 0)      { amount = cred; isCredit = true; }
      else if (deb > 0)  { amount = deb;  isCredit = false; }
      else continue;
    } else if (amtIdx !== -1) {
      const raw = String(row[amtIdx] || "").trim();
      if (!raw) continue;
      isCredit = /cr$/i.test(raw);
      amount = Math.abs(parseFloat(raw.replace(/[^\d.\-]/g, "")) || 0);
    } else continue;
    if (amount === 0) continue;

    const { day, monthIdx, year } = parsed;
    const dateStr = `${MNS[monthIdx]} ${day}`;
    transactions.push({
      id: transactions.length,
      date: new Date(year, monthIdx, day),
      dateStr,
      description: desc,
      amount,
      isCredit,
      category: categoriseFallback(desc, isCredit, catNames || []),
      aiCategorised: false,
      manualCategory: null,
    });
  }
  return transactions;
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
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#E31A51", marginBottom: 10 }}>Base X Studio</div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 900, fontSize: 28, letterSpacing: "-0.03em", textTransform: "uppercase", color: "#0A0A0A" }}>Financial<br />Dashboard</div>
        </div>
        <div style={{ background: "#F5F5F5", border: "1px solid rgba(0,0,0,0.10)", borderRadius: 24, padding: 32, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.4)", marginBottom: 4 }}>
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </div>
          <button onClick={handleGoogle} disabled={loading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px", borderRadius: 12, border: "1.5px solid rgba(0,0,0,0.10)", background: "white", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600, color: "#0A0A0A", transition: "all 0.15s" }}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
            Continue with Google
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "rgba(0,0,0,0.3)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
          </div>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email address"
            style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.10)", background: "white", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "#0A0A0A", outline: "none" }} />
          <input value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleEmail()} type="password" placeholder="Password"
            style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.10)", background: "white", fontFamily: "'Inter', sans-serif", fontSize: 14, color: "#0A0A0A", outline: "none" }} />
          {error && <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#E31A51", padding: "8px 12px", background: "rgba(227,26,81,0.06)", borderRadius: 8 }}>{error}</div>}
          {message && <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#14b8a6", padding: "8px 12px", background: "rgba(20,184,166,0.06)", borderRadius: 8 }}>{message}</div>}
          <button onClick={handleEmail} disabled={loading} style={{ padding: "13px", borderRadius: 100, background: "linear-gradient(135deg, #E31A51, #FF5C7A)", border: "none", color: "white", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 12px rgba(227,26,81,0.3)", marginTop: 4 }}>
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
          <div style={{ textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 4 }}>
            {mode === "login" ? (
              <span>No account? <button onClick={() => { setMode("signup"); setError(null); }} style={{ background: "none", border: "none", color: "#E31A51", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", fontWeight: 700 }}>Sign up</button></span>
            ) : (
              <span>Have an account? <button onClick={() => { setMode("login"); setError(null); }} style={{ background: "none", border: "none", color: "#E31A51", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", fontWeight: 700 }}>Sign in</button></span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontFamily: "'Inter', sans-serif", fontSize: 10, color: "rgba(0,0,0,0.25)", letterSpacing: "0.06em" }}>
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


/* ─── AVATAR IMAGES ─── */
const AVATAR_BXS = "data:image/png;base64,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";
const AVATAR_OTO = "data:image/png;base64,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";

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

  const bg        = dark ? "#111111"                  : "#FDF8F5";
  const border    = dark ? "rgba(255,255,255,0.06)"   : "var(--cream-border)";
  const gridLine  = dark ? "rgba(255,255,255,0.06)"   : "rgba(0,0,0,0.05)";
  const fyColor   = dark ? "rgba(255,255,255,0.9)"    : "var(--ink)";
  const arrowFill = dark ? "rgba(255,255,255,0.7)"    : "var(--ink-mid)";
  const labelMute = dark ? "rgba(255,255,255,0.35)"   : "var(--ink-faint)";
  const incomeCol = dark ? "#8EEC7C"                  : "#16a34a";
  const spendCol  = dark ? "#FF9F99"                  : "#E31A51";
  const netCol    = (n) => n >= 0 ? incomeCol : spendCol;
  const clearBg   = dark ? "rgba(255,255,255,0.08)"   : "white";
  const clearBd   = dark ? "rgba(255,255,255,0.12)"   : "var(--cream-border)";
  const clearTxt  = dark ? "rgba(255,255,255,0.6)"    : "var(--ink-mid)";
  const emptyBar  = dark ? "rgba(255,255,255,0.08)"   : "rgba(0,0,0,0.06)";
  const monthLbl  = (sel, empty) => sel ? (dark ? "rgba(255,255,255,0.9)" : "var(--ink)") : empty ? (dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.15)") : (dark ? "rgba(255,255,255,0.35)" : "var(--ink-faint)");
  const selBorder = dark ? "rgba(255,255,255,0.08)"   : "var(--cream-border)";
  const selTxtMute= dark ? "rgba(255,255,255,0.4)"    : "var(--ink-faint)";
  const selTxtHi  = dark ? "rgba(255,255,255,0.9)"    : "var(--ink)";

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: "var(--r-xl)", padding: "20px 24px 16px", marginBottom: 14, position: "relative", overflow: "visible" }}>
      {/* bg grid lines */}
      <div style={{ position: "absolute", left: 24, right: 24, top: 52, bottom: 40, pointerEvents: "none", zIndex: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{ width: "100%", height: "1px", background: gridLine }} />
        ))}
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          {/* FY Navigator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={prevFY} disabled={!canGoBack} style={{ background: "transparent", border: "none", cursor: canGoBack ? "pointer" : "default", padding: "0 2px", lineHeight: 1, opacity: canGoBack ? 1 : 0.2, transition: "opacity 0.15s" }}>
              <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="8,1 2,5 8,9" fill={arrowFill}/></svg>
            </button>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: fyColor }}>
              FY {fyStartYear}/{fyStartYear + 1}
            </div>
            <button onClick={nextFY} disabled={!canGoFwd} style={{ background: "transparent", border: "none", cursor: canGoFwd ? "pointer" : "default", padding: "0 2px", lineHeight: 1, opacity: canGoFwd ? 1 : 0.2, transition: "opacity 0.15s" }}>
              <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="2,1 8,5 2,9" fill={arrowFill}/></svg>
            </button>
          </div>
          {/* Totals */}
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <div>
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: labelMute }}>Income  </span>
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700, color: incomeCol }}>{fmt(totalIncome, true)}</span>
            </div>
            <div>
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: labelMute }}>Spend  </span>
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700, color: spendCol }}>{fmt(totalSpend, true)}</span>
            </div>
            <div>
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: labelMute }}>Net  </span>
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700, color: netCol(totalIncome - totalSpend) }}>{fmt(totalIncome - totalSpend, true)}</span>
            </div>
          </div>
        </div>
        {selectedMonth && (
          <button onClick={() => onSelectMonth(null)} style={{ background: clearBg, border: `1px solid ${clearBd}`, borderRadius: 100, padding: "4px 12px", color: clearTxt, fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", cursor: "pointer", textTransform: "uppercase" }}>
            Clear ✕
          </button>
        )}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 110, position: "relative", zIndex: 1 }}>
        {monthData.map((m, i) => {
          const isSelected = selectedMonth && selectedMonth.month === m.month && selectedMonth.year === m.year;
          const incomeH = m.income > 0 ? Math.max((m.income / maxVal) * 100, 4) : 0;
          const spendH  = m.spend  > 0 ? Math.max((m.spend  / maxVal) * 100, 4) : 0;
          const isEmpty = !m.hasTxs;
          const dimmed = selectedMonth && !isSelected;

          return (
            <div
              key={i}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: isEmpty ? "default" : "pointer", position: "relative" }}
              onClick={() => !isEmpty && onSelectMonth(isSelected ? null : m)}
              onMouseEnter={() => !isEmpty && setTooltip(i)}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Tooltip */}
              {tooltip === i && (
                <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "var(--ink)", borderRadius: 10, padding: "10px 12px", zIndex: 20, pointerEvents: "none", minWidth: 130, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.9)", marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: "#8EEC7C", marginBottom: 2 }}>↑ {fmt(m.income, true)}</div>
                  <div style={{ fontSize: 10, color: "#FF9F99", marginBottom: 2 }}>↓ {fmt(m.spend, true)}</div>
                  <div style={{ fontSize: 10, color: m.net >= 0 ? "#8EEC7C" : "#FF9F99", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 4, marginTop: 4 }}>
                    {m.net >= 0 ? "+" : ""}{fmt(m.net, true)}
                  </div>
                </div>
              )}

              {/* Bar pair — thin pill bars with gradient */}
              <div style={{ width: "100%", display: "flex", gap: 0, alignItems: "flex-end", height: 96, paddingBottom: 0 }}>
                {/* Income bar */}
                <div style={{
                  flex: 1,
                  maxWidth: 7,
                  margin: "0 1px 0 auto",
                  height: isEmpty ? 3 : `${incomeH}%`,
                  background: isEmpty ? emptyBar : "linear-gradient(to bottom, #8EEC7C, #C0EFDE)",
                  borderRadius: 100,
                  transition: "all 0.3s ease",
                  opacity: isEmpty ? 1 : dimmed ? 0.2 : 1,
                  minHeight: isEmpty ? 3 : undefined,
                }} />
                {/* Spend bar */}
                <div style={{
                  flex: 1,
                  maxWidth: 7,
                  margin: "0 auto 0 1px",
                  height: isEmpty ? 3 : `${spendH}%`,
                  background: isEmpty ? emptyBar : "linear-gradient(to bottom, #FF9F99, #FFCECD)",
                  borderRadius: 100,
                  transition: "all 0.3s ease",
                  opacity: isEmpty ? 1 : dimmed ? 0.2 : 1,
                  minHeight: isEmpty ? 3 : undefined,
                }} />
              </div>

              {/* Month label */}
              <div style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 8, fontWeight: isSelected ? 700 : 400,
                color: monthLbl(isSelected, isEmpty),
                letterSpacing: "0.06em", textTransform: "uppercase",
                transition: "color 0.2s",
                paddingTop: 6,
                whiteSpace: "nowrap",
              }}>
                {ALL_MONTHS[m.month].slice(0,3)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected month indicator */}
      {selectedMonth && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${selBorder}`, fontFamily: "'Inter', sans-serif", fontSize: 10, color: selTxtMute, letterSpacing: "0.06em" }}>
          Showing  <span style={{ color: selTxtHi, fontWeight: 700 }}>{selectedMonth.label}</span>  below · Click bar again or Clear to see full year
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
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Edit Transaction</div>
          <button onClick={onClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: "var(--ink-light)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Description</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Amount</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 4, padding: "3px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)" }}>
            <button onClick={() => setIsCredit(false)} style={{ padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, background: !isCredit ? "#FFD6C2" : "transparent", color: !isCredit ? "#8B3A00" : "var(--ink-faint)", transition: "all 0.15s" }}>Debit</button>
            <button onClick={() => setIsCredit(true)}  style={{ padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, background: isCredit  ? "#BFEFDF" : "transparent", color: isCredit  ? "#1A5C3A" : "var(--ink-faint)", transition: "all 0.15s" }}>Credit</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Date</label>
          <input value={dateStr} onChange={e => setDateStr(e.target.value)} placeholder="08 Dec" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Category</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, maxHeight: 200, overflowY: "auto" }}>
            {categories.filter(c => c.name !== "Income" || isCredit).map(c => {
              const cfg = catMap[c.name] || { color: "#7A756E", bg: "#7A756E18" };
              const isActive = category === c.name;
              return (
                <button key={c.id} onClick={() => setCategory(c.name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: `1px solid ${isActive ? cfg.color : "var(--cream-border)"}`, background: isActive ? cfg.bg : "transparent", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600, color: isActive ? cfg.color : "var(--ink-mid)", transition: "all 0.1s" }}>
                  {c.icon} <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-mid)", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "10px", borderRadius: 100, background: "var(--charcoal)", border: "none", color: "white", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

/* ─── IMPORT MODAL ─── */
function ImportModal({ open, onClose, onImport, onImportDirect, catNames }) {
  const [text, setText]           = useState("");
  const [dragging, setDragging]   = useState(false);
  const [fileName, setFileName]   = useState("");
  const [processing, setProcessing] = useState(false);
  const [pdfStatus, setPdfStatus] = useState("");  // live status string during PDF parse
  const [pdfPreview, setPdfPreview] = useState(null); // { transactions, count } after parse
  const [pdfError, setPdfError]   = useState("");

  const resetPdf = () => { setPdfPreview(null); setPdfStatus(""); setPdfError(""); setFileName(""); };

  const processFile = async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    setFileName(file.name);
    setPdfError("");

    if (ext === "pdf") {
      // ── PDF path: AI extraction ──
      setProcessing(true);
      setPdfStatus("Reading PDF…");
      setPdfPreview(null);
      try {
        const txs = await parsePDFWithAI(file, catNames || [], msg => setPdfStatus(msg));
        if (!txs.length) throw new Error("No transactions found in PDF.");
        setPdfPreview({ transactions: txs, fileName: file.name });
        setPdfStatus("");
      } catch (e) {
        setPdfError(e.message || "PDF parsing failed.");
        setPdfStatus("");
        setFileName("");
      }
      setProcessing(false);
    } else if (ext === "csv" || ext === "xlsx" || ext === "xls") {
      // ── Spreadsheet path: parse directly to structured transactions ──
      setProcessing(true);
      try {
        const txs = await parseSpreadsheet(file, catNames || []);
        if (!txs.length) throw new Error("No transactions found in spreadsheet.");
        setPdfPreview({ transactions: txs, fileName: file.name });
      } catch (e) {
        setPdfError(e.message || "Could not read spreadsheet.");
        setFileName("");
      }
      setProcessing(false);
    } else {
      // ── Text/paste path ──
      setProcessing(true);
      try { setText(await file.text()); }
      catch { setText(""); alert("Could not read file."); }
      setProcessing(false);
    }
  };

  if (!open) return null;

  const canImportText = text.trim().length > 0;
  const canImportPdf  = !!pdfPreview;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => { onClose(); resetPdf(); }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(3px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 24, padding: 32, width: 540, maxWidth: "95vw", zIndex: 101, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Import Statement</div>
          <button onClick={() => { onClose(); resetPdf(); }} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", color: "var(--ink-light)", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {/* Drop zone */}
        {!pdfPreview && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={async e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) await processFile(f); }}
            style={{ border: `2px dashed ${dragging ? "var(--red)" : "var(--cream-border)"}`, borderRadius: 14, padding: "28px 20px", textAlign: "center", transition: "all 0.15s", background: dragging ? "rgba(227,26,81,0.04)" : "var(--cream)", cursor: "pointer" }}
            onClick={() => document.getElementById("file-input-hidden").click()}
          >
            <input id="file-input-hidden" type="file" accept=".txt,.csv,.xlsx,.xls,.pdf" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) await processFile(f); e.target.value = ""; }} />
            {processing ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div className="ai-spinner" style={{ width: 20, height: 20, borderWidth: 2.5 }} />
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#6366f1", fontWeight: 600 }}>{pdfStatus || "Processing…"}</div>
              </div>
            ) : fileName && !pdfError ? (
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-mid)", fontWeight: 600 }}>📄 {fileName}</div>
            ) : (
              <>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-faint)" }}>Drop file or click to browse</div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, color: "var(--ink-faint)", marginTop: 4, opacity: 0.7 }}>PDF · TXT · CSV · XLSX · XLS</div>
                <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 100, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
                  <span style={{ fontSize: 9, color: "#6366f1", fontFamily: "'Inter',sans-serif", fontWeight: 700, letterSpacing: "0.06em" }}>✦ PDF auto-parsed by Claude</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* PDF error */}
        {pdfError && (
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(227,26,81,0.06)", border: "1px solid rgba(227,26,81,0.2)", fontFamily: "'Inter',sans-serif", fontSize: 11, color: "var(--red)" }}>
            ⚠ {pdfError}
          </div>
        )}

        {/* PDF preview card — shown after successful parse */}
        {pdfPreview && (
          <div style={{ borderRadius: 14, border: "1px solid var(--cream-border)", overflow: "hidden" }}>
            {/* Preview header */}
            <div style={{ padding: "14px 18px", background: "rgba(99,102,241,0.06)", borderBottom: "1px solid var(--cream-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6366f1" }}>
                {/\.pdf$/i.test(pdfPreview.fileName) ? "✦ Claude extracted" : "✓ Parsed"} {pdfPreview.transactions.length} transactions
              </div>
                <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "var(--ink-light)", marginTop: 2 }}>📄 {pdfPreview.fileName}</div>
              </div>
              <button onClick={resetPdf} style={{ background: "transparent", border: "1px solid var(--cream-border)", borderRadius: 100, padding: "3px 10px", cursor: "pointer", fontFamily: "'Inter',sans-serif", fontSize: 9, color: "var(--ink-faint)", letterSpacing: "0.05em" }}>Change file</button>
            </div>
            {/* Transaction preview list */}
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {pdfPreview.transactions.slice(0, 8).map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", borderBottom: "1px solid var(--cream-border)", background: i % 2 ? "var(--cream)" : "transparent" }}>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: "var(--ink-faint)", whiteSpace: "nowrap", width: 44 }}>{t.dateStr}</span>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "var(--ink-mid)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</span>
                  <span style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, fontWeight: 600, color: t.isCredit ? "#3D8C6F" : "var(--red)", whiteSpace: "nowrap" }}>{t.isCredit ? "+" : "−"}R {t.amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
              {pdfPreview.transactions.length > 8 && (
                <div style={{ padding: "8px 18px", fontFamily: "'Inter',sans-serif", fontSize: 10, color: "var(--ink-faint)", textAlign: "center" }}>
                  + {pdfPreview.transactions.length - 8} more transactions
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text paste — only show when no PDF loaded */}
        {!pdfPreview && (
          <>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Or paste statement text</div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} placeholder="Paste your bank statement text here…" style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, lineHeight: 1.7, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--cream-border)", background: "var(--cream)", color: "var(--ink)", resize: "vertical", outline: "none" }} />
          </>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { onClose(); resetPdf(); }} style={{ flex: 1, padding: "11px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-mid)", cursor: "pointer" }}>Cancel</button>
          {canImportPdf ? (
            <button
              onClick={() => { onImportDirect(pdfPreview.transactions); resetPdf(); }}
              style={{ flex: 2, padding: "11px", borderRadius: 100, background: "var(--grad)", border: "none", color: "white", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              Import {pdfPreview.transactions.length} Transactions
            </button>
          ) : (
            <button
              onClick={() => { if (canImportText) { onImport(text); setText(""); setFileName(""); } }}
              disabled={!canImportText}
              style={{ flex: 2, padding: "11px", borderRadius: 100, background: canImportText ? "var(--grad)" : "var(--cream-border)", border: "none", color: canImportText ? "white" : "var(--ink-faint)", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, cursor: canImportText ? "pointer" : "not-allowed", transition: "all 0.15s" }}
            >
              Import Statement
            </button>
          )}
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
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)", marginBottom: 4 }}>Re-categorise</div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", marginBottom: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{transaction.description}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {categories.filter(c => c.name !== "Income").map(c => (
            <button key={c.id} onClick={() => onSelect(c.name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600, color: "var(--ink-mid)", transition: "all 0.1s" }}>
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
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Manage Categories</div>
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
          <button onClick={add} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px dashed var(--cream-border)", background: "transparent", fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-faint)", cursor: "pointer" }}>+ Add Category</button>
          <button onClick={() => onSave(cats, deletedName, reassignTo)} style={{ flex: 2, padding: "10px", borderRadius: 100, background: "var(--charcoal)", border: "none", color: "white", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
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
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Custom Date Range</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 12, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 12, color: "var(--ink)", outline: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-mid)", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => canApply && onApply(from, to)} disabled={!canApply} style={{ flex: 2, padding: "10px", borderRadius: 100, background: canApply ? "var(--charcoal)" : "var(--cream-border)", border: "none", color: canApply ? "white" : "var(--ink-faint)", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, cursor: canApply ? "pointer" : "not-allowed" }}>Apply Range</button>
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
  const [renamingStmt, setRenamingStmt] = useState(null); // { idx, value }

  const catNames = categories.map(c => c.name);

  /* Load statements — 2 queries total instead of N+1 */
  useEffect(() => {
    const load = async () => {
      setDbLoading(true);
      try {
        const { data: stmts, error: stmtsErr } = await supabase
          .from("statements").select("*")
          .eq("user_id", userId).eq("workspace", workspace).order("created_at");
        if (stmtsErr) throw stmtsErr;
        if (!stmts || !stmts.length) { setStatements([]); setDbLoading(false); return; }

        const stmtIds = stmts.map(s => s.id);
        const { data: allTxRows, error: txErr } = await supabase
          .from("transactions").select("*")
          .in("statement_id", stmtIds).order("local_id");
        if (txErr) throw txErr;

        // Group transactions by statement_id client-side
        const txByStmt = {};
        (allTxRows || []).forEach(t => {
          if (!txByStmt[t.statement_id]) txByStmt[t.statement_id] = [];
          txByStmt[t.statement_id].push({
            ...t, id: t.local_id, date: new Date(t.date), dateStr: t.date_str,
            isCredit: t.is_credit, aiCategorised: t.ai_categorised, manualCategory: t.manual_category
          });
        });

        const results = stmts.map(s => ({
          id: s.id, label: s.label, sortOrder: s.sort_order ?? null,
          transactions: txByStmt[s.id] || []
        }));
        setStatements(sortStatements(results));
      } catch (e) {
        console.error("Failed to load statements:", e);
        setStatements([]);
      } finally {
        setDbLoading(false);
      }
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
    setStatements(prev => {
      const updated = sortStatements([...prev, newEntry]);
      setActiveStmt(updated.length - 1);
      return updated;
    });
    setShowImport(false); setAiStatus(null);
  };

  // Direct import path for PDF-parsed transactions (already structured, skip text parsing)
  const handleImportDirect = async (parsed) => {
    if (!parsed.length) { alert("No transactions found."); return; }
    const label = detectPeriodLabel(parsed);
    const { data: newStmt } = await supabase.from("statements").insert({ user_id: userId, workspace, label }).select().single();
    if (!newStmt) { alert("Failed to save statement."); return; }
    const txRows = parsed.map(t => ({ statement_id: newStmt.id, local_id: t.id, date: t.date.toISOString(), date_str: t.dateStr, description: t.description, amount: t.amount, is_credit: t.isCredit, category: t.category, ai_categorised: false, manual_category: null }));
    await supabase.from("transactions").insert(txRows);
    const newEntry = { id: newStmt.id, label, sortOrder: null, transactions: parsed };
    setStatements(prev => {
      const updated = sortStatements([...prev, newEntry]);
      setActiveStmt(updated.length - 1);
      return updated;
    });
    setShowImport(false); setAiStatus(null);
  };

  const handleAICategorise = async () => {
    setAiLoading(true); setAiStatus(null);
    try {
      // In statement mode: categorise the active statement only
      // In calendar mode: categorise all statements (all visible transactions may span many)
      const targetStmts = navMode === "statement"
        ? [statements[activeStmt] || statements[0]].filter(Boolean)
        : statements;

      for (const stmt of targetStmts) {
        const updated = await categoriseWithAI(stmt.transactions, catNames);
        for (const t of updated) {
          await supabase.from("transactions")
            .update({ category: t.category, ai_categorised: t.aiCategorised })
            .eq("statement_id", stmt.id).eq("local_id", t.id);
        }
        setStatements(prev => prev.map(s => s.id === stmt.id ? { ...s, transactions: updated } : s));
      }
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
      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-faint)" }}>Loading statements…</span>
    </div>
  );

  return (
    <div style={{ position: "relative" }}>

      {/* ── NAV MODE TOGGLE ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 100, padding: 3, gap: 2 }}>
          {[["calendar","📅 Calendar"],["statement","🗂 Statement"]].map(([mode, label]) => (
            <button key={mode} onClick={() => { setNavMode(mode); setSelectedMonth(null); setCustomRange(null); setActiveCategory(null); setSearch(""); }} style={{ padding: "5px 14px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: navMode === mode ? "var(--charcoal)" : "transparent", color: navMode === mode ? "white" : "var(--ink-faint)", transition: "all 0.2s" }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "var(--ink-faint)", paddingLeft: 4 }}>{contextLabel}</div>
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
                {renamingStmt?.idx === i ? (
                  <input
                    autoFocus
                    value={renamingStmt.value}
                    onChange={e => setRenamingStmt(r => ({ ...r, value: e.target.value }))}
                    onBlur={async () => {
                      const newLabel = renamingStmt.value.trim();
                      if (newLabel && newLabel !== s.label) {
                        await supabase.from("statements").update({ label: newLabel }).eq("id", s.id);
                        setStatements(prev => prev.map((st, si) => si === i ? { ...st, label: newLabel } : st));
                      }
                      setRenamingStmt(null);
                    }}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setRenamingStmt(null); }}
                    style={{ padding: "3px 8px", borderRadius: 8, border: "1px solid var(--red)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, color: "var(--ink)", outline: "none", width: Math.max(80, renamingStmt.value.length * 7) + "px", letterSpacing: "0.05em" }}
                  />
                ) : (
                  <button
                    onClick={() => { setActiveStmt(i); setCustomRange(null); setActiveCategory(null); setSearch(""); setAiStatus(null); }}
                    onDoubleClick={() => isActive && setRenamingStmt({ idx: i, value: s.label })}
                    title={isActive ? "Double-click to rename" : ""}
                    style={{ padding: isActive && statements.length > 1 ? "5px 4px" : "5px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, color: isActive ? "var(--ink)" : "var(--ink-faint)", letterSpacing: "0.05em", whiteSpace: "nowrap" }}
                  >{s.label}</button>
                )}
                {isActive && statements.length > 1 && (
                  <button onClick={() => moveStatement(i, 1)} disabled={i === statements.length - 1} style={{ padding: "5px 6px", background: "transparent", border: "none", cursor: i === statements.length - 1 ? "default" : "pointer", color: i === statements.length - 1 ? "var(--cream-border)" : "var(--ink-faint)", fontSize: 10 }}>›</button>
                )}
                <button onClick={() => removeStatement(i)} style={{ padding: "5px 10px 5px 4px", background: "transparent", border: "none", cursor: "pointer", color: isActive ? "var(--ink-faint)" : "rgba(0,0,0,0.15)", fontSize: 11 }}>✕</button>
              </div>
            );
          })}
          {/* Custom range button */}
          <button onClick={() => setShowCustomRange(true)} style={{ padding: "5px 14px", borderRadius: 100, border: `1px solid ${customRange ? "var(--red)" : "var(--cream-border)"}`, background: customRange ? "rgba(227,26,81,0.06)" : "transparent", color: customRange ? "var(--red)" : "var(--ink-faint)", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: customRange ? 700 : 400, cursor: "pointer", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
            {customRange ? `📅 ${customRange.from} → ${customRange.to} ✕` : "📅 Custom Range"}
          </button>
          {customRange && <button onClick={() => setCustomRange(null)} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 9, color: "var(--ink-faint)" }}>Clear</button>}
          <button onClick={() => setShowImport(true)} style={{ padding: "5px 12px", borderRadius: 100, border: "1px dashed var(--cream-border)", background: "transparent", color: "var(--ink-faint)", fontFamily: "'Inter', sans-serif", fontSize: 10, cursor: "pointer" }}>+ Add</button>
        </div>
      )}

      {!statements.length && (
        <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--ink-faint)", fontFamily: "'Inter', sans-serif", fontSize: 12, letterSpacing: "0.06em" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🗂️</div>
          No statements yet.<br />
          <button onClick={() => setShowImport(true)} style={{ marginTop: 16, padding: "8px 20px", borderRadius: 100, background: "var(--grad)", border: "none", color: "white", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Import your first statement</button>
        </div>
      )}

      {statements.length > 0 && <>
        {/* AI Status */}
        {(aiLoading || aiStatus) && (
          <div style={{ marginBottom: 12, padding: "10px 18px", borderRadius: 10, background: aiLoading ? "rgba(99,102,241,0.08)" : aiStatus === "done" ? "rgba(20,184,166,0.08)" : "rgba(227,26,81,0.08)", border: `1px solid ${aiLoading ? "rgba(99,102,241,0.2)" : aiStatus === "done" ? "rgba(20,184,166,0.2)" : "rgba(227,26,81,0.2)"}`, display: "flex", alignItems: "center", gap: 10 }}>
            {aiLoading && <div className="ai-spinner" />}
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: aiLoading ? "#6366f1" : aiStatus === "done" ? "#14b8a6" : "#E31A51" }}>
              {aiLoading ? "Claude is categorising your transactions…" : aiStatus === "done" ? `✓ AI categorised ${aiCount} transactions${manualCount > 0 ? ` · ${manualCount} manually overridden` : ""}` : "⚠ AI categorisation failed — using keyword matching"}
            </span>
          </div>
        )}

        {/* KPI CARDS — animate on change */}
        <div className="fade-up bento-top" style={{ animationDelay: "0.05s" }} key={`${navMode}-${selectedMonth?.label}-${customRange?.from}-${activeStmt}`}>
          <div style={{ padding: "20px 20px 18px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #BFEFDF 60%, #DCF2F8)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 10 }}>Income</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 40, fontWeight: 700, color: "#0A0A0A", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", flex: 1 }}>{fmt(summary.income, true)}</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 14 }}>{transactions.filter(t => t.isCredit).length} credits</div>
          </div>
          <div style={{ padding: "20px 20px 18px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #FFD6C2 0%, #FFB3C6 100%)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 10 }}>Spend</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 40, fontWeight: 700, color: "#0A0A0A", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", flex: 1 }}>{fmt(summary.spend, true)}</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 14 }}>{transactions.filter(t => !t.isCredit).length} debits</div>
          </div>
          <div className="net-hero-inner" style={{ borderRadius: "var(--r-xl)", padding: "20px 28px 18px", background: netPositive ? "var(--charcoal)" : "#C0392B", boxShadow: netPositive ? "0 2px 24px rgba(13,11,9,0.14)" : "0 2px 24px rgba(192,57,43,0.25)", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.75)", marginBottom: 10 }}>{netPositive ? "Net Surplus" : "Net Deficit"}</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 40, fontWeight: 700, color: "white", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", flex: 1 }}>{fmt(Math.abs(summary.net), true)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.18)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min((summary.spend / (summary.income || 1)) * 100, 100).toFixed(1)}%`, background: "rgba(255,255,255,0.6)", borderRadius: 2, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
              </div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>{((summary.spend / (summary.income || 1)) * 100).toFixed(0)}% spend ratio</div>
            </div>
          </div>
        </div>

        {/* CATEGORY */}
        <div className="fade-up" style={{ animationDelay: "0.1s", marginBottom: 12 }}>
          <div className="stat-card" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Spend by Category</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {activeCategory && <button onClick={() => setActiveCategory(null)} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, color: "var(--red)", letterSpacing: "0.04em" }}>Clear ✕</button>}
                <button onClick={handleAICategorise} disabled={aiLoading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 100, background: aiLoading ? "transparent" : "var(--cream)", border: `1px solid ${aiLoading ? "rgba(99,102,241,0.2)" : "var(--cream-border)"}`, color: aiLoading ? "#6366f1" : "var(--ink-mid)", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", cursor: aiLoading ? "not-allowed" : "pointer", transition: "all 0.2s" }}>
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
                      <text x={cx} y={cy-8} textAnchor="middle" style={{fontFamily:"'Inter',sans-serif",fontSize:11,fill:"var(--ink-light)",fontWeight:700}}>SPEND</text>
                      <text x={cx} y={cy+10} textAnchor="middle" style={{fontFamily:"'Inter',sans-serif",fontSize:13,fill:"var(--ink)",fontWeight:700}}>{fmt(total,true)}</text>
                    </svg>
                  </div>
                  <div className="donut-legend" style={{ flex:1, minWidth:160 }}>
                    {slices.map(({cat,amount,frac}) => { const cfg=catMap[cat]||{color:"#7A756E",bg:"#7A756E18"}; const isA=activeCategory===cat; return (
                      <div key={cat} onClick={() => setActiveCategory(activeCategory===cat?null:cat)} style={{cursor:"pointer",padding:"6px 0",borderRadius:6,background:isA?cfg.bg:"transparent",border:`1px solid ${isA?cfg.color+"22":"transparent"}`,opacity:activeCategory&&!isA?0.35:1,transition:"all 0.15s"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                          <div style={{width:7,height:7,borderRadius:2,background:cfg.color,flexShrink:0}} />
                          <div style={{flex:1,fontFamily:"'Inter',sans-serif",fontSize:11,fontWeight:600,color:isA?cfg.color:"var(--ink-mid)"}}>{cat}</div>
                          <div style={{fontFamily:"'Inter',sans-serif",fontSize:12,fontWeight:700,color:isA?cfg.color:"var(--ink)"}}>{(frac*100).toFixed(0)}%</div>
                          <div style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:"var(--ink-faint)"}}>{fmt(amount,true)}</div>
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
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>
                Transactions {activeCategory ? <span style={{ color: "var(--red)", marginLeft: 8 }}>{activeCategory}</span> : null}
              </div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "var(--ink-faint)", marginTop: 3 }}>{filtered.length} of {transactions.length}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {txView === "list" && <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" />}
              <div style={{ display: "flex", gap: 4 }}>
                {[["list","List"],["calendar","Calendar"]].map(([v,lbl]) => <button key={v} onClick={() => { setTxView(v); setSelectedDay(null); }} style={{ padding: "4px 12px", borderRadius: 100, border: "1px solid var(--cream-border)", background: txView===v?"var(--cream-card)":"transparent", color: txView===v?"var(--ink)":"var(--ink-faint)", fontFamily: "'Inter',sans-serif", fontSize: 10, cursor: "pointer", transition: "all 0.15s" }}>{lbl}</button>)}
              </div>
            </div>
          </div>

          {txView === "list" && (
            <div style={{ overflowY: "auto", maxHeight: 520 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--cream)" }}>{[["Date","left"],["Description","left"],["Category","left"],["Amount","right"],["","right"]].map(([h,align]) => <th key={h} style={{ padding:"10px 20px",textAlign:align,fontFamily:"'Inter',sans-serif",fontSize:9,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--ink-faint)",borderBottom:"1px solid var(--cream-border)" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.map(t => { const cat=t.manualCategory||t.category; const cfg=catMap[cat]||{color:"#7A756E",bg:"#7A756E18",icon:"•"}; return (
                    <tr key={t.id} className="tx-row">
                      <td style={{ padding:"11px 20px",fontFamily:"'Inter',sans-serif",fontSize:11,color:"var(--ink-faint)",whiteSpace:"nowrap" }}>{t.dateStr}</td>
                      <td style={{ padding:"11px 20px",fontFamily:"'Inter',sans-serif",fontSize:13,color:"var(--ink-mid)",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{t.description}</td>
                      <td style={{ padding:"11px 20px" }}><button onClick={() => !t.isCredit && setPickerTx(t)} style={{ background:cfg.bg,color:cfg.color,padding:"3px 10px",borderRadius:100,fontFamily:"'Inter',sans-serif",fontSize:10,fontWeight:600,letterSpacing:"0.04em",whiteSpace:"nowrap",border:`1px solid ${t.manualCategory?cfg.color+"66":"transparent"}`,cursor:t.isCredit?"default":"pointer",display:"inline-flex",alignItems:"center",gap:4,transition:"all 0.15s" }}>{cfg.icon} {cat}{t.manualCategory&&<span style={{fontSize:8,opacity:0.7}}>✎</span>}{t.aiCategorised&&!t.manualCategory&&<span style={{fontSize:8,opacity:0.7}}>✦</span>}</button></td>
                      <td style={{ padding:"11px 20px",textAlign:"right",fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:t.isCredit?"#3D8C6F":"var(--red)",whiteSpace:"nowrap" }}>{t.isCredit?"+":"−"}{fmt(t.amount)}</td>
                      <td style={{ padding:"11px 12px 11px 4px",textAlign:"right" }}>
                        <button onClick={() => setEditTx(t)} style={{ background:"transparent",border:"1px solid var(--cream-border)",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontFamily:"'Inter',sans-serif",fontSize:9,color:"var(--ink-faint)" }}>✎</button>
                      </td>
                    </tr>
                  ); })}
                </tbody>
              </table>
              {!filtered.length && <div style={{ padding:"48px 24px",textAlign:"center",color:"var(--ink-faint)",fontFamily:"'Inter',sans-serif",fontSize:11 }}>No transactions match your filter.</div>}
              <div style={{ padding:"10px 20px",borderTop:"1px solid var(--cream-border)",display:"flex",gap:16,flexWrap:"wrap" }}>
                {[["✦ AI categorised","#6366f1"],["✎ Manually overridden","#14b8a6"],["Click any category to re-categorise","var(--ink-faint)"]].map(([lbl,color]) => <span key={lbl} style={{ fontFamily:"'Inter',sans-serif",fontSize:9,color,letterSpacing:"0.06em" }}>{lbl}</span>)}
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
                        <div style={{fontFamily:"'Inter',sans-serif",fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"var(--ink-light)",marginBottom:10}}>{MN[month]} {year}</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>{DAYS.map(d=><div key={d} style={{fontFamily:"'Inter',sans-serif",fontSize:8,fontWeight:700,color:"var(--ink-faint)",textAlign:"center",padding:"2px 0"}}>{d}</div>)}</div>
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
                              <div style={{fontFamily:"'Inter',sans-serif",fontSize:9,fontWeight:isSel?700:400,color:isSel?"white":data?"var(--ink)":"var(--ink-faint)",lineHeight:1}}>{day}</div>
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
                    <div key={label} style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:12,height:12,borderRadius:3,background:color}}/><span style={{fontFamily:"'Inter',sans-serif",fontSize:10,color:"var(--ink-faint)"}}>{label}</span></div>
                  ))}
                </div>
                {selectedDay&&(
                  <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid var(--cream-border)"}}>
                    <div style={{fontFamily:"'Inter',sans-serif",fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--ink-light)",marginBottom:12}}>{selectedDay} · {selectedTxs.length} transaction{selectedTxs.length!==1?"s":""}</div>
                    {selectedTxs.map(t=>{const cat=t.manualCategory||t.category;const cfg=catMap[cat]||{color:"#7A756E",bg:"#7A756E18",icon:"•"};return(
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid var(--cream-border)"}}>
                        <span style={{background:cfg.bg,color:cfg.color,padding:"2px 8px",borderRadius:100,fontFamily:"'Inter',sans-serif",fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cat}</span>
                        <span style={{flex:1,fontFamily:"'Inter',sans-serif",fontSize:13,color:"var(--ink-mid)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</span>
                        <span style={{fontFamily:"'Inter',sans-serif",fontSize:13,fontWeight:600,color:t.isCredit?"#3D8C6F":"var(--red)",whiteSpace:"nowrap"}}>{t.isCredit?"+":"−"}{fmt(t.amount)}</span>
                      </div>
                    );})}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </>}

      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} onImportDirect={handleImportDirect} catNames={catNames} />
      {pickerTx && <CategoryPicker transaction={pickerTx} categories={categories} onSelect={handleManualCategory} onClose={() => setPickerTx(null)} />}
      {editTx && <EditTxModal transaction={editTx} categories={categories} catMap={catMap} onSave={handleEditSave} onClose={() => setEditTx(null)} />}
      {showCustomRange && <CustomRangePicker onApply={(from, to) => { setCustomRange({ from, to }); setShowCustomRange(false); setActiveCategory(null); setSearch(""); }} onClose={() => setShowCustomRange(false)} />}

      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 40 }}>
        <button className="fab-import" onClick={() => setShowImport(true)} title="Import Statement"><span className="fab-icon">+</span><span className="fab-label">Import Statement</span></button>
      </div>
    </div>
  );
}

/* ─── FINANCIAL REPORT GENERATOR ─── */
function buildFYYearsList() {
  const years = [];
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  const base = m >= 2 ? y : y - 1;
  for (let i = 0; i < 5; i++) {
    const s = base - i;
    years.push({ id: `${s}-${s+1}`, label: `FY ${s}/${s+1}`, startDate: new Date(s, 2, 1), endDate: new Date(s+1, 2, 0) });
  }
  return years;
}

function FinancialReportGenerator({ session, workspace }) {
  const entityName = workspace === "professional" ? "Base X Studio" : "Otoabasi Bassey";
  const [fyYearsList] = useState(() => buildFYYearsList());
  const [fyYear, setFyYear] = useState(() => buildFYYearsList()[0]);
  const [allTxs, setAllTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [narrative, setNarrative] = useState("");
  const [narLoading, setNarLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const reportRef = useRef(null);

  useEffect(() => {
    if (!session?.user) return;
    setLoading(true); setGenerated(false); setReportData(null); setNarrative("");
    (async () => {
      const { data: stmts } = await supabase.from("statements").select("id").eq("user_id", session.user.id).eq("workspace", workspace);
      if (!stmts?.length) { setAllTxs([]); setLoading(false); return; }
      const { data: txs } = await supabase.from("transactions").select("*").in("statement_id", stmts.map(s => s.id)).order("date");
      setAllTxs((txs || []).map(t => ({ ...t, date: new Date(t.date), dateStr: t.date_str, isCredit: t.is_credit, manualCategory: t.manual_category })));
      setLoading(false);
    })();
  }, [workspace, session]);

  const inFY = useMemo(() => allTxs.filter(t => { const d = new Date(t.date); return d >= fyYear.startDate && d <= fyYear.endDate; }), [allTxs, fyYear]);

  const buildReport = () => {
    const income = inFY.filter(t => t.isCredit).reduce((s,t) => s+t.amount, 0);
    const spend  = inFY.filter(t => !t.isCredit).reduce((s,t) => s+t.amount, 0);
    const byCat  = {};
    inFY.filter(t => !t.isCredit).forEach(t => { const c = t.manualCategory||t.category; byCat[c]=(byCat[c]||0)+t.amount; });
    const topCats = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
    const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mMap = {};
    inFY.forEach(t => { const d = new Date(t.date); const k = `${MN[d.getMonth()]} ${d.getFullYear()}`; if (!mMap[k]) mMap[k]={income:0,spend:0}; if(t.isCredit) mMap[k].income+=t.amount; else mMap[k].spend+=t.amount; });
    const monthly = Object.entries(mMap).map(([label,d]) => ({label,...d})).sort((a,b) => { const [am,ay]=a.label.split(" "); const [bm,by]=b.label.split(" "); return ay!==by?parseInt(ay)-parseInt(by):MN.indexOf(am)-MN.indexOf(bm); });
    return { income, spend, net: income-spend, topCats, monthly, filtered: inFY };
  };

  const handleGenerate = async () => {
    const data = buildReport();
    setReportData(data); setGenerated(true);
    setGeneratedAt(new Date().toLocaleDateString("en-ZA", { day:"2-digit", month:"long", year:"numeric" }));
    setNarLoading(true);
    try {
      const prompt = `You are a professional financial analyst. Write a concise annual financial narrative (~250 words) for ${entityName} for ${fyYear.label}.\n\nIncome: R${data.income.toFixed(2)}, Expenditure: R${data.spend.toFixed(2)}, Net: R${data.net.toFixed(2)}\nTop categories: ${data.topCats.slice(0,5).map(([c,a])=>`${c} R${a.toFixed(0)}`).join(", ")}\n\nWrite 3 paragraphs: executive summary, spending observations, forward outlook. Professional tone, South African context, no bullet points.`;
      const res = await fetch("/api/claude", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:800, messages:[{role:"user",content:prompt}] }) });
      const d = await res.json();
      setNarrative(d.content?.map(c=>c.text||"").join("")||"");
    } catch { setNarrative(""); }
    setNarLoading(false);
  };

  const handlePrint = () => window.print();

  const fmtR = n => `R\u00A0${Number(n).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtRs = n => n>=1000?`R\u00A0${(n/1000).toFixed(1)}k`:fmtR(n);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Controls */}
      <div className="no-print" style={{ background:"var(--cream-card)", border:"1px solid var(--cream-border)", borderRadius:"var(--r-xl)", padding:"24px 28px", marginBottom:24, display:"flex", gap:24, alignItems:"flex-end", flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:200 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-faint)", marginBottom:8 }}>Account</div>
          <div style={{ fontSize:15, fontWeight:700, color:"var(--ink)" }}>{entityName}</div>
          <div style={{ fontSize:12, color:"var(--ink-light)", marginTop:2 }}>{workspace === "professional" ? "Business account" : "Personal account"}</div>
        </div>
        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-faint)", marginBottom:8 }}>Financial Year</div>
          <select value={fyYear.id} onChange={e => { setFyYear(fyYearsList.find(f=>f.id===e.target.value)); setGenerated(false); }} style={{ padding:"9px 14px", borderRadius:10, border:"1px solid var(--cream-border)", background:"var(--cream)", fontFamily:"'Inter',sans-serif", fontSize:13, color:"var(--ink)", outline:"none", cursor:"pointer" }}>
            {fyYearsList.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--ink-faint)", marginBottom:8 }}>Transactions in period</div>
          <div style={{ fontSize:22, fontWeight:900, color: inFY.length > 0 ? "var(--red)" : "var(--ink-faint)" }}>{loading ? "—" : inFY.length}</div>
        </div>
        <button onClick={handleGenerate} disabled={loading||inFY.length===0||!session?.user} style={{ padding:"11px 24px", borderRadius:100, background: (!loading&&inFY.length>0)?"linear-gradient(135deg,#E31A51,#FF5C7A)":"var(--cream-border)", border:"none", color: (!loading&&inFY.length>0)?"white":"var(--ink-faint)", fontFamily:"'Inter',sans-serif", fontSize:13, fontWeight:600, cursor: (!loading&&inFY.length>0)?"pointer":"not-allowed", boxShadow: (!loading&&inFY.length>0)?"0 2px 12px rgba(225,53,64,0.3)":"none", whiteSpace:"nowrap" }}>
          {loading ? "Loading…" : "Generate Report"}
        </button>
      </div>

      {/* Report */}
      {generated && reportData && (
        <div className="fade-up">
          <div className="no-print" style={{ display:"flex", gap:10, marginBottom:16, alignItems:"center", flexWrap:"wrap" }}>
            <div style={{ fontSize:11, color:"var(--ink-faint)", marginRight:"auto" }}>{reportData.filtered.length} transactions · {entityName} · {fyYear.label}</div>
            {narLoading && <div style={{ fontSize:11, color:"#6366f1", display:"flex", alignItems:"center", gap:6 }}><div className="ai-spinner"/>Generating narrative…</div>}
            <button onClick={handlePrint} style={{ padding:"8px 18px", borderRadius:100, background:"var(--charcoal)", border:"none", color:"white", fontFamily:"'Inter',sans-serif", fontSize:12, fontWeight:600, cursor:"pointer" }}>🖨 Print / PDF</button>
          </div>
          <div ref={reportRef} style={{ background:"white", borderRadius:16, padding:"48px 52px", boxShadow:"0 4px 40px rgba(0,0,0,0.08)", fontFamily:"'Inter',sans-serif", color:"#0A0A0A" }}>
            {/* Cover */}
            <div style={{ marginBottom:40, paddingBottom:28, borderBottom:"2px solid #0A0A0A" }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", color:"#E31A51", marginBottom:8 }}>{workspace==="professional"?"Business · Financial Year Report":"Personal · Financial Year Report"}</div>
              <div style={{ fontSize:34, fontWeight:900, letterSpacing:"-0.02em", textTransform:"uppercase", lineHeight:1 }}>{entityName}</div>
              <div style={{ fontFamily:"'Noto Serif',serif", fontSize:15, color:"#7A756E", marginTop:8, fontStyle:"italic" }}>Annual Financial Statement — {fyYear.label}</div>
              <div style={{ marginTop:12, fontSize:10, color:"#B8B3AC" }}>Generated {generatedAt} · Confidential</div>
            </div>
            {/* KPIs */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, marginBottom:36 }}>
              {[
                {label:"Total Income",value:fmtRs(reportData.income),color:"#22c55e"},
                {label:"Total Expenditure",value:fmtRs(reportData.spend),color:"#E31A51"},
                {label:reportData.net>=0?"Net Surplus":"Net Deficit",value:fmtRs(Math.abs(reportData.net)),color:reportData.net>=0?"#22c55e":"#E31A51"},
                {label:"Savings Rate",value:`${reportData.income>0?((reportData.net/reportData.income)*100).toFixed(1):0}%`,color:"#6366f1"},
              ].map(({label,value,color})=>(
                <div key={label} style={{background:"#FAF7F3",borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:color,borderRadius:"12px 12px 0 0"}}/>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#7A756E",marginBottom:8}}>{label}</div>
                  <div style={{fontSize:20,fontWeight:700,color,lineHeight:1}}>{value}</div>
                </div>
              ))}
            </div>
            {/* Narrative */}
            {narrative && <div style={{background:"#FAF8F5",borderRadius:12,padding:"24px 28px",marginBottom:36,borderLeft:"3px solid #E31A51"}}><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#E31A51",marginBottom:12}}>Executive Summary</div><div style={{fontFamily:"'Noto Serif',serif",fontSize:14,lineHeight:1.8,color:"#3D3A36",whiteSpace:"pre-line"}}>{narrative}</div></div>}
            {/* Monthly */}
            {reportData.monthly.length>0&&<div style={{marginBottom:36}}><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#B8B3AC",marginBottom:16}}>Monthly Performance</div><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{borderBottom:"1px solid #E5E5E5"}}>{["Month","Income","Expenditure","Net"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Month"?"left":"right",fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#B8B3AC"}}>{h}</th>)}</tr></thead><tbody>{reportData.monthly.map((m,i)=><tr key={m.label} style={{borderBottom:"1px solid rgba(0,0,0,0.04)",background:i%2?"#FAF7F3":"transparent"}}><td style={{padding:"9px 10px",fontWeight:600}}>{m.label}</td><td style={{padding:"9px 10px",textAlign:"right",color:"#22c55e"}}>{fmtR(m.income)}</td><td style={{padding:"9px 10px",textAlign:"right",color:"#E31A51"}}>{fmtR(m.spend)}</td><td style={{padding:"9px 10px",textAlign:"right",fontWeight:700,color:m.income-m.spend>=0?"#22c55e":"#E31A51"}}>{m.income-m.spend>=0?"+":""}{fmtR(m.income-m.spend)}</td></tr>)}</tbody><tfoot><tr style={{borderTop:"2px solid #0A0A0A",background:"#FAF7F3"}}><td style={{padding:"10px",fontWeight:700,fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase"}}>TOTAL</td><td style={{padding:"10px",textAlign:"right",fontWeight:700,color:"#22c55e"}}>{fmtR(reportData.income)}</td><td style={{padding:"10px",textAlign:"right",fontWeight:700,color:"#E31A51"}}>{fmtR(reportData.spend)}</td><td style={{padding:"10px",textAlign:"right",fontWeight:700,color:reportData.net>=0?"#22c55e":"#E31A51"}}>{reportData.net>=0?"+":""}{fmtR(reportData.net)}</td></tr></tfoot></table></div>}
            {/* Categories */}
            {reportData.topCats.length>0&&<div style={{marginBottom:36}}><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#B8B3AC",marginBottom:16}}>Expenditure by Category</div>{reportData.topCats.map(([cat,amt])=>{const pct=reportData.spend>0?((amt/reportData.spend)*100).toFixed(1):0;return(<div key={cat} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12,fontWeight:500}}>{cat}</span><span style={{fontSize:12,fontWeight:700}}>{fmtR(amt)} <span style={{color:"#B8B3AC",fontWeight:400}}>({pct}%)</span></span></div><div style={{height:4,background:"rgba(0,0,0,0.06)",borderRadius:2}}><div style={{height:"100%",width:`${pct}%`,background:"#E31A51",borderRadius:2}}/></div></div>);})}</div>}
            {/* Ledger */}
            <div><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#B8B3AC",marginBottom:16}}>Full Transaction Ledger</div><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead><tr style={{background:"#FAF7F3",borderBottom:"1px solid #E5E5E5"}}>{["Date","Description","Category","Type","Amount"].map((h,i)=><th key={h} style={{padding:"7px 10px",textAlign:i>=3?"right":"left",fontSize:8,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#B8B3AC"}}>{h}</th>)}</tr></thead><tbody>{[...reportData.filtered].sort((a,b)=>new Date(a.date)-new Date(b.date)).map((t,i)=>{const cat=t.manualCategory||t.category;return(<tr key={i} style={{borderBottom:"1px solid rgba(0,0,0,0.04)"}}><td style={{padding:"6px 10px",color:"#7A756E",whiteSpace:"nowrap"}}>{t.dateStr}</td><td style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</td><td style={{padding:"6px 10px"}}><span style={{background:t.isCredit?"rgba(34,197,94,0.1)":"rgba(227,26,81,0.08)",color:t.isCredit?"#16a34a":"#E31A51",padding:"2px 8px",borderRadius:100,fontSize:9,fontWeight:600}}>{cat}</span></td><td style={{padding:"6px 10px",textAlign:"right",fontSize:9,fontWeight:700,color:t.isCredit?"#16a34a":"#E31A51"}}>{t.isCredit?"CR":"DR"}</td><td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,color:t.isCredit?"#16a34a":"#E31A51",whiteSpace:"nowrap"}}>{t.isCredit?"+":"−"}{fmtR(t.amount)}</td></tr>);})}</tbody></table></div>
          </div>
        </div>
      )}
      <style>{`@media print { .no-print { display:none!important; } body { background:white!important; } @page { size:A4; margin:20mm; } }`}</style>
    </div>
  );
}

/* ─── ROOT ─── */
export default function App() {
  const [session, setSession] = useState(undefined);
  const [accessDenied, setAccessDenied] = useState(false);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("bxs-dark") === "1"; } catch { return false; }
  });
  const [workspace, setWorkspace] = useState(() => {
    try { return localStorage.getItem("bxs-ws") || "professional"; } catch { return "professional"; }
  });
  const [showCatManager, setShowCatManager] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [view, setView] = useState("dashboard");
  const catMap = useMemo(() => buildCatMap(categories), [categories]);

  // Persist preferences
  useEffect(() => { try { localStorage.setItem("bxs-dark", dark ? "1" : "0"); } catch {} }, [dark]);
  const switchWorkspace = (ws) => { setWorkspace(ws); try { localStorage.setItem("bxs-ws", ws); } catch {} };

  // Safety net — if still loading after 8s, show login screen instead of spinning forever
  useEffect(() => {
    const t = setTimeout(() => setSession(prev => prev === undefined ? null : prev), 8000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try {
            const allowed = await Promise.race([
              checkAllowed(session.user.email),
              new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))
            ]);
            if (!allowed) { await supabase.auth.signOut(); setAccessDenied(true); setSession(null); }
            else { setSession(session); await loadCategories(setCategories); }
          } catch {
            // If allowed_users check times out or fails, allow through — better than infinite load
            setSession(session);
            await loadCategories(setCategories);
          }
        } else {
          setSession(null);
        }
      } catch {
        setSession(null);
      }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        try {
          const allowed = await Promise.race([
            checkAllowed(session.user.email),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))
          ]);
          if (!allowed) { await supabase.auth.signOut(); setAccessDenied(true); setSession(null); }
          else { setSession(session); await loadCategories(setCategories); }
        } catch {
          setSession(session);
          await loadCategories(setCategories);
        }
      } else {
        setSession(null);
      }
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
    if (deletedName && reassignTo && session?.user) {
      // Scope reassign to this user's statement IDs only — avoids cross-user pollution if RLS is off
      const { data: userStmts } = await supabase.from("statements").select("id").eq("user_id", session.user.id);
      const ids = (userStmts || []).map(s => s.id);
      if (ids.length) {
        await supabase.from("transactions").update({ category: reassignTo }).eq("category", deletedName).in("statement_id", ids);
        await supabase.from("transactions").update({ manual_category: reassignTo }).eq("manual_category", deletedName).in("statement_id", ids);
      }
    }
    setCategories(newCats);
    setShowCatManager(false);
  };

  const isPro = workspace === "professional";
  const eyebrow = isPro ? "Base X Studio" : "Otoabasi Bassey";
  const accountLabel = isPro ? "FNB Gold Business" : "FNB Personal Account";

  if (session === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#B0B0B0", letterSpacing: "0.08em", gap: 12 }}>
      <div style={{ width: 16, height: 16, border: "2px solid rgba(227,26,81,0.2)", borderTopColor: "#E31A51", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      Loading…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!session) return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;900&display=swap');`}</style>
      {accessDenied && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: "#E31A51", color: "white", padding: "10px 20px", borderRadius: 100, fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, zIndex: 999 }}>
          Access denied — your email is not on the approved list.
        </div>
      )}
      <LoginScreen />
    </>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&family=Noto+Serif:ital,wght@0,400;0,600;1,400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --cream: #FFFFFF; --cream-card: #F5F5F5; --cream-border: rgba(0,0,0,0.10);
          --ink: #0A0A0A; --ink-mid: #3A3A3A; --ink-light: #767676; --ink-faint: #B0B0B0;
          --red: #E31A51; --grad: linear-gradient(135deg, #E31A51, #FF5C7A);
          --charcoal: #111111; --r-sm: 8px; --r-md: 12px; --r-lg: 18px; --r-xl: 24px;
          --mono: 'Inter', sans-serif;
        }
        .dark { --cream: #141210; --cream-card: #1C1917; --cream-border: rgba(255,255,255,0.08); --ink: #F5F1ED; --ink-mid: #C4BDB6; --ink-light: #8A8279; --ink-faint: #6A6560; --charcoal: #2C2926; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--cream-border); border-radius: 4px; }
        .cat-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 100px; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; border: 1px solid var(--cream-border); background: var(--cream-card); color: var(--ink-mid); transition: all 0.15s; white-space: nowrap; }
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
        .ws-toggle-opt { padding: 5px 9px; border-radius: 100px; border: none; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 700; transition: all 0.2s; white-space: nowrap; line-height: 1; }
        .ws-toggle-opt.active { background: var(--cream-card); color: var(--ink); box-shadow: 0 0 0 1.5px var(--cream-border); }
        .ws-toggle-opt:not(.active) { background: transparent; color: var(--ink-faint); opacity: 0.5; }
        .ws-toggle-opt:not(.active):hover { opacity: 1; }
        .fab-import { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 100px; background: linear-gradient(135deg, #E31A51, #FF5C7A); border: none; cursor: pointer; overflow: hidden; box-shadow: 0 4px 20px rgba(227,26,81,0.4); transition: width 0.3s cubic-bezier(0.4,0,0.2,1), background 0.25s ease, box-shadow 0.2s; white-space: nowrap; gap: 0; }
        .fab-import:hover { width: 168px; background: linear-gradient(135deg, #252220, #3D3A36); box-shadow: 0 6px 28px rgba(13,11,9,0.35); gap: 8px; }
        .fab-icon { font-size: 22px; font-weight: 300; color: white; line-height: 1; flex-shrink: 0; }
        .fab-label { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 700; color: white; letter-spacing: 0.04em; max-width: 0; overflow: hidden; opacity: 0; transition: max-width 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s 0.1s; white-space: nowrap; }
        .fab-import:hover .fab-label { max-width: 120px; opacity: 1; }
        .nav-btn { padding: 6px 14px; border-radius: 100px; border: 1.5px solid rgba(0,0,0,0.10); background: transparent; font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; color: var(--ink-mid); cursor: pointer; transition: all 0.15s; letter-spacing: 0.01em; }
        .nav-btn:hover { border-color: rgba(0,0,0,0.2); background: var(--cream-card); }
        .nav-btn.active { background: var(--charcoal); border-color: var(--charcoal); color: white; }
      `}</style>

      <div className={dark ? "dark" : ""} style={{ background: "var(--cream)", minHeight: "100vh", padding: "48px 28px 80px", fontFamily: "'Inter', sans-serif", transition: "background 0.3s, color 0.3s" }}>
        <div className="fade-up" style={{ marginBottom: 28 }}>
          <div style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 32, padding: "5px 12px", borderRadius: 100, background: "var(--cream-card)", border: "1px solid var(--cream-border)", fontFamily: "'Inter', sans-serif", fontSize: 11, letterSpacing: "0.04em", color: "var(--ink-faint)" }}>
            <span style={{ color: isPro ? "var(--red)" : "var(--ink)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>{eyebrow}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{accountLabel}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{session.user.email}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <img
                src={isPro ? AVATAR_BXS : AVATAR_OTO}
                alt={eyebrow}
                style={{ width: 78, height: 78, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--cream-border)", flexShrink: 0, boxShadow: "0 2px 12px rgba(0,0,0,0.1)" }}
              />
              <div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ink)", lineHeight: 1.1 }}>Hello, {eyebrow} 👋</div>
                <div style={{ fontFamily: "'Noto Serif', serif", fontSize: 18, fontWeight: 300, color: "var(--ink-light)", marginTop: 6 }}>Welcome to your financial dashboard.</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* View toggle */}
              <div style={{ display: "flex", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 100, padding: 3, gap: 2, marginRight: 4 }}>
                <button className={`nav-btn${view === "dashboard" ? " active" : ""}`} onClick={() => setView("dashboard")}>Dashboard</button>
                <button className={`nav-btn${view === "reports" ? " active" : ""}`} onClick={() => setView("reports")}>Reports</button>
              </div>
              <div className="ws-toggle">
                <button className={`ws-toggle-opt${isPro ? " active" : ""}`} onClick={() => switchWorkspace("professional")} title="Professional">💼</button>
                <button className={`ws-toggle-opt${!isPro ? " active" : ""}`} onClick={() => switchWorkspace("personal")} title="Personal">👤</button>
              </div>
              <div className="ws-toggle">
                <button className={`ws-toggle-opt${!dark ? " active" : ""}`} onClick={() => setDark(false)} title="Light mode">☀️</button>
                <button className={`ws-toggle-opt${dark ? " active" : ""}`} onClick={() => setDark(true)} title="Dark mode">🌙</button>
              </div>
              <button onClick={() => setShowCatManager(true)} title="Manage categories" style={{ background: "transparent", border: "1.5px solid rgba(0,0,0,0.14)", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", color: "var(--ink-faint)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>🗂️</button>
              <button onClick={() => supabase.auth.signOut()} title="Sign out" style={{ background: "transparent", border: "1.5px solid rgba(0,0,0,0.14)", borderRadius: 100, padding: "5px 12px", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--ink-faint)", letterSpacing: "0.02em" }}>Sign out</button>
            </div>
          </div>
        </div>

        {view === "dashboard" && (
          <DashboardPanel key={workspace} userId={session.user.id} workspace={workspace} categories={categories} catMap={catMap} dark={dark} />
        )}
        {view === "reports" && (
          <FinancialReportGenerator session={session} workspace={workspace} />
        )}
        {showCatManager && <CategoryManager categories={categories} onSave={handleSaveCategories} onClose={() => setShowCatManager(false)} />}
      </div>
    </>
  );
}
