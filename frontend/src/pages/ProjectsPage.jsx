import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProjets,
  getStats,
  getTaches,
  getProjectMembers,
  creerSousProjet,
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
  const [subFormOpen, setSubFormOpen] = useState(null);
  const [subDraft, setSubDraft] = useState({
    title: "", description: "", startDate: "", endDate: "", workload: ""
  });
  const [subLoading, setSubLoading] = useState(false);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const C = {
    green: "#c2c395", greenLight: "#f5f6ec", greenMid: "#dfe0c0", greenDark: "#5a6332",
    pink: "#d4538a", pinkLight: "#fce7f3", pinkMid: "#f4b8d4", pinkDark: "#7d1f52",
    blue: "#5a8ac4", blueLight: "#eaf2fb",
    orange: "#d4874a", orangeLight: "#fef3e8",
    redLight: "#fdecea", red: "#b23a3a",
    purple: "#9b8dc2", purpleLight: "#f3f0fa",
    bg: "#f6f6f2", card: "#ffffff",
    text: "#2d2d2a", textMuted: "#6e6e68", textLight: "#aaaaaa",
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
    background: C.card, borderRadius: "18px", padding: "20px",
    border: `1px solid ${C.border}`, boxShadow: C.shadow,
    transition: "all 0.22s ease", ...extra,
  });

  const btn = (extra = {}) => ({
    border: "none", borderRadius: "999px", padding: "8px 14px",
    fontSize: "11px", fontWeight: "700", cursor: "pointer",
    transition: "all 0.18s ease", ...extra,
  });

  const inp = (extra = {}) => ({
    width: "100%", boxSizing: "border-box",
    border: `1px solid ${C.border}`, borderRadius: "12px",
    padding: "9px 12px", outline: "none", fontSize: "12px",
    color: C.text, background: "#fff", ...extra,
  });

  const loadProjects = async () => {
    setLoading(true);
    try {
      const pRes = await getProjets();
      const list = pRes.data || [];
      setProjets(list);
      const sMap = {}, tMap = {}, mMap = {};
      await Promise.all(list.map(async (p) => {
        try {
          const [sr, tr, mr] = await Promise.all([
            getStats(p.id), getTaches(p.id), getProjectMembers(p.id),
          ]);
          sMap[p.id] = sr.data;
          tMap[p.id] = tr.data || [];
          mMap[p.id] = mr.data || [];
        } catch {
          sMap[p.id] = null; tMap[p.id] = []; mMap[p.id] = [];
        }
      }));
      setStatsMap(sMap); setTachesMap(tMap); setMembersMap(mMap);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadProjects(); }, []);

  const handleLogout = async () => {
    try { await logout(); } catch {}
    localStorage.removeItem("jwt"); localStorage.removeItem("user"); navigate("/");
  };

  const isDone = t => ["clos","done","termin","closed","finished","resolved","fermé"]
    .some(k => (t._links?.status?.title||"").toLowerCase().includes(k));
  const isInProgress = t => ["progress","cours"]
    .some(k => (t._links?.status?.title||"").toLowerCase().includes(k));
  const isOverdue = t => t.dueDate && new Date(t.dueDate) < new Date() && !isDone(t);

  const formatDate = (d) => {
    if (!d) return "Non définie";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "Non définie";
    return dt.toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" });
  };

  const currentUserId = String(user.id || user.userId || "");

  const getRoleForProject = (projectId) => {
    if (user.isAdmin) return "admin";
    const members = membersMap[projectId] || [];
    const m = members.find(m => String(m.op_user_id || m.id) === currentUserId);
    return m?.role || "member";
  };

  // Label rôle — une seule version, pas de doublon
  const roleLabel = (role) => {
    if (role === "admin") return "Administrateur";
    if (role === "manager") return "Chef de projet";
    return "Membre";
  };

  // Statut calculé à partir des données du projet
  const getStatut = (p) => {
    if (p.progress === 100) return { label: "Terminé", bg: C.greenLight, color: C.greenDark, border: C.greenMid };
    if (p.riskScore >= 70 || p.late >= 3) return { label: "Critique", bg: C.redLight, color: C.red, border: "#f5c6c6" };
    if (p.riskScore >= 40 || p.late > 0) return { label: "À risque", bg: C.orangeLight, color: "#7a4520", border: "#fdd9b5" };
    if (p.progress >= 60) return { label: "Avancé", bg: C.greenLight, color: C.greenDark, border: C.greenMid };
    if (p.progress >= 20) return { label: "En cours", bg: C.blueLight, color: C.blue, border: "#c5daf5" };
    return { label: "À démarrer", bg: "#fafaf8", color: C.textMuted, border: C.border };
  };

  const allTaches = useMemo(() => Object.values(tachesMap).flat(), [tachesMap]);

  const totals = useMemo(() => {
    const total = allTaches.length;
    const done = allTaches.filter(isDone).length;
    const progress = allTaches.filter(isInProgress).length;
    const late = allTaches.filter(isOverdue).length;
    return { total, done, progress, late };
  }, [allTaches]);

  const projectComputed = useMemo(() => {
    return projets.map((p, index) => {
      const kpis = statsMap[p.id]?.kpis || {};
      const tasks = tachesMap[p.id] || [];
      const members = membersMap[p.id] || [];
      const total = kpis.total ?? tasks.length;
      const done = kpis.done ?? tasks.filter(isDone).length;
      const inProgress = kpis.inProgress ?? tasks.filter(isInProgress).length;
      const progress = Number(p.progress ?? kpis.progressCount ?? (total > 0 ? Math.round((done/total)*100) : 0));
      const riskScore = Number(p.riskScore ?? 0);
      const late = Number(p.lateTasks ?? kpis.late ?? tasks.filter(isOverdue).length);
      const blocked = Number(p.blockedTasks ?? 0);
      const accent = accents[index % accents.length];
      const role = getRoleForProject(p.id);
      const canManage = role === "admin" || role === "manager";
      const recentTasks = [...tasks]
        .sort((a,b) => new Date(b.updatedAt||b.createdAt||0) - new Date(a.updatedAt||a.createdAt||0))
        .slice(0, 3);

      return {
        ...p, total, done, inProgress, late, blocked, progress, riskScore,
        tasks, recentTasks, members, accent, role, canManage,
        startDate: p.startDate || p.start_date || kpis.startDate || null,
        endDate: p.endDate || p.end_date || kpis.endDate || null,
        riskExplanation: p.aiSummary || p.ai_summary || "Score calculé à partir des retards, dépendances et avancement.",
        estimatesComplete: p.estimatesComplete !== undefined ? Boolean(p.estimatesComplete) : true,
        missingEstimates: Number(p.missingEstimates ?? 0),
        riskIsPartial: Boolean(p.riskIsPartial),
      };
    });
  }, [projets, statsMap, tachesMap, membersMap, currentUserId, user.isAdmin]);

  const projetsFiltres = useMemo(() => {
    return projectComputed.filter(p => {
      const matchSearch = (p.name||"").toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (filtre === "late") return p.late > 0;
      if (filtre === "blocked") return p.blocked > 0;
      if (filtre === "risk") return p.riskScore >= 40;
      if (filtre === "finished") return p.progress === 100;
      if (filtre === "active") return p.progress < 100;
      return true;
    });
  }, [projectComputed, search, filtre]);

  const topProject = [...projectComputed].sort((a,b) => b.progress - a.progress)[0];
  const busiestProject = [...projectComputed].sort((a,b) => b.total - a.total)[0];
  const riskyProject = [...projectComputed].sort((a,b) => b.riskScore - a.riskScore)[0];
  const lateTasks = allTaches.filter(isOverdue).slice(0, 5);
  const globalProgress = projectComputed.length
    ? Math.round(projectComputed.reduce((s,p) => s+(p.progress||0), 0) / projectComputed.length)
    : 0;
  const avgRisk = projectComputed.length
    ? Math.round(projectComputed.reduce((s,p) => s+(p.riskScore||0), 0) / projectComputed.length)
    : 0;
  const totalBlocked = projectComputed.reduce((s,p) => s+(p.blocked||0), 0);

  const AvatarStack = ({ members }) => (
    <div style={{ display:"flex", alignItems:"center" }}>
      {members.slice(0,5).map((m,i) => (
        <div key={m.op_user_id||m.id||i} title={m.name} style={{
          width:"28px", height:"28px", borderRadius:"50%",
          background: accents[i%accents.length].bg,
          border: "2px solid #fff", marginLeft: i===0?0:"-7px",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:"10px", fontWeight:"700", color: accents[i%accents.length].dark,
          boxShadow: C.shadow,
        }}>{m.name?.charAt(0)?.toUpperCase()||"?"}</div>
      ))}
      {members.length > 5 && (
        <div style={{ width:"28px", height:"28px", borderRadius:"50%", background: C.greenLight, border:"2px solid #fff", marginLeft:"-7px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"10px", color: C.greenDark, fontWeight:"700" }}>
          +{members.length-5}
        </div>
      )}
    </div>
  );

  const createSubProject = async (parentId) => {
    if (!subDraft.title.trim() || !subDraft.description.trim())
      return alert("Titre et description obligatoires.");
    setSubLoading(true);
    try {
      await creerSousProjet(parentId, subDraft);
      setSubDraft({ title:"", description:"", startDate:"", endDate:"", workload:"" });
      setSubFormOpen(null);
      await loadProjects();
    } catch (err) {
      alert(err.response?.data?.message || "Erreur création sous-projet.");
    } finally { setSubLoading(false); }
  };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", minHeight:"100vh", background:C.bg, fontFamily:"'Segoe UI',Arial,sans-serif" }}>

      {/* SIDEBAR */}
      <aside style={{ background:"#fff", borderRight:`1px solid ${C.border}`, padding:"24px 0", display:"flex", flexDirection:"column", justifyContent:"space-between", position:"sticky", top:0, height:"100vh", overflowY:"auto", boxShadow:"2px 0 8px rgba(0,0,0,0.03)" }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"0 20px 28px" }}>
            <div style={{ width:"32px", height:"32px", borderRadius:"10px", background:C.green, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px" }}>🐝</div>
            <span style={{ fontSize:"16px", fontWeight:"700", color:C.text }}>lightproject</span>
          </div>
          <div style={{ padding:"0 12px" }}>
            {[
              { label:"Dashboard", path:"/dashboard" },
              { label:"Mes projets", path:"/projets", active:true },
              { label:"Mes tâches", path:"/taches" },
              { label:"Analyse IA", path:"/ai" },
            ].map(item => (
              <div key={item.path} onClick={() => navigate(item.path)} style={{
                padding:"10px 14px", borderRadius:"12px", fontSize:"13px", cursor:"pointer", marginBottom:"3px",
                color: item.active ? C.greenDark : C.textMuted,
                background: item.active ? C.greenLight : "transparent",
                fontWeight: item.active ? "600" : "400",
                borderLeft: item.active ? `3px solid ${C.green}` : "3px solid transparent",
              }}>{item.label}</div>
            ))}
          </div>
          <div style={{ height:"1px", background:C.border, margin:"16px" }}/>
          <div style={{ padding:"0 12px" }}>
            <p style={{ fontSize:"10px", color:C.textLight, textTransform:"uppercase", letterSpacing:"1px", padding:"0 14px", margin:"0 0 6px" }}>Compte</p>
            <div style={{ padding:"10px 14px", borderRadius:"12px", fontSize:"13px", color:C.textMuted, cursor:"pointer" }} onClick={() => navigate("/profil")}>Mon profil</div>
            <div style={{ padding:"10px 14px", borderRadius:"12px", fontSize:"13px", color:C.pink, cursor:"pointer", fontWeight:"500" }} onClick={handleLogout}>Déconnexion</div>
          </div>
        </div>
        <div style={{ margin:"0 16px" }}>
          <div style={{ background:C.greenLight, borderRadius:"14px", padding:"12px", display:"flex", alignItems:"center", gap:"10px", border:`1px solid ${C.greenMid}` }}>
            <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:C.green, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"15px", fontWeight:"700", color:"#fff" }}>
              {user.name?.charAt(0)?.toUpperCase()||"A"}
            </div>
            <div>
              <p style={{ fontSize:"13px", fontWeight:"600", color:C.text, margin:0 }}>{user.name||"Admin"}</p>
              <p style={{ fontSize:"11px", color:C.textMuted, margin:0 }}>{user.isAdmin?"Administrateur":"Membre"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ padding:"28px", overflowY:"auto" }}>

        {/* HEADER */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"24px", gap:"12px", flexWrap:"wrap" }}>
          <div>
            <h1 style={{ fontSize:"24px", fontWeight:"800", color:C.text, margin:0 }}>Mes projets 📁</h1>
            <p style={{ fontSize:"12px", color:C.textMuted, margin:"5px 0 0" }}>Progression, risque et statut synchronisés depuis OpenProject.</p>
          </div>
          <button onClick={loadProjects} style={btn({ background:C.green, color:"#fff" })}>↻ Rafraîchir</button>
        </div>

        {/* KPI CARDS */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"14px", marginBottom:"20px" }}>
          {[
            { label:"Projets", value:projets.length, bg:C.green, color:"#fff", sub:"visibles" },
            { label:"Progression", value:`${globalProgress}%`, bg:C.pinkLight, color:C.pinkDark, sub:"moyenne" },
            { label:"Risque moyen", value:`${avgRisk}%`, bg:avgRisk>=40?C.orangeLight:"#fff", color:avgRisk>=40?"#7a4520":C.text, sub:"risk score" },
            { label:"Bloquées", value:totalBlocked, bg:totalBlocked>0?C.redLight:"#fff", color:totalBlocked>0?C.red:C.textMuted, sub:"tâches" },
            { label:"En retard", value:totals.late, bg:totals.late>0?C.redLight:"#fff", color:totals.late>0?C.red:C.textMuted, sub:"tâches" },
          ].map(item => (
            <div key={item.label} style={{ ...card({ padding:"18px", background:item.bg }) }}
              onMouseEnter={e => { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow=C.shadowMd; }}
              onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow=C.shadow; }}>
              <p style={{ fontSize:"10px", textTransform:"uppercase", color:item.color, opacity:0.75, margin:"0 0 8px", letterSpacing:"0.6px" }}>{item.label}</p>
              <p style={{ fontSize:"30px", fontWeight:"800", color:item.color, margin:0 }}>{item.value}</p>
              <p style={{ fontSize:"11px", color:item.color, opacity:0.6, margin:"3px 0 0" }}>{item.sub}</p>
            </div>
          ))}
        </div>

        {/* APERÇU INTELLIGENT */}
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 1fr", gap:"14px", marginBottom:"20px" }}>
          <div style={{ ...card({ background:"linear-gradient(135deg,#fff,#f5f6ec)" }) }}>
            <p style={{ fontSize:"13px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>✨ Aperçu intelligent</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px" }}>
              {[
                { title:"Plus avancé", value:topProject?.name||"—", meta:`${topProject?.progress||0}%`, color:C.green },
                { title:"Plus chargé", value:busiestProject?.name||"—", meta:`${busiestProject?.total||0} tâches`, color:C.blue },
                { title:"Plus risqué", value:riskyProject?.riskScore>0?riskyProject?.name:"Aucun", meta:`${riskyProject?.riskScore||0}%`, color:riskyProject?.riskScore>=40?C.red:C.green },
              ].map(x => (
                <div key={x.title} style={{ background:"#fff", border:`1px solid ${C.border}`, borderRadius:"14px", padding:"12px" }}>
                  <p style={{ fontSize:"10px", color:C.textLight, margin:"0 0 6px", textTransform:"uppercase", letterSpacing:"0.5px" }}>{x.title}</p>
                  <p style={{ fontSize:"12px", color:C.text, fontWeight:"700", margin:"0 0 5px", lineHeight:1.35 }}>{x.value}</p>
                  <span style={{ fontSize:"11px", color:x.color, fontWeight:"700" }}>{x.meta}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={card()}>
            <p style={{ fontSize:"13px", fontWeight:"700", margin:"0 0 10px", color:C.text }}>🚨 Tâches en retard</p>
            {lateTasks.length===0 ? (
              <div style={{ background:C.greenLight, border:`1px dashed ${C.greenMid}`, borderRadius:"12px", padding:"16px", textAlign:"center", color:C.greenDark, fontSize:"12px", fontWeight:"600" }}>Aucune tâche en retard 🎉</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:"7px" }}>
                {lateTasks.map(t => (
                  <div key={t.id} style={{ background:C.redLight, border:"1px solid #f5c6c6", borderRadius:"10px", padding:"8px 10px" }}>
                    <p style={{ fontSize:"11px", color:C.text, fontWeight:"700", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.subject}</p>
                    <p style={{ fontSize:"10px", color:C.red, margin:"2px 0 0" }}>{formatDate(t.dueDate)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={card()}>
            <p style={{ fontSize:"13px", fontWeight:"700", margin:"0 0 10px", color:C.text }}>📊 Progression globale</p>
            <p style={{ fontSize:"36px", fontWeight:"800", color:C.pink, margin:"0 0 8px" }}>{globalProgress}%</p>
            <div style={{ height:"8px", background:C.border, borderRadius:"999px", overflow:"hidden", marginBottom:"10px" }}>
              <div style={{ width:`${globalProgress}%`, height:"8px", background:C.pink, borderRadius:"999px", transition:"width 0.7s ease" }}/>
            </div>
            <p style={{ fontSize:"11px", color:C.textMuted, margin:0 }}>Moyenne de tous les projets</p>
          </div>
        </div>

        {/* BARRE RECHERCHE + FILTRES */}
        <div style={{ ...card({ marginBottom:"20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px", flexWrap:"wrap" }) }}>
          <div style={{ background:"#fafaf8", border:`1px solid ${C.border}`, borderRadius:"999px", padding:"10px 16px", minWidth:"260px", flex:1, display:"flex", alignItems:"center", gap:"8px" }}>
            <span>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un projet..."
              style={{ border:"none", outline:"none", background:"transparent", width:"100%", fontSize:"13px", color:C.text }}/>
          </div>
          <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
            {[["all","Tous"],["active","Actifs"],["finished","Terminés"],["late","En retard"],["blocked","Bloqués"],["risk","À risque"]].map(([key,label]) => (
              <button key={key} onClick={() => setFiltre(key)} style={btn({
                background: filtre===key ? C.greenLight : "#fff",
                color: filtre===key ? C.greenDark : C.textMuted,
                border: filtre===key ? `1px solid ${C.greenMid}` : `1px solid ${C.border}`,
              })}>{label}</button>
            ))}
          </div>
        </div>

        {/* LISTE PROJETS */}
        {loading ? (
          <div style={card({ textAlign:"center", padding:"40px" })}>
            <div style={{ fontSize:"28px", marginBottom:"8px" }}>🐝</div>
            <p style={{ color:C.textMuted }}>Chargement des projets...</p>
          </div>
        ) : projetsFiltres.length===0 ? (
          <div style={card({ textAlign:"center", padding:"40px" })}>
            <div style={{ fontSize:"34px", marginBottom:"8px" }}>🌿</div>
            <p style={{ fontWeight:"700", color:C.text }}>Aucun projet trouvé</p>
            <p style={{ fontSize:"13px", color:C.textMuted }}>Essaie de modifier la recherche ou les filtres.</p>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(440px,1fr))", gap:"16px" }}>
            {projetsFiltres.map(p => {
              const statut = getStatut(p);
              return (
                <div key={p.id}
                  onClick={() => navigate(`/projets/${p.id}`)}
                  onMouseEnter={e => { e.currentTarget.style.transform="translateY(-5px)"; e.currentTarget.style.boxShadow=C.shadowMd; }}
                  onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow=C.shadow; }}
                  style={{ ...card({ cursor:"pointer", background:`linear-gradient(135deg,${p.accent.bg},#fff)` }) }}>

                  {/* EN-TÊTE CARTE */}
                  <div style={{ display:"flex", justifyContent:"space-between", gap:"10px", marginBottom:"12px" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:"16px", fontWeight:"800", color:C.text, margin:"0 0 6px", lineHeight:1.35, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</p>
                      <div style={{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ fontSize:"10px", color:C.textMuted }}>#{p.id}</span>
                        {/* RÔLE — un seul label, pas de doublon */}
                        <span style={{ fontSize:"10px", background:"#fff", border:`1px solid ${C.border}`, padding:"2px 8px", borderRadius:"999px", color:C.textMuted }}>{roleLabel(p.role)}</span>
                        {p.managerName && <span style={{ fontSize:"10px", background:"#fff", border:`1px solid ${C.border}`, padding:"2px 8px", borderRadius:"999px", color:C.textMuted }}>Chef : {p.managerName}</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"5px", flexShrink:0 }}>
                      {/* STATUT du projet — remplace les badges health/risk */}
                      <span style={{ background:statut.bg, color:statut.color, border:`1px solid ${statut.border}`, borderRadius:"999px", padding:"4px 10px", fontSize:"10px", fontWeight:"700", whiteSpace:"nowrap" }}>
                        {statut.label}
                      </span>
                      {/* RISQUE en badge séparé, uniquement si > 0 */}
                      {p.riskScore > 0 && (
                        <span style={{ background:p.riskScore>=70?C.redLight:p.riskScore>=40?C.orangeLight:C.greenLight, color:p.riskScore>=70?C.red:p.riskScore>=40?"#7a4520":C.greenDark, border:`1px solid ${p.riskScore>=70?"#f5c6c6":p.riskScore>=40?"#fdd9b5":C.greenMid}`, borderRadius:"999px", padding:"4px 10px", fontSize:"10px", fontWeight:"700", whiteSpace:"nowrap" }}>
                          Risque {p.riskScore}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* BARRE DE PROGRESSION */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"5px" }}>
                    <span style={{ fontSize:"11px", color:C.textMuted }}>Progression</span>
                    <span style={{ fontSize:"12px", color:p.accent.c, fontWeight:"800" }}>{p.progress}%</span>
                  </div>
                  <div style={{ height:"7px", background:"rgba(255,255,255,0.8)", borderRadius:"999px", overflow:"hidden", marginBottom:"10px" }}>
                    <div style={{ width:`${p.progress}%`, height:"7px", background:p.accent.c, borderRadius:"999px", transition:"width 0.7s ease" }}/>
                  </div>

                  {/* EXPLICATION RISQUE — à côté du risque, pas de la progression */}
                  {p.riskScore > 0 && p.riskExplanation && (
                    <div style={{ background:"rgba(255,255,255,0.65)", border:`1px solid ${p.riskScore>=40?"#fdd9b5":C.greenMid}`, borderRadius:"12px", padding:"9px 12px", marginBottom:"12px" }}>
                      <p style={{ fontSize:"10px", color:C.textLight, margin:"0 0 3px", textTransform:"uppercase", letterSpacing:"0.5px", fontWeight:"700" }}>Analyse du risque</p>
                      <p style={{ fontSize:"11px", color:p.riskScore>=40?"#7a4520":C.greenDark, margin:0, lineHeight:1.5, fontWeight:"600" }}>{p.riskExplanation}</p>
                    </div>
                  )}

                  {/* COMPTEURS TÂCHES */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"6px", marginBottom:"12px" }}>
                    {[
                      ["Total", p.total, false],
                      ["Terminé", p.done, false],
                      ["En cours", p.inProgress, false],
                      ["Retard", p.late, p.late > 0],
                      ["Bloquées", p.blocked, p.blocked > 0],
                    ].map(([label, value, isAlert]) => (
                      <div key={label} style={{ background:"#fff", border:`1px solid ${isAlert?"#f5c6c6":C.border}`, borderRadius:"10px", padding:"8px 6px", textAlign:"center" }}>
                        <p style={{ fontSize:"16px", fontWeight:"800", margin:0, color:isAlert?C.red:C.text }}>{value}</p>
                        <p style={{ fontSize:"9px", color:isAlert?C.red:C.textLight, margin:"2px 0 0" }}>{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* CALENDRIER + TÂCHES RÉCENTES */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", marginBottom:"12px" }}>
                    <div style={{ background:"rgba(255,255,255,0.72)", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px" }}>
                      <p style={{ fontSize:"10px", color:C.textMuted, fontWeight:"700", margin:"0 0 8px", textTransform:"uppercase", letterSpacing:"0.5px" }}>Calendrier</p>
                      <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between" }}>
                          <span style={{ fontSize:"10px", color:C.textLight }}>Début</span>
                          <span style={{ fontSize:"10px", color:C.text, fontWeight:"700" }}>{formatDate(p.startDate)}</span>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between" }}>
                          <span style={{ fontSize:"10px", color:C.textLight }}>Fin</span>
                          <span style={{ fontSize:"10px", color:C.text, fontWeight:"700" }}>{formatDate(p.endDate)}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ background:"rgba(255,255,255,0.72)", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px" }}>
                      <p style={{ fontSize:"10px", color:C.textMuted, fontWeight:"700", margin:"0 0 8px", textTransform:"uppercase", letterSpacing:"0.5px" }}>Tâches récentes</p>
                      {p.recentTasks.length > 0 ? (
                        <div style={{ display:"flex", flexDirection:"column", gap:"5px" }}>
                          {p.recentTasks.map((t,i) => (
                            <div key={i} style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                              <div style={{ width:"5px", height:"5px", borderRadius:"50%", background:p.accent.c, flexShrink:0 }}/>
                              <span style={{ fontSize:"10px", color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.subject||t.name||"Tâche"}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p style={{ fontSize:"10px", color:C.textLight, margin:0 }}>Aucune tâche</p>}
                    </div>
                  </div>

                  {/* ÉQUIPE */}
                  <div style={{ background:"rgba(255,255,255,0.72)", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px", marginBottom:"12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <p style={{ fontSize:"10px", color:C.textMuted, fontWeight:"700", margin:"0 0 4px", textTransform:"uppercase", letterSpacing:"0.5px" }}>Équipe</p>
                      <p style={{ fontSize:"10px", color:C.textLight, margin:0 }}>{p.members.length} membre(s)</p>
                    </div>
                    {p.members.length > 0 && <AvatarStack members={p.members}/>}
                  </div>

                  {/* AVERTISSEMENT ESTIMATIONS */}
                  {(p.riskIsPartial || !p.estimatesComplete) && (
                    <div style={{ background:C.orangeLight, border:"1px solid #fdd9b5", borderRadius:"10px", padding:"8px 12px", marginBottom:"12px" }}>
                      <p style={{ fontSize:"10px", color:"#7a4520", margin:0, fontWeight:"700" }}>
                        {p.riskIsPartial ? "Score de risque partiel" : "Progression simplifiée"}
                        {p.missingEstimates > 0 ? ` · ${p.missingEstimates} estimation(s) manquante(s)` : ""}
                      </p>
                    </div>
                  )}

                  {/* FORMULAIRE SOUS-PROJET */}
                  {subFormOpen === p.id && p.canManage && (
                    <div onClick={e => e.stopPropagation()} style={{ background:"rgba(255,255,255,0.9)", border:`1px solid ${C.border}`, borderRadius:"14px", padding:"14px", marginBottom:"12px" }}>
                      <p style={{ fontSize:"12px", fontWeight:"700", color:C.text, margin:"0 0 10px" }}>Créer un sous-projet</p>
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        <input style={inp()} placeholder="Titre *" value={subDraft.title} onChange={e => setSubDraft({...subDraft, title:e.target.value})}/>
                        <textarea style={inp({ minHeight:"56px", resize:"vertical" })} placeholder="Description *" value={subDraft.description} onChange={e => setSubDraft({...subDraft, description:e.target.value})}/>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                          <div>
                            <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Date de début</label>
                            <input style={inp()} type="date" value={subDraft.startDate} onChange={e => setSubDraft({...subDraft, startDate:e.target.value})}/>
                          </div>
                          <div>
                            <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Date de fin</label>
                            <input style={inp()} type="date" value={subDraft.endDate} onChange={e => setSubDraft({...subDraft, endDate:e.target.value})}/>
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Workload (heures)</label>
                          <input style={inp()} type="number" min="0" placeholder="Ex: 40" value={subDraft.workload} onChange={e => setSubDraft({...subDraft, workload:e.target.value})}/>
                        </div>
                        <div style={{ display:"flex", gap:"8px" }}>
                          <button onClick={() => createSubProject(p.id)} disabled={subLoading}
                            style={btn({ background:C.purple, color:"#fff", opacity:subLoading?0.7:1 })}>
                            {subLoading ? "Création..." : "Créer"}
                          </button>
                          <button onClick={() => setSubFormOpen(null)} style={btn({ background:"#fff", color:C.textMuted, border:`1px solid ${C.border}` })}>Annuler</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* FOOTER CARTE — sans bouton Synchroniser */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:`1px solid ${C.border}`, paddingTop:"12px", gap:"8px", flexWrap:"wrap" }}>
                    <span style={{ fontSize:"10px", color:C.textLight }}>Mis à jour : {formatDate(p.updatedAt||p.updated_at)}</span>
                    <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                      {p.canManage && (
                        <button onClick={e => { e.stopPropagation(); setSubFormOpen(subFormOpen===p.id?null:p.id); }}
                          style={btn({ background:C.purpleLight, color:"#4a3a7a", border:`1px solid ${C.border}` })}>
                          + Sous-projet
                        </button>
                      )}
                      <span style={{ fontSize:"12px", color:C.greenDark, fontWeight:"700" }}>Voir détails →</span>
                    </div>
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