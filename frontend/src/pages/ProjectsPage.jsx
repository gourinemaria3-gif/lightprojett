import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProjets,
  getStats,
  getTaches,
  getProjectMembers,
  logout,
} from "../services/api";

export default function Projets() {
  const [projets, setProjets] = useState([]);
  const [statsMap, setStatsMap] = useState({});
  const [tachesMap, setTachesMap] = useState({});
  const [membersMap, setMembersMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtre, setFiltre] = useState("all");
  const navigate = useNavigate();

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

  useEffect(() => {
    Promise.all([getProjets()])
      .then(async ([pRes]) => {
        const list = pRes.data || [];
        setProjets(list);

        const sMap = {};
        const tMap = {};
        const mMap = {};

        await Promise.all(
          list.map(async (p) => {
            try {
              const [statsRes, tachesRes, membersRes] = await Promise.all([
                getStats(p.id),
                getTaches(p.id),
                getProjectMembers(p.id),
              ]);

              sMap[p.id] = statsRes.data;
              tMap[p.id] = tachesRes.data || [];
              mMap[p.id] = membersRes.data || [];
            } catch {
              sMap[p.id] = null;
              tMap[p.id] = [];
              mMap[p.id] = [];
            }
          })
        );

        setStatsMap(sMap);
        setTachesMap(tMap);
        setMembersMap(mMap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {}
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
    navigate("/");
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

  const formatDate = (date) => {
    if (!date) return "Non définie";
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getProjectStartDate = (p) =>
    p.startDate || p.start_date || p.kpis?.startDate || statsMap[p.id]?.kpis?.startDate || null;

  const getProjectEndDate = (p) =>
    p.endDate || p.end_date || p.kpis?.endDate || statsMap[p.id]?.kpis?.endDate || null;

  const allTaches = useMemo(() => Object.values(tachesMap).flat(), [tachesMap]);

  const totals = useMemo(() => {
    const total = allTaches.length;
    const done = allTaches.filter(isDone).length;
    const progress = allTaches.filter(isInProgress).length;
    const late = allTaches.filter(isOverdue).length;
    return { total, done, progress, late, todo: total - done - progress };
  }, [allTaches]);

  const projectComputed = useMemo(() => {
    return projets.map((p, index) => {
      const kpis = statsMap[p.id]?.kpis || {};
      const tasks = tachesMap[p.id] || [];
      const members = membersMap[p.id] || [];
      const total = kpis.total ?? tasks.length;
      const done = kpis.done ?? tasks.filter(isDone).length;
      const inProgress = kpis.inProgress ?? tasks.filter(isInProgress).length;
      const late = kpis.late ?? tasks.filter(isOverdue).length;
      const progress = total > 0 ? Math.round((done / total) * 100) : 0;
      const accent = accents[index % accents.length];
      const startDate = getProjectStartDate(p);
      const endDate = getProjectEndDate(p);

      const recentTasks = [...tasks]
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0) -
            new Date(a.updatedAt || a.createdAt || 0)
        )
        .slice(0, 4);

      const health =
        late >= 3 ? "Critique" :
        late > 0 ? "À risque" :
        progress >= 80 ? "Très bon" :
        progress >= 40 ? "Stable" :
        "À démarrer";

      return {
        ...p,
        total,
        done,
        inProgress,
        late,
        progress,
        tasks,
        recentTasks,
        members,
        accent,
        health,
        startDate,
        endDate,
      };
    });
  }, [projets, statsMap, tachesMap, membersMap]);

  const projetsFiltres = useMemo(() => {
    return projectComputed.filter((p) => {
      const matchSearch = (p.name || "").toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (filtre === "late") return p.late > 0;
      if (filtre === "finished") return p.total > 0 && p.progress === 100;
      if (filtre === "active") return p.progress < 100;
      return true;
    });
  }, [projectComputed, search, filtre]);

  const topProject = [...projectComputed].sort((a, b) => b.progress - a.progress)[0];
  const busiestProject = [...projectComputed].sort((a, b) => b.total - a.total)[0];
  const riskyProject = [...projectComputed].sort((a, b) => b.late - a.late)[0];
  const lateTasks = allTaches.filter(isOverdue).slice(0, 5);

  const getHealthStyle = (health) => {
    if (health === "Critique") return { bg: C.redLight, color: C.red, border: "#f5c6c6" };
    if (health === "À risque") return { bg: C.orangeLight, color: "#7a4520", border: "#fdd9b5" };
    if (health === "Très bon") return { bg: C.greenLight, color: C.greenDark, border: C.greenMid };
    if (health === "Stable") return { bg: C.blueLight, color: C.blue, border: "#c5daf5" };
    return { bg: "#fafaf8", color: C.textMuted, border: C.border };
  };

  const AvatarStack = ({ members }) => (
    <div style={{ display: "flex", alignItems: "center" }}>
      {members.slice(0, 5).map((m, i) => (
        <div
          key={`${m.op_user_id || m.id || i}`}
          title={m.name}
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "50%",
            background: accents[i % accents.length].bg,
            border: `2px solid #fff`,
            marginLeft: i === 0 ? 0 : "-8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            fontWeight: "800",
            color: accents[i % accents.length].dark,
            boxShadow: C.shadow,
          }}
        >
          {m.name?.charAt(0)?.toUpperCase() || "?"}
        </div>
      ))}
      {members.length > 5 && (
        <div
          style={{
            width: "30px",
            height: "30px",
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
          +{members.length - 5}
        </div>
      )}
    </div>
  );

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: "800", color: C.text, margin: 0 }}>Mes projets 📁</h1>
            <p style={{ fontSize: "12px", color: C.textMuted, margin: "5px 0 0" }}>Vue complète des projets synchronisés depuis OpenProject.</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "18px" }}>
          {[
            { label: "Projets visibles", value: projets.length, bg: C.green, color: "#fff", sub: "depuis OpenProject" },
            { label: "Tâches totales", value: totals.total, bg: "#fff", color: C.text, sub: "tous projets" },
            { label: "Terminées", value: totals.done, bg: C.pinkLight, color: C.pinkDark, sub: "complétées" },
            { label: "En retard", value: totals.late, bg: totals.late > 0 ? C.redLight : "#fff", color: totals.late > 0 ? C.red : C.textMuted, sub: "à surveiller" },
          ].map((item) => (
            <div
              key={item.label}
              style={{ ...card({ padding: "18px", background: item.bg }) }}
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
              <p style={{ fontSize: "32px", fontWeight: "800", color: item.color, margin: 0 }}>{item.value}</p>
              <p style={{ fontSize: "11px", color: item.color, opacity: 0.6, margin: "3px 0 0" }}>{item.sub}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "14px", marginBottom: "18px" }}>
          <div style={{ ...card({ background: "linear-gradient(135deg, #fff, #f5f6ec)" }) }}>
            <p style={{ fontSize: "13px", fontWeight: "800", color: C.text, margin: "0 0 12px" }}>✨ Aperçu intelligent</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
              {[
                { title: "Plus avancé", value: topProject?.name || "—", meta: `${topProject?.progress || 0}%`, color: C.green },
                { title: "Plus chargé", value: busiestProject?.name || "—", meta: `${busiestProject?.total || 0} tâches`, color: C.blue },
                { title: "À surveiller", value: riskyProject?.late > 0 ? riskyProject?.name : "Aucun risque", meta: riskyProject?.late > 0 ? `${riskyProject.late} retards` : "Tout est OK", color: riskyProject?.late > 0 ? C.red : C.green },
              ].map((x) => (
                <div key={x.title} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px" }}>
                  <p style={{ fontSize: "10px", color: C.textLight, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{x.title}</p>
                  <p style={{ fontSize: "12px", color: C.text, fontWeight: "800", margin: "0 0 5px", lineHeight: 1.35 }}>{x.value}</p>
                  <span style={{ fontSize: "11px", color: x.color, fontWeight: "800" }}>{x.meta}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={card()}>
            <p style={{ fontSize: "13px", fontWeight: "800", margin: "0 0 10px", color: C.text }}>🚨 Tâches en retard</p>
            {lateTasks.length === 0 ? (
              <div style={{ background: C.greenLight, border: `1px dashed ${C.greenMid}`, borderRadius: "12px", padding: "16px", textAlign: "center", color: C.greenDark, fontSize: "12px", fontWeight: "700" }}>Aucune tâche en retard 🎉</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {lateTasks.map((t) => (
                  <div key={t.id} style={{ background: C.redLight, border: "1px solid #f5c6c6", borderRadius: "10px", padding: "8px 10px" }}>
                    <p style={{ fontSize: "11px", color: C.text, fontWeight: "800", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</p>
                    <p style={{ fontSize: "10px", color: C.red, margin: "2px 0 0" }}>{formatDate(t.dueDate)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={card()}>
            <p style={{ fontSize: "13px", fontWeight: "800", margin: "0 0 10px", color: C.text }}>📊 Progression globale</p>
            <p style={{ fontSize: "36px", fontWeight: "900", color: C.pink, margin: "0 0 8px" }}>{totals.total ? Math.round((totals.done / totals.total) * 100) : 0}%</p>
            <div style={{ height: "8px", background: C.border, borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
              <div style={{ width: `${totals.total ? Math.round((totals.done / totals.total) * 100) : 0}%`, height: "8px", background: C.pink, borderRadius: "999px", transition: "width 0.7s ease" }} />
            </div>
            <p style={{ fontSize: "11px", color: C.textMuted, margin: 0 }}>{totals.done} terminées · {totals.progress} en cours · {totals.todo} à faire</p>
          </div>
        </div>

        <div style={{ ...card(), marginBottom: "22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ background: "#fafaf8", border: `1px solid ${C.border}`, borderRadius: "999px", padding: "10px 16px", minWidth: "280px", flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un projet..."
              style={{ border: "none", outline: "none", background: "transparent", width: "100%", fontSize: "13px", color: C.text }}
            />
          </div>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[["all", "Tous"], ["active", "Actifs"], ["finished", "Terminés"], ["late", "En retard"]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFiltre(key)}
                style={{ background: filtre === key ? C.greenLight : "#fff", color: filtre === key ? C.greenDark : C.textMuted, border: filtre === key ? `1px solid ${C.greenMid}` : `1px solid ${C.border}`, padding: "8px 13px", borderRadius: "999px", fontSize: "12px", fontWeight: filtre === key ? "800" : "500", cursor: "pointer", transition: "all 0.18s ease" }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={card({ textAlign: "center", padding: "40px" })}>
            <p style={{ color: C.textMuted }}>Chargement des projets...</p>
          </div>
        ) : projetsFiltres.length === 0 ? (
          <div style={card({ textAlign: "center", padding: "40px" })}>
            <div style={{ fontSize: "34px", marginBottom: "8px" }}>🌿</div>
            <p style={{ fontWeight: "800", color: C.text }}>Aucun projet trouvé</p>
            <p style={{ fontSize: "13px", color: C.textMuted }}>Essaie de modifier la recherche ou les filtres.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "16px" }}>
            {projetsFiltres.map((p) => {
              const healthStyle = getHealthStyle(p.health);
              const startLabel = formatDate(p.startDate);
              const endLabel = formatDate(p.endDate);
              return (
                <div
                  key={p.id}
                  onClick={() => navigate(`/projets/${p.id}`)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-5px)";
                    e.currentTarget.style.boxShadow = C.shadowMd;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = C.shadow;
                  }}
                  style={{ ...card({ cursor: "pointer", background: `linear-gradient(135deg, ${p.accent.bg}, #fff)`, transition: "all 0.22s ease" }) }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", marginBottom: "14px" }}>
                    <div>
                      <p style={{ fontSize: "16px", fontWeight: "900", color: C.text, margin: "0 0 6px", lineHeight: 1.45 }}>{p.name}</p>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", color: C.textMuted }}>Projet #{p.id}</span>
                        {p.managerName && <span style={{ fontSize: "10px", background: "#fff", border: `1px solid ${C.border}`, padding: "2px 7px", borderRadius: "999px", color: C.textMuted }}>Manager : {p.managerName}</span>}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                      <span style={{ height: "fit-content", background: p.late > 0 ? C.redLight : C.greenLight, color: p.late > 0 ? C.red : C.greenDark, border: p.late > 0 ? "1px solid #f5c6c6" : `1px solid ${C.greenMid}`, borderRadius: "999px", padding: "4px 9px", fontSize: "10px", fontWeight: "800", whiteSpace: "nowrap" }}>
                        {p.late > 0 ? `${p.late} en retard` : "Sur la bonne voie"}
                      </span>
                      <span style={{ height: "fit-content", background: healthStyle.bg, color: healthStyle.color, border: `1px solid ${healthStyle.border}`, borderRadius: "999px", padding: "4px 9px", fontSize: "10px", fontWeight: "800", whiteSpace: "nowrap" }}>
                        {p.health}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
                    <span style={{ fontSize: "11px", color: C.textMuted }}>Progression</span>
                    <span style={{ fontSize: "12px", color: p.accent.c, fontWeight: "900" }}>{p.progress}%</span>
                  </div>
                  <div style={{ height: "8px", background: "rgba(255,255,255,0.8)", borderRadius: "999px", overflow: "hidden", marginBottom: "8px" }}>
                    <div style={{ width: `${p.progress}%`, height: "8px", background: p.accent.c, borderRadius: "999px", transition: "width 0.7s ease" }} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "14px" }}>
                    {[["Total", p.total], ["Done", p.done], ["Cours", p.inProgress], ["Retard", p.late]].map(([label, value]) => (
                      <div key={label} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: "12px", padding: "9px 6px", textAlign: "center" }}>
                        <p style={{ fontSize: "17px", fontWeight: "900", margin: 0, color: label === "Retard" && value > 0 ? C.red : C.text }}>{value}</p>
                        <p style={{ fontSize: "10px", color: C.textLight, margin: "2px 0 0" }}>{label}</p>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                    <div style={{ background: "rgba(255,255,255,0.72)", border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px" }}>
                      <p style={{ fontSize: "11px", color: C.textMuted, fontWeight: "800", margin: "0 0 10px" }}>Calendrier du projet</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                          <span style={{ fontSize: "11px", color: C.textLight }}>Début</span>
                          <span style={{ fontSize: "11px", color: C.text, fontWeight: "800" }}>{startLabel}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                          <span style={{ fontSize: "11px", color: C.textLight }}>Fin</span>
                          <span style={{ fontSize: "11px", color: C.text, fontWeight: "800" }}>{endLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: "rgba(255,255,255,0.72)", border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px" }}>
                      <div style={{ background: "rgba(255,255,255,0.72)", border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px" }}>
                      <p style={{ fontSize: "11px", color: C.textMuted, fontWeight: "800", margin: "0 0 10px" }}>Tâches récentes</p>

                      {p.recentTasks && p.recentTasks.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {p.recentTasks.slice(0, 4).map((t, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.green }} />
                              <span style={{ fontSize: "11px", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {t.subject || t.name || "Tâche"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: "11px", color: C.textLight, margin: 0 }}>Aucune tâche récente</p>
                      )}
                    </div>
                    </div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.72)", border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px", marginBottom: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                      <div>
                        <p style={{ fontSize: "11px", color: C.textMuted, fontWeight: "800", margin: "0 0 8px" }}>Équipe</p>
                        {p.members.length === 0 ? (
                          <p style={{ fontSize: "11px", color: C.textLight, margin: 0 }}>Aucun membre</p>
                        ) : (
                          <p style={{ fontSize: "10px", color: C.textLight, margin: 0 }}>{p.members.length} membre(s)</p>
                        )}
                      </div>
                      {p.members.length > 0 && <AvatarStack members={p.members} />}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.border}`, paddingTop: "12px" }}>
                    <span style={{ fontSize: "11px", color: C.textMuted }}>Dernière mise à jour : {formatDate(p.updatedAt || p.updated_at)}</span>
                    <span style={{ fontSize: "12px", color: C.greenDark, fontWeight: "900" }}>Voir détails →</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}