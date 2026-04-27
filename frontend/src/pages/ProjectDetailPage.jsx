import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getProjets,
  getStats,
  getTaches,
  getProjectMembers,
  updateTache,
  deleteTache,
  logout,
} from "../services/api";

export default function DetailProjet() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const C = {
    green: "#9FB878",
    greenLight: "#f5f6ec",
    greenMid: "#dfe0c0",
    greenDark: "#5a6332",
    pink: "#d4538a",
    pinkLight: "#fce7f3",
    pinkMid: "#f4b8d4",
    pinkDark: "#7d1f52",
    blue: "#5a8ac4",
    blueLight: "#eaf2fb",
    orange: "#d4874a",
    orangeLight: "#fef3e8",
    redLight: "#fdecea",
    red: "#b23a3a",
    purple: "#9b8dc2",
    purpleLight: "#f3f0fa",
    bg: "#f6f6f2",
    card: "#ffffff",
    text: "#2d2d2a",
    textMuted: "#6e6e68",
    textLight: "#aaaaaa",
    border: "#e8e8e0",
    shadow: "0 2px 8px rgba(0,0,0,0.05)",
    shadowMd: "0 10px 26px rgba(45,45,42,0.09)",
  };

  const accents = [
    { c: C.green, bg: C.greenLight, dark: C.greenDark },
    { c: C.pink, bg: C.pinkLight, dark: C.pinkDark },
    { c: C.blue, bg: C.blueLight, dark: C.blue },
    { c: C.orange, bg: C.orangeLight, dark: "#7a4520" },
    { c: C.purple, bg: C.purpleLight, dark: "#4a3a7a" },
  ];

  const card = (extra = {}) => ({
    background: C.card,
    borderRadius: "18px",
    padding: "20px",
    border: `1px solid ${C.border}`,
    boxShadow: C.shadow,
    transition: "all 0.22s ease",
    ...extra,
  });

  const formatDate = (date) => {
    if (!date) return "Non définie";
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const isDone = (t) =>
    ["clos", "done", "termin", "closed"].some((k) =>
      (t._links?.status?.title || "").toLowerCase().includes(k)
    );

  const isInProgress = (t) =>
    ["progress", "cours"].some((k) =>
      (t._links?.status?.title || "").toLowerCase().includes(k)
    );

  const isOverdue = (t) =>
    t.dueDate && new Date(t.dueDate) < new Date() && !isDone(t);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");

      try {
        const [projectsRes, statsRes, tasksRes, membersRes] = await Promise.all([
          getProjets(),
          getStats(id),
          getTaches(id),
          getProjectMembers(id),
        ]);

        const list = projectsRes.data || [];
        const found = list.find((p) => String(p.id) === String(id));

        setProject(found || null);
        setStats(statsRes.data || null);
        setTasks(tasksRes.data || []);
        setMembers(membersRes.data || []);
      } catch (err) {
        setError(err.response?.data?.message || "Impossible de charger le projet.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {}
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
    navigate("/");
  };

  const kpis = stats?.kpis || {};

  const totals = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(isDone).length;
    const progress = tasks.filter(isInProgress).length;
    const late = tasks.filter(isOverdue).length;
    return {
      total,
      done,
      progress,
      late,
      todo: Math.max(0, total - done - progress),
      completion: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const q = search.toLowerCase();
      const title = (task.subject || "").toLowerCase();
      const status = (task._links?.status?.title || "").toLowerCase();

      if (!title.includes(q) && !status.includes(q)) return false;
      if (filter === "done") return isDone(task);
      if (filter === "progress") return isInProgress(task);
      if (filter === "late") return isOverdue(task);
      if (filter === "todo") return !isDone(task) && !isInProgress(task);
      return true;
    });
  }, [tasks, search, filter]);

  const upcomingTasks = useMemo(() => {
    return tasks
      .filter((t) => t.dueDate && !isDone(t))
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      .slice(0, 5);
  }, [tasks]);

  const recentTasks = useMemo(() => {
    return [...tasks]
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0) -
          new Date(a.updatedAt || a.createdAt || 0)
      )
      .slice(0, 5);
  }, [tasks]);

  const health =
    totals.late >= 3
      ? "Critique"
      : totals.late > 0
      ? "À risque"
      : totals.completion >= 80
      ? "Très bon"
      : totals.completion >= 40
      ? "Stable"
      : "À démarrer";

  const getHealthStyle = () => {
    if (health === "Critique") return { bg: C.redLight, color: C.red, border: "#f5c6c6" };
    if (health === "À risque") return { bg: C.orangeLight, color: "#7a4520", border: "#fdd9b5" };
    if (health === "Très bon") return { bg: C.greenLight, color: C.greenDark, border: C.greenMid };
    if (health === "Stable") return { bg: C.blueLight, color: C.blue, border: "#c5daf5" };
    return { bg: "#fafaf8", color: C.textMuted, border: C.border };
  };

  const healthStyle = getHealthStyle();

  const statusDist = useMemo(() => {
    return tasks.reduce((acc, task) => {
      const status = task._links?.status?.title || "Inconnu";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
  }, [tasks]);

  const AvatarStack = ({ list }) => (
    <div style={{ display: "flex", alignItems: "center" }}>
      {list.slice(0, 6).map((m, i) => (
        <div
          key={`${m.op_user_id || m.id || i}`}
          title={m.name}
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: accents[i % accents.length].bg,
            border: `2px solid #fff`,
            marginLeft: i === 0 ? 0 : "-8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            fontWeight: "800",
            color: accents[i % accents.length].dark,
            boxShadow: C.shadow,
          }}
        >
          {m.name?.charAt(0)?.toUpperCase() || "?"}
        </div>
      ))}
      {list.length > 6 && (
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: C.greenLight,
            border: `2px solid #fff`,
            marginLeft: "-8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "10px",
            color: C.greenDark,
            fontWeight: "800",
          }}
        >
          +{list.length - 6}
        </div>
      )}
    </div>
  );

  const StatusBadge = ({ task }) => {
    const s = task._links?.status?.title || "—";
    const done = isDone(task);
    const prog = isInProgress(task);
    const bg = done ? C.greenLight : prog ? C.blueLight : C.pinkLight;
    const color = done ? C.greenDark : prog ? C.blue : C.pinkDark;
    const border = done ? C.greenMid : prog ? "#c5daf5" : C.pinkMid;

    return (
      <span
        style={{
          fontSize: "10px",
          background: bg,
          color,
          border: `1px solid ${border}`,
          padding: "3px 8px",
          borderRadius: "999px",
          fontWeight: "800",
          whiteSpace: "nowrap",
        }}
      >
        {s}
      </span>
    );
  };

  const changeTaskStatus = async (task, status) => {
    try {
      await updateTache(task.id, {
        projectId: id,
        status,
        lockVersion: task.lockVersion,
      });

      const fresh = await getTaches(id);
      setTasks(fresh.data || []);
    } catch (err) {
      alert(err.response?.data?.message || "Erreur lors de la mise à jour de la tâche.");
    }
  };

  const removeTask = async (task) => {
    const ok = window.confirm("Supprimer cette tâche ?");
    if (!ok) return;

    try {
      await deleteTache(task.id, id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      alert(err.response?.data?.message || "Erreur lors de la suppression.");
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        <div style={card({ textAlign: "center", padding: "40px" })}>
          <div style={{ fontSize: "34px", marginBottom: "10px" }}>🐝</div>
          <p style={{ color: C.text, fontWeight: "800", margin: 0 }}>Chargement du projet...</p>
          <p style={{ color: C.textLight, fontSize: "12px" }}>Synchronisation avec OpenProject</p>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        <div style={card({ textAlign: "center", padding: "40px", maxWidth: "420px" })}>
          <div style={{ fontSize: "34px", marginBottom: "10px" }}>⚠️</div>
          <p style={{ color: C.text, fontWeight: "800", margin: 0 }}>Projet introuvable</p>
          <p style={{ color: C.textMuted, fontSize: "12px" }}>{error || "Impossible de charger ce projet."}</p>
          <button
            onClick={() => navigate("/projets")}
            style={{ background: C.green, color: "#fff", border: "none", padding: "10px 16px", borderRadius: "999px", fontWeight: "800", cursor: "pointer" }}
          >
            Retour aux projets
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'Segoe UI', Arial, sans-serif",
      }}
    >
      <aside
        style={{
          background: "#fff",
          borderRight: `1px solid ${C.border}`,
          padding: "24px 0",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          boxShadow: "2px 0 8px rgba(0,0,0,0.03)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 20px 28px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🐝</div>
            <span style={{ fontSize: "16px", fontWeight: "700", color: C.text }}>lightproject</span>
          </div>

          <div style={{ padding: "0 12px" }}>
            {[
              { label: "Dashboard", path: "/dashboard" },
              { label: "Mes projets", path: "/projets", active: true },
              { label: "Mes tâches", path: "/taches" },
              { label: "Analyse IA", path: "/ai" },
            ].map((item) => (
              <div
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  padding: "10px 14px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  cursor: "pointer",
                  marginBottom: "3px",
                  color: item.active ? C.greenDark : C.textMuted,
                  background: item.active ? C.greenLight : "transparent",
                  fontWeight: item.active ? "600" : "400",
                  borderLeft: item.active ? `3px solid ${C.green}` : "3px solid transparent",
                  transition: "all 0.18s ease",
                }}
              >
                {item.label}
              </div>
            ))}
          </div>

          <div style={{ height: "1px", background: C.border, margin: "16px" }} />

          <div style={{ padding: "0 12px" }}>
            <p style={{ fontSize: "10px", color: C.textLight, textTransform: "uppercase", letterSpacing: "1px", padding: "0 14px" }}>Compte</p>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.textMuted, cursor: "pointer" }} onClick={() => navigate("/profil")}>Mon profil</div>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.pink, cursor: "pointer", fontWeight: "500" }} onClick={handleLogout}>Déconnexion</div>
          </div>
        </div>

        <div style={{ margin: "0 16px" }}>
          <div style={{ background: C.greenLight, borderRadius: "14px", padding: "12px", display: "flex", alignItems: "center", gap: "10px", border: `1px solid ${C.greenMid}` }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: "700", color: "#fff" }}>
              {user.name?.charAt(0)?.toUpperCase() || "A"}
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: "600", margin: 0 }}>{user.name || "Admin"}</p>
              <p style={{ fontSize: "11px", color: C.textMuted, margin: 0 }}>{user.isAdmin ? "Administrateur" : "Membre"}</p>
            </div>
          </div>
        </div>
      </aside>

      <main style={{ padding: "28px", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "22px", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <button
              onClick={() => navigate("/projets")}
              style={{ background: "#fff", border: `1px solid ${C.border}`, color: C.textMuted, padding: "7px 12px", borderRadius: "999px", cursor: "pointer", fontSize: "12px", fontWeight: "700", marginBottom: "12px" }}
            >
              ← Retour aux projets
            </button>
            <h1 style={{ fontSize: "25px", fontWeight: "900", color: C.text, margin: 0, lineHeight: 1.3 }}>{project.name}</h1>
            <p style={{ fontSize: "12px", color: C.textMuted, margin: "6px 0 0" }}>Projet #{project.id} · Détails synchronisés depuis OpenProject</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ background: healthStyle.bg, color: healthStyle.color, border: `1px solid ${healthStyle.border}`, borderRadius: "999px", padding: "8px 13px", fontSize: "12px", fontWeight: "900" }}>
              Santé : {health}
            </span>
            <AvatarStack list={members} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "14px", marginBottom: "18px" }}>
          {[
            { label: "Progression", value: `${totals.completion}%`, bg: C.green, color: "#fff", sub: "complétion" },
            { label: "Tâches", value: totals.total, bg: "#fff", color: C.text, sub: "total" },
            { label: "Terminées", value: totals.done, bg: C.pinkLight, color: C.pinkDark, sub: "done" },
            { label: "En cours", value: totals.progress, bg: C.blueLight, color: C.blue, sub: "in progress" },
            { label: "En retard", value: totals.late, bg: totals.late > 0 ? C.redLight : "#fff", color: totals.late > 0 ? C.red : C.textMuted, sub: "risques" },
          ].map((item) => (
            <div
              key={item.label}
              style={{ ...card({ padding: "17px", background: item.bg }) }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = C.shadowMd;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = C.shadow;
              }}
            >
              <p style={{ fontSize: "10px", textTransform: "uppercase", color: item.color, opacity: 0.75, margin: "0 0 8px", letterSpacing: "0.6px" }}>{item.label}</p>
              <p style={{ fontSize: "30px", fontWeight: "900", color: item.color, margin: 0 }}>{item.value}</p>
              <p style={{ fontSize: "11px", color: item.color, opacity: 0.6, margin: "3px 0 0" }}>{item.sub}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "14px", marginBottom: "18px" }}>
          <div style={{ ...card({ background: "linear-gradient(135deg, #fff, #f5f6ec)" }) }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
              <p style={{ fontSize: "14px", fontWeight: "900", color: C.text, margin: 0 }}>Vue d’ensemble</p>
              <span style={{ fontSize: "11px", color: C.greenDark, fontWeight: "900" }}>{totals.completion}%</span>
            </div>
            <div style={{ height: "10px", background: "#fff", borderRadius: "999px", overflow: "hidden", border: `1px solid ${C.border}`, marginBottom: "12px" }}>
              <div style={{ height: "10px", width: `${totals.completion}%`, background: C.green, borderRadius: "999px", transition: "width 0.7s ease" }} />
            </div>
            <p style={{ fontSize: "12px", color: C.textMuted, lineHeight: 1.7, margin: 0 }}>
              Ce projet contient <b>{totals.total}</b> tâches, dont <b>{totals.done}</b> terminées et <b>{totals.progress}</b> en cours. {totals.late > 0 ? `Il y a ${totals.late} tâche(s) en retard à traiter.` : "Aucune tâche en retard pour le moment."}
            </p>
          </div>

          <div style={card()}>
            <p style={{ fontSize: "14px", fontWeight: "900", color: C.text, margin: "0 0 12px" }}>Calendrier</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: C.textLight }}>Début</span>
                <span style={{ fontSize: "12px", color: C.text, fontWeight: "800" }}>{formatDate(kpis.startDate || project.startDate || project.start_date)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: C.textLight }}>Fin</span>
                <span style={{ fontSize: "12px", color: C.text, fontWeight: "800" }}>{formatDate(kpis.endDate || project.endDate || project.end_date)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: C.textLight }}>Mise à jour</span>
                <span style={{ fontSize: "12px", color: C.text, fontWeight: "800" }}>{formatDate(project.updatedAt || project.updated_at)}</span>
              </div>
            </div>
          </div>

          <div style={card()}>
            <p style={{ fontSize: "14px", fontWeight: "900", color: C.text, margin: "0 0 12px" }}>Équipe</p>
            {members.length === 0 ? (
              <div style={{ background: C.greenLight, border: `1px dashed ${C.greenMid}`, borderRadius: "12px", padding: "15px", textAlign: "center", color: C.textMuted, fontSize: "12px" }}>
                Aucun membre trouvé.
              </div>
            ) : (
              <>
                <AvatarStack list={members} />
                <p style={{ fontSize: "12px", color: C.textMuted, margin: "12px 0 0" }}>{members.length} membre(s) dans ce projet</p>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 330px", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ ...card(), display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ background: "#fafaf8", border: `1px solid ${C.border}`, borderRadius: "999px", padding: "10px 16px", minWidth: "280px", flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>🔍</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher une tâche..."
                  style={{ border: "none", outline: "none", background: "transparent", width: "100%", fontSize: "13px", color: C.text }}
                />
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {[["all", "Toutes"], ["todo", "À faire"], ["progress", "En cours"], ["done", "Terminées"], ["late", "En retard"]].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    style={{ background: filter === key ? C.greenLight : "#fff", color: filter === key ? C.greenDark : C.textMuted, border: filter === key ? `1px solid ${C.greenMid}` : `1px solid ${C.border}`, padding: "8px 13px", borderRadius: "999px", fontSize: "12px", fontWeight: filter === key ? "800" : "500", cursor: "pointer", transition: "all 0.18s ease" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={card()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <p style={{ fontSize: "15px", color: C.text, fontWeight: "900", margin: 0 }}>Tâches du projet</p>
                <span style={{ fontSize: "12px", color: C.textMuted }}>{filteredTasks.length} résultat(s)</span>
              </div>

              {filteredTasks.length === 0 ? (
                <div style={{ background: C.greenLight, border: `1px dashed ${C.greenMid}`, borderRadius: "14px", padding: "30px", textAlign: "center" }}>
                  <div style={{ fontSize: "30px", marginBottom: "8px" }}>🌿</div>
                  <p style={{ fontSize: "13px", color: C.greenDark, fontWeight: "800", margin: 0 }}>Aucune tâche trouvée</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {filteredTasks.map((task) => (
                    <div
                      key={task.id}
                      style={{ background: "#fafaf8", border: `1px solid ${isOverdue(task) ? "#f5c6c6" : C.border}`, borderRadius: "14px", padding: "13px", transition: "all 0.18s ease" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateX(4px)";
                        e.currentTarget.style.boxShadow = C.shadow;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateX(0)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: isDone(task) ? C.green : isInProgress(task) ? C.blue : C.pink, flexShrink: 0 }} />
                            <p style={{ fontSize: "13px", fontWeight: "900", color: C.text, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.subject}</p>
                          </div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "10px", color: C.textLight }}>#{task.id}</span>
                            <span style={{ fontSize: "10px", color: isOverdue(task) ? C.red : C.textMuted }}>Échéance : {formatDate(task.dueDate)}</span>
                            {task.estimatedTime && <span style={{ fontSize: "10px", color: C.textMuted }}>Temps estimé : {task.estimatedTime}</span>}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <StatusBadge task={task} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              changeTaskStatus(task, "In progress");
                            }}
                            style={{ background: C.blueLight, color: C.blue, border: "1px solid #c5daf5", padding: "5px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: "800", cursor: "pointer" }}
                          >
                            En cours
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              changeTaskStatus(task, "Closed");
                            }}
                            style={{ background: C.greenLight, color: C.greenDark, border: `1px solid ${C.greenMid}`, padding: "5px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: "800", cursor: "pointer" }}
                          >
                            Terminer
                          </button>
                          {user.isAdmin && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTask(task);
                              }}
                              style={{ background: C.redLight, color: C.red, border: "1px solid #f5c6c6", padding: "5px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: "800", cursor: "pointer" }}
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={card()}>
              <p style={{ fontSize: "14px", fontWeight: "900", color: C.text, margin: "0 0 12px" }}>Deadlines proches</p>
              {upcomingTasks.length === 0 ? (
                <div style={{ background: C.greenLight, border: `1px dashed ${C.greenMid}`, borderRadius: "12px", padding: "16px", textAlign: "center", color: C.greenDark, fontSize: "12px", fontWeight: "700" }}>Aucune deadline proche 🎉</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {upcomingTasks.map((task) => {
                    const late = isOverdue(task);
                    return (
                      <div key={task.id} style={{ background: late ? C.redLight : C.orangeLight, border: late ? "1px solid #f5c6c6" : "1px solid #fdd9b5", borderRadius: "12px", padding: "10px" }}>
                        <p style={{ fontSize: "12px", color: C.text, fontWeight: "800", margin: "0 0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.subject}</p>
                        <p style={{ fontSize: "10px", color: late ? C.red : "#7a4520", margin: 0, fontWeight: "700" }}>{formatDate(task.dueDate)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={card()}>
              <p style={{ fontSize: "14px", fontWeight: "900", color: C.text, margin: "0 0 12px" }}>Répartition des statuts</p>
              {Object.keys(statusDist).length === 0 ? (
                <p style={{ fontSize: "12px", color: C.textMuted }}>Aucun statut disponible.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {Object.entries(statusDist).map(([status, count], i) => {
                    const pct = tasks.length ? Math.round((count / tasks.length) * 100) : 0;
                    const a = accents[i % accents.length];
                    return (
                      <div key={status}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", color: C.text, fontWeight: "700" }}>{status}</span>
                          <span style={{ fontSize: "11px", color: a.dark, fontWeight: "900" }}>{pct}%</span>
                        </div>
                        <div style={{ height: "6px", background: C.border, borderRadius: "999px", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "6px", background: a.c, borderRadius: "999px", transition: "width 0.6s ease" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={card()}>
              <p style={{ fontSize: "14px", fontWeight: "900", color: C.text, margin: "0 0 12px" }}>Activité récente</p>
              {recentTasks.length === 0 ? (
                <p style={{ fontSize: "12px", color: C.textMuted }}>Aucune activité récente.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {recentTasks.map((task) => (
                    <div key={task.id} style={{ display: "flex", gap: "9px", alignItems: "center", background: "#fafaf8", border: `1px solid ${C.border}`, borderRadius: "12px", padding: "9px" }}>
                      <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: isDone(task) ? C.green : isInProgress(task) ? C.blue : C.pink, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: "11px", fontWeight: "800", color: C.text, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.subject}</p>
                        <p style={{ fontSize: "10px", color: C.textLight, margin: "2px 0 0" }}>{formatDate(task.updatedAt || task.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}