import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fetchProjects, fetchStats, fetchMembers, fetchTasks } from "../services/api";

const isDone = t => ["clos","done","termin"].some(k => (t._links?.status?.title||"").toLowerCase().includes(k));
  const isInProgress = t => ["progress","cours"].some(k => (t._links?.status?.title||"").toLowerCase().includes(k));
  const isTodo = t => !isDone(t) && !isInProgress(t);
  
export default function Dashboard() {
  const [projets, setProjets] = useState([]);
  const [statsMap, setStatsMap] = useState({});
  const [tachesMap, setTachesMap] = useState({});
  const [membres, setMembres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kanbanFilter, setKanbanFilter] = useState("all");
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  useEffect(() => {
     Promise.all([fetchProjects(), fetchMembers()])
  .then(async ([list, membres]) => {
    setProjets(list || []);
    setMembres(membres || []);
    const sMap = {}, tMap = {};
    await Promise.all((list || []).map(async (p) => {
      try {
        const [sr, tr] = await Promise.all([fetchStats(p.id), fetchTasks(p.id)]);
        sMap[p.id] = sr;
        tMap[p.id] = tr || [];
      } catch { sMap[p.id] = null; tMap[p.id] = []; }
    }));
    setStatsMap(sMap); setTachesMap(tMap); setLoading(false);
  }).catch(() => setLoading(false));
  }, []);

  const handleLogout = () => {
  localStorage.removeItem("jwt");
  localStorage.removeItem("user");
  navigate("/");
};    


  const allTaches = useMemo(() => Object.values(tachesMap).flat(), [tachesMap]);
  const now = useMemo(() => new Date(), []);

  
  const isOverdue = t => t.dueDate && new Date(t.dueDate) < now && !isDone(t);
  const isUpcoming = t => {
    if (!t.dueDate || isDone(t)) return false;
    const diff = (new Date(t.dueDate) - now) / 86400000;
    return diff >= 0 && diff <= 7;
  };

  const totalTaches = allTaches.length;
  const totalDone = allTaches.filter(isDone).length;
  const totalInProgress = allTaches.filter(isInProgress).length;
  const totalTodo = allTaches.filter(isTodo).length;
  const totalLate = allTaches.filter(isOverdue).length;
  const totalProgress = totalTaches > 0 ? Math.round((totalDone / totalTaches) * 100) : 0;
  const upcomingTasks = allTaches.filter(isUpcoming).sort((a,b) => new Date(a.dueDate)-new Date(b.dueDate));
  const overdueTasks = allTaches.filter(isOverdue).sort((a,b) => new Date(a.dueDate)-new Date(b.dueDate));
  const recentTasks = [...allTaches].sort((a,b) => new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)).slice(0,5);

  const productivityScore = useMemo(() => {
    if (totalTaches === 0) return 75;
    const completionScore = Math.round((totalDone / totalTaches) * 50);
    const punctualityScore = Math.round(((totalTaches - totalLate) / totalTaches) * 30);
    const activityScore = Math.min(20, projets.length * 5 + (totalInProgress > 0 ? 10 : 0));
    return Math.min(100, completionScore + punctualityScore + activityScore);
  }, [totalTaches, totalDone, totalLate, totalInProgress, projets.length]);

  const scoreLabel = productivityScore >= 80 ? "Excellent" : productivityScore >= 60 ? "Bien" : productivityScore >= 40 ? "Moyen" : "À améliorer";
  const scoreColor = productivityScore >= 80 ? "#9FB878" : productivityScore >= 60 ? "#9FB878" : productivityScore >= 40 ? "#c27a2a" : "#b23a3a";
  const scoreBg = productivityScore >= 80 ? "#f0f2e0" : productivityScore >= 60 ? "#fef9e7" : productivityScore >= 40 ? "#fff3e0" : "#fdecea";

  const statusDist = useMemo(() => allTaches.reduce((acc,t) => {
    const s = t._links?.status?.title || "Inconnu";
    acc[s] = (acc[s]||0)+1; return acc;
  }, {}), [allTaches]);

  const weeklyVelocity = useMemo(() => Object.values(statsMap).reduce((acc,s) => {
    if (!s?.weeklyVelocity) return acc;
    Object.entries(s.weeklyVelocity).forEach(([k,v]) => { acc[k]=(acc[k]||0)+v; });
    return acc;
  }, {}), [statsMap]);

  const workloadAll = useMemo(() => Object.values(statsMap).reduce((acc,s) => {
    if (!s?.workloadByMember) return acc;
    Object.entries(s.workloadByMember).forEach(([name,data]) => {
      if (!acc[name]) acc[name] = {count:0,done:0,late:0};
      acc[name].count += data.count||0; acc[name].done += data.done||0; acc[name].late += data.late||0;
    });
    return acc;
  }, {}), [statsMap]);

  const weekEntries = Object.entries(weeklyVelocity).sort((a,b)=>a[0].localeCompare(b[0])).slice(-7);
  const maxWeekVal = Math.max(...weekEntries.map(e=>e[1]),1);

  const filteredKanban = useMemo(() => {
    if (kanbanFilter==="todo") return allTaches.filter(isTodo);
    if (kanbanFilter==="progress") return allTaches.filter(isInProgress);
    if (kanbanFilter==="done") return allTaches.filter(isDone);
    return allTaches;
  }, [allTaches, kanbanFilter]);

  // PALETTE - vert remplacé par #9FB878
  const C = {
    green: "#9FB878", greenLight: "#f5f6ec", greenMid: "#dfe0c0", greenDark: "#5a6332",
    pink: "#d4538a", pinkLight: "#fce7f3", pinkMid: "#f4b8d4", pinkDark: "#7d1f52",
    orange: "#d4874a", orangeLight: "#fef3e8",
    blue: "#5a8ac4", blueLight: "#eaf2fb",
    bg: "#f6f6f2", card: "#ffffff",
    text: "#2d2d2a", textMuted: "#6e6e68", textLight: "#aaaaaa",
    border: "#e8e8e0",
    shadow: "0 2px 8px rgba(0,0,0,0.05)",
    shadowMd: "0 4px 16px rgba(0,0,0,0.07)",
  };

  const accentColors = [C.green, C.pink, C.orange, C.blue, "#9b8dc2"];
  const accentBg = [C.greenLight, C.pinkLight, C.orangeLight, C.blueLight, "#f3f0fa"];
  const accentDark = [C.greenDark, C.pinkDark, "#7a4520", "#2a4f82", "#4a3a7a"];

  const card = (extra={}) => ({
    background: C.card, borderRadius: "18px", padding: "20px",
    border: `1px solid ${C.border}`, boxShadow: C.shadow, ...extra
  });

  const CircProgress = ({val, size=68, stroke=C.green, bg=C.greenLight, label, sub}) => {
    const r=(size-10)/2, c=2*Math.PI*r, off=c-(Math.min(val,100)/100)*c;
    return (
      <div style={{textAlign:"center"}}>
        <svg width={size} height={size}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth="8"/>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={stroke} strokeWidth="8"
            strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} style={{transition:"stroke-dashoffset 0.6s"}}/>
          <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
            fontSize="12" fontWeight="700" fill={C.text}>{val}%</text>
        </svg>
        {label && <p style={{fontSize:"11px",fontWeight:"600",color:C.text,margin:"3px 0 0"}}>{label}</p>}
        {sub && <p style={{fontSize:"10px",color:C.textLight,margin:"1px 0 0"}}>{sub}</p>}
      </div>
    );
  };

  const DonutChart = ({data, size=88}) => {
    const total = data.reduce((a,d)=>a+d.val,0)||1;
    const r=30, cx=44, cy=44, circ=2*Math.PI*r;
    let offset = 0;
    const slices = data.map(d => {
      const dash = (d.val/total)*circ;
      const sl = {offset, dash, color: d.color};
      offset += dash; return sl;
    });
    return (
      <svg width={size} height={size} viewBox="0 0 88 88">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.border} strokeWidth="13"/>
        {slices.map((sl,i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={sl.color} strokeWidth="13"
            strokeDasharray={`${sl.dash} ${circ-sl.dash}`}
            strokeDashoffset={circ/4-sl.offset}
            style={{transition:"stroke-dasharray 0.6s"}}/>
        ))}
        <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle"
          fontSize="14" fontWeight="700" fill={C.text}>{total}</text>
      </svg>
    );
  };

  const StatusBadge = ({title}) => {
    const s=(title||"").toLowerCase();
    const done=["clos","done","termin"].some(k=>s.includes(k));
    const prog=["progress","cours"].some(k=>s.includes(k));
    const bg=done?C.greenLight:prog?C.blueLight:C.pinkLight;
    const tc=done?C.greenDark:prog?C.blue:C.pinkDark;
    return <span style={{fontSize:"10px",background:bg,color:tc,padding:"2px 8px",borderRadius:"999px",fontWeight:"600",whiteSpace:"nowrap",border:`1px solid ${done?C.greenMid:prog?"#c5daf5":C.pinkMid}`}}>{title||"—"}</span>;
  };

  return (
    <div style={{display:"grid",gridTemplateColumns:"220px 1fr",minHeight:"100vh",background:C.bg,fontFamily:"'Segoe UI',Arial,sans-serif"}}>

      {/* SIDEBAR */}
      <aside style={{background:"#fff",borderRight:`1px solid ${C.border}`,padding:"24px 0",display:"flex",flexDirection:"column",justifyContent:"space-between",position:"sticky",top:0,height:"100vh",overflowY:"auto",boxShadow:"2px 0 8px rgba(0,0,0,0.03)"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"0 20px 28px"}}>
            <div style={{width:"32px",height:"32px",borderRadius:"10px",background:C.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",boxShadow:`0 2px 8px ${C.greenMid}`}}>🐝</div>
            <span style={{fontSize:"16px",fontWeight:"700",color:C.text}}>lightproject</span>
          </div>
          <div style={{padding:"0 12px"}}>
            {[
              {label:"Dashboard",path:"/dashboard",active:true},
              {label:"Mes projets",path:"/projets"},
              {label:"Mes tâches",path:"/taches"},
              {label:"Analyse IA",path:"/ai"},
            ].map(item => (
              <div key={item.path} onClick={()=>navigate(item.path)}
                style={{padding:"10px 14px",borderRadius:"12px",fontSize:"13px",cursor:"pointer",marginBottom:"3px",
                  color:item.active?C.greenDark:C.textMuted,
                  background:item.active?C.greenLight:"transparent",
                  fontWeight:item.active?"600":"400",
                  borderLeft:item.active?`3px solid ${C.green}`:"3px solid transparent",
                  transition:"all 0.15s"}}>
                {item.label}
              </div>
            ))}
          </div>
          <div style={{height:"1px",background:C.border,margin:"16px"}}/>
          <div style={{padding:"0 12px"}}>
            <p style={{fontSize:"10px",color:C.textLight,textTransform:"uppercase",letterSpacing:"1px",padding:"0 14px",margin:"0 0 6px"}}>Compte</p>
            <div style={{padding:"10px 14px",borderRadius:"12px",fontSize:"13px",color:C.textMuted,cursor:"pointer",marginBottom:"2px"}} onClick={()=>navigate("/profil")}>Mon profil</div>
            <div style={{padding:"10px 14px",borderRadius:"12px",fontSize:"13px",color:C.pink,cursor:"pointer",fontWeight:"500"}} onClick={handleLogout}>Déconnexion</div>
          </div>
        </div>
        <div style={{margin:"0 16px"}}>
          <div style={{background:C.greenLight,borderRadius:"14px",padding:"12px",display:"flex",alignItems:"center",gap:"10px",border:`1px solid ${C.greenMid}`}}>
            <div style={{width:"36px",height:"36px",borderRadius:"50%",background:C.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"15px",fontWeight:"700",color:"#fff",flexShrink:0,boxShadow:`0 2px 6px ${C.greenMid}`}}>
              {user.name?.charAt(0)?.toUpperCase()||"A"}
            </div>
            <div>
              <p style={{fontSize:"13px",fontWeight:"600",color:C.text,margin:0}}>{user.name||"Admin"}</p>
              <p style={{fontSize:"11px",color:C.textMuted,margin:0}}>{user.isAdmin?"Administrateur":"Membre"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{padding:"28px",overflowY:"auto"}}>

        {/* HEADER */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"24px",flexWrap:"wrap",gap:"12px"}}>
          <div>
            <h1 style={{fontSize:"22px",fontWeight:"700",color:C.text,margin:0}}>
              Good Morning, {user.name?.split(" ")[0]||"Admin"} 👋
            </h1>
            <p style={{fontSize:"12px",color:C.textMuted,margin:"4px 0 0"}}>
              {new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})} • Tableau de bord
            </p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
            <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:"999px",padding:"8px 16px",fontSize:"13px",color:C.textLight,cursor:"pointer",boxShadow:C.shadow}}>🔍 Rechercher...</div>
            <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:"999px",padding:"6px 16px",fontSize:"13px",color:C.text,boxShadow:C.shadow}}><b>{projets.length}</b> Projets</div>
            <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:"999px",padding:"6px 16px",fontSize:"13px",color:C.text,boxShadow:C.shadow}}><b>{totalTaches}</b> Tâches</div>
            {user.isAdmin && (
              <button style={{background:C.pink,color:"#fff",border:"none",padding:"8px 18px",borderRadius:"999px",fontSize:"13px",fontWeight:"600",cursor:"pointer",boxShadow:`0 3px 10px ${C.pinkMid}`}}
                onClick={()=>navigate("/projets/nouveau")}>+ Nouveau projet</button>
            )}
            <div style={{width:"36px",height:"36px",borderRadius:"50%",background:C.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",fontWeight:"700",color:"#fff",boxShadow:`0 2px 6px ${C.greenMid}`}}>
              {user.name?.charAt(0)?.toUpperCase()||"A"}
            </div>
          </div>
        </div>

        {/* KPI */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"12px",marginBottom:"24px"}}>
          {[
            {label:"Projets actifs",val:projets.length,bg:C.green,tc:"#fff",sub:"total"},
            {label:"Tâches totales",val:totalTaches,bg:"#fff",tc:C.text,sub:"tous projets"},
            {label:"Terminées",val:totalDone,bg:C.pinkLight,tc:C.pinkDark,sub:"complétées"},
            {label:"En cours",val:totalInProgress,bg:C.blueLight,tc:C.blue,sub:"in progress"},
            {label:"En retard",val:totalLate,bg:totalLate>0?"#fdecea":"#fff",tc:totalLate>0?"#b23a3a":C.textMuted,sub:"à traiter"},
          ].map((k,i)=>(
            <div key={i} style={{...card({padding:"18px"}),background:k.bg}}>
              <p style={{fontSize:"10px",color:k.tc,opacity:0.75,textTransform:"uppercase",letterSpacing:"0.6px",margin:"0 0 8px"}}>{k.label}</p>
              <p style={{fontSize:"30px",fontWeight:"700",color:k.tc,margin:"0 0 3px"}}>{k.val}</p>
              <p style={{fontSize:"11px",color:k.tc,opacity:0.6,margin:0}}>{k.sub}</p>
            </div>
          ))}
        </div>

        {/* GRID */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"16px"}}>

          {/* COL 1 */}
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

            {/* PRODUCTIVITY SCORE */}
            <div style={{...card(),background:`linear-gradient(135deg, ${scoreBg}, #fff)`,border:`1px solid ${C.greenMid}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"14px"}}>
                <div>
                  <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 2px"}}>Productivity Score</p>
                  <p style={{fontSize:"11px",color:C.textMuted,margin:0}}>Basé sur tes projets et tâches</p>
                </div>
                <span style={{fontSize:"10px",fontWeight:"700",background:scoreBg,color:scoreColor,padding:"4px 10px",borderRadius:"999px",border:`1px solid ${scoreColor}30`}}>{scoreLabel}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
                <div style={{position:"relative",width:"80px",height:"80px",flexShrink:0}}>
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="32" fill="none" stroke={C.border} strokeWidth="10"/>
                    <circle cx="40" cy="40" r="32" fill="none" stroke={scoreColor} strokeWidth="10"
                      strokeDasharray={`${(productivityScore/100)*201} 201`}
                      strokeDashoffset="50" strokeLinecap="round"
                      style={{transition:"stroke-dasharray 0.8s ease"}}/>
                    <text x="40" y="36" textAnchor="middle" fontSize="18" fontWeight="700" fill={scoreColor}>{productivityScore}</text>
                    <text x="40" y="50" textAnchor="middle" fontSize="9" fill={C.textMuted}>/100</text>
                  </svg>
                </div>
                <div style={{flex:1,display:"flex",flexDirection:"column",gap:"8px"}}>
                  {[
                    {label:"Complétion",val:totalTaches>0?Math.round((totalDone/totalTaches)*100):0,col:C.green},
                    {label:"Ponctualité",val:totalTaches>0?Math.round(((totalTaches-totalLate)/totalTaches)*100):100,col:C.blue},
                    {label:"Activité",val:Math.min(100,projets.length*20+(totalInProgress>0?40:0)),col:C.pink},
                  ].map((item,i)=>(
                    <div key={i}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px"}}>
                        <span style={{fontSize:"10px",color:C.textMuted}}>{item.label}</span>
                        <span style={{fontSize:"10px",fontWeight:"600",color:item.col}}>{item.val}%</span>
                      </div>
                      <div style={{height:"4px",background:C.border,borderRadius:"999px"}}>
                        <div style={{width:`${item.val}%`,height:"4px",background:item.col,borderRadius:"999px",transition:"width 0.6s"}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* PROJETS */}
            <div style={card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
                <span style={{fontSize:"14px",fontWeight:"700",color:C.text}}>Mes Projets ({projets.length})</span>
                {user.isAdmin && (
                  <button style={{background:C.greenLight,color:C.greenDark,border:`1px solid ${C.greenMid}`,padding:"5px 12px",borderRadius:"999px",fontSize:"11px",fontWeight:"600",cursor:"pointer"}}
                    onClick={()=>navigate("/projets/nouveau")}>+ Nouveau</button>
                )}
              </div>
              {loading && <p style={{fontSize:"13px",color:C.textLight,textAlign:"center",padding:"12px"}}>Chargement...</p>}
              <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                {projets.map((p,i)=>{
                  const kpis=statsMap[p.id]?.kpis;
                  const prog=kpis?.progressCount||0;
                  const col=accentColors[i%accentColors.length];
                  const bg=accentBg[i%accentBg.length];
                  return (
                    <div key={p.id} style={{background:bg,borderRadius:"14px",padding:"14px",cursor:"pointer",border:`1px solid ${C.border}`,transition:"box-shadow 0.2s"}}
                      onClick={()=>navigate(`/projets/${p.id}`)}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"7px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <div style={{width:"9px",height:"9px",borderRadius:"50%",background:col,boxShadow:`0 0 0 3px ${bg}`}}/>
                          <span style={{fontSize:"13px",fontWeight:"600",color:C.text}}>{p.name}</span>
                          {(kpis?.late||0)>0 && <span style={{fontSize:"10px",background:"#fdecea",color:"#b23a3a",padding:"1px 7px",borderRadius:"999px",fontWeight:"600",border:"1px solid #f5c6c6"}}>{kpis.late} retard</span>}
                        </div>
                        <span style={{fontSize:"12px",fontWeight:"700",color:col}}>{prog}%</span>
                      </div>
                      <div style={{height:"6px",background:"rgba(255,255,255,0.7)",borderRadius:"999px",marginBottom:"5px"}}>
                        <div style={{width:`${prog}%`,height:"6px",background:col,borderRadius:"999px",transition:"width 0.5s",boxShadow:`0 1px 4px ${col}60`}}/>
                      </div>
                      <div style={{display:"flex",gap:"12px"}}>
                        <span style={{fontSize:"10px",color:C.textMuted}}>{kpis?.done||0}/{kpis?.total||0} tâches</span>
                        {(kpis?.inProgress||0)>0 && <span style={{fontSize:"10px",color:C.blue}}>{kpis.inProgress} en cours</span>}
                        {(kpis?.late||0)>0 && <span style={{fontSize:"10px",color:"#b23a3a"}}>{kpis.late} en retard</span>}
                      </div>
                    </div>
                  );
                })}
                {!loading && projets.length===0 && <p style={{fontSize:"13px",color:C.textLight,textAlign:"center",padding:"20px"}}>Aucun projet trouvé.</p>}
              </div>
            </div>

            {/* KANBAN */}
            <div style={card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                <span style={{fontSize:"14px",fontWeight:"700",color:C.text}}>Kanban Board</span>
                <div style={{display:"flex",gap:"3px"}}>
                  {[["all","Tout"],["todo","À faire"],["progress","En cours"],["done","Terminé"]].map(([tab,label])=>(
                    <button key={tab} onClick={()=>setKanbanFilter(tab)}
                      style={{background:kanbanFilter===tab?C.greenLight:"transparent",border:kanbanFilter===tab?`1px solid ${C.greenMid}`:`1px solid ${C.border}`,borderRadius:"999px",padding:"3px 9px",fontSize:"10px",color:kanbanFilter===tab?C.greenDark:C.textMuted,cursor:"pointer",fontWeight:kanbanFilter===tab?"600":"400"}}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {kanbanFilter==="all" ? (
                <div style={{display:"flex",gap:"8px"}}>
                  {[
                    {label:"À faire",items:allTaches.filter(isTodo),col:C.pink,bg:C.pinkLight,border:C.pinkMid},
                    {label:"En cours",items:allTaches.filter(isInProgress),col:C.blue,bg:C.blueLight,border:"#c5daf5"},
                    {label:"Terminé",items:allTaches.filter(isDone),col:C.greenDark,bg:C.greenLight,border:C.greenMid},
                  ].map(col=>(
                    <div key={col.label} style={{flex:1}}>
                      <div style={{background:col.bg,borderRadius:"10px",padding:"6px 10px",marginBottom:"7px",display:"flex",justifyContent:"space-between",alignItems:"center",border:`1px solid ${col.border}`}}>
                        <span style={{fontSize:"10px",fontWeight:"700",color:col.col}}>{col.label}</span>
                        <span style={{fontSize:"11px",fontWeight:"700",color:"#fff",background:col.col,borderRadius:"999px",padding:"0px 7px",minWidth:"20px",textAlign:"center"}}>{col.items.length}</span>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:"5px",maxHeight:"130px",overflowY:"auto"}}>
                        {col.items.length===0 ? (
                          <div style={{borderRadius:"10px",padding:"12px",textAlign:"center",fontSize:"11px",color:C.textLight,border:`1.5px dashed ${C.border}`,background:"#fafaf8"}}>Vide</div>
                        ) : col.items.slice(0,5).map((t,i)=>(
                          <div key={i} style={{background:"#fff",borderRadius:"10px",padding:"8px 10px",fontSize:"11px",color:C.text,border:`1px solid ${C.border}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",cursor:"pointer"}}>
                            {t.subject}
                          </div>
                        ))}
                        {col.items.length>5 && <div style={{fontSize:"10px",color:C.textLight,textAlign:"center",padding:"3px"}}>+{col.items.length-5} autres</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:"6px",maxHeight:"200px",overflowY:"auto"}}>
                  {filteredKanban.length===0 ? (
                    <div style={{textAlign:"center",padding:"24px",background:C.greenLight,borderRadius:"12px",border:`1.5px dashed ${C.greenMid}`}}>
                      <p style={{fontSize:"13px",color:C.greenDark,margin:0,fontWeight:"500"}}>Aucune tâche ici.</p>
                    </div>
                  ) : filteredKanban.slice(0,8).map((t,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"9px 12px",background:"#fafaf8",borderRadius:"10px",border:`1px solid ${C.border}`}}>
                      <div style={{width:"7px",height:"7px",borderRadius:"50%",background:isDone(t)?C.green:isInProgress(t)?C.blue:C.pink,flexShrink:0}}/>
                      <span style={{fontSize:"12px",color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.subject}</span>
                      <StatusBadge title={t._links?.status?.title}/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* COL 2 */}
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

            {/* TODAY'S FOCUS */}
            <div style={card()}>
              <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 12px"}}>Today's Focus</p>
              {overdueTasks.length===0 && upcomingTasks.length===0 ? (
                <div style={{background:C.greenLight,borderRadius:"14px",padding:"22px",textAlign:"center",border:`1px solid ${C.greenMid}`}}>
                  <div style={{fontSize:"30px",marginBottom:"8px"}}>🎉</div>
                  <p style={{fontSize:"14px",fontWeight:"700",color:C.greenDark,margin:"0 0 4px"}}>Tout est à jour !</p>
                  <p style={{fontSize:"12px",color:C.textMuted,margin:0}}>Aucune tâche urgente ni deadline proche.</p>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {overdueTasks.slice(0,2).map((t,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"10px",padding:"11px 14px",background:"#fdecea",borderRadius:"12px",border:"1px solid #f5c6c6"}}>
                      <div style={{width:"30px",height:"30px",borderRadius:"9px",background:"#f5c6c6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>⚠️</div>
                      <div style={{flex:1,overflow:"hidden"}}>
                        <p style={{fontSize:"12px",fontWeight:"600",color:C.text,margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.subject}</p>
                        <p style={{fontSize:"10px",color:"#b23a3a",margin:"2px 0 0",fontWeight:"500"}}>En retard · {Math.ceil((now-new Date(t.dueDate))/86400000)}j</p>
                      </div>
                    </div>
                  ))}
                  {upcomingTasks.slice(0,4).map((t,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"10px",padding:"11px 14px",background:C.greenLight,borderRadius:"12px",border:`1px solid ${C.greenMid}`}}>
                      <div style={{width:"30px",height:"30px",borderRadius:"9px",background:C.greenMid,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>📅</div>
                      <div style={{flex:1,overflow:"hidden"}}>
                        <p style={{fontSize:"12px",fontWeight:"600",color:C.text,margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.subject}</p>
                        <p style={{fontSize:"10px",color:C.greenDark,margin:"2px 0 0",fontWeight:"500"}}>
                          {Math.ceil((new Date(t.dueDate)-now)/86400000)===0?"Aujourd'hui !":  `Dans ${Math.ceil((new Date(t.dueDate)-now)/86400000)}j`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* TACHES RECENTES */}
            <div style={card()}>
              <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 12px"}}>Tâches récentes</p>
              {recentTasks.length===0 ? (
                <div style={{background:C.greenLight,borderRadius:"12px",padding:"20px",textAlign:"center",border:`1px dashed ${C.greenMid}`}}>
                  <p style={{fontSize:"13px",color:C.textMuted,margin:0}}>Aucune tâche pour l'instant.</p>
                  <p style={{fontSize:"11px",color:C.textLight,margin:"4px 0 0"}}>Créez vos premières tâches dans un projet.</p>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
                  {recentTasks.map((t,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",background:"#fafaf8",borderRadius:"12px",border:`1px solid ${C.border}`}}>
                      <div style={{width:"8px",height:"8px",borderRadius:"50%",background:isDone(t)?C.green:isInProgress(t)?C.blue:C.pink,flexShrink:0}}/>
                      <div style={{flex:1,overflow:"hidden"}}>
                        <p style={{fontSize:"12px",fontWeight:"600",color:C.text,margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.subject}</p>
                        {t.dueDate && <p style={{fontSize:"10px",color:C.textLight,margin:"2px 0 0"}}>Échéance : {new Date(t.dueDate).toLocaleDateString("fr-FR")}</p>}
                      </div>
                      <StatusBadge title={t._links?.status?.title}/>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* DEADLINES */}
            <div style={card()}>
              <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 12px"}}>Deadlines</p>
              {allTaches.filter(t=>t.dueDate&&!isDone(t)).length===0 ? (
                <div style={{background:C.greenLight,borderRadius:"12px",padding:"18px",textAlign:"center",border:`1px dashed ${C.greenMid}`}}>
                  <p style={{fontSize:"13px",color:C.textMuted,margin:0}}>Aucune deadline définie.</p>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
                  {allTaches.filter(t=>t.dueDate&&!isDone(t)).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).slice(0,6).map((t,i)=>{
                    const late=new Date(t.dueDate)<now;
                    const diff=Math.ceil((new Date(t.dueDate)-now)/86400000);
                    const urgent=!late&&diff<=2;
                    return (
                      <div key={i} style={{display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",background:late?"#fdecea":urgent?C.orangeLight:"#fafaf8",borderRadius:"12px",border:`1px solid ${late?"#f5c6c6":urgent?"#fdd9b5":C.border}`}}>
                        <div style={{width:"7px",height:"7px",borderRadius:"50%",background:late?C.pink:urgent?C.orange:C.green,flexShrink:0}}/>
                        <span style={{fontSize:"12px",color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.subject}</span>
                        <span style={{fontSize:"10px",color:late?"#b23a3a":urgent?C.orange:C.greenDark,fontWeight:"700",background:late?"#f5c6c6":urgent?"#fdd9b5":C.greenLight,padding:"2px 8px",borderRadius:"999px"}}>
                          {late?`${Math.abs(diff)}j retard`:diff===0?"Auj.":diff===1?"Demain":`${diff}j`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* DISTRIBUTION */}
            {Object.keys(statusDist).length>0 && (
              <div style={card()}>
                <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 14px"}}>Distribution des statuts</p>
                <div style={{display:"flex",alignItems:"center",gap:"18px"}}>
                  <DonutChart size={90} data={Object.entries(statusDist).map(([s,v],i)=>({val:v,color:accentColors[i%accentColors.length]}))}/>
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:"8px"}}>
                    {Object.entries(statusDist).map(([status,count],i)=>{
                      const pct=totalTaches>0?Math.round((count/totalTaches)*100):0;
                      const col=accentColors[i%accentColors.length];
                      return (
                        <div key={status}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
                            <span style={{fontSize:"11px",color:C.text}}>{status}</span>
                            <span style={{fontSize:"11px",fontWeight:"700",color:col}}>{pct}%</span>
                          </div>
                          <div style={{height:"5px",background:C.border,borderRadius:"999px"}}>
                            <div style={{width:`${pct}%`,height:"5px",background:col,borderRadius:"999px",transition:"width 0.5s"}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* COL 3 */}
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

            {/* PROGRESSION GLOBALE */}
            <div style={card()}>
              <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 14px"}}>Progression globale</p>
              <div style={{display:"flex",justifyContent:"space-around",marginBottom:"16px"}}>
                <CircProgress val={totalProgress} stroke={C.green} bg={C.greenLight} label="Avancement" sub={`${totalDone}/${totalTaches}`}/>
                <CircProgress val={totalTaches>0?Math.round((totalInProgress/totalTaches)*100):0} stroke={C.blue} bg={C.blueLight} label="En cours" sub={`${totalInProgress} tâches`}/>
                <CircProgress val={totalTaches>0?Math.round(((totalTaches-totalLate)/totalTaches)*100):100} stroke={C.pink} bg={C.pinkLight} label="Dans les temps" sub={`${totalTaches-totalLate}/${totalTaches}`}/>
              </div>
              <div style={{display:"flex",gap:"8px"}}>
                {[{label:"À faire",val:totalTodo,col:C.pink,bg:C.pinkLight},{label:"En cours",val:totalInProgress,col:C.blue,bg:C.blueLight},{label:"Terminé",val:totalDone,col:C.greenDark,bg:C.greenLight}].map((item,i)=>(
                  <div key={i} style={{flex:1,background:item.bg,borderRadius:"12px",padding:"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
                    <p style={{fontSize:"22px",fontWeight:"700",color:item.col,margin:"0 0 2px"}}>{item.val}</p>
                    <p style={{fontSize:"10px",color:item.col,margin:0,fontWeight:"600"}}>{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* WEEKLY ACTIVITY */}
            <div style={{...card(),background:`linear-gradient(135deg,#9FB878,#d4d9b0)`,border:"none",boxShadow:"0 4px 16px rgba(194,195,149,0.4)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
                <span style={{fontSize:"14px",fontWeight:"700",color:"#3a3d1a"}}>Weekly activity</span>
                <span style={{fontSize:"11px",background:"rgba(255,255,255,0.35)",color:"#3a3d1a",padding:"3px 10px",borderRadius:"999px",fontWeight:"600"}}>
                  {weekEntries.reduce((a,e)=>a+e[1],0)} tâches
                </span>
              </div>
              {weekEntries.length>0 ? (
                <div style={{display:"flex",alignItems:"flex-end",gap:"5px",height:"70px"}}>
                  {weekEntries.map(([week,val],i)=>(
                    <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px"}}>
                      <div style={{width:"100%",background:i===weekEntries.length-1?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.4)",borderRadius:"4px 4px 0 0",height:`${Math.round((val/maxWeekVal)*58)+6}px`,transition:"height 0.5s",boxShadow:i===weekEntries.length-1?"0 2px 8px rgba(255,255,255,0.4)":"none"}}/>
                      <span style={{fontSize:"9px",color:"rgba(58,61,26,0.6)"}}>{week.slice(5,10)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{display:"flex",alignItems:"flex-end",gap:"5px",height:"70px"}}>
                  {[2,5,3,7,4,6,3].map((v,i)=>(
                    <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px"}}>
                      <div style={{width:"100%",background:i===5?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.35)",borderRadius:"4px 4px 0 0",height:`${Math.round((v/7)*58)+6}px`}}/>
                      <span style={{fontSize:"9px",color:"rgba(58,61,26,0.6)"}}>{"LMMJVSD"[i]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* TOTAL PROGRESS */}
            <div style={{...card(),background:C.pinkLight,border:`1px solid ${C.pinkMid}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px"}}>
                <div>
                  <p style={{fontSize:"11px",fontWeight:"700",color:C.pinkDark,margin:"0 0 4px",textTransform:"uppercase",letterSpacing:"0.6px"}}>Total progress</p>
                  <p style={{fontSize:"38px",fontWeight:"700",color:C.pink,margin:0,lineHeight:1}}>{totalProgress}%</p>
                </div>
                <span style={{fontSize:"10px",background:"#fff",color:C.pinkDark,padding:"3px 10px",borderRadius:"999px",fontWeight:"600",border:`1px solid ${C.pinkMid}`}}>this week</span>
              </div>
              <div style={{height:"8px",background:"rgba(255,255,255,0.6)",borderRadius:"999px",marginBottom:"10px",overflow:"hidden"}}>
                <div style={{width:`${totalProgress}%`,height:"8px",background:C.pink,borderRadius:"999px",transition:"width 0.6s",boxShadow:`0 2px 6px ${C.pinkMid}`}}/>
              </div>
              <p style={{fontSize:"11px",color:C.pinkDark,margin:0,fontWeight:"500"}}>{totalDone} terminées · {totalInProgress} en cours · {totalTodo} à faire</p>
            </div>

            {/* CHARGE MEMBRES */}
            {Object.keys(workloadAll).length>0 && (
              <div style={card()}>
                <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 14px"}}>Charge par membre</p>
                <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                  {Object.entries(workloadAll).slice(0,5).map(([name,data],i)=>(
                    <div key={name} style={{display:"flex",alignItems:"center",gap:"10px"}}>
                      <div style={{width:"30px",height:"30px",borderRadius:"50%",background:accentBg[i%5],border:`2px solid ${accentColors[i%5]}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"700",color:accentDark[i%5],flexShrink:0}}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                          <span style={{fontSize:"12px",fontWeight:"600",color:C.text}}>{name}</span>
                          <span style={{fontSize:"10px",color:C.textLight}}>{data.count} tâches</span>
                        </div>
                        <div style={{height:"5px",background:C.border,borderRadius:"999px"}}>
                          <div style={{width:data.count>0?`${Math.round((data.done/data.count)*100)}%`:"0%",height:"5px",background:accentColors[i%5],borderRadius:"999px",transition:"width 0.5s"}}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* MEMBRES */}
            {membres.length>0 && (
              <div style={card()}>
                <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 12px"}}>Équipe ({membres.length})</p>
                <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"12px"}}>
                  {membres.slice(0,10).map((m,i)=>(
                    <div key={i} title={m.name} style={{width:"32px",height:"32px",borderRadius:"50%",background:accentBg[i%5],border:`2px solid ${accentColors[i%5]}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"700",color:accentDark[i%5],cursor:"pointer"}}>
                      {m.name?.charAt(0)?.toUpperCase()||"?"}
                    </div>
                  ))}
                  {membres.length>10 && <div style={{width:"32px",height:"32px",borderRadius:"50%",background:C.greenLight,border:`1px solid ${C.greenMid}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:C.textMuted}}>+{membres.length-10}</div>}
                </div>
                {membres.slice(0,3).map((m,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"10px",padding:"7px 0",borderBottom:i<2?`1px solid ${C.border}`:"none"}}>
                    <div style={{width:"28px",height:"28px",borderRadius:"50%",background:accentBg[i%5],border:`2px solid ${accentColors[i%5]}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"700",color:accentDark[i%5],flexShrink:0}}>
                      {m.name?.charAt(0)?.toUpperCase()||"?"}
                    </div>
                    <div style={{flex:1,overflow:"hidden"}}>
                      <p style={{fontSize:"12px",fontWeight:"600",color:C.text,margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</p>
                      <p style={{fontSize:"10px",color:C.textLight,margin:0}}>{m.email||"membre"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ACCÈS RAPIDE */}
            <div style={card()}>
              <p style={{fontSize:"14px",fontWeight:"700",color:C.text,margin:"0 0 12px"}}>Accès rapide</p>
              {projets.map((p,i)=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:i<projets.length-1?`1px solid ${C.border}`:"none",cursor:"pointer"}}
                  onClick={()=>navigate(`/projets/${p.id}`)}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <div style={{width:"8px",height:"8px",borderRadius:"50%",background:accentColors[i%accentColors.length]}}/>
                    <span style={{fontSize:"13px",color:C.text}}>{p.name}</span>
                  </div>
                  <span style={{fontSize:"11px",color:C.textLight}}>#{p.id} →</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}