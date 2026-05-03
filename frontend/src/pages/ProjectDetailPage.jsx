import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getProjets, getStats, getTaches, getProjectMembers, getAllMembers,
  updateTache, deleteTache, creerTache, addTimeLog, getTimeLogs,
  getDependencies, addDependency, deleteDependency,
  getBudgetSummary, getBudgetTasks, getBudgetTimeline,
  updateProjectBudget, updateTaskEstimatedHours, updateTaskMemberRate,
  addProjectMember, removeMember, creerSousProjet,
  syncProject, logout,
} from "../services/api";
import TaskAI from "../components/TaskAI";

export default function DetailProjet() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [subProjects, setSubProjects] = useState([]);
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [budget, setBudget] = useState(null);
  const [budgetTasks, setBudgetTasks] = useState([]);
  const [budgetTimeline, setBudgetTimeline] = useState([]);
  const [dependenciesMap, setDependenciesMap] = useState({});
  const [timeLogsMap, setTimeLogsMap] = useState({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const [taskDrafts, setTaskDrafts] = useState({});
  const [newTask, setNewTask] = useState({ title:"", description:"", dueDate:"", estimatedHours:"", assigneeId:"" });
  const [newSubProject, setNewSubProject] = useState({ title:"", description:"", startDate:"", endDate:"", workload:"" });
  const [memberForm, setMemberForm] = useState({ opUserId:"", role:"member" });
  const [budgetInput, setBudgetInput] = useState("");
  const [timeForm, setTimeForm] = useState({ hoursWorked:"", loggedDate:"", note:"" });
  const [rateForm, setRateForm] = useState({ taskId:"", memberRate:"" });
  const [depForm, setDepForm] = useState({ taskId:"", dependsOnTaskId:"" });
  const [hoursForm, setHoursForm] = useState({ taskId:"", estimatedHours:"" });

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const userIsAdmin = Boolean(user.isAdmin);

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
    { c:C.green, bg:C.greenLight, dark:C.greenDark },
    { c:C.pink, bg:C.pinkLight, dark:C.pinkDark },
    { c:C.blue, bg:C.blueLight, dark:C.blue },
    { c:C.orange, bg:C.orangeLight, dark:"#7a4520" },
    { c:C.purple, bg:C.purpleLight, dark:"#4a3a7a" },
  ];

  const card = (extra={}) => ({ background:C.card, borderRadius:"18px", padding:"20px", border:`1px solid ${C.border}`, boxShadow:C.shadow, ...extra });
  const inp = (extra={}) => ({ width:"100%", boxSizing:"border-box", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px", outline:"none", fontSize:"12px", color:C.text, background:"#fff", ...extra });
  const btn = (extra={}) => ({ border:"none", borderRadius:"999px", padding:"8px 14px", fontSize:"11px", fontWeight:"700", cursor:"pointer", transition:"all 0.18s ease", ...extra });

  const formatDate = (d) => {
    if (!d) return "Non définie";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "Non définie";
    return dt.toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" });
  };

  const parseHours = (v) => {
    if (!v) return 0;
    if (!isNaN(Number(v))) return Number(v);
    const str = String(v).toUpperCase();
    const days = Number(str.match(/(\d+(?:\.\d+)?)D/)?.[1]||0);
    const hours = Number(str.match(/T(\d+(?:\.\d+)?)H/)?.[1]||0);
    return days*8+hours;
  };

  const isDone = t => ["clos","done","termin","closed","finished","resolved","fermé"].some(k => (t._links?.status?.title||"").toLowerCase().includes(k));
  const isInProgress = t => ["progress","cours"].some(k => (t._links?.status?.title||"").toLowerCase().includes(k));
  const isOverdue = t => t.dueDate && new Date(t.dueDate) < new Date() && !isDone(t);
  const getAssigneeId = t => t._links?.assignee?.href?.split("/").pop() || null;
  const getAssigneeName = t => t._links?.assignee?.title || t.assignee || "Non assigné";

  const getTaskDesc = (task) => {
    const d = task?.description;
    if (!d) return null;
    if (typeof d === "string") return d.trim() || null;
    return (d.raw || d.html?.replace(/<[^>]*>/g, "") || "").trim() || null;
  };

  const userMembership = useMemo(() => members.find(m => String(m.op_user_id||m.id) === String(user.id||user.userId)), [members, user.id, user.userId]);
  const role = user.isAdmin ? "admin" : userMembership?.role || "member";
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const canManage = isAdmin || isManager;
  const roleLabelStr = isAdmin ? "Administrateur" : isManager ? "Chef de projet" : "Membre";

  const projectDescription = useMemo(() => {
    const desc = project?.description;
    if (!desc) return "Aucune description disponible.";
    if (typeof desc === "string") return desc;
    return desc.raw || desc.html?.replace(/<[^>]*>/g,"") || "Aucune description disponible.";
  }, [project]);

  const getStatut = () => {
    const prog = Number(project?.progress ?? 0);
    const risk = Number(project?.riskScore ?? 0);
    const late = Number(project?.lateTasks ?? 0);
    if (prog === 100) return { label:"Terminé", bg:C.greenLight, color:C.greenDark, border:C.greenMid };
    if (risk >= 70 || late >= 3) return { label:"Critique", bg:C.redLight, color:C.red, border:"#f5c6c6" };
    if (risk >= 40 || late > 0) return { label:"À risque", bg:C.orangeLight, color:"#7a4520", border:"#fdd9b5" };
    if (prog >= 60) return { label:"Avancé", bg:C.greenLight, color:C.greenDark, border:C.greenMid };
    if (prog >= 20) return { label:"En cours", bg:C.blueLight, color:C.blue, border:"#c5daf5" };
    return { label:"À démarrer", bg:"#fafaf8", color:C.textMuted, border:C.border };
  };

  const reloadCore = async () => {
    const [projectsRes, statsRes, tasksRes, membersRes] = await Promise.all([
      getProjets(), getStats(id), getTaches(id), getProjectMembers(id),
    ]);

    const list = projectsRes.data || [];
    const found = list.find(p => String(p.id) === String(id));
    const children = list.filter(p => {
      const href = p._links?.parent?.href || p.parent?.href || "";
      return href.endsWith(`/${id}`) || String(p.parentId || p.parent_id || "") === String(id);
    });

    setProject(found || null);
    setSubProjects(children);
    setStats(statsRes.data || null);
    setTasks(tasksRes.data || []);

    const loadedMembers = membersRes.data || [];
    setMembers(loadedMembers);

    // ✅ FIX : initialise les drafts avec les heures parsées correctement
    const drafts = {};
    (tasksRes.data || []).forEach(t => {
      drafts[t.id] = {
        dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0,10) : "",
        estimatedHours: parseHours(t.estimatedTime) || "",
        assigneeId: getAssigneeId(t) || "",
      };
    });
    setTaskDrafts(drafts);

    return loadedMembers;
  };

  const reloadExtra = async (projectMembers = []) => {
    const results = await Promise.allSettled([
      userIsAdmin ? getAllMembers() : Promise.resolve(projectMembers),
      getBudgetSummary(id),
      canManage ? getBudgetTasks(id) : Promise.resolve({ data: [] }),
      canManage ? getBudgetTimeline(id) : Promise.resolve({ data: [] }),
    ]);

    if (results[0].status === "fulfilled") {
      const val = results[0].value;
      setAllUsers(Array.isArray(val) ? val : (val?.data || []));
    }
    if (results[1].status === "fulfilled") {
      setBudget(results[1].value.data || null);
      setBudgetInput(
        results[1].value.data?.budgetTotal ??
        results[1].value.data?.budget_total ?? ""
      );
    }
    if (results[2].status === "fulfilled") setBudgetTasks(results[2].value.data || []);
    if (results[3].status === "fulfilled") setBudgetTimeline(results[3].value.data || []);
  };

  const reloadDeps = async (taskList) => {
    const deps = {}, logs = {};
    await Promise.all((taskList||[]).map(async t => {
      const [dr, lr] = await Promise.allSettled([getDependencies(t.id, id), getTimeLogs(t.id, id)]);
      deps[t.id] = dr.status==="fulfilled" ? dr.value.data : null;
      logs[t.id] = lr.status==="fulfilled" ? lr.value.data||[] : [];
    }));
    setDependenciesMap(deps); setTimeLogsMap(logs);
  };

  const loadPage = async () => {
    setLoading(true); setError("");
    try {
      await syncProject(id).catch(() => null);
      const loadedMembers = await reloadCore();
      await reloadExtra(loadedMembers);
    } catch(err) {
      setError(err.response?.data?.message || "Impossible de charger le projet.");
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await syncProject(id).catch(() => null);
      const loadedMembers = await reloadCore();
      await reloadExtra(loadedMembers);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { loadPage(); }, [id]);
  useEffect(() => { if (tasks.length) reloadDeps(tasks); }, [tasks.length, id]);

  const handleLogout = async () => {
    try { await logout(); } catch {}
    localStorage.removeItem("jwt"); localStorage.removeItem("user"); navigate("/");
  };

  const totals = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(isDone).length;
    const progress = tasks.filter(isInProgress).length;
    const late = tasks.filter(isOverdue).length;
    const estimatedHours = tasks.reduce((s,t) => s+parseHours(t.estimatedTime), 0);
    return { total, done, progress, late, todo:Math.max(0,total-done-progress), completion:total?Math.round((done/total)*100):0, estimatedHours:Math.round(estimatedHours*10)/10 };
  }, [tasks]);

  const backendProgress = Number(project?.progress ?? totals.completion ?? 0);
  const backendRiskScore = Number(project?.riskScore ?? 0);
  const riskExplanation = project?.aiSummary || project?.ai_summary || "Score calculé à partir des retards, dépendances bloquantes et avancement.";
  const statut = getStatut();

  const blockedTasks = useMemo(() => tasks.filter(t => dependenciesMap[t.id]?.isBlocked), [tasks, dependenciesMap]);
  const blockedCount = Object.keys(dependenciesMap).length > 0 ? blockedTasks.length : Number(project?.blockedTasks ?? 0);

  const statusDist = useMemo(() => tasks.reduce((acc,t) => {
    const s = t._links?.status?.title || "Inconnu";
    acc[s] = (acc[s]||0)+1; return acc;
  }, {}), [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const q = search.toLowerCase();
      const title = (task.subject||"").toLowerCase();
      const assignee = getAssigneeName(task).toLowerCase();
      const status = (task._links?.status?.title||"").toLowerCase();
      const blocked = Boolean(dependenciesMap[task.id]?.isBlocked);
      if (!title.includes(q) && !assignee.includes(q) && !status.includes(q)) return false;
      if (filter==="done") return isDone(task);
      if (filter==="progress") return isInProgress(task);
      if (filter==="late") return isOverdue(task);
      if (filter==="blocked") return blocked;
      if (filter==="todo") return !isDone(task)&&!isInProgress(task);
      return true;
    });
  }, [tasks, search, filter, dependenciesMap]);

  const upcomingTasks = useMemo(() => tasks.filter(t=>t.dueDate&&!isDone(t)).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)).slice(0,5), [tasks]);
  const recentTasks = useMemo(() => [...tasks].sort((a,b)=>new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)).slice(0,5), [tasks]);

  const updateStatus = async (task, status) => {
    try { await updateTache(task.id, { projectId:id, status }); await refreshAll(); }
    catch(err) { alert(err.response?.data?.message||"Erreur modification statut."); }
  };

  // ✅ FIX PRINCIPAL : saveTaskFields corrigé
  // - Comparaison robuste des heures (Number vs Number)
  // - Ne bloque plus si seules les heures changent
  // - Appel updateTaskEstimatedHours garanti même si updateTache ne renvoie pas d'erreur
  const saveTaskFields = async (task) => {
    const draft = taskDrafts[task.id] || {};
    try {
      const payload = { projectId: id };

      // Assignee
      const currentAssigneeId = getAssigneeId(task) || "";
      if (String(draft.assigneeId) !== String(currentAssigneeId)) {
        payload.assignee = draft.assigneeId
          ? { href: `/api/v3/users/${draft.assigneeId}` }
          : { href: null };
      }

      // Date de fin
      const currentDueDate = task.dueDate
        ? new Date(task.dueDate).toISOString().slice(0,10)
        : "";
      if (draft.dueDate !== currentDueDate) {
        payload.dueDate = draft.dueDate || null;
      }

      // ✅ FIX heures : comparaison Number vs Number, pas string vs number
      const draftHours = draft.estimatedHours !== "" ? Number(draft.estimatedHours) : null;
      const currentHours = parseHours(task.estimatedTime);
      const hoursChanged = draftHours !== null && draftHours !== currentHours;

      if (hoursChanged) {
        payload.estimatedHours = draftHours;
      }

      // Envoyer updateTache si au moins un champ a changé (hors projectId)
      const hasChanges = Object.keys(payload).length > 1;
      if (hasChanges) {
        await updateTache(task.id, payload);
      }

      // ✅ FIX : appel séparé et garanti pour les heures côté budget
      if (hoursChanged) {
        try {
          await updateTaskEstimatedHours(id, task.id, draftHours);
        } catch (budgetErr) {
          // Non bloquant : le budget peut ne pas être configuré
          console.warn("Budget hours update failed:", budgetErr?.message);
        }
      }

      await refreshAll();
    } catch(err) {
      const msg = err?.raw?.message || err?.response?.data?.message || err?.message || "Erreur modification tâche.";
      alert(msg);
    }
  };

  const createTask = async () => {
    if (!newTask.title.trim()) return alert("Titre obligatoire.");
    try {
      await creerTache(id, {
        title: newTask.title, description: newTask.description,
        dueDate: newTask.dueDate||undefined, estimatedHours: newTask.estimatedHours||undefined,
        assignee: newTask.assigneeId ? { href:`/api/v3/users/${newTask.assigneeId}` } : undefined,
      });
      setNewTask({ title:"", description:"", dueDate:"", estimatedHours:"", assigneeId:"" });
      await refreshAll();
    } catch(err) { alert(err.response?.data?.message||"Erreur création tâche."); }
  };

  const removeTask = async (task) => {
    if (!window.confirm("Supprimer cette tâche ?")) return;
    try { await deleteTache(task.id, id); await refreshAll(); }
    catch(err) { alert(err.response?.data?.message||"Erreur suppression tâche."); }
  };

  const saveTimeLog = async (task) => {
    if (!timeForm.hoursWorked) return alert("Nombre d'heures obligatoire.");
    try {
      await addTimeLog(task.id, {
        opUserId: user.id||user.userId,
        hoursWorked: timeForm.hoursWorked,
        loggedDate: timeForm.loggedDate||undefined,
        note: timeForm.note,
        projectId: id,
      });
      setTimeForm({ hoursWorked:"", loggedDate:"", note:"" });
      await reloadExtra(members);
    } catch(err) { alert(err.response?.data?.message||"Erreur ajout heures."); }
  };

  const saveMemberRate = async (taskId) => {
    if (!rateForm.memberRate) return alert("Taux obligatoire.");
    const numRate = Number(rateForm.memberRate);
    if (isNaN(numRate) || numRate <= 0) return alert("Le taux doit être un nombre positif.");
    try {
      await updateTaskMemberRate(id, taskId, numRate);
      setRateForm({ taskId:"", memberRate:"" });
      await reloadExtra(members);
    } catch(err) { alert(err.response?.data?.message||"Erreur taux horaire."); }
  };

  const saveEstimatedHoursBudget = async () => {
    if (!hoursForm.taskId || !hoursForm.estimatedHours) return alert("Tâche et heures obligatoires.");
    const numHours = Number(hoursForm.estimatedHours);
    if (isNaN(numHours) || numHours <= 0) return alert("Heures invalides.");
    try {
      await updateTaskEstimatedHours(id, hoursForm.taskId, numHours);
      setHoursForm({ taskId:"", estimatedHours:"" });
      await reloadExtra(members);
    } catch(err) { alert(err.response?.data?.message||"Erreur heures estimées."); }
  };

  const saveBudget = async () => {
    if (!budgetInput && budgetInput !== 0) return alert("Budget obligatoire.");
    const num = Number(budgetInput);
    if (isNaN(num) || num < 0) return alert("Le budget doit être un nombre positif ou nul.");
    try { await updateProjectBudget(id, num); await reloadExtra(members); }
    catch(err) { alert(err.response?.data?.message||"Erreur budget."); }
  };

  // ✅ FIX DÉPENDANCES : renommage pour éviter le conflit avec l'import deleteDependency
  // Dans le document original, "removeDependency" écrasait l'import "deleteDependency"
  // et "addDependency" importé était potentiellement shadowed.
  // Solution : utiliser des noms distincts pour les handlers locaux.
  const handleCreateDependency = async () => {
    if (!depForm.taskId || depForm.taskId === "")
      return alert("Choisis la tâche bloquée.");
    if (!depForm.dependsOnTaskId || depForm.dependsOnTaskId === "")
      return alert("Choisis la tâche dont elle dépend.");

    const taskIdNum      = Number(depForm.taskId);
    const dependsOnIdNum = Number(depForm.dependsOnTaskId);

    if (isNaN(taskIdNum) || taskIdNum <= 0)
      return alert("ID de tâche invalide.");
    if (isNaN(dependsOnIdNum) || dependsOnIdNum <= 0)
      return alert("ID de dépendance invalide.");
    if (taskIdNum === dependsOnIdNum)
      return alert("Une tâche ne peut pas dépendre d'elle-même.");

    try {
      // ✅ Utilise directement l'import addDependency (pas de conflit de nom)
      await addDependency(taskIdNum, dependsOnIdNum, Number(id));
      setDepForm({ taskId: "", dependsOnTaskId: "" });
      const freshMembers = await reloadCore();
      await reloadExtra(freshMembers);
      const freshTasksRes = await getTaches(id);
      await reloadDeps(freshTasksRes.data || []);
    } catch (err) {
      alert(err.response?.data?.message || err?.raw?.message || err?.message || "Erreur création dépendance.");
    }
  };

  const handleRemoveDependency = async (taskId, dependsOnTaskId) => {
    const taskIdNum      = Number(taskId);
    const dependsOnIdNum = Number(dependsOnTaskId);
    if (!taskIdNum || !dependsOnIdNum) return alert("IDs de tâches invalides.");

    try {
      // ✅ Utilise directement l'import deleteDependency (pas de conflit de nom)
      await deleteDependency(taskIdNum, dependsOnIdNum, Number(id));
      const freshMembers = await reloadCore();
      await reloadExtra(freshMembers);
      const freshTasksRes = await getTaches(id);
      await reloadDeps(freshTasksRes.data || []);
    } catch (err) {
      alert(err.response?.data?.message || err?.raw?.message || err?.message || "Erreur suppression dépendance.");
    }
  };

  const addMember = async () => {
    if (!memberForm.opUserId) return alert("Choisis un membre.");
    const selected = allUsers.find(u => String(u.id) === String(memberForm.opUserId));
    if (!selected) return alert("Utilisateur introuvable dans la liste.");
    try {
      await addProjectMember(id, {
        opUserId: memberForm.opUserId,
        name: selected.name,
        email: selected.email || `user${memberForm.opUserId}@openproject.local`,
        role: memberForm.role,
      });
      setMemberForm({ opUserId: "", role: "member" });
      await reloadCore();
    } catch(err) {
      console.error("addMember error:", err);
      alert(err?.message || "Erreur ajout membre.");
    }
  };

  const createSubProject = async () => {
    if (!newSubProject.title.trim()||!newSubProject.description.trim()) return alert("Titre et description obligatoires.");
    try {
      await creerSousProjet(id, newSubProject);
      setNewSubProject({ title:"", description:"", startDate:"", endDate:"", workload:"" });
      await refreshAll();
    } catch(err) { alert(err.response?.data?.message||"Erreur création sous-projet."); }
  };

  const DonutChart = () => {
    const entries = Object.entries(statusDist);
    const total = entries.reduce((a,[,v])=>a+v,0)||1;
    let offset = 0;
    const r = 34, c = 2*Math.PI*r;
    return (
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle cx="54" cy="54" r={r} fill="none" stroke={C.border} strokeWidth="14"/>
        {entries.map(([status,count],i) => {
          const dash = (count/total)*c;
          const sl = <circle key={status} cx="54" cy="54" r={r} fill="none"
            stroke={accents[i%accents.length].c} strokeWidth="14" strokeLinecap="round"
            strokeDasharray={`${dash} ${c-dash}`} strokeDashoffset={c/4-offset}/>;
          offset += dash; return sl;
        })}
        <text x="54" y="50" textAnchor="middle" fontSize="18" fontWeight="800" fill={C.text}>{totals.total}</text>
        <text x="54" y="65" textAnchor="middle" fontSize="9" fill={C.textMuted}>tâches</text>
      </svg>
    );
  };

  const AvatarStack = ({ list }) => (
    <div style={{ display:"flex", alignItems:"center" }}>
      {list.slice(0,6).map((m,i) => (
        <div key={m.op_user_id||m.id||i} title={m.name} style={{ width:"32px", height:"32px", borderRadius:"50%", background:accents[i%accents.length].bg, border:"2px solid #fff", marginLeft:i===0?0:"-8px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:accents[i%accents.length].dark, boxShadow:C.shadow }}>
          {m.name?.charAt(0)?.toUpperCase()||"?"}
        </div>
      ))}
      {list.length>6 && <div style={{ width:"32px", height:"32px", borderRadius:"50%", background:C.greenLight, border:"2px solid #fff", marginLeft:"-8px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"10px", color:C.greenDark, fontWeight:"700" }}>+{list.length-6}</div>}
    </div>
  );

  const StatusBadge = ({ task }) => {
    const done=isDone(task), prog=isInProgress(task);
    const blocked=Boolean(dependenciesMap[task.id]?.isBlocked);
    const label=task._links?.status?.title||"—";
    const bg=blocked?C.redLight:done?C.greenLight:prog?C.blueLight:C.pinkLight;
    const color=blocked?C.red:done?C.greenDark:prog?C.blue:C.pinkDark;
    const border=blocked?"#f5c6c6":done?C.greenMid:prog?"#c5daf5":C.pinkMid;
    return <span style={{ fontSize:"10px", background:bg, color, border:`1px solid ${border}`, padding:"4px 9px", borderRadius:"999px", fontWeight:"700", whiteSpace:"nowrap" }}>{blocked?"Bloquée":label}</span>;
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',Arial,sans-serif" }}>
      <div style={card({ textAlign:"center", padding:"40px" })}>
        <div style={{ fontSize:"34px", marginBottom:"10px" }}>🐝</div>
        <p style={{ color:C.text, fontWeight:"700", margin:0 }}>Chargement du projet...</p>
        <p style={{ color:C.textLight, fontSize:"12px" }}>Synchronisation avec OpenProject</p>
      </div>
    </div>
  );

  if (error||!project) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',Arial,sans-serif" }}>
      <div style={card({ textAlign:"center", padding:"40px", maxWidth:"420px" })}>
        <div style={{ fontSize:"34px", marginBottom:"10px" }}>⚠️</div>
        <p style={{ color:C.text, fontWeight:"700", margin:0 }}>Projet introuvable</p>
        <p style={{ color:C.textMuted, fontSize:"12px" }}>{error||"Impossible de charger ce projet."}</p>
        <button onClick={()=>navigate("/projets")} style={btn({ background:C.green, color:"#fff", marginTop:"12px" })}>Retour aux projets</button>
      </div>
    </div>
  );

  return (
    <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", minHeight:"100vh", background:C.bg, fontFamily:"'Segoe UI',Arial,sans-serif" }}>

      {/* ── SIDEBAR ── */}
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
              <div key={item.path} onClick={()=>navigate(item.path)} style={{ padding:"10px 14px", borderRadius:"12px", fontSize:"13px", cursor:"pointer", marginBottom:"3px", color:item.active?C.greenDark:C.textMuted, background:item.active?C.greenLight:"transparent", fontWeight:item.active?"600":"400", borderLeft:item.active?`3px solid ${C.green}`:"3px solid transparent" }}>
                {item.label}
              </div>
            ))}
          </div>
          <div style={{ height:"1px", background:C.border, margin:"16px" }}/>
          <div style={{ padding:"0 12px" }}>
            <p style={{ fontSize:"10px", color:C.textLight, textTransform:"uppercase", letterSpacing:"1px", padding:"0 14px", margin:"0 0 6px" }}>Compte</p>
            <div style={{ padding:"10px 14px", borderRadius:"12px", fontSize:"13px", color:C.textMuted, cursor:"pointer" }} onClick={()=>navigate("/profil")}>Mon profil</div>
            <div style={{ padding:"10px 14px", borderRadius:"12px", fontSize:"13px", color:C.pink, cursor:"pointer", fontWeight:"500" }} onClick={handleLogout}>Déconnexion</div>
          </div>
        </div>
        <div style={{ margin:"0 16px" }}>
          <div style={{ background:C.greenLight, borderRadius:"14px", padding:"12px", display:"flex", alignItems:"center", gap:"10px", border:`1px solid ${C.greenMid}` }}>
            <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:C.green, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"15px", fontWeight:"700", color:"#fff" }}>
              {user.name?.charAt(0)?.toUpperCase()||"A"}
            </div>
            <div>
              <p style={{ fontSize:"13px", fontWeight:"600", color:C.text, margin:0 }}>{user.name||"Utilisateur"}</p>
              <p style={{ fontSize:"11px", color:C.textMuted, margin:0 }}>{roleLabelStr}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ padding:"28px", overflowY:"auto" }}>

        {/* HEADER */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:"22px", gap:"12px", flexWrap:"wrap" }}>
          <div>
            <button onClick={()=>navigate("/projets")} style={btn({ background:"#fff", border:`1px solid ${C.border}`, color:C.textMuted, marginBottom:"12px" })}>← Retour aux projets</button>
            <h1 style={{ fontSize:"26px", fontWeight:"800", color:C.text, margin:0, lineHeight:1.3 }}>{project.name}</h1>
            <p style={{ fontSize:"12px", color:C.textMuted, margin:"6px 0 0" }}>Projet #{project.id} · Synchronisé depuis OpenProject</p>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
            <span style={{ background:isAdmin?C.pinkLight:isManager?C.greenLight:C.blueLight, color:isAdmin?C.pinkDark:isManager?C.greenDark:C.blue, border:`1px solid ${C.border}`, borderRadius:"999px", padding:"7px 12px", fontSize:"11px", fontWeight:"700" }}>
              {roleLabelStr}
            </span>
            <span style={{ background:statut.bg, color:statut.color, border:`1px solid ${statut.border}`, borderRadius:"999px", padding:"7px 12px", fontSize:"11px", fontWeight:"700" }}>
              Statut : {statut.label}
            </span>
            <button onClick={refreshAll} style={btn({ background:C.green, color:"#fff" })}>
              {refreshing ? "Sync..." : "↻ Actualiser"}
            </button>
          </div>
        </div>

        {/* KPI */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:"12px", marginBottom:"18px" }}>
          {[
            { label:"Progression", value:`${backendProgress}%`, bg:C.green, color:"#fff", sub:"du projet" },
            { label:"Tâches", value:totals.total, bg:"#fff", color:C.text, sub:"total" },
            { label:"Terminées", value:totals.done, bg:C.greenLight, color:C.greenDark, sub:"complétées" },
            { label:"En cours", value:totals.progress, bg:C.blueLight, color:C.blue, sub:"active" },
            { label:"Bloquées", value:blockedCount, bg:blockedCount>0?C.redLight:"#fff", color:blockedCount>0?C.red:C.textMuted, sub:"dépendances" },
            { label:"Risque", value:`${backendRiskScore}%`, bg:backendRiskScore>40?C.orangeLight:C.greenLight, color:backendRiskScore>40?"#7a4520":C.greenDark, sub:project?.riskIsPartial?"partiel":"calculé" },
          ].map(item => (
            <div key={item.label} style={{ ...card({ padding:"16px", background:item.bg }) }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=C.shadowMd;}}
              onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow=C.shadow;}}>
              <p style={{ fontSize:"10px", textTransform:"uppercase", color:item.color, opacity:0.75, margin:"0 0 6px", letterSpacing:"0.6px" }}>{item.label}</p>
              <p style={{ fontSize:"26px", fontWeight:"800", color:item.color, margin:0 }}>{item.value}</p>
              <p style={{ fontSize:"10px", color:item.color, opacity:0.6, margin:"2px 0 0" }}>{item.sub}</p>
            </div>
          ))}
        </div>

        {/* VUE D'ENSEMBLE */}
        <div style={{ display:"grid", gridTemplateColumns:"1.3fr 1fr 1fr", gap:"14px", marginBottom:"18px" }}>
          <div style={{ ...card({ background:"linear-gradient(135deg,#fff,#f5f6ec)" }) }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
              <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:0 }}>Vue d'ensemble</p>
              <span style={{ fontSize:"11px", color:C.greenDark, fontWeight:"700" }}>{backendProgress}%</span>
            </div>
            <div style={{ height:"10px", background:"#fff", borderRadius:"999px", overflow:"hidden", border:`1px solid ${C.border}`, marginBottom:"14px" }}>
              <div style={{ height:"10px", width:`${backendProgress}%`, background:C.green, borderRadius:"999px", transition:"width 0.7s ease" }}/>
            </div>
            <p style={{ fontSize:"12px", color:C.textMuted, lineHeight:1.7, margin:"0 0 10px" }}>{projectDescription}</p>
            <p style={{ fontSize:"12px", color:C.textMuted, lineHeight:1.7, margin:0 }}>
              <b>{totals.total}</b> tâche(s) · <b>{totals.done}</b> terminée(s) · <b>{totals.progress}</b> en cours · <b>{totals.late}</b> en retard
            </p>
          </div>

          <div style={card()}>
            <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 14px" }}>Calendrier</p>
            <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
              {[
                ["Début", formatDate(project.startDate||project.start_date||stats?.kpis?.startDate)],
                ["Fin", formatDate(project.endDate||project.end_date||stats?.kpis?.endDate)],
                ["Workload", `${project.workload||stats?.kpis?.workload||totals.estimatedHours||"—"} h`],
                ["En retard", totals.late],
              ].map(([label,value]) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:"12px", color:C.textLight }}>{label}</span>
                  <span style={{ fontSize:"12px", color:C.text, fontWeight:"700" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={card()}>
            <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Analyse du risque</p>
            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"12px" }}>
              <div style={{ width:"52px", height:"52px", borderRadius:"50%", background:backendRiskScore>=70?C.redLight:backendRiskScore>=40?C.orangeLight:C.greenLight, border:`2px solid ${backendRiskScore>=70?"#f5c6c6":backendRiskScore>=40?"#fdd9b5":C.greenMid}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <span style={{ fontSize:"15px", fontWeight:"800", color:backendRiskScore>=70?C.red:backendRiskScore>=40?"#7a4520":C.greenDark }}>{backendRiskScore}%</span>
              </div>
              <div>
                <p style={{ fontSize:"12px", fontWeight:"700", color:backendRiskScore>=70?C.red:backendRiskScore>=40?"#7a4520":C.greenDark, margin:0 }}>
                  {backendRiskScore>=70?"Risque élevé":backendRiskScore>=40?"Risque modéré":"Risque faible"}
                </p>
                <p style={{ fontSize:"10px", color:C.textLight, margin:"2px 0 0" }}>{project?.riskIsPartial?"Score partiel":"Score calculé"}</p>
              </div>
            </div>
            <div style={{ background:backendRiskScore>=40?C.orangeLight:C.greenLight, border:`1px solid ${backendRiskScore>=40?"#fdd9b5":C.greenMid}`, borderRadius:"12px", padding:"10px 12px" }}>
              <p style={{ fontSize:"11px", color:backendRiskScore>=40?"#7a4520":C.greenDark, lineHeight:1.6, margin:0, fontWeight:"600" }}>{riskExplanation}</p>
            </div>
            {project?.estimatesComplete===false && (
              <p style={{ fontSize:"10px", color:C.orange, margin:"8px 0 0", fontWeight:"700" }}>
                ⚠️ {project.missingEstimates||0} tâche(s) sans estimation d'heures.
              </p>
            )}
          </div>
        </div>

        {/* ÉQUIPE */}
        <div style={{ ...card({ marginBottom:"18px" }) }}>
          <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 14px" }}>Équipe du projet</p>
          {members.length===0 ? (
            <div style={{ background:C.greenLight, border:`1px dashed ${C.greenMid}`, borderRadius:"12px", padding:"16px", textAlign:"center", color:C.textMuted, fontSize:"12px" }}>Aucun membre trouvé.</div>
          ) : (
            <div style={{ display:"flex", alignItems:"center", gap:"16px", flexWrap:"wrap" }}>
              <AvatarStack list={members}/>
              <p style={{ fontSize:"12px", color:C.textMuted, margin:0 }}>{members.length} membre(s)</p>
              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                {members.slice(0,6).map((m,i) => (
                  <div key={m.op_user_id||m.id||i} style={{ background:accents[i%accents.length].bg, border:`1px solid ${C.border}`, borderRadius:"999px", padding:"4px 10px", fontSize:"11px", color:accents[i%accents.length].dark, fontWeight:"600" }}>
                    {m.name} · <span style={{ opacity:0.7 }}>{m.role==="manager"?"Chef de projet":"Membre"}</span>
                  </div>
                ))}
                {members.length>6 && <span style={{ fontSize:"11px", color:C.textMuted }}>+{members.length-6} autres</span>}
              </div>
            </div>
          )}
        </div>

        {/* GRID PRINCIPAL */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:"16px" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

            {/* CRÉER TÂCHE */}
            {canManage && (
              <div style={card({ background:"linear-gradient(135deg,#fff,#f3f0fa)" })}>
                <p style={{ fontSize:"14px", color:C.text, fontWeight:"700", margin:"0 0 12px" }}>Créer une tâche</p>
                <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 0.8fr 0.8fr", gap:"8px", marginBottom:"8px" }}>
                  <div>
                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Titre *</label>
                    <input style={inp()} placeholder="Titre de la tâche" value={newTask.title} onChange={e=>setNewTask({...newTask,title:e.target.value})}/>
                  </div>
                  <div>
                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Responsable</label>
                    <select style={inp()} value={newTask.assigneeId} onChange={e=>setNewTask({...newTask,assigneeId:e.target.value})}>
                      <option value="">Non assigné</option>
                      {members.map(m=><option key={m.op_user_id||m.id} value={m.op_user_id||m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Date de fin</label>
                    <input style={inp()} type="date" value={newTask.dueDate} onChange={e=>setNewTask({...newTask,dueDate:e.target.value})}/>
                  </div>
                  <div>
                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Heures estimées</label>
                    <input style={inp()} type="number" min="0" placeholder="Ex: 8" value={newTask.estimatedHours} onChange={e=>setNewTask({...newTask,estimatedHours:e.target.value})}/>
                  </div>
                </div>
                <textarea style={inp({ minHeight:"56px", resize:"vertical", marginBottom:"8px" })} placeholder="Description de la tâche" value={newTask.description} onChange={e=>setNewTask({...newTask,description:e.target.value})}/>
                <button onClick={createTask} style={btn({ background:C.purple, color:"#fff" })}>+ Ajouter la tâche</button>
              </div>
            )}

            {/* FILTRES */}
            <div style={{ ...card(), display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px", flexWrap:"wrap" }}>
              <div style={{ background:"#fafaf8", border:`1px solid ${C.border}`, borderRadius:"999px", padding:"10px 16px", minWidth:"240px", flex:1, display:"flex", alignItems:"center", gap:"8px" }}>
                <span>🔍</span>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une tâche..."
                  style={{ border:"none", outline:"none", background:"transparent", width:"100%", fontSize:"13px", color:C.text }}/>
              </div>
              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                {[["all","Toutes"],["todo","À faire"],["progress","En cours"],["done","Terminées"],["late","En retard"],["blocked","Bloquées"]].map(([key,label]) => (
                  <button key={key} onClick={()=>setFilter(key)} style={btn({ background:filter===key?C.greenLight:"#fff", color:filter===key?C.greenDark:C.textMuted, border:filter===key?`1px solid ${C.greenMid}`:`1px solid ${C.border}` })}>{label}</button>
                ))}
              </div>
            </div>

            {/* LISTE TÂCHES */}
            <div style={card()}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
                <p style={{ fontSize:"14px", color:C.text, fontWeight:"700", margin:0 }}>Work packages ({filteredTasks.length})</p>
              </div>

              {filteredTasks.length===0 ? (
                <div style={{ background:C.greenLight, border:`1px dashed ${C.greenMid}`, borderRadius:"14px", padding:"30px", textAlign:"center" }}>
                  <div style={{ fontSize:"28px", marginBottom:"8px" }}>🌿</div>
                  <p style={{ fontSize:"13px", color:C.greenDark, fontWeight:"700", margin:0 }}>Aucune tâche trouvée</p>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                  {filteredTasks.map(task => {
                    const blocked = Boolean(dependenciesMap[task.id]?.isBlocked);
                    const draft = taskDrafts[task.id]||{};
                    const isSelected = selectedTaskId === task.id;
                    const taskAssigneeId = getAssigneeId(task);
                    const isMyTask = String(taskAssigneeId) === String(user.id||user.userId);

                    return (
                      <div key={task.id} style={{ background:blocked?C.redLight:"#fafaf8", border:`1px solid ${blocked?"#f5c6c6":C.border}`, borderRadius:"16px", padding:"14px" }}>

                        <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:"10px", alignItems:"start" }}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"5px" }}>
                              <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:isDone(task)?C.green:isInProgress(task)?C.blue:C.pink, flexShrink:0 }}/>
                              <p style={{ fontSize:"13px", fontWeight:"700", color:C.text, margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{task.subject}</p>
                            </div>
                            <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
                              <span style={{ fontSize:"10px", color:C.textLight }}>#{task.id}</span>
                              <span style={{ fontSize:"10px", color:C.textMuted }}>👤 {getAssigneeName(task)}</span>
                              <span style={{ fontSize:"10px", color:isOverdue(task)?C.red:C.textMuted }}>📅 {formatDate(task.dueDate)}</span>
                              <span style={{ fontSize:"10px", color:C.textMuted }}>⏱ {parseHours(task.estimatedTime)||"—"}h</span>
                            </div>
                            {blocked && <p style={{ fontSize:"11px", color:C.red, margin:"5px 0 0", fontWeight:"700" }}>⚠️ Tâche bloquée par une dépendance.</p>}
                          </div>

                          <StatusBadge task={task}/>

                          <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                            {!isDone(task)&&!isInProgress(task) && (
                              <button onClick={()=>updateStatus(task,"In progress")} style={btn({ background:C.blueLight, color:C.blue, border:"1px solid #c5daf5", padding:"5px 10px" })}>→ En cours</button>
                            )}
                            {!isDone(task) && (
                              <button onClick={()=>updateStatus(task,"Closed")} style={btn({ background:C.greenLight, color:C.greenDark, border:`1px solid ${C.greenMid}`, padding:"5px 10px" })}>✓ Terminer</button>
                            )}
                            <button onClick={()=>setSelectedTaskId(isSelected?null:task.id)}
                              style={btn({ background:isSelected?C.purpleLight:"#fff", color:C.purple, border:`1px solid ${C.border}`, padding:"5px 10px" })}>
                              {isSelected?"✕ Fermer":"⋯ Détails"}
                            </button>
                            {canManage && (
                              <button onClick={()=>removeTask(task)} style={btn({ background:C.redLight, color:C.red, border:"1px solid #f5c6c6", padding:"5px 10px" })}>✕</button>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <div style={{ marginTop:"14px", display:"flex", flexDirection:"column", gap:"12px" }}>

                            {(() => {
                              const descText = getTaskDesc(task);
                              return descText ? (
                                <div style={{ background:C.greenLight, border:`1px solid ${C.greenMid}`, borderRadius:"12px", padding:"12px 14px" }}>
                                  <p style={{ fontSize:"10px", color:C.greenDark, fontWeight:"700", margin:"0 0 6px", textTransform:"uppercase", letterSpacing:"0.5px" }}>Description</p>
                                  <p style={{ fontSize:"12px", color:C.text, lineHeight:1.7, margin:0 }}>{descText}</p>
                                </div>
                              ) : null;
                            })()}

                            {canManage && (
                              <div style={{ background:"#fff", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px" }}>
                                <p style={{ fontSize:"12px", fontWeight:"700", color:C.text, margin:"0 0 10px" }}>Modifier la tâche</p>
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"8px", marginBottom:"8px" }}>
                                  <div>
                                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Responsable</label>
                                    <select style={inp()} value={draft.assigneeId||""}
                                      onChange={e=>setTaskDrafts({...taskDrafts,[task.id]:{...draft,assigneeId:e.target.value}})}>
                                      <option value="">Non assigné</option>
                                      {members.map(m=>(
                                        <option key={m.op_user_id||m.id} value={m.op_user_id||m.id}>{m.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Date de fin</label>
                                    <input style={inp()} type="date" value={draft.dueDate||""}
                                      onChange={e=>setTaskDrafts({...taskDrafts,[task.id]:{...draft,dueDate:e.target.value}})}/>
                                  </div>
                                  <div>
                                    {/* ✅ FIX : label clair + valeur du draft bien initialisée */}
                                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>
                                      Heures estimées {draft.estimatedHours ? `(actuel : ${draft.estimatedHours}h)` : ""}
                                    </label>
                                    <input style={inp()} type="number" min="0" step="0.5" placeholder="Ex: 8"
                                      value={draft.estimatedHours||""}
                                      onChange={e=>setTaskDrafts({...taskDrafts,[task.id]:{...draft,estimatedHours:e.target.value}})}/>
                                  </div>
                                </div>
                                <button onClick={()=>saveTaskFields(task)} style={btn({ background:C.green, color:"#fff" })}>Sauvegarder</button>
                                <p style={{ fontSize:"10px", color:C.textLight, margin:"6px 0 0" }}>
                                  Les heures estimées sont mises à jour dans OpenProject et dans le budget du projet.
                                </p>
                              </div>
                            )}

                            <div style={{ background:"#fff", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px" }}>
                              <p style={{ fontSize:"12px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Heures travaillées</p>
                              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", marginBottom:"8px" }}>
                                <div>
                                  <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Heures travaillées *</label>
                                  <input style={inp()} type="number" min="0.5" step="0.5" placeholder="Ex: 2.5"
                                    value={timeForm.hoursWorked}
                                    onChange={e=>setTimeForm({...timeForm,hoursWorked:e.target.value})}/>
                                </div>
                                <div>
                                  <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Date</label>
                                  <input style={inp()} type="date" value={timeForm.loggedDate}
                                    onChange={e=>setTimeForm({...timeForm,loggedDate:e.target.value})}/>
                                </div>
                              </div>
                              <input style={inp({ marginBottom:"8px" })} placeholder="Note (optionnel)"
                                value={timeForm.note} onChange={e=>setTimeForm({...timeForm,note:e.target.value})}/>
                              <button onClick={()=>saveTimeLog(task)} style={btn({ background:C.blue, color:"#fff", marginBottom:"12px" })}>
                                + Enregistrer les heures
                              </button>

                              {(timeLogsMap[task.id]||[]).length > 0 && (
                                <div style={{ background:"#fafaf8", border:`1px solid ${C.border}`, borderRadius:"10px", padding:"10px 12px", marginBottom:"12px" }}>
                                  <p style={{ fontSize:"10px", color:C.textMuted, fontWeight:"700", margin:"0 0 6px" }}>
                                    Entrées enregistrées ({timeLogsMap[task.id].length})
                                  </p>
                                  <div style={{ display:"flex", flexDirection:"column", gap:"4px", maxHeight:"120px", overflowY:"auto" }}>
                                    {timeLogsMap[task.id].map((log, li) => (
                                      <div key={log.id||li} style={{ display:"flex", justifyContent:"space-between", fontSize:"10px", color:C.text }}>
                                        <span>{log.logged_date || "—"}</span>
                                        <span style={{ fontWeight:"700" }}>{log.hours_worked}h</span>
                                        {log.computed_cost !== null && (
                                          <span style={{ color:C.greenDark }}>{log.computed_cost} DA</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {(canManage || isMyTask) && (
                                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"12px" }}>
                                  <p style={{ fontSize:"11px", color:C.textMuted, fontWeight:"700", margin:"0 0 7px" }}>
                                    {canManage ? "Taux horaire (DA/h)" : "Mon taux horaire (DA/h)"}
                                  </p>
                                  <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                                    <input style={inp({ flex:1 })} type="number" min="0" placeholder="Ex: 1500"
                                      value={rateForm.taskId===String(task.id)?rateForm.memberRate:""}
                                      onChange={e=>setRateForm({ taskId:String(task.id), memberRate:e.target.value })}/>
                                    <button onClick={()=>saveMemberRate(task.id)} style={btn({ background:C.orange, color:"#fff", whiteSpace:"nowrap" })}>
                                      Fixer taux
                                    </button>
                                  </div>
                                  <p style={{ fontSize:"10px", color:C.textLight, margin:"5px 0 0" }}>
                                    {canManage
                                      ? "Le taux est utilisé pour calculer le coût estimé et réel de cette tâche."
                                      : "Votre taux horaire personnel pour cette tâche."}
                                  </p>
                                </div>
                              )}

                              {!canManage && !isMyTask && (
                                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"12px" }}>
                                  <p style={{ fontSize:"11px", color:C.textLight, fontStyle:"italic" }}>
                                    Le taux horaire est géré par le responsable de la tâche.
                                  </p>
                                </div>
                              )}
                            </div>

                            <div style={{ background:"#fafaf8", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"14px" }}>
                              <p style={{ fontSize:"12px", fontWeight:"700", color:C.text, margin:"0 0 2px" }}>✨ Analyse IA</p>
                              <p style={{ fontSize:"10px", color:C.textLight, margin:"0 0 4px" }}>
                                Génère un plan, un guide ou détecte les blocages pour cette tâche.
                              </p>
                              <TaskAI task={task} projectId={id}/>
                            </div>

                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── COLONNE DROITE ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>

            {/* MINI KANBAN */}
            <div style={card()}>
              <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Mini Kanban</p>
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                {[
                  { label:"À faire", list:tasks.filter(t=>!isDone(t)&&!isInProgress(t)), bg:C.pinkLight, color:C.pinkDark, dot:C.pink },
                  { label:"En cours", list:tasks.filter(isInProgress), bg:C.blueLight, color:C.blue, dot:C.blue },
                  { label:"Terminées", list:tasks.filter(isDone), bg:C.greenLight, color:C.greenDark, dot:C.green },
                  { label:"Bloquées", list:blockedTasks, bg:C.redLight, color:C.red, dot:C.red },
                ].map(col => (
                  <div key={col.label} style={{ background:col.bg, border:`1px solid ${C.border}`, borderRadius:"12px", padding:"10px 12px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"7px" }}>
                      <span style={{ fontSize:"11px", fontWeight:"700", color:col.color }}>{col.label}</span>
                      <span style={{ fontSize:"10px", fontWeight:"700", color:"#fff", background:col.dot, borderRadius:"999px", padding:"1px 8px" }}>{col.list.length}</span>
                    </div>
                    {col.list.slice(0,3).map(task => (
                      <div key={task.id} style={{ background:"rgba(255,255,255,0.75)", border:`1px solid ${C.border}`, borderRadius:"9px", padding:"6px 9px", display:"flex", gap:"7px", alignItems:"center", marginBottom:"5px" }}>
                        <span style={{ width:"5px", height:"5px", borderRadius:"50%", background:col.dot, flexShrink:0 }}/>
                        <span style={{ fontSize:"11px", color:C.text, fontWeight:"600", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{task.subject}</span>
                      </div>
                    ))}
                    {col.list.length>3 && <p style={{ fontSize:"10px", color:col.color, margin:"4px 0 0", textAlign:"center" }}>+{col.list.length-3} autres</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* RÉPARTITION */}
            <div style={card()}>
              <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Répartition des tâches</p>
              <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
                <DonutChart/>
                <div style={{ flex:1, display:"flex", flexDirection:"column", gap:"7px" }}>
                  {Object.entries(statusDist).map(([status,count],i) => (
                    <div key={status}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"2px" }}>
                        <span style={{ fontSize:"11px", color:C.text }}>{status}</span>
                        <span style={{ fontSize:"11px", fontWeight:"700", color:accents[i%accents.length].dark }}>{count}</span>
                      </div>
                      <div style={{ height:"4px", background:C.border, borderRadius:"999px" }}>
                        <div style={{ width:`${totals.total?Math.round((count/totals.total)*100):0}%`, height:"4px", background:accents[i%accents.length].c, borderRadius:"999px" }}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* BUDGET */}
            <div style={card()}>
              <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 14px" }}>Budget</p>

              {budget ? (
                <>
                  {budget.status && budget.status !== "no_budget" && (
                    <div style={{ background:budget.status==="danger"?C.redLight:budget.status==="warning"?C.orangeLight:C.greenLight, border:`1px solid ${budget.status==="danger"?"#f5c6c6":budget.status==="warning"?"#fdd9b5":C.greenMid}`, borderRadius:"10px", padding:"8px 12px", marginBottom:"12px", display:"flex", alignItems:"center", gap:"8px" }}>
                      <span style={{ fontSize:"16px" }}>{budget.status==="danger"?"🔴":budget.status==="warning"?"🟡":"🟢"}</span>
                      <div>
                        <p style={{ fontSize:"11px", fontWeight:"700", color:budget.status==="danger"?C.red:budget.status==="warning"?"#7a4520":C.greenDark, margin:0 }}>
                          {budget.status==="danger"?"Budget dépassé !":budget.status==="warning"?"Attention — 80% consommé":"Budget sous contrôle"}
                        </p>
                        {budget.consumedPct!==null && (
                          <p style={{ fontSize:"10px", color:C.textMuted, margin:"2px 0 0" }}>{budget.consumedPct}% du budget consommé</p>
                        )}
                      </div>
                    </div>
                  )}

                  {budget.budgetTotal!==null && budget.consumedPct!==null && (
                    <div style={{ marginBottom:"12px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
                        <span style={{ fontSize:"10px", color:C.textMuted }}>Consommation</span>
                        <span style={{ fontSize:"10px", fontWeight:"700", color:budget.status==="danger"?C.red:C.text }}>{budget.consumedPct}%</span>
                      </div>
                      <div style={{ height:"7px", background:C.border, borderRadius:"999px", overflow:"hidden" }}>
                        <div style={{ width:`${Math.min(budget.consumedPct,100)}%`, height:"7px", background:budget.status==="danger"?C.red:budget.status==="warning"?C.orange:C.green, borderRadius:"999px", transition:"width 0.6s" }}/>
                      </div>
                    </div>
                  )}

                  <div style={{ display:"flex", flexDirection:"column", gap:"7px", marginBottom:"12px" }}>
                    {[
                      { label:"Budget total", value:budget.budgetTotal!==null?`${budget.budgetTotal} DA`:"Non défini" },
                      { label:"Coût estimé", value:budget.estimatedCost!==null?`${budget.estimatedCost} DA`:"—" },
                      { label:"Coût réel", value:budget.actualCost!==null?`${budget.actualCost} DA`:"—" },
                      { label:"Restant", value:budget.remaining!==null?`${budget.remaining} DA`:"—" },
                      ...(budget.overrun>0?[{ label:"Dépassement", value:`${budget.overrun} DA`, alert:true }]:[]),
                    ].map(item => (
                      <div key={item.label} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                        <span style={{ fontSize:"12px", color:C.textLight }}>{item.label}</span>
                        <b style={{ fontSize:"12px", color:item.alert?C.red:C.text }}>{item.value}</b>
                      </div>
                    ))}
                  </div>

                  {isAdmin && (
                    <div style={{ background:C.pinkLight, border:`1px solid ${C.pinkMid}`, borderRadius:"12px", padding:"12px", marginBottom:"14px" }}>
                      <p style={{ fontSize:"11px", color:C.pinkDark, fontWeight:"700", margin:"0 0 8px" }}>Définir le budget total du projet</p>
                      <div style={{ display:"flex", gap:"8px" }}>
                        <input style={inp({ flex:1 })} type="number" min="0" placeholder="Montant en DA"
                          value={budgetInput} onChange={e=>setBudgetInput(e.target.value)}/>
                        <button onClick={saveBudget} style={btn({ background:C.pink, color:"#fff" })}>Fixer</button>
                      </div>
                      <p style={{ fontSize:"10px", color:C.textLight, margin:"6px 0 0" }}>Modifier le budget réinitialise les alertes de dépassement.</p>
                    </div>
                  )}

                  {canManage && (
                    <div style={{ background:C.blueLight, border:"1px solid #c5daf5", borderRadius:"12px", padding:"12px", marginBottom:"14px" }}>
                      <p style={{ fontSize:"11px", color:C.blue, fontWeight:"700", margin:"0 0 8px" }}>Heures estimées par tâche</p>
                      <div style={{ display:"flex", gap:"8px", alignItems:"center", marginBottom:"6px" }}>
                        <select style={inp({ flex:1 })} value={hoursForm.taskId}
                          onChange={e=>setHoursForm({...hoursForm,taskId:e.target.value})}>
                          <option value="">Choisir une tâche</option>
                          {tasks.map(t=><option key={t.id} value={t.id}>{t.subject}</option>)}
                        </select>
                      </div>
                      <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                        <input style={inp({ flex:1 })} type="number" min="0" step="0.5" placeholder="Heures (ex: 8)"
                          value={hoursForm.estimatedHours}
                          onChange={e=>setHoursForm({...hoursForm,estimatedHours:e.target.value})}/>
                        <button onClick={saveEstimatedHoursBudget} style={btn({ background:C.blue, color:"#fff", whiteSpace:"nowrap" })}>Définir</button>
                      </div>
                      <p style={{ fontSize:"10px", color:C.textLight, margin:"6px 0 0" }}>Utilisé pour calculer le coût estimé selon le taux horaire du membre assigné.</p>
                    </div>
                  )}

                  {canManage && budgetTasks.length > 0 && (
                    <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"14px" }}>
                      <p style={{ fontSize:"12px", fontWeight:"700", color:C.text, margin:"0 0 10px" }}>Détail par tâche</p>
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px", maxHeight:"280px", overflowY:"auto" }}>
                        {budgetTasks.map((bt,i) => {
                          const taskObj = tasks.find(t=>String(t.id)===String(bt.taskId));
                          const taskHasIssues = bt.memberRate===null || bt.estimatedHours===null;
                          return (
                            <div key={bt.taskId||i} style={{ background:taskHasIssues?"#fffbf0":"#fafaf8", border:`1px solid ${taskHasIssues?"#fdd9b5":C.border}`, borderRadius:"12px", padding:"10px 12px" }}>
                              <p style={{ fontSize:"11px", fontWeight:"700", color:C.text, margin:"0 0 7px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {taskObj?.subject||`Tâche #${bt.taskId}`}
                              </p>
                              {taskHasIssues && (
                                <p style={{ fontSize:"10px", color:C.orange, margin:"0 0 6px", fontWeight:"700" }}>
                                  {bt.memberRate===null && "⚠️ Taux horaire manquant. "}
                                  {bt.estimatedHours===null && "⚠️ Heures estimées manquantes."}
                                </p>
                              )}
                              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 12px" }}>
                                {[
                                  ["Heures estimées", bt.estimatedHours?`${bt.estimatedHours}h`:"—"],
                                  ["Heures travaillées", bt.hoursLogged?`${bt.hoursLogged}h`:"—"],
                                  ["Taux (DA/h)", bt.memberRate?`${bt.memberRate} DA`:"—"],
                                  ["Coût estimé", bt.estimatedCost?`${bt.estimatedCost} DA`:"—"],
                                  ["Coût réel", bt.actualCost?`${bt.actualCost} DA`:"—"],
                                ].map(([label,value]) => (
                                  <div key={label} style={{ display:"flex", justifyContent:"space-between" }}>
                                    <span style={{ fontSize:"10px", color:C.textLight }}>{label}</span>
                                    <span style={{ fontSize:"10px", fontWeight:"700", color:C.text }}>{value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ background:C.greenLight, border:`1px solid ${C.greenMid}`, borderRadius:"12px", padding:"10px 14px", marginTop:"10px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <p style={{ fontSize:"11px", color:C.greenDark, fontWeight:"700", margin:0 }}>Total utilisé</p>
                          <p style={{ fontSize:"10px", color:C.textMuted, margin:"2px 0 0" }}>sur {budget.budgetTotal!==null?`${budget.budgetTotal} DA`:"budget non défini"}</p>
                        </div>
                        <p style={{ fontSize:"18px", fontWeight:"800", color:C.pinkDark, margin:0 }}>
                          {budget.actualCost!==null?`${budget.actualCost} DA`:"—"}
                        </p>
                      </div>
                    </div>
                  )}

                  {!canManage && (
                    <div style={{ background:C.blueLight, border:"1px solid #c5daf5", borderRadius:"12px", padding:"10px 12px" }}>
                      <p style={{ fontSize:"11px", color:C.blue, margin:0 }}>
                        Le détail complet du budget est réservé au chef de projet.
                        Votre taux horaire se définit dans chaque tâche qui vous est assignée.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ fontSize:"12px", color:C.textMuted }}>Budget non disponible.</p>
              )}
            </div>

            {/* ✅ DÉPENDANCES — utilise handleCreateDependency et handleRemoveDependency */}
            {canManage && (
              <div style={card()}>
                <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Dépendances</p>

                <div style={{ background:"#fafaf8", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"12px", marginBottom:"12px" }}>
                  <p style={{ fontSize:"11px", color:C.textMuted, fontWeight:"700", margin:"0 0 10px" }}>Créer une dépendance</p>
                  <div style={{ marginBottom:"8px" }}>
                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Tâche bloquée</label>
                    <select style={inp()} value={depForm.taskId}
                      onChange={e=>setDepForm({...depForm,taskId:e.target.value,dependsOnTaskId:""})}>
                      <option value="">— Choisir la tâche bloquée —</option>
                      {tasks.map(t=><option key={t.id} value={String(t.id)}>{t.subject}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom:"10px" }}>
                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Dépend de (doit être terminée avant)</label>
                    <select style={inp()} value={depForm.dependsOnTaskId}
                      onChange={e=>setDepForm({...depForm,dependsOnTaskId:e.target.value})}>
                      <option value="">— Choisir la dépendance —</option>
                      {tasks.filter(t=>String(t.id)!==String(depForm.taskId)).map(t=>(
                        <option key={t.id} value={String(t.id)}>{t.subject}</option>
                      ))}
                    </select>
                  </div>
                  {/* ✅ Appel handleCreateDependency au lieu de createDependency */}
                  <button onClick={handleCreateDependency}
                    style={btn({
                      background: depForm.taskId && depForm.dependsOnTaskId ? C.pink : C.border,
                      color: depForm.taskId && depForm.dependsOnTaskId ? "#fff" : C.textLight,
                    })}>
                    Créer dépendance
                  </button>
                </div>

                {blockedTasks.length === 0 ? (
                  <div style={{ background:C.greenLight, border:`1px dashed ${C.greenMid}`, borderRadius:"12px", padding:"10px", textAlign:"center" }}>
                    <p style={{ fontSize:"11px", color:C.greenDark, margin:0 }}>Aucune tâche bloquée.</p>
                  </div>
                ) : (
                  blockedTasks.map(task => (
                    <div key={task.id} style={{ background:C.redLight, border:"1px solid #f5c6c6", borderRadius:"12px", padding:"9px 12px", marginTop:"8px" }}>
                      <p style={{ fontSize:"11px", color:C.text, fontWeight:"700", margin:"0 0 5px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        ⚠️ {task.subject}
                      </p>
                      {(dependenciesMap[task.id]?.dependsOn||[]).map(dep => (
                        <div key={dep.taskId} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", marginBottom:"4px" }}>
                          <div style={{ minWidth:0 }}>
                            <span style={{ fontSize:"10px", color:C.red }}>Bloquée par : </span>
                            <span style={{ fontSize:"10px", color:C.text, fontWeight:"600" }}>{dep.title}</span>
                            {dep.isDone && <span style={{ fontSize:"10px", color:C.greenDark, marginLeft:"4px" }}>(terminée)</span>}
                            {dep.missing && <span style={{ fontSize:"10px", color:C.textLight, marginLeft:"4px" }}>(supprimée)</span>}
                          </div>
                          {/* ✅ Appel handleRemoveDependency au lieu de removeDependency */}
                          <button onClick={()=>handleRemoveDependency(Number(task.id), Number(dep.taskId))}
                            style={btn({ padding:"3px 8px", background:"#fff", color:C.red, border:"1px solid #f5c6c6", flexShrink:0 })}>
                            Retirer
                          </button>
                        </div>
                      ))}
                    </div>
                  ))
                )}

                {tasks.filter(t =>
                  !dependenciesMap[t.id]?.isBlocked &&
                  (dependenciesMap[t.id]?.dependsOn||[]).length > 0
                ).map(task => (
                  <div key={task.id} style={{ background:"#fafaf8", border:`1px solid ${C.border}`, borderRadius:"12px", padding:"9px 12px", marginTop:"8px" }}>
                    <p style={{ fontSize:"11px", color:C.text, fontWeight:"700", margin:"0 0 5px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      ✓ {task.subject}
                    </p>
                    {(dependenciesMap[task.id]?.dependsOn||[]).map(dep => (
                      <div key={dep.taskId} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"8px", marginBottom:"4px" }}>
                        <div style={{ minWidth:0 }}>
                          <span style={{ fontSize:"10px", color:C.textMuted }}>Dépend de : </span>
                          <span style={{ fontSize:"10px", color:dep.isDone?C.greenDark:C.text, fontWeight:"600" }}>{dep.title}</span>
                          {dep.isDone && <span style={{ fontSize:"10px", color:C.greenDark, marginLeft:"4px" }}>✓</span>}
                        </div>
                        {/* ✅ Appel handleRemoveDependency au lieu de removeDependency */}
                        <button onClick={()=>handleRemoveDependency(Number(task.id), Number(dep.taskId))}
                          style={btn({ padding:"3px 8px", background:"#fff", color:C.textMuted, border:`1px solid ${C.border}`, flexShrink:0 })}>
                          Retirer
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* MEMBRES */}
            {canManage && (
              <div style={card()}>
                <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Gestion des membres</p>
                <div style={{ display:"flex", flexDirection:"column", gap:"7px", marginBottom:"12px" }}>
                  {members.map((m,i) => (
                    <div key={m.op_user_id||m.id||i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px", padding:"8px 10px", background:"#fafaf8", borderRadius:"10px", border:`1px solid ${C.border}` }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                        <div style={{ width:"26px", height:"26px", borderRadius:"50%", background:accents[i%accents.length].bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"11px", fontWeight:"700", color:accents[i%accents.length].dark }}>
                          {m.name?.charAt(0)?.toUpperCase()||"?"}
                        </div>
                        <div>
                          <p style={{ fontSize:"12px", fontWeight:"600", color:C.text, margin:0 }}>{m.name}</p>
                          <p style={{ fontSize:"10px", color:C.textMuted, margin:0 }}>{m.role==="manager"?"Chef de projet":"Membre"}</p>
                        </div>
                      </div>
                      {isAdmin && (
                        <button onClick={async () => {
                          try {
                            await removeMember(id, m.op_user_id || m.id);
                            await reloadCore();
                          } catch(err) {
                            console.error("Retirer membre erreur:", err);
                            alert(err?.raw?.message || err?.message || "Erreur lors du retrait.");
                          }
                        }} style={btn({ padding:"4px 8px", background:C.redLight, color:C.red, border:"1px solid #f5c6c6" })}>
                          Retirer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p style={{ fontSize:"11px", color:C.textMuted, fontWeight:"700", margin:"0 0 8px" }}>Ajouter un membre</p>
                <select style={inp({ marginBottom:"8px" })} value={memberForm.opUserId} onChange={e=>setMemberForm({...memberForm,opUserId:e.target.value})}>
                  <option value="">Choisir un utilisateur</option>
                  {allUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select style={inp({ marginBottom:"8px" })} value={memberForm.role} onChange={e=>setMemberForm({...memberForm,role:e.target.value})}>
                  <option value="member">Membre</option>
                  <option value="manager">Chef de projet</option>
                </select>
                <button onClick={addMember} style={btn({ background:C.green, color:"#fff" })}>Ajouter</button>
                <p style={{ fontSize:"10px", color:C.textLight, margin:"8px 0 0" }}>
                  Chaque membre définit son taux horaire dans la fiche de sa tâche assignée.
                </p>
              </div>
            )}

            {/* SOUS-PROJETS */}
            {canManage && (
              <div style={card()}>
                <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Sous-projets</p>
                {subProjects.length>0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:"7px", marginBottom:"14px" }}>
                    {subProjects.map(p => (
                      <div key={p.id} onClick={()=>navigate(`/projets/${p.id}`)} style={{ background:C.greenLight, border:`1px solid ${C.greenMid}`, borderRadius:"12px", padding:"9px 12px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <p style={{ fontSize:"12px", color:C.text, fontWeight:"700", margin:0 }}>{p.name}</p>
                          <p style={{ fontSize:"10px", color:C.textMuted, margin:"2px 0 0" }}>#{p.id}</p>
                        </div>
                        <span style={{ fontSize:"11px", color:C.greenDark }}>→</span>
                      </div>
                    ))}
                  </div>
                )}
                <p style={{ fontSize:"11px", color:C.textMuted, fontWeight:"700", margin:"0 0 10px" }}>Créer un sous-projet</p>
                <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                  <input style={inp()} placeholder="Titre *" value={newSubProject.title} onChange={e=>setNewSubProject({...newSubProject,title:e.target.value})}/>
                  <textarea style={inp({ minHeight:"56px", resize:"vertical" })} placeholder="Description *" value={newSubProject.description} onChange={e=>setNewSubProject({...newSubProject,description:e.target.value})}/>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                    <div>
                      <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Date de début</label>
                      <input style={inp()} type="date" value={newSubProject.startDate} onChange={e=>setNewSubProject({...newSubProject,startDate:e.target.value})}/>
                    </div>
                    <div>
                      <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Date de fin</label>
                      <input style={inp()} type="date" value={newSubProject.endDate} onChange={e=>setNewSubProject({...newSubProject,endDate:e.target.value})}/>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize:"10px", color:C.textMuted, display:"block", marginBottom:"3px" }}>Workload (heures)</label>
                    <input style={inp()} type="number" min="0" placeholder="Ex: 40" value={newSubProject.workload} onChange={e=>setNewSubProject({...newSubProject,workload:e.target.value})}/>
                  </div>
                  <button onClick={createSubProject} style={btn({ background:C.purple, color:"#fff" })}>Créer sous-projet</button>
                </div>
              </div>
            )}

            {/* ACTIVITÉ RÉCENTE */}
            <div style={card()}>
              <p style={{ fontSize:"14px", fontWeight:"700", color:C.text, margin:"0 0 12px" }}>Activité récente</p>
              {recentTasks.length===0 ? (
                <p style={{ fontSize:"12px", color:C.textMuted }}>Aucune activité récente.</p>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:"7px" }}>
                  {recentTasks.map(task => (
                    <div key={task.id} style={{ display:"flex", gap:"9px", alignItems:"center", background:"#fafaf8", border:`1px solid ${C.border}`, borderRadius:"10px", padding:"9px 10px" }}>
                      <div style={{ width:"7px", height:"7px", borderRadius:"50%", background:isDone(task)?C.green:isInProgress(task)?C.blue:C.pink, flexShrink:0 }}/>
                      <div style={{ minWidth:0 }}>
                        <p style={{ fontSize:"11px", fontWeight:"600", color:C.text, margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{task.subject}</p>
                        <p style={{ fontSize:"10px", color:C.textLight, margin:"2px 0 0" }}>{formatDate(task.updatedAt||task.createdAt)}</p>
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