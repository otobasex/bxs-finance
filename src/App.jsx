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

/* ─── UNIVERSAL SPREADSHEET PARSER (CSV + Excel via SheetJS) ─── */
async function parseSpreadsheet(file) {
  // Dynamically load SheetJS from CDN
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
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rows.length < 2) return [];

  // Find header row — first row with at least 3 non-empty cells
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (rows[i].filter(c => String(c).trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = rows[headerIdx].map(h => String(h).toLowerCase().trim());

  // Column detection
  const col = (terms) => headers.findIndex(h => terms.some(t => h.includes(t)));
  const dateIdx = col(["date"]);
  const descIdx = col(["description","narration","details","reference","desc","particular","transaction"]);
  const amtIdx  = col(["amount"]);
  const credIdx = col(["credit","deposit","money in"]);
  const debIdx  = col(["debit","withdrawal","money out"]);

  if (dateIdx === -1 || descIdx === -1) return [];

  const MN = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const MNFull = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const formatDate = (raw) => {
    if (!raw) return null;
    // Already a JS Date (SheetJS with cellDates:true)
    if (raw instanceof Date && !isNaN(raw)) {
      return `${String(raw.getDate()).padStart(2,"0")} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][raw.getMonth()]}`;
    }
    const s = String(raw).trim();
    // DD/MM/YYYY or DD-MM-YYYY or YYYY-MM-DD
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m1) { const d=parseInt(m1[1]),mo=parseInt(m1[2])-1; return `${String(d).padStart(2,"0")} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mo]}`; }
    const m2 = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (m2) { const mo=parseInt(m2[2])-1,d=parseInt(m2[3]); return `${String(d).padStart(2,"0")} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mo]}`; }
    // "08 Dec 2025" or "Dec 08 2025"
    const m3 = s.match(/(\d{1,2})\s+([A-Za-z]+)/);
    if (m3) { const mo = MN.indexOf(m3[2].toLowerCase().slice(0,3)); if (mo !== -1) return `${String(parseInt(m3[1])).padStart(2,"0")} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mo]}`; }
    return s.slice(0, 10); // fallback
  };

  const parseAmt = (v) => {
    if (v === "" || v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    // Strip currency symbols, spaces, but keep minus and digits
    return parseFloat(String(v).replace(/[^\d.\-]/g, "")) || 0;
  };

  const results = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[dateIdx];
    const desc = String(row[descIdx] || "").trim();
    if (!desc || desc.toLowerCase() === "description") continue;

    const dateStr = formatDate(dateRaw);
    if (!dateStr) continue;

    let amount = 0, isCredit = false;

    if (credIdx !== -1 && debIdx !== -1) {
      // Separate debit/credit columns
      const cred = parseAmt(row[credIdx]);
      const deb  = parseAmt(row[debIdx]);
      if (Math.abs(cred) > 0) { amount = Math.abs(cred); isCredit = true; }
      else if (Math.abs(deb) > 0) { amount = Math.abs(deb); isCredit = false; }
      else continue;
    } else if (amtIdx !== -1) {
      // Single amount column — negative = debit, positive = credit
      // Also handle "Cr" suffix meaning credit
      const raw = String(row[amtIdx] || "").trim();
      const hasCr = /cr$/i.test(raw);
      const num = parseAmt(raw);
      if (num === 0) continue;
      if (hasCr) { amount = Math.abs(num); isCredit = true; }
      else if (num < 0) { amount = Math.abs(num); isCredit = false; }
      else { amount = num; isCredit = true; } // positive = credit in single-column statements
    } else continue;

    results.push(`${dateStr} ${desc} ${amount.toFixed(2)}${isCredit ? "Cr" : ""} 0.00`);
  }
  return results.join("\n");
}

function fmt(n, short = false) {
  if (short && n >= 1000) return "R\u00A0" + (n / 1000).toFixed(1) + "k";
  return "R\u00A0" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── LOGIN SCREEN ─── */
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login"); // "login" | "signup"
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
        {/* Logo */}
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#E31A51", marginBottom: 10 }}>Base X Studio</div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 900, fontSize: 28, letterSpacing: "-0.03em", textTransform: "uppercase", color: "#0A0A0A" }}>Financial<br />Dashboard</div>
        </div>

        {/* Card */}
        <div style={{ background: "#F5F5F5", border: "1px solid rgba(0,0,0,0.10)", borderRadius: 24, padding: 32, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.4)", marginBottom: 4 }}>
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </div>

          {/* Google */}
          <button onClick={handleGoogle} disabled={loading} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px", borderRadius: 12, border: "1.5px solid rgba(0,0,0,0.10)", background: "white", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600, color: "#0A0A0A", transition: "all 0.15s" }}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.3)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
          </div>

          {/* Email + password */}
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

/* ─── CATEGORY MANAGER ─── */
function CategoryManager({ categories, onSave, onClose }) {
  const [cats, setCats] = useState(categories.map(c => ({ ...c })));
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [reassignTo, setReassignTo] = useState("");
  const [editId, setEditId] = useState(null);
  const [newName, setNewName] = useState(""); const [newColor, setNewColor] = useState("#6366f1"); const [newIcon, setNewIcon] = useState("•");
  const [adding, setAdding] = useState(false);
  const confirmDelete = (cat) => { if (cat.name === "Other") return; setDeleteTarget(cat); setReassignTo(cats.find(c => c.id !== cat.id && c.name !== "Income")?.name || "Other"); };
  const doDelete = () => { if (!deleteTarget) return; onSave(cats.filter(c => c.id !== deleteTarget.id), deleteTarget.name, reassignTo); setDeleteTarget(null); };
  const doAdd = () => { if (!newName.trim()) return; const id = newName.toLowerCase().replace(/\s+/g,"_")+"_"+Date.now(); setCats(prev => [...prev, { id, name: newName.trim(), color: newColor, icon: newIcon }]); setNewName(""); setNewColor("#6366f1"); setNewIcon("•"); setAdding(false); };
  const updateCat = (id, field, val) => setCats(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c));
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 20, padding: 28, width: 500, maxHeight: "85vh", overflowY: "auto", zIndex: 201, boxShadow: "0 24px 80px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--red)", marginBottom: 4 }}>Settings</div><div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>Manage Categories</div></div>
          <button onClick={onClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "var(--ink-light)", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {cats.map(cat => (
            <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)" }}>
              <input type="color" value={cat.color} onChange={e => updateCat(cat.id, "color", e.target.value)} style={{ width: 24, height: 24, border: "none", borderRadius: 6, cursor: "pointer", padding: 0 }} />
              {editId === cat.id ? <input value={cat.name} onChange={e => updateCat(cat.id, "name", e.target.value)} onBlur={() => setEditId(null)} autoFocus style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "3px 8px", color: "var(--ink)", outline: "none" }} />
              : <span onClick={() => setEditId(cat.id)} style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", cursor: "text" }}><span style={{ marginRight: 6 }}>{cat.icon}</span>{cat.name}</span>}
              <input value={cat.icon} onChange={e => updateCat(cat.id, "icon", e.target.value)} maxLength={2} style={{ width: 36, textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "3px 4px", color: "var(--ink)", outline: "none" }} />
              {cat.name !== "Income" && cat.name !== "Other" && <button onClick={() => confirmDelete(cat)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: 14, padding: "2px 4px" }}>✕</button>}
            </div>
          ))}
        </div>
        {adding ? (
          <div style={{ padding: 12, borderRadius: 10, border: "1px dashed var(--cream-border)", background: "var(--cream)", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 24, height: 24, border: "none", borderRadius: 6, cursor: "pointer", padding: 0 }} />
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Category name" autoFocus style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "6px 10px", color: "var(--ink)", outline: "none" }} />
              <input value={newIcon} onChange={e => setNewIcon(e.target.value)} maxLength={2} placeholder="•" style={{ width: 40, textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "6px 4px", color: "var(--ink)", outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={doAdd} style={{ flex: 1, padding: "7px", background: "var(--charcoal)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700 }}>Add</button>
              <button onClick={() => setAdding(false)} style={{ padding: "7px 14px", background: "transparent", color: "var(--ink-faint)", border: "1px solid var(--cream-border)", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>Cancel</button>
            </div>
          </div>
        ) : <button onClick={() => setAdding(true)} style={{ width: "100%", padding: "9px", background: "transparent", color: "var(--ink-mid)", border: "1.5px dashed var(--cream-border)", borderRadius: 10, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.06em", marginBottom: 12 }}>+ Add Category</button>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 18px", background: "transparent", color: "var(--ink-mid)", border: "1px solid var(--cream-border)", borderRadius: 100, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>Cancel</button>
          <button onClick={() => onSave(cats, null, null)} style={{ padding: "9px 20px", background: "var(--charcoal)", color: "white", border: "none", borderRadius: 100, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700 }}>Save Changes</button>
        </div>
        {deleteTarget && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
            <div style={{ background: "var(--cream-card)", borderRadius: 14, padding: 24, width: 320 }}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>Delete "{deleteTarget.name}"?</div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", marginBottom: 16, lineHeight: 1.5 }}>Transactions will be reassigned to:</div>
              <select value={reassignTo} onChange={e => setReassignTo(e.target.value)} style={{ width: "100%", padding: "8px 12px", marginBottom: 16, background: "var(--cream)", border: "1px solid var(--cream-border)", borderRadius: 8, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }}>
                {cats.filter(c => c.id !== deleteTarget.id && c.name !== "Income").map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setDeleteTarget(null)} style={{ flex: 1, padding: "8px", background: "transparent", border: "1px solid var(--cream-border)", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-mid)" }}>Cancel</button>
                <button onClick={doDelete} style={{ flex: 1, padding: "8px", background: "#E31A51", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700 }}>Delete & Reassign</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── CATEGORY PICKER ─── */
function CategoryPicker({ transaction, categories, onSelect, onClose }) {
  const catMap = buildCatMap(categories);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 16, padding: 24, width: 340, zIndex: 101, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)", marginBottom: 4 }}>Re-categorise</div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", marginBottom: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{transaction.description}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {categories.filter(c => c.name !== "Income").map(cat => {
            const cfg = catMap[cat.name] || { color: "#7A756E", bg: "#7A756E18" };
            const isActive = (transaction.manualCategory || transaction.category) === cat.name;
            return <button key={cat.id} onClick={() => onSelect(cat.name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, border: `1px solid ${isActive ? cfg.color : "var(--cream-border)"}`, background: isActive ? cfg.bg : "transparent", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: isActive ? cfg.color : "var(--ink-mid)" }}><span>{cat.icon}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</span></button>;
          })}
        </div>
        <button onClick={onClose} style={{ marginTop: 14, width: "100%", padding: "8px", borderRadius: 8, border: "1px solid var(--cream-border)", background: "transparent", color: "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ─── IMPORT MODAL ─── */
function ImportModal({ open, onClose, onImport }) {
  const [tab, setTab] = useState("file");
  const [pasteText, setPasteText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null);
  const fileRef = useRef(null);
  const reset = () => { setStatus(null); setPasteText(""); setTab("file"); };
  const handleClose = () => { reset(); onClose(); };

  const processFile = async (file) => {
    if (!file) return;
    setStatus("loading");
    try {
      const isCSV  = file.name.endsWith(".csv") || file.type === "text/csv";
      const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.type.includes("spreadsheet") || file.type.includes("excel");
      const isPDF  = file.name.endsWith(".pdf") || file.type === "application/pdf";

      if (isCSV || isExcel) {
        const result = await parseSpreadsheet(file);
        if (!result) { setStatus("error"); return; }
        onImport(result); handleClose();
      } else if (isPDF) {
        const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
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
                { type: "text", text: `Extract every transaction from this bank statement and return them as a JSON array. Each item must have these fields:
- date: "DD Mon" format e.g. "08 Dec"
- description: the transaction description text
- amount: numeric amount (positive number)
- isCredit: true if it's money coming IN (deposit, payment received), false if money going OUT

Return ONLY the JSON array, no other text. Example:
[{"date":"08 Dec","description":"FNB App Payment From Payment","amount":7700,"isCredit":true},{"date":"08 Dec","description":"FNB App Transfer To Oto","amount":500,"isCredit":false}]` }
              ]
            }]
          })
        });
        const data = await response.json();
        const text = data.content?.map(c => c.text || "").join("") || "";
        const clean = text.replace(/```json|```/g, "").trim();
        let parsed;
        try { parsed = JSON.parse(clean); } catch { throw new Error("Parse failed"); }
        if (!parsed?.length) throw new Error("No transactions");
        // Convert to the line format the statement parser expects
        const lines = parsed.map(t =>
          `${t.date} ${t.description} ${Number(t.amount).toFixed(2)}${t.isCredit ? "Cr" : ""} 0.00`
        ).join("\n");
        onImport(lines);
        handleClose();
      } else { setStatus("error"); }
    } catch (e) { console.error(e); setStatus("error"); }
  };

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={handleClose} style={{ position: "absolute", inset: 0, background: "rgba(13,11,9,0.35)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "relative", width: 480, background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 24, padding: 32, display: "flex", flexDirection: "column", gap: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.18)", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--red)", marginBottom: 6 }}>Import</div><div style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>Add Statement</div></div>
          <button onClick={handleClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "var(--ink-light)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--cream)", borderRadius: 10, padding: 4 }}>
          {[["file","Upload File"],["paste","Paste Text"]].map(([v,lbl]) => <button key={v} onClick={() => { setTab(v); setStatus(null); }} style={{ flex: 1, padding: "7px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", background: tab === v ? "var(--cream-card)" : "transparent", color: tab === v ? "var(--ink)" : "var(--ink-faint)", boxShadow: tab === v ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>{lbl}</button>)}
        </div>
        {tab === "file" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
            <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }} onClick={() => fileRef.current?.click()}
              style={{ flex: 1, minHeight: 180, border: `2px dashed ${dragging ? "var(--red)" : "var(--cream-border)"}`, borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, cursor: "pointer", background: dragging ? "rgba(227,26,81,0.03)" : "var(--cream)", transition: "all 0.15s", padding: 32 }}>
              {status === "loading" ? <><div className="ai-spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#6366f1" }}>Extracting transactions…</div></>
              : status === "error" ? <><div style={{ fontSize: 32 }}>⚠️</div><div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--red)", textAlign: "center", lineHeight: 1.5 }}>Could not read file. Try Paste Text instead.</div><button onClick={e => { e.stopPropagation(); setStatus(null); }} style={{ padding: "6px 14px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-mid)", cursor: "pointer" }}>Try again</button></>
              : <><div style={{ fontSize: 36 }}>🗂️</div><div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 600, color: "var(--ink)", textAlign: "center" }}>Drop your statement here</div><div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-faint)", textAlign: "center", lineHeight: 1.7 }}>PDF · CSV · Excel (.xlsx) · Click to browse</div></>}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.csv,.xlsx,.xls" onChange={e => { const f = e.target.files[0]; if (f) processFile(f); }} style={{ display: "none" }} />
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.6, textAlign: "center" }}>PDF statements read by Claude AI · CSV and Excel parsed directly</p>
          </div>
        )}
        {tab === "paste" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-light)", lineHeight: 1.6 }}>Open your FNB statement PDF, select all text (Ctrl+A), copy, then paste below.</p>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="08 Dec FNB App Transfer To Oto 500.00 ..." rows={14} style={{ flex: 1, resize: "none", padding: "13px 16px", background: "white", border: "1px solid var(--cream-border)", borderRadius: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink)", outline: "none", lineHeight: 1.7 }} />
            <button onClick={() => { onImport(pasteText); handleClose(); }} style={{ background: "var(--grad)", color: "white", border: "none", borderRadius: 100, padding: "12px 22px", fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Parse & Add Statement</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── PILL TICKER ─── */
function PillTicker({ categories, catMap, activeCategory, setActiveCategory }) {
  const wrapRef = useRef(null); const trackRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const [manualOffset, setManualOffset] = useState(0); const [isDragging, setIsDragging] = useState(false);
  const pills = [...categories, ...categories];
  const startDrag = useCallback((clientX) => { const track = trackRef.current; if (track) { const m = window.getComputedStyle(track).transform.match(/matrix.*\((.+)\)/); if (m) drag.current.scrollLeft = parseFloat(m[1].split(', ')[4]) || 0; } drag.current = { ...drag.current, active: true, startX: clientX }; setIsDragging(true); }, []);
  const moveDrag = useCallback((clientX) => { if (!drag.current.active) return; let next = drag.current.scrollLeft + (clientX - drag.current.startX); const track = trackRef.current; if (track) { const hw = track.scrollWidth / 2; if (next < -hw) next += hw; if (next > 0) next -= hw; } setManualOffset(next); }, []);
  const endDrag = useCallback(() => { drag.current.active = false; setIsDragging(false); }, []);
  return (
    <div ref={wrapRef} className={`pill-ticker-wrap${isDragging ? " dragging" : ""}`} onMouseDown={e => { e.preventDefault(); startDrag(e.clientX); }} onMouseMove={e => { if (drag.current.active) moveDrag(e.clientX); }} onMouseUp={endDrag} onMouseLeave={() => { if (drag.current.active) endDrag(); }} onTouchStart={e => startDrag(e.touches[0].clientX)} onTouchMove={e => moveDrag(e.touches[0].clientX)} onTouchEnd={endDrag}>
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

  const MN = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

  const handleSave = () => {
    const amt = parseFloat(amount.replace(/[^0-9.]/g, ""));
    if (!amt || !desc.trim()) return;
    // Rebuild date from dateStr e.g. "Dec 08" or "08 Dec"
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
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)", marginBottom: 4 }}>Edit Transaction</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: "var(--ink-light)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {/* Description */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Description</label>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
        </div>

        {/* Amount + Credit/Debit toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Amount</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'IBM Plex Mono', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 4, padding: "3px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)" }}>
            <button onClick={() => setIsCredit(false)} style={{ padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, background: !isCredit ? "#FFD6C2" : "transparent", color: !isCredit ? "#8B3A00" : "var(--ink-faint)", transition: "all 0.15s" }}>Debit</button>
            <button onClick={() => setIsCredit(true)}  style={{ padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, background: isCredit  ? "#BFEFDF" : "transparent", color: isCredit  ? "#1A5C3A" : "var(--ink-faint)", transition: "all 0.15s" }}>Credit</button>
          </div>
        </div>

        {/* Date */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Date</label>
          <input value={dateStr} onChange={e => setDateStr(e.target.value)} placeholder="08 Dec"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--ink)", outline: "none" }} />
        </div>

        {/* Category */}
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

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-mid)", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex: 2, padding: "10px", borderRadius: 100, background: "var(--charcoal)", border: "none", color: "white", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

/* ─── DASHBOARD PANEL ─── */
function DashboardPanel({ userId, workspace, categories, catMap }) {
  const [statements, setStatements] = useState([]);
  const [activeStmt, setActiveStmt] = useState(0);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [txView, setTxView] = useState("list");
  const [selectedDay, setSelectedDay] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [pickerTx, setPickerTx] = useState(null);
  const [editTx, setEditTx] = useState(null);
  const [dbLoading, setDbLoading] = useState(true);
  const catNames = categories.map(c => c.name);

  /* Load statements from Supabase */
  useEffect(() => {
    const load = async () => {
      setDbLoading(true);
      const { data: stmts } = await supabase.from("statements").select("*").eq("user_id", userId).eq("workspace", workspace).order("created_at");
      if (!stmts || !stmts.length) { setStatements([]); setDbLoading(false); return; }
      const results = await Promise.all(stmts.map(async s => {
        const { data: txs } = await supabase.from("transactions").select("*").eq("statement_id", s.id).order("local_id");
        const transactions = (txs || []).map(t => ({ ...t, id: t.local_id, date: new Date(t.date), dateStr: t.date_str, isCredit: t.is_credit, aiCategorised: t.ai_categorised, manualCategory: t.manual_category }));
        return { id: s.id, label: s.label, transactions };
      }));
      setStatements(results);
      setDbLoading(false);
    };
    load();
  }, [userId, workspace]);

  const stmt = statements[activeStmt] || statements[0];
  const transactions = stmt?.transactions || [];

  /* Update transaction in Supabase */
  const updateTransaction = async (stmtId, txLocalId, fields) => {
    await supabase.from("transactions").update(fields).eq("statement_id", stmtId).eq("local_id", txLocalId);
  };

  const setTransactions = async (updater) => {
    const updated = typeof updater === "function" ? updater(transactions) : updater;
    setStatements(prev => prev.map((s, i) => i === activeStmt ? { ...s, transactions: updated } : s));
    // Persist each changed transaction
    const stmtId = stmt?.id;
    if (!stmtId) return;
    for (const t of updated) {
      await supabase.from("transactions").update({ category: t.category, ai_categorised: t.aiCategorised, manual_category: t.manualCategory }).eq("statement_id", stmtId).eq("local_id", t.id);
    }
  };

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

  /* Import handler — saves to Supabase */
  const handleImport = async (text) => {
    const parsed = parseStatement(text, catNames);
    if (!parsed.length) { alert("No transactions found."); return; }
    const label = detectPeriodLabel(parsed);
    // Insert statement
    const { data: newStmt } = await supabase.from("statements").insert({ user_id: userId, workspace, label }).select().single();
    if (!newStmt) { alert("Failed to save statement."); return; }
    // Insert transactions
    const txRows = parsed.map(t => ({ statement_id: newStmt.id, local_id: t.id, date: t.date.toISOString(), date_str: t.dateStr, description: t.description, amount: t.amount, is_credit: t.isCredit, category: t.category, ai_categorised: false, manual_category: null }));
    await supabase.from("transactions").insert(txRows);
    const newEntry = { id: newStmt.id, label, transactions: parsed };
    setStatements(prev => [...prev, newEntry]);
    setActiveStmt(statements.length);
    setShowImport(false); setAiStatus(null);
  };

  const handleAICategorise = async () => {
    setAiLoading(true); setAiStatus(null);
    try {
      const updated = await categoriseWithAI(transactions, catNames);
      // Save to DB
      const stmtId = stmt?.id;
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
    const stmtId = stmt?.id;
    if (stmtId) await supabase.from("transactions").update({ manual_category: cat }).eq("statement_id", stmtId).eq("local_id", pickerTx.id);
    setStatements(prev => prev.map((s, i) => i === activeStmt ? { ...s, transactions: s.transactions.map(t => t.id === pickerTx.id ? { ...t, manualCategory: cat } : t) } : s));
    setPickerTx(null);
  };

  const handleEditSave = async (updated) => {
    const stmtId = stmt?.id;
    if (stmtId) {
      await supabase.from("transactions").update({
        description: updated.description,
        amount: updated.amount,
        is_credit: updated.isCredit,
        date_str: updated.dateStr,
        date: updated.date.toISOString(),
        manual_category: updated.manualCategory,
      }).eq("statement_id", stmtId).eq("local_id", updated.id);
    }
    setStatements(prev => prev.map((s, i) => i === activeStmt ? { ...s, transactions: s.transactions.map(t => t.id === updated.id ? { ...t, ...updated } : t) } : s));
    setEditTx(null);
  };

  const removeStatement = async (idx) => {
    if (statements.length <= 1) { alert("You need at least one statement."); return; }
    const s = statements[idx];
    if (!window.confirm(`Delete "${s.label}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("statements").delete().eq("id", s.id);
    if (error) { alert("Delete failed — please try again."); return; }
    setStatements(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    setActiveStmt(prev => {
      if (idx < prev) return prev - 1;
      if (idx === prev) return Math.max(0, prev - 1);
      return prev;
    });
  };

  const netPositive = summary.net >= 0;
  const aiCount = transactions.filter(t => t.aiCategorised).length;
  const manualCount = transactions.filter(t => t.manualCategory).length;

  if (dbLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 80, gap: 12 }}>
      <div className="ai-spinner" />
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)" }}>Loading statements…</span>
    </div>
  );

  return (
    <div style={{ position: "relative" }}>
      {/* Statement tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {statements.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 0, borderRadius: 100, border: `1px solid var(--cream-border)`, background: i === activeStmt ? "var(--cream-card)" : "transparent", overflow: "hidden", transition: "all 0.15s" }}>
            <button onClick={() => { setActiveStmt(i); setActiveCategory(null); setSearch(""); setAiStatus(null); }} style={{ padding: "5px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: i === activeStmt ? "var(--ink)" : "var(--ink-faint)", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{s.label}</button>
            {statements.length > 1 && <button onClick={() => removeStatement(i)} style={{ padding: "5px 10px 5px 0", background: "transparent", border: "none", cursor: "pointer", color: i === activeStmt ? "var(--ink-faint)" : "var(--cream-border)", fontSize: 11 }}>✕</button>}
          </div>
        ))}
        <button onClick={() => setShowImport(true)} style={{ padding: "5px 12px", borderRadius: 100, border: "1px dashed var(--cream-border)", background: "transparent", color: "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer", letterSpacing: "0.05em" }}>+ Add</button>
      </div>

      {!statements.length && !dbLoading && (
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

        {/* TOP BENTO */}
        <div className="fade-up bento-top" style={{ animationDelay: "0.05s" }}>
          <div style={{ padding: "20px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #BFEFDF 60%, #DCF2F8)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 12 }}>Income</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 700, color: "#0A0A0A", lineHeight: 1, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{fmt(summary.income, true)}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 6 }}>{transactions.filter(t => t.isCredit).length} credits</div>
          </div>
          <div style={{ padding: "20px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #FFD6C2 0%, #FFB3C6 100%)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 12 }}>Spend</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 700, color: "#0A0A0A", lineHeight: 1, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{fmt(summary.spend, true)}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 6 }}>{transactions.filter(t => !t.isCredit).length} debits</div>
          </div>
          <div className="net-hero-inner" style={{ borderRadius: "var(--r-xl)", padding: "24px 28px", background: netPositive ? "var(--charcoal)" : "#C0392B", boxShadow: netPositive ? "0 2px 24px rgba(13,11,9,0.14)" : "0 2px 24px rgba(192,57,43,0.25)" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.75)", marginBottom: 10 }}>{netPositive ? "Net Surplus" : "Net Deficit"}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 40, fontWeight: 700, color: "white", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>{fmt(Math.abs(summary.net), true)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.18)", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min((summary.spend / (summary.income || 1)) * 100, 100).toFixed(1)}%`, background: "rgba(255,255,255,0.6)", borderRadius: 2, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} /></div>
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
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)" }}>Transactions {activeCategory ? <span style={{ color: "var(--red)", marginLeft: 8 }}>{activeCategory}</span> : null}</div>
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
                      <td style={{ padding:"11px 20px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:600,color:t.isCredit?"#3D8C6F":"var(--ink)",whiteSpace:"nowrap" }}>{t.isCredit?"+":"−"}{fmt(t.amount)}</td>
                      <td style={{ padding:"11px 12px 11px 4px",textAlign:"right",whiteSpace:"nowrap" }}>
                        <button onClick={() => setEditTx(t)} style={{ background:"transparent",border:"1px solid var(--cream-border)",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"var(--ink-faint)",letterSpacing:"0.04em",transition:"all 0.15s" }} title="Edit transaction">✎</button>
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
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"var(--ink-faint)",marginLeft:"auto"}}>Darker = higher spend</div>
                </div>
                {selectedDay&&(
                  <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid var(--cream-border)"}}>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"var(--ink-light)",marginBottom:12}}>{selectedDay} · {selectedTxs.length} transaction{selectedTxs.length!==1?"s":""}</div>
                    {selectedTxs.map(t=>{const cat=t.manualCategory||t.category;const cfg=catMap[cat]||{color:"#7A756E",bg:"#7A756E18",icon:"•"};return(
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid var(--cream-border)"}}>
                        <span style={{background:cfg.bg,color:cfg.color,padding:"2px 8px",borderRadius:100,fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cat}</span>
                        <span style={{flex:1,fontFamily:"'Inter',sans-serif",fontSize:13,color:"var(--ink-mid)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</span>
                        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:13,fontWeight:600,color:t.isCredit?"#3D8C6F":"var(--ink)",whiteSpace:"nowrap"}}>{t.isCredit?"+":"−"}{fmt(t.amount)}</span>
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
      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 40 }}>
        <button className="fab-import" onClick={() => setShowImport(true)} title="Import Statement"><span className="fab-icon">+</span><span className="fab-label">Import Statement</span></button>
      </div>
    </div>
  );
}

/* ─── ROOT ─── */
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [accessDenied, setAccessDenied] = useState(false);
  const [dark, setDark] = useState(false);
  const [workspace, setWorkspace] = useState("professional");
  const [showCatManager, setShowCatManager] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const catMap = useMemo(() => buildCatMap(categories), [categories]);

  /* Auth listener */
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
    // Upsert all categories
    await supabase.from("categories").upsert(newCats.map((c, i) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, sort_order: i })));
    // Delete removed ones
    const newIds = newCats.map(c => c.id);
    const removed = categories.filter(c => !newIds.includes(c.id));
    for (const c of removed) await supabase.from("categories").delete().eq("id", c.id);
    // Reassign transactions if needed
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

  // Loading
  if (session === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B0B0B0", letterSpacing: "0.08em", gap: 12 }}>
      <div style={{ width: 16, height: 16, border: "2px solid rgba(227,26,81,0.2)", borderTopColor: "#E31A51", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      Loading…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // Not logged in
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

  // Logged in
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
        .bento-top { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
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
        {/* HEADER */}
        <div className="fade-up" style={{ marginBottom: 28 }}>
          <div style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 32, padding: "5px 12px", borderRadius: 100, background: "var(--cream-card)", border: "1px solid var(--cream-border)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.04em", color: "var(--ink-faint)" }}>
            <span style={{ color: "var(--red)", fontWeight: 700, textTransform: "uppercase" }}>{eyebrow}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{accountLabel}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{session.user.email}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink)", lineHeight: 1 }}>Financial Overview</div>
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
              <button onClick={() => supabase.auth.signOut()} title="Sign out" style={{ background: "transparent", border: "1.5px solid rgba(0,0,0,0.14)", borderRadius: 100, padding: "5px 12px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: "var(--ink-faint)", letterSpacing: "0.05em", transition: "all 0.15s" }}>Sign out</button>
            </div>
          </div>
        </div>

        <DashboardPanel key={workspace} userId={session.user.id} workspace={workspace} categories={categories} catMap={catMap} />

        {showCatManager && <CategoryManager categories={categories} onSave={handleSaveCategories} onClose={() => setShowCatManager(false)} />}
      </div>
    </>
  );
}
