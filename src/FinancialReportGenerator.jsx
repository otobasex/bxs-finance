import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

/* ─── CONSTANTS ─── */
const FONTS = `https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;900&family=Noto+Serif:ital,wght@0,400;0,600;1,400&display=swap`;

const WORKSPACES = [
  { id: "professional", label: "Base X Studio", icon: "💼" },
  { id: "personal",     label: "Otoabasi Bassey", icon: "👤" },
];

// South African financial year: March → February
const FINANCIAL_YEARS = (() => {
  const years = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed, Jan=0, Mar=2
  // FY 2025/26 = Mar 2025 – Feb 2026.
  // In Apr 2026 (month=3, year=2026): we are in FY 2026/27 (Mar 2026 – Feb 2027), startYear=2026.
  // In Jan 2026 (month=0, year=2026): we are in FY 2025/26, startYear=2025 = year-1.
  // Rule: month >= 2 (Mar+) → startYear = currentYear; month < 2 → startYear = currentYear - 1.
  // But we label the FY by when it STARTS, and we want the most recent *completed* or current FY first.
  // Apr 2026 → currentFYStart = 2026 (Mar 2026 – Feb 2027, currently in progress)
  // The previous FY is 2025 (Mar 2025 – Feb 2026, completed).
  const baseFYStart = currentMonth >= 2 ? currentYear : currentYear - 1;
  // Generate 5 years going backwards from current
  for (let i = 0; i < 5; i++) {
    const startYear = baseFYStart - i;
    const endYear = startYear + 1;
    years.push({
      id: `${startYear}-${endYear}`,
      label: `FY ${startYear}/${endYear}`,
      startDate: new Date(startYear, 2, 1),   // 1 March
      endDate: new Date(endYear, 1, 28),       // 28 Feb
    });
  }
  return years;
})();

const CATEGORY_COLORS = {
  "Income":              "#22c55e",
  "Transfers Out":       "#E31A51",
  "Food & Delivery":     "#F27067",
  "Travel":              "#8b5cf6",
  "Utilities":           "#0ea5e9",
  "Airtime & Data":      "#f59e0b",
  "Subscriptions":       "#6366f1",
  "Savings & Investment":"#14b8a6",
  "Bank Fees":           "#94a3b8",
  "Shopping":            "#ec4899",
  "Rent":                "#a855f7",
  "Business":            "#3b82f6",
  "Other":               "#7A756E",
};

/* ─── HELPERS ─── */
const fmt = (n) => `R\u00A0${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtShort = (n) => n >= 1000 ? `R\u00A0${(n / 1000).toFixed(1)}k` : fmt(n);
const pct = (part, total) => total === 0 ? "0%" : `${((part / total) * 100).toFixed(1)}%`;

function getMonthLabel(date) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/* ─── AI NARRATIVE GENERATOR ─── */
async function generateNarrative({ entityName, workspace, fyLabel, summary, monthlyData, topCategories }) {
  const prompt = `You are a professional financial analyst preparing an annual financial summary for ${entityName} (${workspace === "professional" ? "a business" : "personal finances"}).

Financial Year: ${fyLabel}

Summary:
- Total Income: ${fmt(summary.income)}
- Total Expenditure: ${fmt(summary.spend)}
- Net Position: ${fmt(summary.net)} (${summary.net >= 0 ? "surplus" : "deficit"})
- Savings Rate: ${pct(summary.net, summary.income)}

Top expense categories:
${topCategories.slice(0, 6).map(([cat, amt]) => `- ${cat}: ${fmt(amt)} (${pct(amt, summary.spend)} of spend)`).join("\n")}

Monthly trend:
${monthlyData.map(m => `- ${m.label}: Income ${fmt(m.income)}, Spend ${fmt(m.spend)}`).join("\n")}

Write a professional financial narrative for this report. Include:
1. A 2-3 sentence executive summary of the year's financial performance
2. Key observations about spending patterns and trends
3. Notable strengths (if any) in income or savings
4. Areas for attention or improvement
5. A brief forward-looking note

Tone: Professional, clear, direct. South African context (Rands). No bullet points — write in flowing paragraphs. Use "the ${workspace === "professional" ? "business" : "account"}" as the subject. Do not invent numbers not provided. Keep to ~250-300 words.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    return data.content?.map(c => c.text || "").join("") || "Unable to generate narrative.";
  } catch {
    return "AI narrative unavailable. Please check your connection and try again.";
  }
}

/* ─── REPORT DATA BUILDER ─── */
function buildReportData(transactions, fyYear) {
  const { startDate, endDate } = fyYear;
  const filtered = transactions.filter(t => {
    const d = new Date(t.date);
    return d >= startDate && d <= new Date(endDate.getTime() + 86400000);
  });

  const income = filtered.filter(t => t.isCredit).reduce((s, t) => s + t.amount, 0);
  const spend  = filtered.filter(t => !t.isCredit).reduce((s, t) => s + t.amount, 0);
  const net    = income - spend;

  const byCategory = {};
  filtered.filter(t => !t.isCredit).forEach(t => {
    const cat = t.manualCategory || t.category;
    byCategory[cat] = (byCategory[cat] || 0) + t.amount;
  });
  const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  // Monthly breakdown (March to February)
  const monthlyMap = {};
  filtered.forEach(t => {
    const key = getMonthLabel(new Date(t.date));
    if (!monthlyMap[key]) monthlyMap[key] = { income: 0, spend: 0 };
    if (t.isCredit) monthlyMap[key].income += t.amount;
    else monthlyMap[key].spend += t.amount;
  });

  // Sort months chronologically
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyData = Object.entries(monthlyMap)
    .map(([label, data]) => ({ label, ...data }))
    .sort((a, b) => {
      const [aM, aY] = a.label.split(" "); const [bM, bY] = b.label.split(" ");
      if (aY !== bY) return parseInt(aY) - parseInt(bY);
      return MONTHS.indexOf(aM) - MONTHS.indexOf(bM);
    });

  return { filtered, income, spend, net, topCategories, monthlyData, byCategory };
}

/* ─── PRINT STYLES ─── */
const PRINT_CSS = `
  @media print {
    .no-print { display: none !important; }
    body { background: white !important; }
    .report-page { box-shadow: none !important; margin: 0 !important; padding: 32px !important; }
    .page-break { page-break-before: always; }
  }
  @page { size: A4; margin: 20mm; }
`;

/* ─── REPORT RENDERER ─── */
function ReportDocument({ entityName, workspace, fyLabel, reportData, narrative, generatedAt }) {
  const { income, spend, net, topCategories, monthlyData, filtered } = reportData;
  const savingsRate = income > 0 ? ((net / income) * 100).toFixed(1) : "0.0";
  const isPro = workspace === "professional";

  const barMax = Math.max(...monthlyData.map(m => Math.max(m.income, m.spend)), 1);

  return (
    <div className="report-page" style={{
      background: "white",
      maxWidth: 860,
      margin: "0 auto",
      padding: "48px 56px",
      fontFamily: "'Inter', sans-serif",
      color: "#0D0B09",
      boxShadow: "0 4px 40px rgba(0,0,0,0.08)",
      borderRadius: 16,
    }}>

      {/* ── COVER / HEADER ── */}
      <div style={{ marginBottom: 48, borderBottom: "2px solid #0D0B09", paddingBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#E13540", marginBottom: 8 }}>
              {isPro ? "Business · Financial Year Report" : "Personal · Financial Year Report"}
            </div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 36, fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", lineHeight: 1, color: "#0D0B09", marginBottom: 4 }}>
              {entityName}
            </div>
            <div style={{ fontFamily: "'Noto Serif', serif", fontSize: 16, color: "#7A756E", marginTop: 8 }}>
              Annual Financial Statement — {fyLabel}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#B8B3AC", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Generated</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#3D3A36", fontWeight: 600 }}>{generatedAt}</div>
            <div style={{ marginTop: 12, display: "inline-block", background: "linear-gradient(135deg, #E13540, #F27067)", borderRadius: 6, padding: "4px 10px" }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, color: "white", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {isPro ? "Base X Studio" : "Personal Account"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── SUMMARY KPIs ── */}
      <div style={{ marginBottom: 40 }}>
        <SectionLabel number="01" title="Financial Summary" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginTop: 20 }}>
          {[
            { label: "Total Income", value: fmtShort(income), color: "#22c55e", sub: `${filtered.filter(t => t.isCredit).length} credits` },
            { label: "Total Expenditure", value: fmtShort(spend), color: "#E13540", sub: `${filtered.filter(t => !t.isCredit).length} debits` },
            { label: net >= 0 ? "Net Surplus" : "Net Deficit", value: fmtShort(Math.abs(net)), color: net >= 0 ? "#22c55e" : "#E13540", sub: net >= 0 ? "Positive position" : "Negative position" },
            { label: "Savings Rate", value: `${savingsRate}%`, color: parseFloat(savingsRate) >= 20 ? "#22c55e" : parseFloat(savingsRate) >= 10 ? "#f59e0b" : "#E13540", sub: "of income retained" },
          ].map(({ label, value, color, sub }) => (
            <div key={label} style={{ background: "#FAF7F3", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 16, padding: "20px 20px 18px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "16px 16px 0 0" }} />
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7A756E", marginBottom: 10 }}>{label}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color, lineHeight: 1, marginBottom: 6 }}>{value}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#B8B3AC" }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── AI NARRATIVE ── */}
      {narrative && (
        <div style={{ marginBottom: 40, background: "#FAF8F5", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 16, padding: "28px 32px" }}>
          <SectionLabel number="02" title="Executive Summary" />
          <div style={{ fontFamily: "'Noto Serif', serif", fontSize: 14, lineHeight: 1.8, color: "#3D3A36", marginTop: 16, whiteSpace: "pre-line" }}>
            {narrative}
          </div>
        </div>
      )}

      {/* ── MONTHLY TREND ── */}
      {monthlyData.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <SectionLabel number={narrative ? "03" : "02"} title="Monthly Performance" />
          <div style={{ marginTop: 20, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                  {["Month", "Income", "Expenditure", "Net", "Bar"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Month" ? "left" : "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B8B3AC" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyData.map((m, i) => {
                  const mNet = m.income - m.spend;
                  const incomeBar = (m.income / barMax) * 100;
                  const spendBar = (m.spend / barMax) * 100;
                  return (
                    <tr key={m.label} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", background: i % 2 === 0 ? "transparent" : "#FAF7F3" }}>
                      <td style={{ padding: "10px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: "#3D3A36" }}>{m.label}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#22c55e" }}>{fmt(m.income)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#E13540" }}>{fmt(m.spend)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: mNet >= 0 ? "#22c55e" : "#E13540" }}>{mNet >= 0 ? "+" : ""}{fmt(mNet)}</td>
                      <td style={{ padding: "10px 12px", width: 100 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ height: 4, borderRadius: 2, background: "#22c55e", width: `${incomeBar}%`, opacity: 0.7 }} />
                          <div style={{ height: 4, borderRadius: 2, background: "#E13540", width: `${spendBar}%`, opacity: 0.7 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #0D0B09", background: "#FAF7F3" }}>
                  <td style={{ padding: "12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0D0B09" }}>TOTAL</td>
                  <td style={{ padding: "12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, color: "#22c55e" }}>{fmt(income)}</td>
                  <td style={{ padding: "12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, color: "#E13540" }}>{fmt(spend)}</td>
                  <td style={{ padding: "12px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, color: net >= 0 ? "#22c55e" : "#E13540" }}>{net >= 0 ? "+" : ""}{fmt(net)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── EXPENSE BREAKDOWN ── */}
      {topCategories.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <SectionLabel number={narrative ? "04" : "03"} title="Expenditure by Category" />
          <div style={{ marginTop: 20 }}>
            {topCategories.map(([cat, amt]) => {
              const color = CATEGORY_COLORS[cat] || "#7A756E";
              const barW = pct(amt, spend);
              return (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500, color: "#3D3A36" }}>{cat}</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#7A756E" }}>{barW}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, color: "#0D0B09", minWidth: 100, textAlign: "right" }}>{fmt(amt)}</span>
                    </div>
                  </div>
                  <div style={{ height: 5, background: "rgba(0,0,0,0.06)", borderRadius: 3 }}>
                    <div style={{ height: "100%", width: barW, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TRANSACTION LEDGER ── */}
      <div className="page-break" style={{ marginBottom: 40 }}>
        <SectionLabel number={narrative ? "05" : "04"} title="Full Transaction Ledger" />
        <div style={{ marginTop: 20, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#FAF7F3", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                {["Date","Description","Category","Type","Amount"].map((h, i) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: i >= 3 ? "right" : "left", fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B8B3AC" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...filtered].sort((a, b) => new Date(a.date) - new Date(b.date)).map((t, i) => {
                const cat = t.manualCategory || t.category;
                const color = CATEGORY_COLORS[cat] || "#7A756E";
                return (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                    <td style={{ padding: "7px 10px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#7A756E", whiteSpace: "nowrap" }}>{t.dateStr}</td>
                    <td style={{ padding: "7px 10px", fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#3D3A36", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ background: color + "18", color, padding: "2px 8px", borderRadius: 100, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 600, whiteSpace: "nowrap" }}>{cat}</span>
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: t.isCredit ? "#22c55e" : "#E13540", fontWeight: 700 }}>{t.isCredit ? "CR" : "DR"}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: t.isCredit ? "#22c55e" : "#E13540", whiteSpace: "nowrap" }}>{t.isCredit ? "+" : "−"}{fmt(t.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ marginTop: 48, paddingTop: 20, borderTop: "1px solid rgba(0,0,0,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#B8B3AC", letterSpacing: "0.06em" }}>
          {entityName} · {fyLabel} · Confidential
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#B8B3AC" }}>
          Generated {generatedAt} · {filtered.length} transactions
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ number, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: "#E13540", letterSpacing: "0.1em" }}>{number}</span>
      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#0D0B09" }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function FinancialReportGenerator({ session }) {
  const [workspace, setWorkspace]     = useState("professional");
  const [fyYear, setFyYear]           = useState(FINANCIAL_YEARS[0]);
  const [allTransactions, setAllTxs]  = useState([]);
  const [loading, setLoading]         = useState(false);
  const [reportData, setReportData]   = useState(null);
  const [narrative, setNarrative]     = useState("");
  const [narLoading, setNarLoading]   = useState(false);
  const [generated, setGenerated]     = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const reportRef = useRef(null);

  const ws = WORKSPACES.find(w => w.id === workspace);
  const entityName = ws?.label || workspace;

  // Load all transactions for the workspace
  useEffect(() => {
    if (!session?.user) return;
    const load = async () => {
      setLoading(true);
      const { data: stmts } = await supabase.from("statements").select("id").eq("user_id", session.user.id).eq("workspace", workspace);
      if (!stmts?.length) { setAllTxs([]); setLoading(false); return; }
      const stmtIds = stmts.map(s => s.id);
      const { data: txs } = await supabase.from("transactions").select("*").in("statement_id", stmtIds).order("date");
      const parsed = (txs || []).map(t => ({
        ...t, id: t.local_id,
        date: new Date(t.date),
        dateStr: t.date_str,
        isCredit: t.is_credit,
        manualCategory: t.manual_category,
        aiCategorised: t.ai_categorised,
      }));
      setAllTxs(parsed);
      setLoading(false);
    };
    load();
    setGenerated(false); setReportData(null); setNarrative("");
  }, [workspace, session]);

  const handleGenerate = async () => {
    const data = buildReportData(allTransactions, fyYear);
    setReportData(data);
    setGenerated(true);
    setGeneratedAt(new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" }));

    // Generate AI narrative
    setNarLoading(true);
    const nar = await generateNarrative({
      entityName, workspace, fyLabel: fyYear.label,
      summary: { income: data.income, spend: data.spend, net: data.net },
      monthlyData: data.monthlyData,
      topCategories: data.topCategories,
    });
    setNarrative(nar);
    setNarLoading(false);
  };

  const handlePrint = () => window.print();

  const handleExportHTML = () => {
    const html = reportRef.current?.outerHTML;
    if (!html) return;
    const full = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${entityName} — ${fyYear.label}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="${FONTS}" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #FDF8F5; padding: 40px 20px; font-family: 'Inter', sans-serif; }
    ${PRINT_CSS}
  </style>
</head>
<body>${html}</body>
</html>`;
    const blob = new Blob([full], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${entityName.replace(/\s+/g, "_")}_${fyYear.id}_Report.html`;
    a.click();
  };

  const inFY = allTransactions.filter(t => {
    const d = new Date(t.date);
    return d >= fyYear.startDate && d <= new Date(fyYear.endDate.getTime() + 86400000);
  });

  return (
    <>
      <style>{`
        @import url('${FONTS}');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #FDF8F5; }
        ${PRINT_CSS}
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.4s ease both; }
        .btn-grad { background: linear-gradient(135deg, #E13540, #F27067); color: white; border: none; border-radius: 100px; padding: 11px 24px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 12px rgba(225,53,64,0.3); transition: all 0.15s; }
        .btn-grad:hover { opacity: 0.9; transform: translateY(-1px); }
        .btn-grad:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .btn-outline { background: transparent; color: #3D3A36; border: 1.5px solid rgba(0,0,0,0.1); border-radius: 100px; padding: 10px 20px; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .btn-outline:hover { border-color: rgba(0,0,0,0.2); background: rgba(0,0,0,0.02); }
        .ws-btn { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 14px; border: 1.5px solid rgba(0,0,0,0.08); background: #FAF7F3; cursor: pointer; transition: all 0.15s; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; color: #3D3A36; }
        .ws-btn.active { border-color: #E13540; background: rgba(225,53,64,0.05); color: #E13540; font-weight: 700; }
        .ws-btn:hover:not(.active) { border-color: rgba(0,0,0,0.15); }
        select { appearance: none; padding: 10px 36px 10px 14px; background: #FAF7F3 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%237A756E' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E") no-repeat right 12px center; border: 1px solid rgba(0,0,0,0.1); border-radius: 10px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #3D3A36; cursor: pointer; outline: none; }
        select:focus { border-color: rgba(225,53,64,0.4); }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#FDF8F5", padding: "40px 24px 80px", fontFamily: "'Inter', sans-serif" }}>

        {/* ── HEADER ── */}
        <div className="no-print" style={{ maxWidth: 860, margin: "0 auto 32px" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#E13540", marginBottom: 8 }}>Financial Reports</div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 28, fontWeight: 900, letterSpacing: "-0.01em", textTransform: "uppercase", color: "#0D0B09", marginBottom: 4 }}>
            Year-End Report Generator
          </div>
          <div style={{ fontFamily: "'Noto Serif', serif", fontSize: 14, color: "#7A756E" }}>
            Generate professional financial statements for filing, reporting, and year-end review.
          </div>
        </div>

        {/* ── CONTROLS ── */}
        <div className="no-print fade-up" style={{ maxWidth: 860, margin: "0 auto 32px", background: "#FAF7F3", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 20, padding: "28px 32px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>

            {/* Workspace */}
            <div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#B8B3AC", marginBottom: 12 }}>Account</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {WORKSPACES.map(w => (
                  <button key={w.id} className={`ws-btn${workspace === w.id ? " active" : ""}`} onClick={() => setWorkspace(w.id)}>
                    <span style={{ fontSize: 18 }}>{w.icon}</span>
                    <div>
                      <div style={{ fontSize: 13 }}>{w.label}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#B8B3AC", fontWeight: 400 }}>{w.id === "professional" ? "Business account" : "Personal account"}</div>
                    </div>
                    {workspace === w.id && <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "#E13540" }} />}
                  </button>
                ))}
              </div>
            </div>

            {/* FY + Stats */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#B8B3AC", marginBottom: 12 }}>Financial Year (March – February)</div>
                <select value={fyYear.id} onChange={e => setFyYear(FINANCIAL_YEARS.find(f => f.id === e.target.value))}>
                  {FINANCIAL_YEARS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>

              {/* Quick stats */}
              <div style={{ background: "white", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: "14px 16px" }}>
                {loading ? (
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#B8B3AC" }}>Loading transactions…</div>
                ) : (
                  <>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B8B3AC", marginBottom: 10 }}>Available Data</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {[
                        { label: "All transactions", value: allTransactions.length },
                        { label: `In ${fyYear.label}`, value: inFY.length },
                        { label: "Credits", value: inFY.filter(t => t.isCredit).length },
                        { label: "Debits", value: inFY.filter(t => !t.isCredit).length },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#B8B3AC", marginBottom: 2 }}>{label}</div>
                          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 700, color: value === 0 ? "#B8B3AC" : "#E13540" }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    {inFY.length === 0 && (
                      <div style={{ marginTop: 10, fontFamily: "'Noto Serif', serif", fontSize: 12, color: "#7A756E", fontStyle: "italic" }}>
                        No transactions found for this period. Import statements from your dashboard first.
                      </div>
                    )}
                  </>
                )}
              </div>

              <button
                className="btn-grad"
                onClick={handleGenerate}
                disabled={loading || inFY.length === 0}
              >
                {loading ? "Loading…" : `Generate Report — ${fyYear.label}`}
              </button>
            </div>
          </div>
        </div>

        {/* ── REPORT OUTPUT ── */}
        {generated && reportData && (
          <div className="fade-up" style={{ maxWidth: 860, margin: "0 auto" }}>

            {/* Action bar */}
            <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#7A756E", marginRight: "auto" }}>
                {reportData.filtered.length} transactions · {entityName} · {fyYear.label}
              </div>
              {narLoading && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#6366f1" }}>
                  <div style={{ width: 12, height: 12, border: "2px solid rgba(99,102,241,0.25)", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                  Generating AI narrative…
                </div>
              )}
              <button className="btn-outline" onClick={handleExportHTML}>⬇ Export HTML</button>
              <button className="btn-grad" onClick={handlePrint}>🖨 Print / Save PDF</button>
            </div>

            {/* Report */}
            <div ref={reportRef}>
              <ReportDocument
                entityName={entityName}
                workspace={workspace}
                fyLabel={fyYear.label}
                reportData={reportData}
                narrative={narrative}
                generatedAt={generatedAt}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
