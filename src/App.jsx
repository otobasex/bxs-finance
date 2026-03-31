import { useState, useMemo, useRef, useCallback, useEffect } from "react";

/* ─── STORAGE HELPERS ─── */
const LS_CATS = "bxs_categories_v1";
const LS_STMTS = "bxs_statements_v1";
function lsGet(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/* ─── DEFAULT CATEGORIES ─── */
const DEFAULT_CATEGORIES = [
  { id: "income",      name: "Income",              color: "#22c55e", icon: "↓" },
  { id: "transfers",   name: "Transfers Out",        color: "#E13540", icon: "→" },
  { id: "food",        name: "Food & Delivery",      color: "#F27067", icon: "🍔" },
  { id: "travel",      name: "Travel",               color: "#8b5cf6", icon: "✈" },
  { id: "utilities",   name: "Utilities",            color: "#0ea5e9", icon: "⚡" },
  { id: "airtime",     name: "Airtime & Data",       color: "#f59e0b", icon: "📱" },
  { id: "subs",        name: "Subscriptions",        color: "#6366f1", icon: "▶" },
  { id: "savings",     name: "Savings & Investment", color: "#14b8a6", icon: "🏦" },
  { id: "fees",        name: "Bank Fees",            color: "#94a3b8", icon: "🏛" },
  { id: "shopping",    name: "Shopping",             color: "#ec4899", icon: "🛍" },
  { id: "rent",        name: "Rent",                 color: "#a855f7", icon: "🏠" },
  { id: "business",    name: "Business",             color: "#3b82f6", icon: "💼" },
  { id: "other",       name: "Other",                color: "#7A756E", icon: "•"  },
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
  if (toClassify.length === 0) return transactions;
  const validCats = catNames.filter(c => c !== "Income");
  const prompt = `You are a South African bank statement categoriser. Categorise each transaction into exactly one of these categories: ${validCats.join(", ")}

Rules:
- "Transfers Out" = personal transfers to own/other accounts (Transfer To Oto, Send Money, Payshap)
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

/* ─── DETECT PERIOD LABEL ─── */
function detectPeriodLabel(transactions) {
  if (!transactions.length) return "Imported";
  const months = [...new Set(transactions.map(t => { const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${mn[t.date.getMonth()]} ${t.date.getFullYear()}`; }))];
  return months.join(" – ");
}

/* ─── FORMAT ─── */
function fmt(n, short = false) {
  if (short && n >= 1000) return "R\u00A0" + (n / 1000).toFixed(1) + "k";
  return "R\u00A0" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── SAMPLE DATA ─── */
const SAMPLE_PRO = `08 Dec FNB App Payment From Payment 7,700.00Cr 16,230.79Cr 08 Dec FNB App Rtc Pmt To Nomfundo Payment From Ng 8,000.00 8,230.79Cr 08 Dec Payshap Account Off-Us Nala Refund 2,500.00 13,030.79Cr 08 Dec FNB App Transfer To Plane Ticket 2,500.00 10,530.79Cr 08 Dec Electricity Prepaid Electricity 14363706947 150.00 16,130.79Cr 08 Dec FNB App Transfer To Oto 500.00 17,181.79Cr 08 Dec FNB App Transfer To Oto 750.00 16,280.79Cr 09 Dec FNB App Transfer To Travel 2,385.00 3,495.79Cr 09 Dec FNB App Prepaid Airtime 0736604717 39.00 2,656.79Cr 11 Dec FNB App Payment From Leteketa Constructio 500.00Cr 1,846.79Cr 11 Dec FNB App Payment From Flute 1,500.00Cr 346.79Cr 11 Dec FNB App Payment From Grace Healthcare Gr 2,750.00Cr 2,046.79Cr 13 Dec FNB App Payment From Payment 5,500.00Cr 6,345.79Cr 15 Dec Digital Content Voucher App Store Card 500.00 2,595.79Cr 17 Dec FNB App Payment From Payment 660.00Cr 1,105.79Cr 17 Dec FNB OB Pmt Dv8 Technology Group 4,000.00Cr 4,958.79Cr 17 Dec Send Money App Dr Send Nelly Nelly 50.00 1,055.79Cr 17 Dec FNB App Prepaid Airtime 0736604717 39.00 3,919.79Cr 17 Dec Electricity Prepaid Electricity 14363706947 100.00 2,953.79Cr 18 Dec POS Purchase Mr D Food 94.90 2,858.89Cr 18 Dec POS Purchase Mr D Food 180.00 2,678.89Cr 18 Dec POS Purchase Zulzi Ondemand Mo 377.96 2,300.93Cr 22 Dec FNB App Payment From Sckivest Capital 4,000.00Cr 4,775.03Cr 22 Dec Send Money App Dr Send Oto Bass 500.00 3,229.03Cr 23 Dec POS Purchase Zulzi Ondemand Mo 523.92 1,266.11Cr 23 Dec Inward Swift R025J6P4W0 Health Of Mother Earth 23,938.92Cr 25,205.03Cr 23 Dec FNB App Transfer To Hosting 2,000.00 20,230.03Cr 23 Dec FNB App Payment From Creativeshoppe 40,500.00Cr 59,030.03Cr 23 Dec Send Money App Dr Send Oto Bass 1,000.00 58,030.03Cr 24 Dec Payshap Account Off-Us Nala Refund 2,500.00 45,748.03Cr 24 Dec FNB App Payment To Repayment Eve Oto 7,500.00 38,248.03Cr 27 Dec POS Purchase Takealot 11,999.00 23,007.03Cr 27 Dec Payment To Investment Transfer 5,000.00 14,256.03Cr 27 Dec FNB App Transfer To Travel 3,000.00 10,756.03Cr 29 Dec Magtape Credit ABSA Bank Sales Advantage Book 5,000.00Cr 5,356.03Cr 31 Dec Digital Content Voucher Uber Flexi 250.00 2,406.03Cr 03 Jan Rtc Credit Saving Grace Educati 8,000.00Cr 9,357.03Cr 05 Jan FNB OB Pmt Dr Au Akpabio Inc 6,000.00Cr 10,313.03Cr 06 Jan FNB App Rtc Pmt To Rent Jan 6,000.00 2,313.03Cr 06 Jan POS Purchase PNP Crp Tableview 276.29 1,801.74Cr 06 Jan POS Purchase Yoco Amins Barbe 280.00 1,521.74Cr 07 Jan Send Money App Dr Send Oto Base 150.00 321.74Cr`;
const SAMPLE_PER = `01 Dec POS Purchase Woolworths Food 485442*5822 890.40 12,450.00Cr 02 Dec POS Purchase Checkers Hyper 485442*5822 1,240.60 11,209.40Cr 03 Dec Debit Order Netflix 149.00 11,060.40Cr 03 Dec Debit Order Spotify 89.99 10,970.41Cr 05 Dec POS Purchase Engen Garage 485442*5822 850.00 10,120.41Cr 07 Dec EFT Credit Salary 35,000.00Cr 45,120.41Cr 08 Dec Debit Order Home Loan Repayment 12,500.00 32,620.41Cr 08 Dec Debit Order Car Insurance 1,850.00 30,770.41Cr 10 Dec POS Purchase Woolworths Food 485442*5822 650.30 30,120.11Cr 14 Dec POS Purchase Mr D Food 400568*2793 220.00 29,400.11Cr 15 Dec POS Purchase Zulzi Ondemand 400568*2793 410.00 28,990.11Cr 16 Dec EFT Payment School Fees 3,200.00 25,790.11Cr 18 Dec POS Purchase Takealot 485442*5822 2,340.00 23,450.11Cr 20 Dec Prepaid Electricity 14363706947 300.00 23,150.11Cr 22 Dec POS Purchase Checkers Hyper 485442*5822 980.50 22,169.61Cr 24 Dec POS Purchase Shell Garage 485442*5822 750.00 21,419.61Cr 28 Dec Debit Order Gym Membership 599.00 19,720.61Cr 30 Dec POS Purchase Mr D Food 400568*2793 185.00 19,535.61Cr 02 Jan EFT Credit Salary 35,000.00Cr 54,535.61Cr 03 Jan Debit Order Home Loan Repayment 12,500.00 42,035.61Cr 04 Jan POS Purchase Woolworths Food 485442*5822 740.20 41,295.41Cr 05 Jan Debit Order Car Insurance 1,850.00 39,445.41Cr 06 Jan POS Purchase Engen Garage 485442*5822 900.00 38,545.41Cr 07 Jan POS Purchase Zulzi Ondemand 400568*2793 330.00 38,215.41Cr`;

/* ─── CATEGORY MANAGER MODAL ─── */
function CategoryManager({ categories, onSave, onClose }) {
  const [cats, setCats] = useState(categories.map(c => ({ ...c })));
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [reassignTo, setReassignTo] = useState("");
  const [editId, setEditId] = useState(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [newIcon, setNewIcon] = useState("•");
  const [adding, setAdding] = useState(false);

  const confirmDelete = (cat) => {
    if (cat.name === "Other") return;
    setDeleteTarget(cat);
    setReassignTo(cats.find(c => c.id !== cat.id && c.name !== "Income")?.name || "Other");
  };

  const doDelete = () => {
    if (!deleteTarget) return;
    onSave(cats.filter(c => c.id !== deleteTarget.id), deleteTarget.name, reassignTo);
    setDeleteTarget(null);
  };

  const doAdd = () => {
    if (!newName.trim()) return;
    const id = newName.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
    setCats(prev => [...prev, { id, name: newName.trim(), color: newColor, icon: newIcon }]);
    setNewName(""); setNewColor("#6366f1"); setNewIcon("•"); setAdding(false);
  };

  const updateCat = (id, field, val) => setCats(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 20, padding: 28, width: 500, maxHeight: "85vh", overflowY: "auto", zIndex: 201, boxShadow: "0 24px 80px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--red)", marginBottom: 4 }}>Settings</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>Manage Categories</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "var(--ink-light)", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {/* Category list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {cats.map(cat => (
            <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--cream-border)", background: "var(--cream)" }}>
              <input type="color" value={cat.color} onChange={e => updateCat(cat.id, "color", e.target.value)} style={{ width: 24, height: 24, border: "none", borderRadius: 6, cursor: "pointer", padding: 0, background: "none" }} />
              {editId === cat.id ? (
                <input value={cat.name} onChange={e => updateCat(cat.id, "name", e.target.value)} onBlur={() => setEditId(null)} autoFocus
                  style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "3px 8px", color: "var(--ink)", outline: "none" }} />
              ) : (
                <span onClick={() => setEditId(cat.id)} style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", cursor: "text" }}>
                  <span style={{ marginRight: 6 }}>{cat.icon}</span>{cat.name}
                </span>
              )}
              <input value={cat.icon} onChange={e => updateCat(cat.id, "icon", e.target.value)} maxLength={2}
                style={{ width: 36, textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "3px 4px", color: "var(--ink)", outline: "none" }} />
              {cat.name !== "Income" && cat.name !== "Other" && (
                <button onClick={() => confirmDelete(cat)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: 14, padding: "2px 4px", borderRadius: 4, transition: "color 0.1s" }} title="Delete">✕</button>
              )}
            </div>
          ))}
        </div>

        {/* Add new */}
        {adding ? (
          <div style={{ padding: "12px", borderRadius: 10, border: "1px dashed var(--cream-border)", background: "var(--cream)", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 24, height: 24, border: "none", borderRadius: 6, cursor: "pointer", padding: 0 }} />
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Category name" autoFocus
                style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "6px 10px", color: "var(--ink)", outline: "none" }} />
              <input value={newIcon} onChange={e => setNewIcon(e.target.value)} maxLength={2} placeholder="•"
                style={{ width: 40, textAlign: "center", fontFamily: "'Inter', sans-serif", fontSize: 14, background: "white", border: "1px solid var(--cream-border)", borderRadius: 6, padding: "6px 4px", color: "var(--ink)", outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={doAdd} style={{ flex: 1, padding: "7px", background: "var(--charcoal)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700 }}>Add</button>
              <button onClick={() => setAdding(false)} style={{ padding: "7px 14px", background: "transparent", color: "var(--ink-faint)", border: "1px solid var(--cream-border)", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ width: "100%", padding: "9px", background: "transparent", color: "var(--ink-mid)", border: "1.5px dashed var(--cream-border)", borderRadius: 10, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.06em", marginBottom: 12 }}>+ Add Category</button>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 18px", background: "transparent", color: "var(--ink-mid)", border: "1px solid var(--cream-border)", borderRadius: 100, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>Cancel</button>
          <button onClick={() => onSave(cats, null, null)} style={{ padding: "9px 20px", background: "var(--charcoal)", color: "white", border: "none", borderRadius: 100, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700 }}>Save Changes</button>
        </div>

        {/* Delete reassign dialog */}
        {deleteTarget && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
            <div style={{ background: "var(--cream-card)", borderRadius: 14, padding: 24, width: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>Delete "{deleteTarget.name}"?</div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", marginBottom: 16, lineHeight: 1.5 }}>Transactions in this category will be reassigned to:</div>
              <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", marginBottom: 16, background: "var(--cream)", border: "1px solid var(--cream-border)", borderRadius: 8, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink)", outline: "none" }}>
                {cats.filter(c => c.id !== deleteTarget.id && c.name !== "Income").map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setDeleteTarget(null)} style={{ flex: 1, padding: "8px", background: "transparent", border: "1px solid var(--cream-border)", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-mid)" }}>Cancel</button>
                <button onClick={doDelete} style={{ flex: 1, padding: "8px", background: "#E13540", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700 }}>Delete & Reassign</button>
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
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", marginBottom: 16, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{transaction.description}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {categories.filter(c => c.name !== "Income").map(cat => {
            const cfg = catMap[cat.name] || { color: "#7A756E", bg: "#7A756E18" };
            const isActive = (transaction.manualCategory || transaction.category) === cat.name;
            return (
              <button key={cat.id} onClick={() => onSelect(cat.name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, border: `1px solid ${isActive ? cfg.color : "var(--cream-border)"}`, background: isActive ? cfg.bg : "transparent", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: isActive ? cfg.color : "var(--ink-mid)", transition: "all 0.1s" }}>
                <span>{cat.icon}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</span>
              </button>
            );
          })}
        </div>
        <button onClick={onClose} style={{ marginTop: 14, width: "100%", padding: "8px", borderRadius: 8, border: "1px solid var(--cream-border)", background: "transparent", color: "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ─── CSV PARSER ─── */
function parseCSV(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  // Try to detect header row and find relevant columns
  const header = lines[0].toLowerCase();
  const cols = header.split(",").map(c => c.replace(/"/g, "").trim());
  const dateIdx = cols.findIndex(c => c.includes("date"));
  const descIdx = cols.findIndex(c => c.includes("desc") || c.includes("narrat") || c.includes("detail") || c.includes("ref"));
  const amtIdx  = cols.findIndex(c => c.includes("amount") || c.includes("debit") || c.includes("credit"));
  const credIdx = cols.findIndex(c => c.includes("credit"));
  const debIdx  = cols.findIndex(c => c.includes("debit"));

  // If we can't detect structure, return raw text for the statement parser
  if (dateIdx === -1 || descIdx === -1) return lines.slice(1).join("\n");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map(c => c.replace(/"/g, "").trim());
    if (cells.length < 3) continue;
    const date = cells[dateIdx] || "";
    const desc = cells[descIdx] || "";
    let amount = 0, isCredit = false;
    if (credIdx !== -1 && debIdx !== -1) {
      const cred = parseFloat(cells[credIdx]) || 0;
      const deb  = parseFloat(cells[debIdx])  || 0;
      if (cred > 0) { amount = cred; isCredit = true; }
      else { amount = deb; isCredit = false; }
    } else {
      const raw = parseFloat(cells[amtIdx]?.replace(/[^0-9.-]/g, "")) || 0;
      isCredit = raw > 0; amount = Math.abs(raw);
    }
    if (!amount || !desc) continue;
    rows.push(`${date} ${desc} ${amount.toFixed(2)}${isCredit ? "Cr" : ""} 0.00`);
  }
  return rows.join("\n");
}

/* ─── IMPORT DRAWER ─── */
function ImportDrawer({ open, onClose, onImport }) {
  const [tab, setTab] = useState("file"); // "file" | "paste"
  const [pasteText, setPasteText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState(null); // null | "loading" | "error" | string(success)
  const fileRef = useRef(null);

  const reset = () => { setStatus(null); setPasteText(""); setTab("file"); };
  const handleClose = () => { reset(); onClose(); };

  const processFile = async (file) => {
    if (!file) return;
    setStatus("loading");
    try {
      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        const text = await file.text();
        const parsed = parseCSV(text);
        onImport(parsed);
        handleClose();
      } else if (file.name.endsWith(".pdf") || file.type === "application/pdf") {
        // Send PDF to Claude to extract transaction text
        const base64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(",")[1]);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
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
                { type: "text", text: `Extract all transactions from this FNB bank statement. Return ONLY the raw transaction lines in this exact format, one per line, nothing else:
DD Mon Description Amount.00Cr DD Mon Description Amount.00
Examples:
08 Dec FNB App Payment From Payment 7700.00Cr 16230.79Cr
08 Dec FNB App Transfer To Oto 500.00 17181.79Cr
Include every transaction. No headers, no totals, no explanations.` }
              ]
            }]
          })
        });
        const data = await response.json();
        const extracted = data.content?.map(c => c.text || "").join("") || "";
        if (!extracted.trim()) throw new Error("No transactions found");
        onImport(extracted);
        handleClose();
      } else {
        setStatus("error");
      }
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  };

  const onFileChange = (e) => { const f = e.target.files[0]; if (f) processFile(f); };
  const onDrop = (e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", opacity: open ? 1 : 0, pointerEvents: open ? "all" : "none", transition: "opacity 0.2s" }}>
      <div onClick={handleClose} style={{ position: "absolute", inset: 0, background: "rgba(13,11,9,0.35)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "relative", width: 480, background: "var(--cream-card)", border: "1px solid var(--cream-border)", borderRadius: 24, padding: 32, display: "flex", flexDirection: "column", gap: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.18)", transform: open ? "translateY(0) scale(1)" : "translateY(16px) scale(0.97)", transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)", maxHeight: "85vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--red)", marginBottom: 6 }}>Import</div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>Add Statement</div>
          </div>
          <button onClick={handleClose} style={{ background: "transparent", border: "1.5px solid var(--cream-border)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "var(--ink-light)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "var(--cream)", borderRadius: 10, padding: 4 }}>
          {[["file", "Upload File"], ["paste", "Paste Text"]].map(([v, lbl]) => (
            <button key={v} onClick={() => { setTab(v); setStatus(null); }}
              style={{ flex: 1, padding: "7px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", background: tab === v ? "var(--cream-card)" : "transparent", color: tab === v ? "var(--ink)" : "var(--ink-faint)", boxShadow: tab === v ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* FILE TAB */}
        {tab === "file" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                flex: 1, border: `2px dashed ${dragging ? "var(--red)" : "var(--cream-border)"}`,
                borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 12, cursor: "pointer", background: dragging ? "rgba(225,53,64,0.03)" : "var(--cream)",
                transition: "all 0.15s", padding: 32,
              }}>
              {status === "loading" ? (
                <>
                  <div className="ai-spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#6366f1", letterSpacing: "0.06em" }}>Extracting transactions…</div>
                </>
              ) : status === "error" ? (
                <>
                  <div style={{ fontSize: 32 }}>⚠️</div>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--red)", textAlign: "center", lineHeight: 1.5 }}>Could not read file. Try a different PDF or use Paste Text.</div>
                  <button onClick={e => { e.stopPropagation(); setStatus(null); }} style={{ padding: "6px 14px", borderRadius: 100, border: "1px solid var(--cream-border)", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-mid)", cursor: "pointer" }}>Try again</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36 }}>🗂️</div>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 600, color: "var(--ink)", textAlign: "center" }}>Drop your statement here</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-faint)", textAlign: "center", lineHeight: 1.7, letterSpacing: "0.04em" }}>PDF or CSV · Click to browse</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.csv" onChange={onFileChange} style={{ display: "none" }} />
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.6, textAlign: "center" }}>
              PDF statements are read by Claude AI. CSV files are parsed directly.
            </p>
          </div>
        )}

        {/* PASTE TAB */}
        {tab === "paste" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-light)", lineHeight: 1.6 }}>Open your FNB statement PDF, select all text (Ctrl+A), copy (Ctrl+C), then paste below.</p>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder="08 Dec FNB App Transfer To Oto 500.00 ..." rows={14}
              style={{ flex: 1, resize: "none", padding: "13px 16px", background: "white", border: "1px solid var(--cream-border)", borderRadius: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink)", outline: "none", lineHeight: 1.7 }} />
            <button onClick={() => { onImport(pasteText); handleClose(); }}
              style={{ background: "var(--grad)", color: "white", border: "none", borderRadius: 100, padding: "12px 22px", fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, boxShadow: "0 2px 12px rgba(225,53,64,0.25)", cursor: "pointer" }}>
              Parse & Add Statement
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

/* ─── PILL TICKER ─── */
function PillTicker({ categories, catMap, activeCategory, setActiveCategory }) {
  const wrapRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const [manualOffset, setManualOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pills = [...categories, ...categories];
  const startDrag = useCallback((clientX) => {
    const track = trackRef.current;
    if (track) { const m = window.getComputedStyle(track).transform.match(/matrix.*\((.+)\)/); if (m) drag.current.scrollLeft = parseFloat(m[1].split(', ')[4]) || 0; }
    drag.current = { ...drag.current, active: true, startX: clientX }; setIsDragging(true);
  }, []);
  const moveDrag = useCallback((clientX) => {
    if (!drag.current.active) return;
    let next = drag.current.scrollLeft + (clientX - drag.current.startX);
    const track = trackRef.current;
    if (track) { const hw = track.scrollWidth / 2; if (next < -hw) next += hw; if (next > 0) next -= hw; }
    setManualOffset(next);
  }, []);
  const endDrag = useCallback(() => { drag.current.active = false; setIsDragging(false); }, []);
  return (
    <div ref={wrapRef} className={`pill-ticker-wrap${isDragging ? " dragging" : ""}`}
      onMouseDown={e => { e.preventDefault(); startDrag(e.clientX); }} onMouseMove={e => { if (drag.current.active) moveDrag(e.clientX); }} onMouseUp={endDrag} onMouseLeave={() => { if (drag.current.active) endDrag(); }}
      onTouchStart={e => startDrag(e.touches[0].clientX)} onTouchMove={e => moveDrag(e.touches[0].clientX)} onTouchEnd={endDrag}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 32, background: "linear-gradient(to right, var(--cream-card), transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 32, background: "linear-gradient(to left, var(--cream-card), transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div ref={trackRef} className="pill-ticker-track" style={isDragging ? { transform: `translateX(${manualOffset}px)`, animation: "none" } : undefined}>
        {pills.map(([cat], i) => {
          const cfg = catMap[cat] || { color: "#7A756E", icon: "•" };
          const isActive = activeCategory === cat;
          return (
            <button key={`${cat}-${i}`} className={`cat-chip${isActive ? " active" : ""}`}
              onClick={e => { if (Math.abs(drag.current.startX - e.clientX) < 4) setActiveCategory(isActive ? null : cat); }}
              style={isActive ? { background: cfg.color, borderColor: "transparent" } : {}}>
              {cfg.icon} {cat}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── DASHBOARD PANEL ─── */
function DashboardPanel({ statements, setStatements, categories, catMap }) {
  const [activeStmt, setActiveStmt] = useState(0);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [txView, setTxView] = useState("list");
  const [selectedDay, setSelectedDay] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [pickerTx, setPickerTx] = useState(null);

  const catNames = categories.map(c => c.name);
  const stmt = statements[activeStmt] || statements[0];
  const transactions = stmt?.transactions || [];

  const setTransactions = (updater) => {
    setStatements(prev => prev.map((s, i) => i === activeStmt ? { ...s, transactions: typeof updater === "function" ? updater(s.transactions) : updater } : s));
  };

  const summary = useMemo(() => {
    const income = transactions.filter(t => t.isCredit).reduce((s, t) => s + t.amount, 0);
    const spend = transactions.filter(t => !t.isCredit).reduce((s, t) => s + t.amount, 0);
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

  const handleImport = (text) => {
    const parsed = parseStatement(text, catNames);
    if (!parsed.length) { alert("No transactions found. Ensure you paste raw FNB statement text."); return; }
    const label = detectPeriodLabel(parsed);
    setStatements(prev => [...prev, { id: Date.now(), label, transactions: parsed }]);
    setActiveStmt(statements.length);
    setShowImport(false); setAiStatus(null);
  };

  const handleAICategorise = async () => {
    setAiLoading(true); setAiStatus(null);
    try { const updated = await categoriseWithAI(transactions, catNames); setTransactions(updated); setAiStatus("done"); }
    catch { setAiStatus("error"); } finally { setAiLoading(false); }
  };

  const handleManualCategory = (cat) => {
    if (!pickerTx) return;
    setTransactions(prev => prev.map(t => t.id === pickerTx.id ? { ...t, manualCategory: cat } : t));
    setPickerTx(null);
  };

  const removeStatement = (idx) => {
    if (statements.length <= 1) return;
    setStatements(prev => prev.filter((_, i) => i !== idx));
    setActiveStmt(Math.max(0, activeStmt - 1));
  };

  const netPositive = summary.net >= 0;
  const aiCount = transactions.filter(t => t.aiCategorised).length;
  const manualCount = transactions.filter(t => t.manualCategory).length;

  return (
    <div style={{ position: "relative" }}>
      {/* Statement tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {statements.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 0, borderRadius: 100, border: `1px solid ${i === activeStmt ? "var(--cream-border)" : "var(--cream-border)"}`, background: i === activeStmt ? "var(--cream-card)" : "transparent", overflow: "hidden", transition: "all 0.15s" }}>
            <button onClick={() => { setActiveStmt(i); setActiveCategory(null); setSearch(""); setAiStatus(null); }}
              style={{ padding: "5px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: i === activeStmt ? "var(--ink)" : "var(--ink-faint)", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
              {s.label}
            </button>
            {statements.length > 1 && (
              <button onClick={() => removeStatement(i)} style={{ padding: "5px 10px 5px 0", background: "transparent", border: "none", cursor: "pointer", color: i === activeStmt ? "var(--ink-faint)" : "var(--cream-border)", fontSize: 11, lineHeight: 1 }}>✕</button>
            )}
          </div>
        ))}
        <button onClick={() => setShowImport(true)} style={{ padding: "5px 12px", borderRadius: 100, border: "1px dashed var(--cream-border)", background: "transparent", color: "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer", letterSpacing: "0.05em" }}>+ Add</button>
      </div>

      {/* AI Status */}
      {(aiLoading || aiStatus) && (
        <div style={{ marginBottom: 12, padding: "10px 18px", borderRadius: 10, background: aiLoading ? "rgba(99,102,241,0.08)" : aiStatus === "done" ? "rgba(20,184,166,0.08)" : "rgba(225,53,64,0.08)", border: `1px solid ${aiLoading ? "rgba(99,102,241,0.2)" : aiStatus === "done" ? "rgba(20,184,166,0.2)" : "rgba(225,53,64,0.2)"}`, display: "flex", alignItems: "center", gap: 10 }}>
          {aiLoading && <div className="ai-spinner" />}
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: aiLoading ? "#6366f1" : aiStatus === "done" ? "#14b8a6" : "#E13540" }}>
            {aiLoading ? "Claude is categorising your transactions…" : aiStatus === "done" ? `✓ AI categorised ${aiCount} transactions${manualCount > 0 ? ` · ${manualCount} manually overridden` : ""}` : "⚠ AI categorisation failed — using keyword matching"}
          </span>
        </div>
      )}

      <div className="fade-up bento-top" style={{ animationDelay: "0.05s" }}>
        {/* Income — blue-green soft */}
        <div style={{ padding: "20px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #AECFC2 0%, #C8E6DA 100%)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 12 }}>Income</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 700, color: "#0D0B09", lineHeight: 1, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{fmt(summary.income, true)}</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 6 }}>{transactions.filter(t => t.isCredit).length} credits</div>
        </div>
        {/* Spend — peach-pink soft */}
        <div style={{ padding: "20px", borderRadius: "var(--r-xl)", background: "linear-gradient(135deg, #F2C4BB 0%, #F7D9D4 100%)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)", marginBottom: 12 }}>Spend</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 700, color: "#0D0B09", lineHeight: 1, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{fmt(summary.spend, true)}</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "rgba(0,0,0,0.4)", marginTop: 6 }}>{transactions.filter(t => !t.isCredit).length} debits</div>
        </div>
        {/* Net */}
        <div className="net-hero-inner" style={{ borderRadius: "var(--r-xl)", padding: "24px 28px", background: netPositive ? "var(--charcoal)" : "#C0392B", boxShadow: netPositive ? "0 2px 24px rgba(13,11,9,0.14)" : "0 2px 24px rgba(192,57,43,0.25)" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.75)", marginBottom: 10 }}>{netPositive ? "Net Surplus" : "Net Deficit"}</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 40, fontWeight: 700, color: "white", lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>{fmt(Math.abs(summary.net), true)}</div>
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
            const spendOnly = summary.sorted;
            const total = spendOnly.reduce((s, [,v]) => s + v, 0);
            const size = 200, cx = 100, cy = 100, outerR = 80, innerR = 50;
            let angle = -Math.PI / 2;
            const slices = spendOnly.map(([cat, amount]) => {
              const frac = amount / total, sa = angle, ea = angle + frac * 2 * Math.PI; angle = ea;
              const x1 = cx + outerR * Math.cos(sa), y1 = cy + outerR * Math.sin(sa);
              const x2 = cx + outerR * Math.cos(ea), y2 = cy + outerR * Math.sin(ea);
              const ix1 = cx + innerR * Math.cos(ea), iy1 = cy + innerR * Math.sin(ea);
              const ix2 = cx + innerR * Math.cos(sa), iy2 = cy + innerR * Math.sin(sa);
              const d = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${frac > 0.5 ? 1 : 0} 0 ${ix2} ${iy2} Z`;
              return { cat, amount, frac, d };
            });
            return (
              <div className="donut-layout">
                <div className="donut-container" style={{ flexShrink: 0 }}>
                  <svg viewBox={`0 0 ${size} ${size}`} className="donut-svg">
                    {slices.map(({ cat, d }) => { const cfg = catMap[cat] || { color: "#7A756E" }; const isA = activeCategory === cat; return <path key={cat} d={d} fill={cfg.color} opacity={activeCategory && !isA ? 0.15 : 1} style={{ cursor: "pointer", transition: "opacity 0.2s" }} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)} />; })}
                    <text x={cx} y={cy - 8} textAnchor="middle" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fill: "var(--ink-light)", fontWeight: 700 }}>SPEND</text>
                    <text x={cx} y={cy + 10} textAnchor="middle" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fill: "var(--ink)", fontWeight: 700 }}>{fmt(total, true)}</text>
                  </svg>
                </div>
                <div className="donut-legend" style={{ flex: 1, minWidth: 160 }}>
                  {slices.map(({ cat, amount, frac }) => { const cfg = catMap[cat] || { color: "#7A756E", bg: "#7A756E18" }; const isA = activeCategory === cat; return (
                    <div key={cat} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)} style={{ cursor: "pointer", padding: "6px 0", borderRadius: 6, background: isA ? cfg.bg : "transparent", border: `1px solid ${isA ? cfg.color + "22" : "transparent"}`, opacity: activeCategory && !isA ? 0.35 : 1, transition: "all 0.15s" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: cfg.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: isA ? cfg.color : "var(--ink-mid)" }}>{cat}</div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, color: isA ? cfg.color : "var(--ink)" }}>{(frac * 100).toFixed(0)}%</div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--ink-faint)" }}>{fmt(amount, true)}</div>
                      </div>
                      <div style={{ height: 3, background: "var(--cream-border)", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${(frac * 100).toFixed(1)}%`, background: cfg.color, borderRadius: 2, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} /></div>
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
              {[["list", "List"], ["calendar", "Calendar"]].map(([v, lbl]) => (
                <button key={v} onClick={() => { setTxView(v); setSelectedDay(null); }} style={{ padding: "4px 12px", borderRadius: 100, border: "1px solid var(--cream-border)", background: txView === v ? "var(--cream-card)" : "transparent", color: txView === v ? "var(--ink)" : "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, cursor: "pointer", transition: "all 0.15s" }}>{lbl}</button>
              ))}
            </div>
          </div>
        </div>

        {txView === "list" && (
          <div style={{ overflowY: "auto", maxHeight: 520 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--cream)" }}>
                  {[["Date","left"],["Description","left"],["Category","left"],["Amount","right"]].map(([h, align]) => (
                    <th key={h} style={{ padding: "10px 20px", textAlign: align, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-faint)", borderBottom: "1px solid var(--cream-border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const cat = t.manualCategory || t.category;
                  const cfg = catMap[cat] || { color: "#7A756E", bg: "#7A756E18", icon: "•" };
                  return (
                    <tr key={t.id} className="tx-row">
                      <td style={{ padding: "11px 20px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>{t.dateStr}</td>
                      <td style={{ padding: "11px 20px", fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</td>
                      <td style={{ padding: "11px 20px" }}>
                        <button onClick={() => !t.isCredit && setPickerTx(t)} title={t.isCredit ? "" : "Click to re-categorise"}
                          style={{ background: cfg.bg, color: cfg.color, padding: "3px 10px", borderRadius: 100, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap", border: `1px solid ${t.manualCategory ? cfg.color + "66" : "transparent"}`, cursor: t.isCredit ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}>
                          {cfg.icon} {cat}
                          {t.manualCategory && <span style={{ fontSize: 8, opacity: 0.7 }}>✎</span>}
                          {t.aiCategorised && !t.manualCategory && <span style={{ fontSize: 8, opacity: 0.7 }}>✦</span>}
                        </button>
                      </td>
                      <td style={{ padding: "11px 20px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: t.isCredit ? "#3D8C6F" : "var(--ink)", whiteSpace: "nowrap" }}>
                        {t.isCredit ? "+" : "−"}{fmt(t.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--ink-faint)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>No transactions match your filter.</div>}
            <div style={{ padding: "10px 20px", borderTop: "1px solid var(--cream-border)", display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[["✦ AI categorised", "#6366f1"], ["✎ Manually overridden", "#14b8a6"], ["Click any category to re-categorise", "var(--ink-faint)"]].map(([lbl, color]) => (
                <span key={lbl} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color, letterSpacing: "0.06em" }}>{lbl}</span>
              ))}
            </div>
          </div>
        )}

        {txView === "calendar" && (() => {
          const byDay = {};
          transactions.forEach(t => {
            const key = t.date.toISOString().slice(0, 10);
            if (!byDay[key]) byDay[key] = { spend: 0, income: 0, txs: [] };
            if (t.isCredit) byDay[key].income += t.amount; else byDay[key].spend += t.amount;
            byDay[key].txs.push(t);
          });
          const maxDaySpend = Math.max(...Object.values(byDay).map(d => d.spend), 1);
          const monthList = [...new Set(transactions.map(t => `${t.date.getFullYear()}-${t.date.getMonth()}`))]
            .map(s => { const [y, m] = s.split('-').map(Number); return { year: y, month: m }; })
            .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
          const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
          const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const selectedTxs = selectedDay ? (byDay[selectedDay]?.txs || []) : [];
          return (
            <div style={{ padding: "20px 24px" }}>
              <div className="cal-months-wrap">
                {monthList.map(({ year, month }) => {
                  const firstDay = new Date(year, month, 1).getDay(), dim = new Date(year, month + 1, 0).getDate();
                  const cells = [...Array(firstDay).fill(null), ...Array.from({length: dim}, (_,i) => i+1)];
                  return (
                    <div key={`${year}-${month}`} className="cal-month-wrap">
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-light)", marginBottom: 10 }}>{MN[month]} {year}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>{DAYS.map(d => <div key={d} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, fontWeight: 700, color: "var(--ink-faint)", textAlign: "center", padding: "2px 0" }}>{d}</div>)}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
                        {cells.map((day, i) => {
                          if (!day) return <div key={`e${i}`} />;
                          const key = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                          const data = byDay[key]; const isSel = selectedDay === key;
                          const si = data ? data.spend / maxDaySpend : 0, isNP = data && data.income > data.spend;
                          let bg = "var(--cream)", border = "var(--cream-border)";
                          if (data) { if (isNP) { bg = `rgba(174,207,194,${0.2 + si * 0.4})`; border = `rgba(61,140,111,${0.2 + si * 0.3})`; } else { bg = `rgba(242,196,187,${0.2 + si * 0.5})`; border = `rgba(192,57,43,${0.2 + si * 0.4})`; } }
                          if (isSel) { bg = "var(--charcoal)"; border = "var(--charcoal)"; }
                          return (
                            <div key={key} onClick={() => data && setSelectedDay(isSel ? null : key)}
                              style={{ aspectRatio: "1", borderRadius: 5, background: bg, border: `1px solid ${border}`, cursor: data ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transition: "all 0.15s", padding: 2 }}>
                              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: isSel ? 700 : 400, color: isSel ? "white" : data ? "var(--ink)" : "var(--ink-faint)", lineHeight: 1 }}>{day}</div>
                              {data && <div style={{ width: 3, height: 3, borderRadius: "50%", background: isSel ? "rgba(255,255,255,0.6)" : isNP ? "#3D8C6F" : "#C0392B", marginTop: 2 }} />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--cream-border)", flexWrap: "wrap" }}>
                {[{ color: "rgba(242,196,187,0.6)", label: "Spend day" }, { color: "rgba(174,207,194,0.6)", label: "Net positive day" }, { color: "var(--charcoal)", label: "Selected" }].map(({ color, label }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: color }} /><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-faint)" }}>{label}</span></div>
                ))}
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-faint)", marginLeft: "auto" }}>Darker = higher spend</div>
              </div>
              {selectedDay && (
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--cream-border)" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-light)", marginBottom: 12 }}>{selectedDay} · {selectedTxs.length} transaction{selectedTxs.length !== 1 ? "s" : ""}</div>
                  {selectedTxs.map(t => { const cat = t.manualCategory || t.category; const cfg = catMap[cat] || { color: "#7A756E", bg: "#7A756E18", icon: "•" }; return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--cream-border)" }}>
                      <span style={{ background: cfg.bg, color: cfg.color, padding: "2px 8px", borderRadius: 100, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{cfg.icon} {cat}</span>
                      <span style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "var(--ink-mid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: t.isCredit ? "#3D8C6F" : "var(--ink)", whiteSpace: "nowrap" }}>{t.isCredit ? "+" : "−"}{fmt(t.amount)}</span>
                    </div>
                  ); })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <ImportDrawer open={showImport} onClose={() => setShowImport(false)} onImport={handleImport} />
      {pickerTx && <CategoryPicker transaction={pickerTx} categories={categories} onSelect={handleManualCategory} onClose={() => setPickerTx(null)} />}
      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 40 }}>
        <button
          className="fab-import"
          onClick={() => setShowImport(true)}
          title="Import Statement"
        >
          <span className="fab-icon">+</span>
          <span className="fab-label">Import Statement</span>
        </button>
      </div>
    </div>
  );
}

/* ─── ROOT ─── */
export default function FinanceDashboard() {
  const [dark, setDark] = useState(false);
  const [workspace, setWorkspace] = useState("professional"); // "professional" | "personal"
  const [showCatManager, setShowCatManager] = useState(false);

  // Shared categories (persisted)
  const [categories, setCategories] = useState(() => lsGet(LS_CATS, DEFAULT_CATEGORIES));
  useEffect(() => { lsSet(LS_CATS, categories); }, [categories]);

  // Per-workspace statements (persisted)
  const initStmts = (sampleText, key) => {
    const saved = lsGet(LS_STMTS, null);
    if (saved && saved[key] && saved[key].length) {
      return saved[key].map(s => ({ ...s, transactions: s.transactions.map(t => ({ ...t, date: new Date(t.date) })) }));
    }
    const txs = parseStatement(sampleText, DEFAULT_CATEGORIES.map(c => c.name));
    return [{ id: 1, label: detectPeriodLabel(txs), transactions: txs }];
  };
  const [proStmts, setProStmts] = useState(() => initStmts(SAMPLE_PRO, "pro"));
  const [perStmts, setPerStmts] = useState(() => initStmts(SAMPLE_PER, "per"));

  useEffect(() => { lsSet(LS_STMTS, { pro: proStmts, per: perStmts }); }, [proStmts, perStmts]);

  const catMap = useMemo(() => buildCatMap(categories), [categories]);

  const handleSaveCategories = (newCats, deletedName, reassignTo) => {
    if (deletedName && reassignTo) {
      const reassign = (stmts) => stmts.map(s => ({ ...s, transactions: s.transactions.map(t => ({ ...t, category: t.category === deletedName ? reassignTo : t.category, manualCategory: t.manualCategory === deletedName ? reassignTo : t.manualCategory })) }));
      setProStmts(reassign); setPerStmts(reassign);
    }
    setCategories(newCats);
    setShowCatManager(false);
  };

  const isPro = workspace === "professional";
  const eyebrow = isPro ? "Base X Studio" : "Otoabasi Bassey";
  const accountLabel = isPro ? "FNB Gold Business · 62821136365" : "FNB Personal Account";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --cream: #F8F6F2; --cream-card: #F1EDE6; --cream-border: rgba(0,0,0,0.07);
          --ink: #0D0B09; --ink-mid: #3D3A36; --ink-light: #7A756E; --ink-faint: #9A9590;
          --red: #E13540; --grad: linear-gradient(135deg, #E13540, #F27067);
          --charcoal: #252220; --r-sm: 8px; --r-md: 12px; --r-lg: 18px; --r-xl: 24px;
        }
        .dark {
          --cream: #141210; --cream-card: #1C1917; --cream-border: rgba(255,255,255,0.08);
          --ink: #F5F1ED; --ink-mid: #C4BDB6; --ink-light: #8A8279; --ink-faint: #6A6560; --charcoal: #2C2926;
        }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--cream-border); border-radius: 4px; }
        .cat-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 100px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; border: 1px solid var(--cream-border); background: var(--cream-card); color: var(--ink-mid); transition: all 0.15s; white-space: nowrap; }
        .cat-chip:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .cat-chip.active { color: white; border-color: transparent; }
        .tx-row { border-bottom: 1px solid var(--cream-border); transition: background 0.1s; }
        .tx-row:hover { background: var(--cream); }
        .tx-row:last-child { border-bottom: none; }
        .stat-card { background: var(--cream-card); border: 1px solid var(--cream-border); border-radius: var(--r-xl); box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .import-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--cream-card); border: 1.5px solid var(--cream-border); border-radius: 100px; padding: 8px 16px; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--ink-mid); transition: all 0.15s; }
        .import-btn:hover { border-color: var(--ink-light); color: var(--ink); }
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
        /* FAB import button */
        .fab-import {
          display: flex; align-items: center; justify-content: center;
          width: 48px; height: 48px; border-radius: 100px;
          background: linear-gradient(135deg, #E13540, #F27067);
          border: none; cursor: pointer; overflow: hidden;
          box-shadow: 0 4px 20px rgba(225,53,64,0.4);
          transition: width 0.3s cubic-bezier(0.4,0,0.2,1), background 0.25s ease, box-shadow 0.2s;
          white-space: nowrap; gap: 0;
        }
        .fab-import:hover {
          width: 168px;
          background: linear-gradient(135deg, #252220, #3D3A36);
          box-shadow: 0 6px 28px rgba(13,11,9,0.35);
          gap: 8px;
        }
        .fab-icon {
          font-size: 22px; font-weight: 300; color: white; line-height: 1;
          flex-shrink: 0;
        }
        .fab-label {
          font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 700;
          color: white; letter-spacing: 0.04em;
          max-width: 0; overflow: hidden; opacity: 0;
          transition: max-width 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s 0.1s;
          white-space: nowrap;
        }
        .fab-import:hover .fab-label { max-width: 120px; opacity: 1; }
        .ws-toggle { display: flex; align-items: center; background: transparent; border: 1.5px solid rgba(0,0,0,0.18); border-radius: 100px; padding: 3px; gap: 2px; }
        .ws-toggle-opt { padding: 5px 9px; border-radius: 100px; border: none; cursor: pointer; font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-weight: 700; letter-spacing: 0.05em; transition: all 0.2s; white-space: nowrap; line-height: 1; }
        .ws-toggle-opt.active { background: var(--cream-card); color: var(--ink); box-shadow: 0 0 0 1.5px var(--cream-border); }
        .ws-toggle-opt:not(.active) { background: transparent; color: var(--ink-faint); opacity: 0.5; }
        .ws-toggle-opt:not(.active):hover { opacity: 1; color: var(--ink-mid); }
      `}</style>

      <div className={dark ? "dark" : ""} style={{ background: "var(--cream)", minHeight: "100vh", padding: "48px 28px 80px", fontFamily: "'Inter', sans-serif", transition: "background 0.3s, color 0.3s" }}>

        {/* HEADER */}
        <div className="fade-up" style={{ marginBottom: 28 }}>
          {/* Meta line — cream pill */}
          <div style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 32, padding: "5px 12px", borderRadius: 100, background: "var(--cream-card)", border: "1px solid var(--cream-border)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.04em", color: "var(--ink-faint)" }}>
            <span style={{ color: "var(--red)", fontWeight: 700, textTransform: "uppercase" }}>{eyebrow}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{accountLabel}</span>
            <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
            <span>{(isPro ? proStmts : perStmts).reduce((s, st) => s + st.transactions.length, 0)} transactions</span>
          </div>

          {/* Title row — toggle right-aligned */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink)", lineHeight: 1 }}>Financial Overview</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* Workspace toggle — icons only */}
              <div className="ws-toggle">
                <button className={`ws-toggle-opt${isPro ? " active" : ""}`} onClick={() => setWorkspace("professional")} title="Professional">💼</button>
                <button className={`ws-toggle-opt${!isPro ? " active" : ""}`} onClick={() => setWorkspace("personal")} title="Personal">👤</button>
              </div>
              {/* Dark mode toggle — icons only */}
              <div className="ws-toggle">
                <button className={`ws-toggle-opt${!dark ? " active" : ""}`} onClick={() => setDark(false)} title="Light mode">☀️</button>
                <button className={`ws-toggle-opt${dark ? " active" : ""}`} onClick={() => setDark(true)} title="Dark mode">🌙</button>
              </div>
              {/* Category manager */}
              <button onClick={() => setShowCatManager(true)} title="Manage categories" style={{ background: "transparent", border: "1.5px solid rgba(0,0,0,0.18)", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", color: "var(--ink-faint)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>🗂️</button>
            </div>
          </div>
        </div>

        {/* PANEL — keyed so local state resets on workspace switch */}
        <DashboardPanel
          key={workspace}
          statements={isPro ? proStmts : perStmts}
          setStatements={isPro ? setProStmts : setPerStmts}
          categories={categories}
          catMap={catMap}
        />

        {showCatManager && <CategoryManager categories={categories} onSave={handleSaveCategories} onClose={() => setShowCatManager(false)} />}
      </div>
    </>
  );
}
