import React, { useState, useEffect } from "react";
import { fetchProjects, fetchTasks, patchTask } from "../services/api";
import { useNavigate } from "react-router-dom";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ── Palette identique au Dashboard ──────────────────────────
const C = {
  green: "#9FB878", greenLight: "#f5f6ec", greenMid: "#dfe0c0", greenDark: "#5a6332",
  pink: "#d4538a", pinkLight: "#fce7f3", pinkMid: "#f4b8d4", pinkDark: "#7d1f52",
  orange: "#d4874a", orangeLight: "#fef3e8",
  blue: "#5a8ac4", blueLight: "#eaf2fb",
  bg: "#f6f6f2", card: "#ffffff",
  text: "#2d2d2a", textMuted: "#6e6e68", textLight: "#aaaaaa",
  border: "#e8e8e0",
  shadow: "0 2px 8px rgba(0,0,0,0.05)",
};

const card = (extra = {}) => ({
  background: C.card, borderRadius: "18px", padding: "20px",
  border: `1px solid ${C.border}`, boxShadow: C.shadow, ...extra,
});

const TASK_STATUSES = [
  { label: "À faire",  value: "New"        },
  { label: "En cours", value: "In Progress" },
  { label: "Terminée", value: "Closed"      },
];

function getStatus(task) {
  const title = (task._links?.status?.title || "").toLowerCase();
  const isLate = task.dueDate && new Date(task.dueDate) < new Date() &&
    !title.includes("closed") && !title.includes("terminé") && !title.includes("done");
  if (isLate)
    return { label: "En retard", color: "#b23a3a", bg: "#fdecea", border: "#f5c6c6" };
  if (title.includes("closed") || title.includes("terminé") || title.includes("done"))
    return { label: "Terminée",  color: C.greenDark, bg: C.greenLight, border: C.greenMid };
  if (title.includes("progress") || title.includes("cours"))
    return { label: "En cours",  color: C.blue,      bg: C.blueLight,  border: "#c5daf5"  };
  return   { label: "À faire",   color: C.pinkDark,  bg: C.pinkLight,  border: C.pinkMid  };
}

export default function MyTasksPage({ user }) {
  const navigate = useNavigate();
  const storedUser = user || JSON.parse(localStorage.getItem("user") || "{}");

  const [myTasks,       setMyTasks]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [search,        setSearch]        = useState("");
  const [filterStatus,  setFilterStatus]  = useState("all");
  const [editingStatus, setEditingStatus] = useState(null);
  const [saveError,     setSaveError]     = useState(null);

  useEffect(() => {
    if (!storedUser?.id) return;
    async function load() {
      setLoading(true); setError(null);
      try {
        const projects = await fetchProjects();
        const all = [];
        await Promise.all(projects.map(async (p) => {
          try {
            const tasks = await fetchTasks(p.id);
            tasks.forEach((t) => {
              const aid = t._links?.assignee?.href?.split("/").pop();
              if (String(aid) === String(storedUser.id))
                all.push({ ...t, projectName: p.name, projectId: p.id });
            });
          } catch {}
        }));
        setMyTasks(all);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    }
    load();
  }, [storedUser?.id]);

  if (!storedUser?.id) return null;

  const handleLogout = () => {
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
    navigate("/");
  };

  const totalDone     = myTasks.filter(t => getStatus(t).label === "Terminée").length;
  const totalProgress = myTasks.filter(t => getStatus(t).label === "En cours").length;
  const totalLate     = myTasks.filter(t => getStatus(t).label === "En retard").length;
  const totalTodo     = myTasks.filter(t => getStatus(t).label === "À faire").length;
  const pct = myTasks.length > 0 ? Math.round((totalDone / myTasks.length) * 100) : 0;

  const filtered = myTasks.filter((t) => {
    const matchSearch = t.subject?.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filterStatus === "all")      return true;
    if (filterStatus === "todo")     return getStatus(t).label === "À faire";
    if (filterStatus === "progress") return getStatus(t).label === "En cours";
    if (filterStatus === "done")     return getStatus(t).label === "Terminée";
    if (filterStatus === "late")     return getStatus(t).label === "En retard";
    return true;
  });

  async function saveStatus(task) {
    if (!editingStatus) return;
    setEditingStatus(p => ({ ...p, saving: true }));
    try {
      await patchTask(task.id, task.lockVersion, { status: editingStatus.value }, task.projectId);
      setMyTasks(prev => prev.map(t =>
        t.id === task.id
          ? { ...t, _links: { ...t._links, status: { ...t._links?.status, title: editingStatus.value } } }
          : t
      ));
      setEditingStatus(null);
    } catch (err) {
      setSaveError(err.message || "Erreur mise à jour.");
      setEditingStatus(p => ({ ...p, saving: false }));
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', Arial, sans-serif" }}>

      {/* ══ SIDEBAR ══ */}
      <aside style={{ background: "#fff", borderRight: `1px solid ${C.border}`, padding: "24px 0", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "sticky", top: 0, height: "100vh", overflowY: "auto", boxShadow: "2px 0 8px rgba(0,0,0,0.03)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 20px 28px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", boxShadow: `0 2px 8px ${C.greenMid}` }}>🐝</div>
            <span style={{ fontSize: "16px", fontWeight: "700", color: C.text }}>lightproject</span>
          </div>
          <div style={{ padding: "0 12px" }}>
            {[
              { label: "Dashboard",   path: "/dashboard"         },
              { label: "Mes projets", path: "/projets"           },
              { label: "Mes tâches",  path: "/taches", active: true },
              { label: "Analyse IA",  path: "/ai"                },
            ].map(item => (
              <div key={item.path} onClick={() => navigate(item.path)}
                style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", cursor: "pointer", marginBottom: "3px",
                  color:      item.active ? C.greenDark  : C.textMuted,
                  background: item.active ? C.greenLight : "transparent",
                  fontWeight: item.active ? "600"        : "400",
                  borderLeft: item.active ? `3px solid ${C.green}` : "3px solid transparent",
                  transition: "all 0.15s" }}>
                {item.label}
              </div>
            ))}
          </div>
          <div style={{ height: "1px", background: C.border, margin: "16px" }} />
          <div style={{ padding: "0 12px" }}>
            <p style={{ fontSize: "10px", color: C.textLight, textTransform: "uppercase", letterSpacing: "1px", padding: "0 14px", margin: "0 0 6px" }}>Compte</p>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.textMuted, cursor: "pointer" }} onClick={() => navigate("/profil")}>Mon profil</div>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.pink, cursor: "pointer", fontWeight: "500" }} onClick={handleLogout}>Déconnexion</div>
          </div>
        </div>
        <div style={{ margin: "0 16px" }}>
          <div style={{ background: C.greenLight, borderRadius: "14px", padding: "12px", display: "flex", alignItems: "center", gap: "10px", border: `1px solid ${C.greenMid}` }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: "700", color: "#fff", flexShrink: 0 }}>
              {storedUser.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: "600", color: C.text, margin: 0 }}>{storedUser.name || "Membre"}</p>
              <p style={{ fontSize: "11px", color: C.textMuted, margin: 0 }}>{storedUser.isAdmin ? "Administrateur" : "Membre"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ══ MAIN ══ */}
      <main style={{ padding: "28px", overflowY: "auto" }}>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: C.text, margin: 0 }}>
              Mes Tâches 
            </h1>
            <p style={{ fontSize: "12px", color: C.textMuted, margin: "4px 0 0" }}>
              {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
              {" • "}{myTasks.length} tâche{myTasks.length !== 1 ? "s" : ""} assignée{myTasks.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={() => navigate("/dashboard")}
            style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: "999px", padding: "8px 18px", fontSize: "13px", color: C.textMuted, cursor: "pointer", boxShadow: C.shadow }}>
            ← Dashboard
          </button>
        </div>

        {/* KPI CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "12px", marginBottom: "20px" }}>
          {[
            { label: "Total",     val: myTasks.length, bg: C.green,     tc: "#fff"      },
            { label: "À faire",   val: totalTodo,      bg: "#fff",       tc: C.text      },
            { label: "En cours",  val: totalProgress,  bg: C.blueLight,  tc: C.blue      },
            { label: "Terminées", val: totalDone,      bg: C.greenLight, tc: C.greenDark },
            { label: "En retard", val: totalLate,
              bg: totalLate > 0 ? "#fdecea" : "#fff",
              tc: totalLate > 0 ? "#b23a3a" : C.textMuted },
          ].map((k, i) => (
            <div key={i} style={{ ...card({ padding: "18px" }), background: k.bg }}>
              <p style={{ fontSize: "10px", color: k.tc, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 8px" }}>{k.label}</p>
              <p style={{ fontSize: "30px", fontWeight: "700", color: k.tc, margin: 0 }}>{k.val}</p>
            </div>
          ))}
        </div>

        {/* BARRE DE PROGRESSION */}
        <div style={{ ...card({ padding: "16px 20px", marginBottom: "20px" }), background: C.pinkLight, border: `1px solid ${C.pinkMid}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "13px", fontWeight: "600", color: C.pinkDark }}>Progression globale</span>
            <span style={{ fontSize: "20px", fontWeight: "700", color: C.pink }}>{pct}%</span>
          </div>
          <div style={{ height: "8px", background: "rgba(255,255,255,0.6)", borderRadius: "999px", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "8px", background: C.pink, borderRadius: "999px", transition: "width 0.6s", boxShadow: `0 2px 6px ${C.pinkMid}` }} />
          </div>
          <p style={{ fontSize: "11px", color: C.pinkDark, margin: "8px 0 0", fontWeight: "500" }}>
            {totalDone} terminées · {totalProgress} en cours · {totalTodo} à faire · {totalLate} en retard
          </p>
        </div>

        {/* FILTRES + RECHERCHE */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: "10px", padding: "9px 14px", flex: 1, minWidth: "200px" }}>
            <span>🔍</span>
            <input type="text" placeholder="Rechercher une tâche..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, border: "none", outline: "none", fontSize: "13px", color: C.text, background: "transparent" }} />
          </div>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {[["all","Toutes"],["todo","À faire"],["progress","En cours"],["done","Terminées"],["late","En retard"]].map(([tab, label]) => (
              <button key={tab} onClick={() => setFilterStatus(tab)}
                style={{ background: filterStatus === tab ? C.greenLight : "#fff",
                  border: filterStatus === tab ? `1px solid ${C.greenMid}` : `1px solid ${C.border}`,
                  borderRadius: "999px", padding: "7px 14px", fontSize: "12px",
                  color: filterStatus === tab ? C.greenDark : C.textMuted,
                  cursor: "pointer", fontWeight: filterStatus === tab ? "600" : "400", transition: "all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* SAVE ERROR */}
        {saveError && (
          <div style={{ background: "#fdecea", border: "1px solid #f5c6c6", borderRadius: "10px", padding: "10px 16px", marginBottom: "12px", color: "#b23a3a", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            ⚠️ {saveError}
            <button onClick={() => setSaveError(null)} style={{ background: "none", border: "none", color: "#b23a3a", cursor: "pointer", fontSize: "16px" }}>✕</button>
          </div>
        )}

        {/* LOADING */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "240px", gap: "14px" }}>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ width: "36px", height: "36px", border: `3px solid ${C.border}`, borderTopColor: C.green, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <p style={{ color: C.textMuted, fontSize: "14px" }}>Chargement de vos tâches...</p>
          </div>
        )}

        {/* ERREUR */}
        {error && !loading && (
          <div style={{ ...card(), background: "#fdecea", border: "1px solid #f5c6c6", textAlign: "center", padding: "32px" }}>
            <p style={{ color: "#b23a3a", fontSize: "14px" }}>⚠️ {error}</p>
          </div>
        )}

        {/* VIDE */}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ ...card(), textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📭</div>
            <p style={{ fontSize: "15px", fontWeight: "600", color: C.text, margin: "0 0 6px" }}>
              {search ? `Aucun résultat pour "${search}"` : "Aucune tâche assignée"}
            </p>
            <p style={{ fontSize: "13px", color: C.textMuted, margin: 0 }}>
              {search ? "Essayez un autre mot-clé." : "Les tâches assignées apparaîtront ici."}
            </p>
          </div>
        )}

        {/* TABLE */}
        {!loading && !error && filtered.length > 0 && (
          <div style={{ ...card({ padding: 0 }), overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.greenLight }}>
                  {["Tâche", "Projet", "Statut", "Échéance", "Workload", "Action"].map((h, i) => (
                    <th key={i} style={{ padding: "13px 18px", textAlign: "left", fontSize: "11px", fontWeight: "600", letterSpacing: "0.08em", textTransform: "uppercase", color: C.greenDark, borderBottom: `1px solid ${C.greenMid}` }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((task, i) => {
                  const status    = getStatus(task);
                  const isEditing = editingStatus?.taskId === task.id;
                  const isLate    = status.label === "En retard";

                  return (
                    <tr key={task.id}
                      style={{ background: i % 2 === 0 ? "#fff" : "#fafaf8", borderBottom: `1px solid ${C.border}`, transition: "background 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.greenLight}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafaf8"}>

                      {/* Tâche */}
                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: status.color, flexShrink: 0 }} />
                          <span style={{ fontSize: "13px", fontWeight: "500", color: C.text }}>{task.subject}</span>
                        </div>
                      </td>

                      {/* Projet */}
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ fontSize: "12px", color: C.textMuted, background: C.greenLight, padding: "3px 10px", borderRadius: "999px", border: `1px solid ${C.greenMid}`, fontWeight: "500" }}>
                          {task.projectName}
                        </span>
                      </td>

                      {/* Statut */}
                      <td style={{ padding: "14px 18px" }}>
                        {isEditing ? (
                          <select value={editingStatus.value}
                            onChange={e => setEditingStatus(p => ({ ...p, value: e.target.value }))}
                            disabled={editingStatus.saving}
                            style={{ border: `1px solid ${C.border}`, borderRadius: "8px", padding: "5px 10px", fontSize: "12px", color: C.text, outline: "none", background: "#fff" }}>
                            {TASK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        ) : (
                          <span style={{ fontSize: "11px", fontWeight: "600", padding: "4px 10px", borderRadius: "999px", background: status.bg, color: status.color, border: `1px solid ${status.border}`, whiteSpace: "nowrap" }}>
                            {status.label}
                          </span>
                        )}
                      </td>

                      {/* Échéance */}
                      <td style={{ padding: "14px 18px", fontSize: "13px", color: isLate ? "#b23a3a" : C.textMuted, fontWeight: isLate ? "600" : "400" }}>
                        {isLate && "⚠️ "}{formatDate(task.dueDate)}
                      </td>

                      {/* Workload */}
                      <td style={{ padding: "14px 18px", fontSize: "13px", color: C.textMuted }}>
                        {task.estimatedTime ? task.estimatedTime.replace("PT", "").replace("H", "h") : "—"}
                      </td>

                      {/* Action */}
                      <td style={{ padding: "14px 18px" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button onClick={() => saveStatus(task)} disabled={editingStatus.saving}
                              style={{ background: C.green, color: "#fff", border: "none", borderRadius: "8px", padding: "6px 12px", fontSize: "12px", cursor: "pointer", fontWeight: "600" }}>
                              {editingStatus.saving ? "..." : "✅ OK"}
                            </button>
                            <button onClick={() => setEditingStatus(null)} disabled={editingStatus.saving}
                              style={{ background: "#fff", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "6px 10px", fontSize: "12px", cursor: "pointer" }}>
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingStatus({ taskId: task.id, value: task._links?.status?.title || "New", saving: false })}
                            style={{ background: C.blueLight, color: C.blue, border: "1px solid #c5daf5", borderRadius: "8px", padding: "6px 12px", fontSize: "12px", cursor: "pointer", fontWeight: "600" }}>
                            🔄 Statut
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* FOOTER TABLE */}
            <div style={{ padding: "12px 18px", background: C.greenLight, borderTop: `1px solid ${C.greenMid}`, fontSize: "12px", color: C.greenDark, fontWeight: "500" }}>
              {filtered.length} tâche{filtered.length !== 1 ? "s" : ""} affichée{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== myTasks.length && ` (sur ${myTasks.length} au total)`}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}