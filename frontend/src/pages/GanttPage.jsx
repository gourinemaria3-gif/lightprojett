import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { fetchProjects, fetchStats, fetchMembers } from "../services/api";

// ─────────────────────────────────────────────────────────────────────────────
//  Palette — identique au Dashboard
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  green: "#9FB878", greenLight: "#f5f6ec", greenMid: "#dfe0c0", greenDark: "#5a6332",
  pink: "#d4538a", pinkLight: "#fce7f3", pinkMid: "#f4b8d4", pinkDark: "#7d1f52",
  orange: "#d4874a", orangeLight: "#fef3e8",
  blue: "#5a8ac4", blueLight: "#eaf2fb",
  red: "#b23a3a", redLight: "#fdecea",
  bg: "#f6f6f2", card: "#ffffff",
  text: "#2d2d2a", textMuted: "#6e6e68", textLight: "#aaaaaa",
  border: "#e8e8e0",
  shadow: "0 2px 8px rgba(0,0,0,0.05)",
  shadowMd: "0 4px 16px rgba(0,0,0,0.07)",
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

function taskStatus(t) {
  if (t.done) return "done";
  if (t.late) return "late";
  const s = (t.status || "").toLowerCase();
  if (s.includes("progress") || s.includes("cours")) return "progress";
  return "todo";
}

function diffDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateShort(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function getRange(tasks) {
  const dates = tasks.flatMap(t => [t.startDate, t.dueDate]).filter(Boolean).map(d => new Date(d));
  if (!dates.length) {
    const n = new Date();
    return { min: n, max: new Date(n.getTime() + 90 * 86400000) };
  }
  const mn = new Date(Math.min(...dates));
  const mx = new Date(Math.max(...dates));
  mn.setDate(mn.getDate() - 5);
  mx.setDate(mx.getDate() + 10);
  return { min: mn, max: mx };
}

function getMonthGroups(min, max) {
  const groups = [];
  let cur = new Date(min.getFullYear(), min.getMonth(), 1);
  while (cur <= max) {
    const start = new Date(Math.max(cur, min));
    const endOfMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const end = new Date(Math.min(endOfMonth, max));
    groups.push({
      label: cur.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
      days: diffDays(start, end) + 1,
    });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return groups;
}

function getDayLabels(min, max) {
  const days = [];
  const d = new Date(min);
  while (d <= max) {
    days.push({ day: d.getDate(), isWeekend: d.getDay() === 0 || d.getDay() === 6 });
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Config statut & type
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  done:     { label: "Terminée",  color: C.green,   bg: C.greenLight, text: C.greenDark },
  late:     { label: "En retard", color: C.red,     bg: C.redLight,   text: C.red },
  progress: { label: "En cours",  color: C.blue,    bg: C.blueLight,  text: C.blue },
  todo:     { label: "À faire",   color: "#b4b2a9", bg: "#f1efe8",    text: C.textMuted },
};

const TYPE_CONFIG = {
  milestone: { label: "MILESTONE",    color: C.green,    bg: C.greenLight },
  summary:   { label: "SUMMARY TASK", color: C.orange,   bg: C.orangeLight },
  bug:       { label: "BUG",          color: C.red,      bg: C.redLight },
  story:     { label: "USER STORY",   color: C.blue,     bg: C.blueLight },
  task:      { label: "TASK",         color: C.textMuted, bg: "#f1efe8" },
};

function getTaskType(t) {
  const type = (t.type || "").toLowerCase();
  if (type.includes("milestone")) return "milestone";
  if (type.includes("summary"))   return "summary";
  if (type.includes("bug"))       return "bug";
  if (type.includes("story"))     return "story";
  return "task";
}

const DAY_PX = { week: 28, month: 14, quarter: 6 };
const ROW_H  = 50;
const LEFT_W = 300;

// ─────────────────────────────────────────────────────────────────────────────
//  Composant principal
// ─────────────────────────────────────────────────────────────────────────────
export default function GanttPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const isAdminOrManager = user.isAdmin || user.role === "manager";

  const [projects, setProjects]       = useState([]);
  const [selectedId, setSelectedId]   = useState(null);
  const [allTasks, setAllTasks]       = useState([]);
  const [members, setMembers]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [loadingProj, setLoadingProj] = useState(true);
  const [error, setError]             = useState(null);
  const [zoom, setZoom]               = useState("month");
  const [filter, setFilter]           = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [search, setSearch]           = useState("");
  const [tooltip, setTooltip]         = useState(null);
  const [tooltipPos, setTooltipPos]   = useState({ x: 0, y: 0 });
  const [showDeps, setShowDeps]       = useState(true);

  const headerScrollRef = useRef(null);
  const bodyScrollRef   = useRef(null);
  const svgRef          = useRef(null);

  // ── Charger projets + membres ──────────────────────────────────────────────
  useEffect(() => {
    Promise.all([fetchProjects(), isAdminOrManager ? fetchMembers() : Promise.resolve([])])
      .then(([list, mems]) => {
        setProjects(list || []);
        setMembers(mems || []);
        if (list?.length) setSelectedId(list[0].id);
      })
      .catch(() => setError("Impossible de charger les projets."))
      .finally(() => setLoadingProj(false));
  }, []);

  // ── Charger stats/Gantt ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true); setError(null); setAllTasks([]);
    fetchStats(selectedId)
      .then(data => setAllTasks(data?.ganttTasks || []))
      .catch(() => setError("Erreur de chargement des tâches."))
      .finally(() => setLoading(false));
  }, [selectedId]);

  // ── Auto-scroll vers aujourd'hui ───────────────────────────────────────────
  useEffect(() => {
    if (!bodyScrollRef.current || !allTasks.length) return;
    setTimeout(() => {
      const { min } = getRange(allTasks);
      const px = DAY_PX[zoom] || 14;
      const off = Math.max(0, diffDays(min, new Date()) * px - 300);
      if (bodyScrollRef.current) bodyScrollRef.current.scrollLeft = off;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = off;
    }, 150);
  }, [allTasks, zoom]);

  // ── Sync scroll header ↔ body ──────────────────────────────────────────────
  const onBodyScroll = useCallback(e => {
    if (headerScrollRef.current)
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }, []);

  // ── Filtrage ───────────────────────────────────────────────────────────────
  const filteredTasks = useCallback(() => {
    let tasks = allTasks;
    // Membre : ne voit que ses tâches
    if (!isAdminOrManager) {
      tasks = tasks.filter(t =>
        (t.assignee || "").toLowerCase() === (user.name || "").toLowerCase()
      );
    } else if (memberFilter !== "all") {
      tasks = tasks.filter(t =>
        (t.assignee || "").toLowerCase() === memberFilter.toLowerCase()
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      tasks = tasks.filter(t =>
        (t.subject || "").toLowerCase().includes(q) ||
        (t.assignee || "").toLowerCase().includes(q)
      );
    }
    if (filter !== "all") tasks = tasks.filter(t => taskStatus(t) === filter);
    return tasks;
  }, [allTasks, filter, memberFilter, search, isAdminOrManager, user.name]);

  // ── Stats KPI ──────────────────────────────────────────────────────────────
  const total    = allTasks.length;
  const done     = allTasks.filter(t => t.done).length;
  const late     = allTasks.filter(t => t.late && !t.done).length;
  const progress = allTasks.filter(t => taskStatus(t) === "progress").length;
  const pct      = total ? Math.round((done / total) * 100) : 0;

  // ── Export PDF ─────────────────────────────────────────────────────────────
  function exportPDF() {
    const tasks = filteredTasks();
    const proj  = projects.find(p => String(p.id) === String(selectedId));
    const projName = proj?.name || "Projet";
    const today = new Date().toLocaleDateString("fr-FR");
    if (!tasks.length) { alert("Aucune tâche à exporter."); return; }

    const { min, max } = getRange(tasks);
    const totalDays = diffDays(min, max) + 1;
    const pxPdf = Math.min(12, Math.max(4, Math.floor(900 / totalDays)));
    const months = getMonthGroups(min, max);
    const days   = getDayLabels(min, max);
    const todayOff = diffDays(min, new Date());

    const tableRows = tasks.map((t, i) => {
      const st = taskStatus(t);
      const sc = STATUS_CONFIG[st];
      const tc = TYPE_CONFIG[getTaskType(t)];
      const pctVal = t.done ? 100 : (t.percentageDone || 0);
      const latedays = t.late && !t.done
        ? Math.max(1, Math.ceil((Date.now() - new Date(t.dueDate).getTime()) / 86400000))
        : null;
      return `<tr style="background:${i%2===0?"#fff":"#fafaf8"}">
        <td style="color:#aaa;font-size:9px;text-align:center">${t.id||i+1}</td>
        <td><span style="background:${tc.bg};color:${tc.color};padding:1px 6px;border-radius:3px;font-size:8px;font-weight:700">${tc.label}</span></td>
        <td style="font-weight:600;font-size:10px">${t.subject||"—"}</td>
        <td style="font-size:10px">${t.assignee||"—"}</td>
        <td style="font-size:10px;text-align:center">${formatDate(t.startDate)}</td>
        <td style="font-size:10px;text-align:center">${formatDate(t.dueDate)}</td>
        <td style="font-size:10px;text-align:center">${t.hours?t.hours+"h":"—"}</td>
        <td style="font-size:10px;text-align:center">${t.priority||"—"}</td>
        <td style="text-align:center">
          <div style="background:#eee;border-radius:3px;height:5px;width:50px;display:inline-block;overflow:hidden;vertical-align:middle">
            <div style="width:${pctVal}%;height:100%;background:${sc.color}"></div>
          </div>
          <span style="font-size:9px;color:#666;margin-left:3px">${pctVal}%</span>
        </td>
        <td><span style="background:${sc.bg};color:${sc.text};padding:1px 8px;border-radius:999px;font-size:9px;font-weight:700">${sc.label}</span></td>
        <td style="color:${latedays?"#b23a3a":"#ccc"};font-weight:${latedays?700:400};font-size:10px;text-align:center">${latedays?`⚠ ${latedays}j`:"—"}</td>
      </tr>`;
    }).join("");

    const ganttHeaderM = months.map(m =>
      `<th colspan="${m.days}" style="background:#f6f6f2;padding:3px 4px;font-size:8px;color:#5a6332;border:1px solid #e8e8e0;text-align:center;font-weight:700;white-space:nowrap">${m.label}</th>`
    ).join("");

    const ganttHeaderD = days.map(d =>
      `<th style="background:${d.isWeekend?"#f0f0e8":"#fff"};width:${pxPdf}px;min-width:${pxPdf}px;padding:1px 0;font-size:7px;color:${d.isWeekend?"#ccc":"#aaa"};border:1px solid #eee;text-align:center">${d.day}</th>`
    ).join("");

    const ganttRows = tasks.map((t, i) => {
      const st = taskStatus(t);
      const sc = STATUS_CONFIG[st];
      const isMilestone = getTaskType(t) === "milestone";
      const s = new Date(t.startDate || t.dueDate);
      const e = new Date(t.dueDate   || t.startDate);
      const leftOff = diffDays(min, s);
      const dur = Math.max(1, diffDays(s, e) + 1);
      const pctVal = t.done ? 100 : (t.percentageDone || 0);

      const cells = days.map((d, di) => {
        const inBar  = di >= leftOff && di < leftOff + dur;
        const isStart = di === leftOff;
        const isEnd   = di === leftOff + dur - 1;
        const isToday = di === todayOff;
        const todayBorder = isToday ? "border-left:2px solid #d4874a;" : "";
        const bg = d.isWeekend ? "#f5f4ef" : "transparent";
        let content = "";
        if (isMilestone && di === leftOff) {
          content = `<div style="text-align:center;color:${sc.color};font-size:10px;line-height:14px">◆</div>`;
        } else if (inBar) {
          const r = isStart && isEnd ? "3px" : isStart ? "3px 0 0 3px" : isEnd ? "0 3px 3px 0" : "0";
          content = `<div style="height:10px;background:${sc.color}30;border-radius:${r};overflow:hidden">
            <div style="height:100%;width:${pctVal}%;background:${sc.color};border-radius:${r}"></div>
          </div>`;
        }
        return `<td style="padding:1px;${todayBorder}background:${bg};border:1px solid #f0f0e8">${content}</td>`;
      }).join("");

      return `<tr style="background:${i%2===0?"#fff":"#fafaf8"}">
        <td style="padding:3px 6px;font-size:9px;font-weight:600;white-space:nowrap;max-width:140px;overflow:hidden;border-right:1px solid #e8e8e0">${t.subject||"—"}</td>
        ${cells}
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <title>Gantt — ${projName}</title>
    <style>
      @page{margin:14mm 10mm;size:A3 landscape}
      *{box-sizing:border-box}
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#2d2d2a;margin:0}
      .pb{page-break-before:always}
      .hdr{border-bottom:3px solid #9FB878;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end}
      .hdr h1{font-size:20px;font-weight:800;color:#5a6332;margin:0 0 2px}
      .hdr p{font-size:9px;color:#888;margin:0}
      .kpis{display:flex;gap:8px;margin-bottom:14px}
      .kpi{flex:1;background:#f6f6f2;border-radius:8px;padding:8px 12px;border:1px solid #e8e8e0}
      .kpi-v{font-size:22px;font-weight:800}
      .kpi-l{font-size:8px;color:#888;margin-top:1px;text-transform:uppercase;letter-spacing:0.5px}
      h2{font-size:11px;font-weight:700;color:#5a6332;margin:16px 0 6px;border-left:3px solid #9FB878;padding-left:7px}
      table{width:100%;border-collapse:collapse}
      th{background:#f6f6f2;padding:5px 8px;text-align:left;font-size:8px;color:#6e6e68;border:1px solid #e8e8e0;text-transform:uppercase;letter-spacing:0.4px}
      td{padding:5px 7px;border-bottom:1px solid #f5f5ee;vertical-align:middle}
      .footer{margin-top:14px;font-size:8px;color:#aaa;text-align:center;border-top:1px solid #e8e8e0;padding-top:8px}
      .legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px}
      .leg-item{display:flex;align-items:center;gap:5px;font-size:8px;color:#666}
    </style></head><body>
    <div class="hdr">
      <div>
        <h1>🐝 Diagramme de Gantt — ${projName}</h1>
        <p>Exporté le ${today} · LightProject · ${tasks.length} tâche(s)</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;color:#5a6332;font-weight:800">${pct}% complété</div>
        <div style="background:#e8e8e0;border-radius:999px;height:7px;width:100px;margin-top:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:#9FB878;border-radius:999px"></div>
        </div>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-v">${total}</div><div class="kpi-l">Total</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#5a6332">${done}</div><div class="kpi-l">Terminées</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#b23a3a">${late}</div><div class="kpi-l">En retard</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#5a8ac4">${progress}</div><div class="kpi-l">En cours</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#888">${total-done-late-progress}</div><div class="kpi-l">À faire</div></div>
    </div>
    <h2>📋 Tableau détaillé</h2>
    <table>
      <thead><tr>
        <th style="text-align:center">#</th><th>Type</th><th>Sujet</th><th>Assigné à</th>
        <th style="text-align:center">Début</th><th style="text-align:center">Fin prévue</th>
        <th style="text-align:center">Estim.</th><th style="text-align:center">Priorité</th>
        <th style="text-align:center">Avancement</th><th>Statut</th><th style="text-align:center">Retard</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="pb"></div>
    <div class="hdr">
      <div><h1>📊 Planning visuel — ${projName}</h1><p>${today}</p></div>
    </div>
    <table style="table-layout:fixed">
      <thead>
        <tr><th style="width:140px;border:1px solid #e8e8e0">TÂCHE</th>${ganttHeaderM}</tr>
        <tr><th style="border:1px solid #e8e8e0"></th>${ganttHeaderD}</tr>
      </thead>
      <tbody>${ganttRows}</tbody>
    </table>
    <div class="legend">
      ${Object.entries(STATUS_CONFIG).map(([,sc]) =>
        `<div class="leg-item"><div style="width:12px;height:7px;border-radius:2px;background:${sc.color}"></div>${sc.label}</div>`
      ).join("")}
      <div class="leg-item"><div style="width:8px;height:8px;background:#9FB878;transform:rotate(45deg)"></div>Milestone</div>
      <div class="leg-item"><div style="width:2px;height:10px;background:#d4874a"></div>Aujourd'hui</div>
    </div>
    <div class="footer">🐝 LightProject · Rapport Gantt · ${today}</div>
    </body></html>`;

    const w = window.open("", "_blank");
    if (!w) { alert("Autorise les popups pour exporter en PDF."); return; }
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Calculs Gantt
  // ─────────────────────────────────────────────────────────────────────────
  const tasks     = filteredTasks();
  const px        = DAY_PX[zoom] || 14;
  const { min, max } = tasks.length ? getRange(tasks) : getRange([]);
  const totalDays  = diffDays(min, max) + 1;
  const totalWidth = totalDays * px;
  const todayOff   = diffDays(min, new Date()) * px;
  const months     = getMonthGroups(min, max);
  const dayLabels  = getDayLabels(min, max);

  // Index position des barres pour dessiner les flèches
  const barPositions = {};
  tasks.forEach((t, idx) => {
    const s    = new Date(t.startDate || t.dueDate);
    const e    = new Date(t.dueDate   || t.startDate);
    const left = diffDays(min, s) * px;
    const dur  = Math.max(1, diffDays(s, e) + 1);
    barPositions[t.id] = {
      left,
      width: dur * px,
      top:   idx * ROW_H + ROW_H / 2,
    };
  });

  // Construire les flèches : on cherche dans les tâches si t.dependsOn[] existe
  const arrows = [];
  if (showDeps) {
    tasks.forEach(t => {
      if (!t.dependsOn?.length) return;
      t.dependsOn.forEach(dep => {
        const from = barPositions[dep.taskId];
        const to   = barPositions[t.id];
        if (!from || !to) return;
        const x1 = from.left + from.width;
        const y1 = from.top;
        const x2 = to.left;
        const y2 = to.top;
        arrows.push({ x1, y1, x2, y2, blocked: t.isBlocked });
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Sidebar nav — identique au Dashboard
  // ─────────────────────────────────────────────────────────────────────────
  const navItems = [
    { label: "Dashboard",   path: "/dashboard" },
    { label: "Mes projets", path: "/projets" },
    { label: "Mes tâches",  path: "/taches" },
    { label: "Gantt",       path: "/gantt", active: true },
  ];

  const card = (extra = {}) => ({
    background: C.card, borderRadius: "18px", padding: "20px",
    border: `1px solid ${C.border}`, boxShadow: C.shadow, ...extra,
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', Arial, sans-serif" }}>

      {/* ── SIDEBAR ── */}
      <aside style={{ background: "#fff", borderRight: `1px solid ${C.border}`, padding: "24px 0", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "sticky", top: 0, height: "100vh", overflowY: "auto", boxShadow: "2px 0 8px rgba(0,0,0,0.03)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 20px 28px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", boxShadow: `0 2px 8px ${C.greenMid}` }}>🐝</div>
            <span style={{ fontSize: "16px", fontWeight: "700", color: C.text }}>lightproject</span>
          </div>
          <div style={{ padding: "0 12px" }}>
            {navItems.map(item => (
              <div key={item.path} onClick={() => navigate(item.path)}
                style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", cursor: "pointer", marginBottom: "3px",
                  color: item.active ? C.greenDark : C.textMuted,
                  background: item.active ? C.greenLight : "transparent",
                  fontWeight: item.active ? "600" : "400",
                  borderLeft: item.active ? `3px solid ${C.green}` : "3px solid transparent",
                  transition: "all 0.15s" }}>
                {item.label}
              </div>
            ))}
          </div>
          <div style={{ height: "1px", background: C.border, margin: "16px" }} />
          <div style={{ padding: "0 12px" }}>
            <p style={{ fontSize: "10px", color: C.textLight, textTransform: "uppercase", letterSpacing: "1px", padding: "0 14px", margin: "0 0 6px" }}>Compte</p>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.textMuted, cursor: "pointer", marginBottom: "2px" }} onClick={() => navigate("/profil")}>Mon profil</div>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.textMuted, cursor: "pointer", marginBottom: "2px" }} onClick={() => navigate("/notifications")}>⚙️ Notifications</div>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.pink, cursor: "pointer", fontWeight: "500" }}
              onClick={() => { localStorage.removeItem("jwt"); localStorage.removeItem("user"); navigate("/"); }}>
              Déconnexion
            </div>
          </div>
        </div>
        <div style={{ margin: "0 16px" }}>
          <div style={{ background: C.greenLight, borderRadius: "14px", padding: "12px", display: "flex", alignItems: "center", gap: "10px", border: `1px solid ${C.greenMid}` }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: "700", color: "#fff", flexShrink: 0 }}>
              {user.name?.charAt(0)?.toUpperCase() || "A"}
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: "600", color: C.text, margin: 0 }}>{user.name || "Admin"}</p>
              <p style={{ fontSize: "11px", color: C.textMuted, margin: 0 }}>{user.isAdmin ? "Administrateur" : "Membre"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ padding: "28px", overflowY: "auto", overflowX: "hidden" }}>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: C.text, margin: 0 }}>Diagramme de Gantt 📊</h1>
            <p style={{ fontSize: "12px", color: C.textMuted, margin: "4px 0 0" }}>
              {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · Vue planning
            </p>
          </div>
          <button onClick={exportPDF} disabled={!allTasks.length}
            style={{ background: C.green, color: "#fff", border: "none", padding: "10px 22px", borderRadius: "999px", fontSize: "13px", fontWeight: "600", cursor: allTasks.length ? "pointer" : "not-allowed", opacity: allTasks.length ? 1 : 0.5, boxShadow: `0 3px 10px ${C.greenMid}`, transition: "all 0.2s" }}>
            ⬇ Exporter PDF
          </button>
        </div>

        {/* KPI CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "12px", marginBottom: "20px" }}>
          {[
            { label: "Total",            val: total,    color: C.text,    bg: "#fff" },
            { label: `Terminées (${pct}%)`, val: done,  color: C.greenDark, bg: C.greenLight },
            { label: "En retard",         val: late,    color: C.red,     bg: C.redLight },
            { label: "En cours",          val: progress, color: C.blue,   bg: C.blueLight },
            { label: "À faire",           val: total - done - late - progress, color: C.textMuted, bg: "#f1efe8" },
          ].map((k, i) => (
            <div key={i} style={{ ...card({ padding: "18px", background: k.bg }) }}>
              <p style={{ fontSize: "10px", color: k.color, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 8px" }}>{k.label}</p>
              <p style={{ fontSize: "28px", fontWeight: "700", color: k.color, margin: 0 }}>{k.val}</p>
            </div>
          ))}
        </div>

        {/* PROGRESSION GLOBALE */}
        {total > 0 && (
          <div style={{ ...card({ padding: "14px 20px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "14px" }) }}>
            <span style={{ fontSize: "11px", fontWeight: "600", color: C.textMuted, whiteSpace: "nowrap" }}>Progression globale</span>
            <div style={{ flex: 1, height: "6px", background: C.greenLight, borderRadius: "999px", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: C.green, borderRadius: "999px", transition: "width 0.6s ease" }} />
            </div>
            <span style={{ fontSize: "13px", fontWeight: "700", color: C.greenDark, minWidth: "36px", textAlign: "right" }}>{pct}%</span>
          </div>
        )}

        {/* TOOLBAR */}
        <div style={{ ...card({ padding: "14px 16px", marginBottom: "14px" }) }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px", justifyContent: "space-between" }}>

            {/* Projet */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: C.textMuted, whiteSpace: "nowrap" }}>Projet :</span>
              <select value={selectedId || ""} onChange={e => setSelectedId(Number(e.target.value))} disabled={loadingProj}
                style={{ fontSize: "13px", padding: "6px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "#fff", color: C.text, cursor: "pointer", fontWeight: "500", outline: "none", maxWidth: "200px" }}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name || `Projet #${p.id}`}</option>)}
              </select>
            </div>

            {/* Zoom */}
            <div style={{ display: "flex", gap: "5px" }}>
              {[["week","Semaine"],["month","Mois"],["quarter","Trimestre"]].map(([z, label]) => (
                <button key={z} onClick={() => setZoom(z)} style={{ padding: "5px 13px", borderRadius: "999px", fontSize: "12px", cursor: "pointer", border: `1px solid ${zoom === z ? C.greenMid : C.border}`, background: zoom === z ? C.greenLight : "#fff", color: zoom === z ? C.greenDark : C.textMuted, fontWeight: zoom === z ? "600" : "400", transition: "all 0.15s" }}>{label}</button>
              ))}
            </div>

            {/* Filtres statut */}
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {[["all","Toutes"],["late","⚠ Retard"],["progress","En cours"],["done","Terminées"],["todo","À faire"]].map(([f, label]) => (
                <button key={f} onClick={() => setFilter(f)} style={{ padding: "4px 11px", borderRadius: "999px", fontSize: "11px", cursor: "pointer", border: `1px solid ${filter === f ? C.greenMid : C.border}`, background: filter === f ? C.greenLight : "transparent", color: filter === f ? C.greenDark : C.textMuted, fontWeight: filter === f ? "600" : "400", transition: "all 0.15s" }}>{label}</button>
              ))}
            </div>

            {/* Filtre membre (admin/manager seulement) */}
            {isAdminOrManager && members.length > 0 && (
              <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}
                style={{ fontSize: "12px", padding: "5px 10px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "#fff", color: C.text, outline: "none", cursor: "pointer" }}>
                <option value="all">👥 Tous les membres</option>
                {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            )}

            {/* Dépendances toggle */}
            <button onClick={() => setShowDeps(v => !v)} style={{ padding: "4px 11px", borderRadius: "999px", fontSize: "11px", cursor: "pointer", border: `1px solid ${showDeps ? C.greenMid : C.border}`, background: showDeps ? C.greenLight : "transparent", color: showDeps ? C.greenDark : C.textMuted, fontWeight: showDeps ? "600" : "400", transition: "all 0.15s" }}>
              🔗 Dépendances
            </button>

            {/* Recherche */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: C.textLight, fontSize: "12px", pointerEvents: "none" }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
                style={{ fontSize: "12px", padding: "6px 12px 6px 28px", borderRadius: "999px", border: `1px solid ${C.border}`, background: "#fff", color: C.text, outline: "none", width: "160px" }} />
            </div>
          </div>
        </div>

        {/* GANTT CHART */}
        <div style={{ ...card({ padding: 0, overflow: "hidden" }) }}>
          {loading && <div style={{ padding: "48px", textAlign: "center", color: C.textLight, fontSize: "13px" }}>Chargement du diagramme...</div>}
          {!loading && error && <div style={{ padding: "48px", textAlign: "center", color: C.red, fontSize: "13px" }}>{error}</div>}
          {!loading && !error && tasks.length === 0 && (
            <div style={{ padding: "48px", textAlign: "center" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>📭</div>
              <p style={{ fontSize: "14px", color: C.textMuted, margin: 0 }}>Aucune tâche avec des dates pour ce filtre.</p>
              <p style={{ fontSize: "12px", color: C.textLight, margin: "6px 0 0" }}>Les tâches sans date de début ni de fin ne s'affichent pas dans le Gantt.</p>
            </div>
          )}

          {!loading && !error && tasks.length > 0 && (
            <div>
              {/* HEADER sticky : mois + jours */}
              <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 20, background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: LEFT_W, flexShrink: 0, borderRight: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "flex-end" }}>
                  <span style={{ fontSize: "10px", fontWeight: "600", color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.8px" }}>Tâche / Assigné</span>
                </div>
                <div ref={headerScrollRef} style={{ flex: 1, overflowX: "hidden" }}>
                  <div style={{ width: totalWidth }}>
                    {/* Mois */}
                    <div style={{ display: "flex", height: 26, borderBottom: `1px solid ${C.border}` }}>
                      {months.map((m, i) => (
                        <div key={i} style={{ width: m.days * px, flexShrink: 0, borderRight: `1px solid ${C.border}`, padding: "0 8px", display: "flex", alignItems: "center", overflow: "hidden", background: "#fff" }}>
                          <span style={{ fontSize: "10px", fontWeight: "600", color: C.textMuted, whiteSpace: "nowrap" }}>{m.label}</span>
                        </div>
                      ))}
                    </div>
                    {/* Jours */}
                    <div style={{ display: "flex", height: 22 }}>
                      {dayLabels.map((d, i) => {
                        const isTodayCol = Math.round(todayOff / px) === i;
                        return (
                          <div key={i} style={{ width: px, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isTodayCol ? C.orangeLight : d.isWeekend ? "#f0f0e8" : "#fff", borderRight: `1px solid ${isTodayCol ? C.orange + "80" : C.border}` }}>
                            <span style={{ fontSize: px > 11 ? "9px" : "7px", color: isTodayCol ? C.orange : d.isWeekend ? "#ccc" : C.textMuted, fontWeight: isTodayCol ? "700" : "500" }}>
                              {px > 7 ? d.day : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* BODY : colonne gauche fixe + barres scrollables */}
              <div style={{ display: "flex" }}>

                {/* Colonne gauche */}
                <div style={{ width: LEFT_W, flexShrink: 0, borderRight: `1px solid ${C.border}` }}>
                  {tasks.map((t, idx) => {
                    const st  = taskStatus(t);
                    const sc  = STATUS_CONFIG[st];
                    const tc  = TYPE_CONFIG[getTaskType(t)];
                    const pctVal = t.done ? 100 : (t.percentageDone || 0);
                    const latedays = t.late && !t.done ? Math.max(1, Math.ceil((Date.now() - new Date(t.dueDate).getTime()) / 86400000)) : null;

                    return (
                      <div key={t.id} style={{ height: ROW_H, padding: "5px 14px", borderBottom: idx < tasks.length - 1 ? `1px solid ${C.border}` : "none", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, background: idx % 2 === 0 ? "#fff" : "#fcfcfb" }}>
                        {/* Ligne 1 : id + type + badge retard/bloqué */}
                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                          {t.id && <span style={{ fontSize: "9px", color: C.textLight, fontWeight: "600" }}>#{t.id}</span>}
                          <span style={{ fontSize: "8px", fontWeight: "700", color: tc.color, background: tc.bg, padding: "1px 5px", borderRadius: "3px", letterSpacing: "0.2px", whiteSpace: "nowrap" }}>{tc.label}</span>
                          {t.isBlocked && <span style={{ fontSize: "8px", color: C.red, fontWeight: "700", background: C.redLight, padding: "1px 5px", borderRadius: "3px" }}>🔒 Bloquée</span>}
                          {latedays && <span style={{ fontSize: "8px", color: C.red, fontWeight: "700" }}>⚠ {latedays}j</span>}
                        </div>
                        {/* Ligne 2 : sujet */}
                        <div style={{ fontSize: "12px", fontWeight: "600", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.subject}>{t.subject}</div>
                        {/* Ligne 3 : assigné + heures + progression + statut */}
                        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                          <span style={{ fontSize: "9px", color: C.textLight }}>👤 {t.assignee || "—"}</span>
                          {t.hours && <span style={{ fontSize: "9px", color: C.textLight }}>⏱ {t.hours}h</span>}
                          {t.priority && <span style={{ fontSize: "8px", color: C.orange, background: C.orangeLight, padding: "0px 4px", borderRadius: "3px", fontWeight: "600" }}>{t.priority}</span>}
                          {pctVal > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                              <div style={{ width: "34px", height: "3px", background: C.border, borderRadius: "999px", overflow: "hidden" }}>
                                <div style={{ width: `${pctVal}%`, height: "100%", background: sc.color }} />
                              </div>
                              <span style={{ fontSize: "8px", color: sc.text, fontWeight: "700" }}>{pctVal}%</span>
                            </div>
                          )}
                          <span style={{ fontSize: "8px", color: sc.text, background: sc.bg, padding: "1px 5px", borderRadius: "999px", fontWeight: "600" }}>{sc.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Zone barres + SVG flèches */}
                <div ref={bodyScrollRef} style={{ flex: 1, overflowX: "auto" }} onScroll={onBodyScroll}>
                  <div style={{ width: totalWidth, position: "relative" }}>

                    {/* SVG dépendances (au-dessus des barres) */}
                    {arrows.length > 0 && (
                      <svg ref={svgRef} style={{ position: "absolute", top: 0, left: 0, width: totalWidth, height: tasks.length * ROW_H, pointerEvents: "none", zIndex: 5, overflow: "visible" }}>
                        <defs>
                          <marker id="arrow-dep" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L6,3 z" fill={C.blue} />
                          </marker>
                          <marker id="arrow-blocked" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L6,3 z" fill={C.red} />
                          </marker>
                        </defs>
                        {arrows.map((a, i) => {
                          const color = a.blocked ? C.red : C.blue;
                          const mid   = (a.x1 + a.x2) / 2;
                          return (
                            <path key={i}
                              d={`M${a.x1},${a.y1} C${mid},${a.y1} ${mid},${a.y2} ${a.x2},${a.y2}`}
                              fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={a.blocked ? "4 3" : "none"}
                              markerEnd={a.blocked ? "url(#arrow-blocked)" : "url(#arrow-dep)"}
                              opacity="0.75"
                            />
                          );
                        })}
                      </svg>
                    )}

                    {/* Lignes de tâches */}
                    {tasks.map((t, idx) => {
                      const st   = taskStatus(t);
                      const sc   = STATUS_CONFIG[st];
                      const isMilestone = getTaskType(t) === "milestone";
                      const s    = new Date(t.startDate || t.dueDate);
                      const e    = new Date(t.dueDate   || t.startDate);
                      const left = diffDays(min, s) * px;
                      const dur  = Math.max(1, diffDays(s, e) + 1);
                      const barW = dur * px;
                      const pctVal = t.done ? 100 : (t.percentageDone || 0);

                      return (
                        <div key={t.id} style={{ position: "relative", height: ROW_H, borderBottom: idx < tasks.length - 1 ? `1px solid ${C.border}` : "none", background: idx % 2 === 0 ? "#fff" : "#fcfcfb" }}>

                          {/* Week-end shading */}
                          {dayLabels.map((d, di) => d.isWeekend && (
                            <div key={di} style={{ position: "absolute", left: di * px, width: px, top: 0, bottom: 0, background: "#f0f0e8", opacity: 0.5, pointerEvents: "none" }} />
                          ))}

                          {/* Ligne aujourd'hui */}
                          {todayOff >= 0 && todayOff <= totalWidth && (
                            <div style={{ position: "absolute", left: todayOff, top: 0, bottom: 0, width: 2, background: C.orange, opacity: 0.85, zIndex: 4, pointerEvents: "none" }} />
                          )}

                          {/* Milestone (losange) */}
                          {isMilestone ? (
                            <div
                              onMouseEnter={ev => { setTooltip(t); setTooltipPos({ x: ev.clientX, y: ev.clientY }); }}
                              onMouseMove={ev => setTooltipPos({ x: ev.clientX, y: ev.clientY })}
                              onMouseLeave={() => setTooltip(null)}
                              style={{ position: "absolute", left: left - 9, top: "50%", transform: "translateY(-50%) rotate(45deg)", width: 18, height: 18, background: sc.color, boxShadow: `0 2px 6px ${sc.color}50`, cursor: "pointer", zIndex: 3 }}
                            />
                          ) : (
                            /* Barre normale */
                            <div
                              onMouseEnter={ev => { setTooltip(t); setTooltipPos({ x: ev.clientX, y: ev.clientY }); }}
                              onMouseMove={ev => setTooltipPos({ x: ev.clientX, y: ev.clientY })}
                              onMouseLeave={() => setTooltip(null)}
                              style={{ position: "absolute", left, top: "50%", transform: "translateY(-50%)", width: Math.max(barW, 6), height: 22, borderRadius: 6, background: sc.color + "22", border: `1.5px solid ${sc.color}55`, cursor: "pointer", overflow: "hidden", zIndex: 3 }}
                            >
                              {/* Remplissage progression */}
                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pctVal}%`, background: sc.color, opacity: 0.85 }} />
                              {/* Label */}
                              {barW > 48 && (
                                <span style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", fontSize: "9px", fontWeight: "600", color: st === "todo" ? "#444" : "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: barW - 14, pointerEvents: "none", zIndex: 2, textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>
                                  {t.subject}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Date début (à gauche de la barre si espace) */}
                          {t.startDate && left > 38 && (
                            <span style={{ position: "absolute", left: Math.max(2, left - 36), top: "50%", transform: "translateY(-50%)", fontSize: "8px", color: C.textLight, whiteSpace: "nowrap", pointerEvents: "none" }}>
                              {formatDateShort(t.startDate)}
                            </span>
                          )}
                          {/* Date fin (à droite) */}
                          {t.dueDate && (
                            <span style={{ position: "absolute", left: left + Math.max(barW, 6) + 4, top: "50%", transform: "translateY(-50%)", fontSize: "8px", color: t.late && !t.done ? C.red : C.textLight, whiteSpace: "nowrap", pointerEvents: "none", fontWeight: t.late && !t.done ? "700" : "400" }}>
                              {formatDateShort(t.dueDate)}{t.late && !t.done ? " ⚠" : ""}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* LÉGENDE */}
        {!loading && tasks.length > 0 && (
          <div style={{ display: "flex", gap: "16px", marginTop: "14px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {Object.entries(STATUS_CONFIG).map(([k, sc]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.textMuted }}>
                  <div style={{ width: 14, height: 8, borderRadius: 2, background: sc.color }} />
                  {sc.label}
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.textMuted }}>
                <div style={{ width: 10, height: 10, background: C.green, transform: "rotate(45deg)", flexShrink: 0 }} />
                Milestone
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.textMuted }}>
                <div style={{ width: 2, height: 14, background: C.orange }} />
                Aujourd'hui
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.textMuted }}>
                <div style={{ width: 20, height: 8, borderRadius: 2, background: "#f0f0e8", border: "1px solid #ddd" }} />
                Week-end
              </div>
              {showDeps && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.textMuted }}>
                    <svg width="20" height="8"><path d="M0,4 L16,4" stroke={C.blue} strokeWidth="1.5" markerEnd="url(#arr)" /><defs><marker id="arr" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L0,4 L4,2 z" fill={C.blue}/></marker></defs></svg>
                    Dépendance
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.textMuted }}>
                    <svg width="20" height="8"><path d="M0,4 L16,4" stroke={C.red} strokeWidth="1.5" strokeDasharray="3 2" /><line x1="14" y1="2" x2="18" y2="4" stroke={C.red} strokeWidth="1.5"/><line x1="14" y1="6" x2="18" y2="4" stroke={C.red} strokeWidth="1.5"/></svg>
                    Bloquée
                  </div>
                </>
              )}
            </div>
            <span style={{ fontSize: "10px", color: C.textLight }}>{tasks.length} tâche(s) affichée(s) sur {total}</span>
          </div>
        )}
      </main>

      {/* TOOLTIP */}
      {tooltip && (() => {
        const st  = taskStatus(tooltip);
        const sc  = STATUS_CONFIG[st];
        const tc  = TYPE_CONFIG[getTaskType(tooltip)];
        const pctVal = tooltip.done ? 100 : (tooltip.percentageDone || 0);
        const latedays = tooltip.late && !tooltip.done
          ? Math.max(1, Math.ceil((Date.now() - new Date(tooltip.dueDate).getTime()) / 86400000))
          : null;
        return (
          <div style={{ position: "fixed", left: tooltipPos.x + 14, top: tooltipPos.y - 10, background: "#fff", border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px 16px", fontSize: "12px", zIndex: 9999, pointerEvents: "none", minWidth: "220px", maxWidth: "290px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
            {/* Type + ID */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <span style={{ fontSize: "8px", fontWeight: "700", color: tc.color, background: tc.bg, padding: "2px 7px", borderRadius: "3px" }}>{tc.label}</span>
              {tooltip.id && <span style={{ fontSize: "9px", color: C.textLight }}>#{tooltip.id}</span>}
              {tooltip.isBlocked && <span style={{ fontSize: "8px", color: C.red, background: C.redLight, padding: "1px 6px", borderRadius: "3px", fontWeight: "700" }}>🔒 Bloquée</span>}
            </div>
            {/* Titre */}
            <p style={{ fontWeight: "700", fontSize: "13px", color: C.text, margin: "0 0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{tooltip.subject}</p>
            {/* Infos */}
            {[
              ["👤 Assigné à",  tooltip.assignee  || "Non assigné"],
              ["📅 Début",      formatDate(tooltip.startDate)],
              ["🏁 Fin prévue", formatDate(tooltip.dueDate)],
              ["⏱ Estimation", tooltip.hours     ? `${tooltip.hours}h` : "—"],
              ["🎯 Priorité",   tooltip.priority  || "—"],
              ["🔖 Version",    tooltip.version   || "—"],
              ["📋 Statut OP",  tooltip.status    || "—"],
            ].filter(([, v]) => v !== "—").map(([k, v], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 3 }}>
                <span style={{ color: C.textMuted, fontSize: "11px" }}>{k}</span>
                <span style={{ fontWeight: "600", color: C.text, fontSize: "11px" }}>{v}</span>
              </div>
            ))}
            {/* Avancement */}
            <div style={{ margin: "8px 0 6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                <span style={{ fontSize: "10px", color: C.textMuted }}>Avancement</span>
                <span style={{ fontSize: "10px", fontWeight: "700", color: sc.text }}>{pctVal}%</span>
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${pctVal}%`, height: "100%", background: sc.color, transition: "width 0.3s" }} />
              </div>
            </div>
            {/* Retard */}
            {latedays && (
              <div style={{ background: C.redLight, border: `1px solid ${C.red}30`, borderRadius: "8px", padding: "5px 10px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ fontSize: "11px", color: C.red, fontWeight: "700" }}>⚠ En retard de {latedays} jour(s)</span>
              </div>
            )}
            {/* Badge statut */}
            <span style={{ background: sc.bg, color: sc.text, fontSize: "10px", padding: "3px 10px", borderRadius: "999px", fontWeight: "600" }}>{sc.label}</span>
          </div>
        );
      })()}

      <style>{`
        div::-webkit-scrollbar { height: 5px; width: 5px; }
        div::-webkit-scrollbar-track { background: transparent; }
        div::-webkit-scrollbar-thumb { background: ${C.greenMid}; border-radius: 3px; }
      `}</style>
    </div>
  );
}