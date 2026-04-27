import React, { useState, useEffect } from "react";
import { analyzeWithAI, createProject, fetchMembers } from "../services/api";
import { useNavigate } from "react-router-dom";
import "./NewProjectPage.css";

const emptyTask = () => ({
  id: Date.now() + Math.random(),
  title: "",
  description: "",
  estimatedHours: "",
  startDate: "",
  dueDate: "",
});

/* ─── Palette Dashboard ─── */
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

export default function NewProjectPage({ onBack }) {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [step, setStep]               = useState(1);
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate]     = useState("");
  const [endDate, setEndDate]         = useState("");
  const [workload, setWorkload]       = useState("");
  const [managerId, setManagerId]     = useState("");
  const [useAI, setUseAI]             = useState(false);
  const [members, setMembers]         = useState([]);
  const [errors, setErrors]           = useState({});
  const [tasks, setTasks]             = useState([]);
  const [taskErrors, setTaskErrors]   = useState({});
  const [correctedDesc, setCorrectedDesc] = useState("");
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiError, setAiError]         = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState(null);
  const [success, setSuccess]         = useState(false);

  useEffect(() => {
    fetchMembers().then(setMembers).catch(() => setMembers([]));
  }, []);

  function validateField(field, value, extra = {}) {
    let error = "";
    switch (field) {
      case "title":
        if (!value.trim()) error = "Le titre est obligatoire.";
        else if (value.trim().length < 2) error = "Minimum 2 caractères.";
        else if (value.trim().length > 200) error = "Maximum 200 caractères.";
        break;
      case "description":
        if (!value.trim()) error = "La description est obligatoire.";
        else if (value.trim().length < 5) error = "Minimum 5 caractères.";
        break;
      case "startDate":
        if (value && extra.endDate && new Date(value) > new Date(extra.endDate))
          error = "La date de début ne peut pas être après la date de fin.";
        break;
      case "endDate":
        if (value && extra.startDate && new Date(extra.startDate) > new Date(value))
          error = "La date de fin ne peut pas être avant la date de début.";
        break;
      case "workload":
        if (value && (isNaN(Number(value)) || Number(value) < 0))
          error = "Le workload doit être un nombre positif.";
        break;
      default: break;
    }
    setErrors((prev) => ({ ...prev, [field]: error }));
    return error;
  }

  function validateTaskField(taskId, field, value, extra = {}) {
    let error = "";
    switch (field) {
      case "title":
        if (!value.trim()) error = "Le titre est obligatoire.";
        else if (value.trim().length > 255) error = "Maximum 255 caractères.";
        break;
      case "estimatedHours":
        if (value && (isNaN(Number(value)) || Number(value) < 0))
          error = "Doit être un nombre positif.";
        break;
      case "startDate":
        if (value && extra.dueDate && new Date(value) > new Date(extra.dueDate))
          error = "Début après la fin.";
        break;
      case "dueDate":
        if (value && extra.startDate && new Date(extra.startDate) > new Date(value))
          error = "Fin avant le début.";
        break;
      default: break;
    }
    setTaskErrors((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] || {}), [field]: error },
    }));
    return error;
  }

  async function handleNext() {
    const e1 = validateField("title", title);
    const e2 = validateField("description", description);
    const e3 = validateField("startDate", startDate, { endDate });
    const e4 = validateField("endDate", endDate, { startDate });
    const e5 = validateField("workload", workload);
    if (e1 || e2 || e3 || e4 || e5) return;

    if (useAI) {
      setAiLoading(true); setAiError(null);
      try {
        const result = await analyzeWithAI(title, description);
        setCorrectedDesc(result.correctedDescription || description);
        setTasks((result.tasks || []).map((t) => ({
          id: Date.now() + Math.random(),
          title: t.title || "", description: t.description || "",
          estimatedHours: t.estimatedHours || "",
          startDate: startDate || "", dueDate: endDate || "",
        })));
      } catch (err) {
        setAiError("Erreur IA : " + err.message);
        setAiLoading(false); return;
      } finally { setAiLoading(false); }
    } else { setTasks([emptyTask()]); }
    setStep(2);
  }

  function updateTask(id, field, value) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    const task = tasks.find((t) => t.id === id);
    if (field === "startDate")      validateTaskField(id, field, value, { dueDate: task?.dueDate });
    if (field === "dueDate")        validateTaskField(id, field, value, { startDate: task?.startDate });
    if (field === "estimatedHours") validateTaskField(id, field, value);
    if (field === "title")          validateTaskField(id, field, value);
  }

  function deleteTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setTaskErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (editingTaskId === id) setEditingTaskId(null);
  }

  function addTask() {
    const newTask = emptyTask();
    setTasks((prev) => [...prev, newTask]);
    setEditingTaskId(newTask.id);
  }

  async function handleCreate() {
    setCreating(true); setCreateError(null);
    try {
      const finalDesc = correctedDesc || description;
      const selectedManager = members.find((m) => String(m.id) === String(managerId));
      await createProject(
        title, finalDesc, tasks,
        managerId || null,
        selectedManager?.name || null,
        selectedManager?.email || null,
        startDate || null, endDate || null, workload || null
      );
      setSuccess(true);
    } catch (err) { setCreateError("Erreur : " + err.message); }
    finally { setCreating(false); }
  }

  const handleLogout = () => {
    localStorage.removeItem("jwt"); localStorage.removeItem("user"); navigate("/");
  };

  const goBack = onBack || (() => navigate("/projets"));
  const selectedManager = members.find((m) => String(m.id) === String(managerId));

  /* ── Styles partagés ── */
  const fieldLabel = {
    fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em",
    textTransform: "uppercase", color: C.textMuted, display: "block", marginBottom: "7px",
  };

  const fieldInput = (hasError = false) => ({
    width: "100%", background: "#fff",
    border: `1.5px solid ${hasError ? C.pink : C.border}`,
    borderRadius: "10px", padding: "11px 14px", color: C.text,
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: "13px", outline: "none",
    boxShadow: hasError ? `0 0 0 3px rgba(212,83,138,0.10)` : "0 1px 3px rgba(0,0,0,0.04)",
    transition: "border-color 0.2s, box-shadow 0.2s", boxSizing: "border-box",
  });

  const errorMsg = (msg) => msg ? (
    <span style={{
      fontSize: "11px", color: C.pinkDark, marginTop: "5px",
      background: C.pinkLight, border: `1px solid ${C.pinkMid}`,
      borderRadius: "6px", padding: "3px 9px", display: "inline-block",
    }}>⚠ {msg}</span>
  ) : null;

  const cardShell = {
    background: C.card, borderRadius: "18px",
    border: `1px solid ${C.border}`, boxShadow: C.shadowMd, overflow: "hidden",
  };

  /* FIX: unified neutral white card header — ends all color clashes */
  const cardHeader = () => ({
    background: "#fff",
    borderBottom: `1px solid ${C.border}`,
    padding: "18px 28px", display: "flex", alignItems: "center", gap: "12px",
  });

  const iconBox = (bg = C.green, shadow = "rgba(159,184,120,0.4)") => ({
    width: "38px", height: "38px", borderRadius: "11px", background: bg,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "17px", boxShadow: `0 3px 10px ${shadow}`, flexShrink: 0,
  });

  /* ── SUCCESS ── */
  if (success) return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI',Arial,sans-serif" }}>
      <Sidebar user={user} navigate={navigate} handleLogout={handleLogout} C={C} />
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <div style={{ textAlign: "center", maxWidth: "460px" }}>
          <div style={{ fontSize: "64px", marginBottom: "20px" }}>🎉</div>
          <h2 style={{ fontSize: "28px", fontWeight: "700", color: C.text, marginBottom: "12px" }}>Projet créé avec succès !</h2>
          <p style={{ color: C.textMuted, fontSize: "14px", marginBottom: "32px", lineHeight: 1.8 }}>
            Le projet <strong>"{title}"</strong> et ses <strong>{tasks.length}</strong> tâche{tasks.length > 1 ? "s" : ""} ont été créés dans OpenProject.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <button onClick={() => navigate("/projets")} style={{ padding: "12px 24px", background: C.greenLight, border: `1px solid ${C.greenMid}`, borderRadius: "999px", color: C.greenDark, fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>Voir mes projets</button>
            <button onClick={() => navigate("/dashboard")} style={{ padding: "12px 24px", background: C.green, border: "none", borderRadius: "999px", color: "#fff", fontSize: "13px", fontWeight: "600", cursor: "pointer", boxShadow: `0 3px 10px rgba(159,184,120,0.35)` }}>Dashboard →</button>
          </div>
        </div>
      </main>
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI',Arial,sans-serif" }}>
      <Sidebar user={user} navigate={navigate} handleLogout={handleLogout} C={C} />

      <main style={{ overflowY: "auto", padding: "32px 40px" }}>
        {/* FIX: increased max-width from 960px → 1100px */}
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>

          {/* HEADER */}
          <div style={{ marginBottom: "26px" }}>
            <button
              onClick={step === 1 ? goBack : step === 2 ? () => setStep(1) : () => setStep(2)}
              style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: "999px",
                padding: "7px 16px", fontSize: "12px", color: C.textMuted, cursor: "pointer",
                fontWeight: "600", marginBottom: "14px", boxShadow: C.shadow,
                display: "inline-flex", alignItems: "center", gap: "4px",
              }}
            >← {step === 1 ? "Retour aux projets" : "Étape précédente"}</button>

            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", color: C.green, margin: "0 0 5px" }}>
                  Light Project — Étape {step}/3
                </p>
                <h1 style={{ fontSize: "26px", fontWeight: "700", color: C.text, margin: 0, lineHeight: 1.2 }}>
                  {step === 1 && "Nouveau Projet"}
                  {step === 2 && "Les Tâches"}
                  {step === 3 && "Récapitulatif & Validation"}
                </h1>
              </div>
              <span style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: "999px",
                padding: "6px 16px", fontSize: "12px", color: C.textMuted,
                boxShadow: C.shadow, whiteSpace: "nowrap", flexShrink: 0,
              }}>Étape <strong style={{ color: C.text }}>{step}</strong> sur 3</span>
            </div>
          </div>

          {/* STEPPER */}
          <div style={{
            background: C.card, borderRadius: "14px", padding: "16px 24px",
            border: `1px solid ${C.border}`, boxShadow: C.shadow,
            display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px",
          }}>
            {[["1", "Informations"], ["2", "Tâches"], ["3", "Validation"]].map(([num, label], i) => {
              const active = step >= i + 1;
              const done   = step > i + 1;
              return (
                <React.Fragment key={num}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: active ? 1 : 0.35, transition: "opacity 0.3s" }}>
                    <div style={{
                      width: "28px", height: "28px", borderRadius: "50%",
                      background: active ? C.green : C.bg,
                      border: `2px solid ${active ? C.green : C.border}`,
                      color: active ? "#fff" : C.textMuted,
                      fontSize: "11px", fontWeight: "700",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: active && !done ? `0 0 0 4px ${C.greenLight}` : "none",
                      transition: "all 0.3s",
                    }}>{done ? "✓" : num}</div>
                    <span style={{ fontSize: "13px", color: active ? C.greenDark : C.textMuted, fontWeight: active ? "600" : "400" }}>{label}</span>
                  </div>
                  {i < 2 && (
                    <div style={{ flex: 1, height: "2px", borderRadius: "2px", background: step > i + 1 ? C.green : C.border, transition: "background 0.3s" }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* ═══════════════ ÉTAPE 1 ═══════════════ */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" }}>

                {/* Informations générales */}
                <div style={cardShell}>
                  <div style={cardHeader()}>
                    <div style={iconBox()}>📋</div>
                    <div>
                      <p style={{ fontSize: "14px", fontWeight: "700", color: C.text, margin: 0 }}>Informations du projet</p>
                      <p style={{ fontSize: "12px", color: C.textMuted, margin: "2px 0 0" }}>Titre, description et responsable</p>
                    </div>
                  </div>
                  <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
                    <div>
                      <label style={fieldLabel}>Titre du projet *</label>
                      <input style={fieldInput(!!errors.title)} type="text" placeholder="Ex: Refonte du site web"
                        value={title} onChange={(e) => { setTitle(e.target.value); validateField("title", e.target.value); }} />
                      {errorMsg(errors.title)}
                    </div>
                    <div>
                      <label style={fieldLabel}>Description du projet *</label>
                      <textarea style={{ ...fieldInput(!!errors.description), minHeight: "120px", resize: "vertical" }}
                        placeholder="Décrivez votre projet en quelques phrases..."
                        value={description} onChange={(e) => { setDescription(e.target.value); validateField("description", e.target.value); }} />
                      {errorMsg(errors.description)}
                    </div>
                    <div>
                      <label style={fieldLabel}>Chef de projet</label>
                      <select style={fieldInput()} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                        <option value="">— Sélectionner un membre —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* FIX: Planification — white header, blue icon only, no blue bg */}
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  <div style={cardShell}>
                    <div style={cardHeader()}>
                      <div style={iconBox(C.blue, "rgba(90,138,196,0.25)")}>🗓</div>
                      <div>
                        <p style={{ fontSize: "14px", fontWeight: "700", color: C.text, margin: 0 }}>Planification</p>
                        <p style={{ fontSize: "12px", color: C.textMuted, margin: "2px 0 0" }}>Dates et charge estimée</p>
                      </div>
                    </div>
                    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div>
                          <label style={fieldLabel}>Date de début</label>
                          <input style={fieldInput(!!errors.startDate)} type="date" value={startDate}
                            onChange={(e) => { setStartDate(e.target.value); validateField("startDate", e.target.value, { endDate }); validateField("endDate", endDate, { startDate: e.target.value }); }} />
                          {errorMsg(errors.startDate)}
                        </div>
                        <div>
                          <label style={fieldLabel}>Date de fin cible</label>
                          <input style={fieldInput(!!errors.endDate)} type="date" value={endDate}
                            onChange={(e) => { setEndDate(e.target.value); validateField("endDate", e.target.value, { startDate }); validateField("startDate", startDate, { endDate: e.target.value }); }} />
                          {errorMsg(errors.endDate)}
                        </div>
                      </div>
                      <div>
                        <label style={fieldLabel}>Workload estimé (heures)</label>
                        <input style={fieldInput(!!errors.workload)} type="number" placeholder="Ex: 120"
                          value={workload} onChange={(e) => { setWorkload(e.target.value); validateField("workload", e.target.value); }} />
                        {errorMsg(errors.workload)}
                      </div>

                      {/* FIX: compact toggle pill — not a big card anymore */}
                      <div
                        onClick={() => setUseAI(!useAI)}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "10px 14px",
                          border: `1.5px solid ${useAI ? C.green : C.border}`,
                          borderRadius: "10px",
                          background: useAI ? C.greenLight : C.bg,
                          cursor: "pointer", transition: "all 0.2s",
                          marginTop: "4px",
                        }}
                      >
                        <div style={{
                          width: "34px", height: "20px", borderRadius: "999px",
                          background: useAI ? C.green : "#d1d1c8",
                          position: "relative", flexShrink: 0,
                          transition: "background 0.2s",
                        }}>
                          <div style={{
                            position: "absolute", top: "3px",
                            left: useAI ? "16px" : "3px",
                            width: "14px", height: "14px", borderRadius: "50%",
                            background: "#fff",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                            transition: "left 0.2s",
                          }} />
                        </div>
                        <span style={{ fontSize: "12px", fontWeight: "600", color: useAI ? C.greenDark : C.textMuted }}>
                          ✨ Analyser avec l'IA Gemini
                        </span>
                        <span style={{ fontSize: "11px", color: C.textLight, marginLeft: "auto" }}>
                          Tâches auto
                        </span>
                      </div>
                    </div>
                  </div>

                  {aiError && (
                    <p style={{ color: C.pinkDark, fontSize: "12px", background: C.pinkLight, padding: "10px 14px", borderRadius: "10px", border: `1px solid ${C.pinkMid}`, margin: 0 }}>⚠️ {aiError}</p>
                  )}
                </div>
              </div>

              <button onClick={handleNext} disabled={aiLoading} style={{
                width: "100%", padding: "15px",
                background: aiLoading ? C.textLight : C.green,
                border: "none", borderRadius: "12px", color: "#fff",
                fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: "14px", fontWeight: "700",
                cursor: aiLoading ? "not-allowed" : "pointer",
                boxShadow: `0 3px 12px rgba(159,184,120,0.35)`, transition: "opacity 0.2s",
              }}>
                {aiLoading ? "⏳ Analyse IA en cours..." : "Suivant →"}
              </button>
            </div>
          )}

          {/* ═══════════════ ÉTAPE 2 ═══════════════ */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

              {correctedDesc && (
                <div style={{ background: C.greenLight, border: `1px solid ${C.greenMid}`, borderRadius: "14px", padding: "16px 22px" }}>
                  <p style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: C.greenDark, opacity: 0.7, margin: "0 0 6px" }}>✨ Description corrigée par l'IA</p>
                  <p style={{ fontSize: "13px", color: C.greenDark, lineHeight: 1.7, margin: 0 }}>{correctedDesc}</p>
                </div>
              )}

              {/* FIX: tasks card — white header, green icon for AI too (no purple/blue clash) */}
              <div style={cardShell}>
                <div style={cardHeader()}>
                  <div style={iconBox(C.green, "rgba(159,184,120,0.4)")}>{useAI ? "🤖" : "✏️"}</div>
                  <div>
                    <p style={{ fontSize: "14px", fontWeight: "700", color: C.text, margin: 0 }}>{useAI ? "Tâches proposées par l'IA" : "Tâches du projet"}</p>
                    <p style={{ fontSize: "12px", color: C.textMuted, margin: "2px 0 0" }}>{tasks.length} tâche{tasks.length > 1 ? "s" : ""} · Cliquez sur ✏️ pour modifier</p>
                  </div>
                </div>

                <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {tasks.map((task, i) => (
                    <div key={task.id} style={{
                      background: C.bg,
                      border: `1.5px solid ${editingTaskId === task.id ? C.green : C.border}`,
                      borderRadius: "12px", overflow: "hidden",
                      boxShadow: editingTaskId === task.id ? `0 0 0 3px ${C.greenLight}` : "none",
                      transition: "all 0.2s",
                    }}>
                      <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{
                          width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0,
                          background: editingTaskId === task.id ? C.green : C.greenLight,
                          border: `1.5px solid ${C.greenMid}`,
                          color: editingTaskId === task.id ? "#fff" : C.greenDark,
                          fontSize: "11px", fontWeight: "700",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.2s",
                        }}>{i + 1}</div>
                        <input type="text" value={task.title} placeholder="Titre de la tâche"
                          onChange={(e) => updateTask(task.id, "title", e.target.value)}
                          style={{ flex: 1, background: "transparent", border: "none", borderBottom: `1.5px solid ${taskErrors[task.id]?.title ? C.pink : "transparent"}`, padding: "3px 0", color: C.text, fontFamily: "inherit", fontSize: "13px", fontWeight: "600", outline: "none" }} />
                        <button onClick={() => setEditingTaskId(editingTaskId === task.id ? null : task.id)}
                          style={{ background: editingTaskId === task.id ? C.greenLight : "#fff", border: `1px solid ${editingTaskId === task.id ? C.green : C.border}`, borderRadius: "8px", color: editingTaskId === task.id ? C.greenDark : C.textMuted, width: "32px", height: "32px", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {editingTaskId === task.id ? "▲" : "✏️"}
                        </button>
                        <button onClick={() => deleteTask(task.id)}
                          style={{ background: C.pinkLight, border: `1px solid ${C.pinkMid}`, borderRadius: "8px", color: C.pinkDark, width: "32px", height: "32px", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                      {taskErrors[task.id]?.title && (
                        <div style={{ paddingLeft: "56px", paddingBottom: "8px" }}>{errorMsg(taskErrors[task.id].title)}</div>
                      )}
                      {editingTaskId === task.id && (
                        <div style={{ borderTop: `1px solid ${C.greenMid}`, padding: "18px 20px", background: "#fff", display: "flex", flexDirection: "column", gap: "14px" }}>
                          <div>
                            <label style={fieldLabel}>Description</label>
                            <textarea value={task.description} placeholder="Description de la tâche..."
                              onChange={(e) => updateTask(task.id, "description", e.target.value)}
                              style={{ ...fieldInput(), minHeight: "70px", resize: "vertical" }} />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                            {[
                              { label: "Heures estimées", field: "estimatedHours", type: "number", placeholder: "Ex: 8" },
                              { label: "Date de début",   field: "startDate",       type: "date"   },
                              { label: "Date de fin",     field: "dueDate",         type: "date"   },
                            ].map(({ label, field, type, placeholder }) => (
                              <div key={field}>
                                <label style={fieldLabel}>{label}</label>
                                <input type={type} value={task[field]} placeholder={placeholder || ""}
                                  onChange={(e) => updateTask(task.id, field, e.target.value)}
                                  style={fieldInput(!!taskErrors[task.id]?.[field])} />
                                {errorMsg(taskErrors[task.id]?.[field])}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <button onClick={addTask} style={{
                    width: "100%", padding: "12px",
                    background: "transparent", border: `1.5px dashed ${C.greenMid}`,
                    borderRadius: "12px", color: C.textMuted,
                    fontFamily: "inherit", fontSize: "13px", fontWeight: "500",
                    cursor: "pointer", transition: "all 0.2s",
                  }}>+ Ajouter une tâche</button>
                </div>
              </div>

              <button onClick={() => setStep(3)} style={{
                width: "100%", padding: "15px", background: C.green, border: "none",
                borderRadius: "12px", color: "#fff",
                fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: "14px", fontWeight: "700",
                cursor: "pointer", boxShadow: `0 3px 12px rgba(159,184,120,0.35)`,
              }}>Suivant → Récapitulatif</button>
            </div>
          )}

          {/* ═══════════════ ÉTAPE 3 ═══════════════ */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" }}>

                {/* Infos projet */}
                <div style={cardShell}>
                  <div style={cardHeader()}>
                    <div style={iconBox()}>🔍</div>
                    <div>
                      <p style={{ fontSize: "14px", fontWeight: "700", color: C.text, margin: 0 }}>Récapitulatif du projet</p>
                      <p style={{ fontSize: "12px", color: C.textMuted, margin: "2px 0 0" }}>Vérifiez les informations</p>
                    </div>
                  </div>
                  <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    {[
                      ["Titre",            title || "—"],
                      ["Chef de projet",   selectedManager?.name || "Non assigné"],
                      ["Date de début",    startDate || "—"],
                      ["Date de fin",      endDate || "—"],
                      ["Workload estimé",  workload ? `${workload} heures` : "—"],
                      ["Généré par IA",    useAI ? "✅ Oui" : "Non"],
                    ].map(([label, value]) => (
                      <div key={label} style={{ background: C.bg, borderRadius: "10px", padding: "10px 14px", border: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.06em", color: C.textLight }}>{label}</span>
                        <span style={{ fontSize: "13px", color: C.text, fontWeight: "600" }}>{value}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: "6px" }}>
                      <p style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: C.textLight, margin: "0 0 8px" }}>Description</p>
                      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px 14px", fontSize: "13px", color: C.textMuted, lineHeight: 1.7 }}>
                        {correctedDesc || description || "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* FIX: Tasks recap — white header, green icon, no pink bg */}
                <div style={cardShell}>
                  <div style={cardHeader()}>
                    <div style={iconBox(C.green, "rgba(159,184,120,0.3)")}>📝</div>
                    <div>
                      <p style={{ fontSize: "14px", fontWeight: "700", color: C.text, margin: 0 }}>Tâches ({tasks.length})</p>
                      <p style={{ fontSize: "12px", color: C.textMuted, margin: "2px 0 0" }}>Récapitulatif des tâches définies</p>
                    </div>
                  </div>
                  <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: "8px", maxHeight: "440px", overflowY: "auto" }}>
                    {tasks.length === 0 ? (
                      <p style={{ fontSize: "13px", color: C.textLight, fontStyle: "italic", textAlign: "center", padding: "24px 0" }}>Aucune tâche définie.</p>
                    ) : tasks.map((task, i) => (
                      <div key={task.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: C.greenLight, border: `1.5px solid ${C.greenMid}`, color: C.greenDark, fontSize: "11px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ flex: 1, fontSize: "13px", fontWeight: "600", color: C.text }}>{task.title || <em style={{ color: C.textLight, fontWeight: 400 }}>Sans titre</em>}</span>
                          {task.estimatedHours && (
                            <span style={{ fontSize: "11px", padding: "2px 10px", background: C.greenLight, border: `1px solid ${C.greenMid}`, borderRadius: "999px", color: C.greenDark, fontWeight: "700" }}>⏱ {task.estimatedHours}h</span>
                          )}
                        </div>
                        {(task.description || task.startDate || task.dueDate) && (
                          <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid #f0efe8`, paddingLeft: "32px" }}>
                            {task.description && <p style={{ fontSize: "12px", color: C.textMuted, lineHeight: 1.6, margin: "0 0 4px" }}>{task.description}</p>}
                            <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: C.textLight }}>
                              {task.startDate && <span>🗓 {task.startDate}</span>}
                              {task.dueDate   && <span>🏁 {task.dueDate}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {createError && (
                <p style={{ color: C.pinkDark, fontSize: "12px", background: C.green, padding: "10px 14px", borderRadius: "10px", border: `1px solid ${C.pinkMid}`, margin: 0 }}>⚠️ {createError}</p>
              )}

              <button onClick={handleCreate} disabled={creating} style={{
                width: "100%", padding: "16px",
                background: creating ? C.textLight : C.pink,
                border: "none", borderRadius: "12px", color: "#fff",
                fontFamily: "'Segoe UI',Arial,sans-serif", fontSize: "15px", fontWeight: "700",
                cursor: creating ? "not-allowed" : "pointer",
                boxShadow: `0 3px 12px rgba(159,184,120,0.3)`,
                opacity: creating ? 0.6 : 1, transition: "opacity 0.2s",
              }}>
                {creating ? "⏳ Création en cours..." : " Valider et créer dans OpenProject"}
              </button>
            </div>
          )}

        </div>
      </main>

      <style>{`
        input:focus, textarea:focus, select:focus {
          border-color: #9FB878 !important;
          box-shadow: 0 0 0 3px rgba(159,184,120,0.15) !important;
          outline: none;
        }
      `}</style>
    </div>
  );
}

/* ── Sidebar identique au Dashboard ── */
function Sidebar({ user, navigate, handleLogout, C }) {
  const path = window.location.pathname;
  const navItems = [
    { label: "Dashboard",   path: "/dashboard" },
    { label: "Mes projets", path: "/projets"   },
    { label: "Mes tâches",  path: "/taches"    },
    { label: "Analyse IA",  path: "/ai"        },
  ];
  return (
    <aside style={{ background: "#fff", borderRight: `1px solid ${C.border}`, padding: "24px 0", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "sticky", top: 0, height: "100vh", overflowY: "auto", boxShadow: "2px 0 8px rgba(0,0,0,0.03)" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 20px 28px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", boxShadow: `0 2px 8px ${C.greenMid}` }}>🐝</div>
          <span style={{ fontSize: "16px", fontWeight: "700", color: C.text }}>lightproject</span>
        </div>
        <div style={{ padding: "0 12px" }}>
          {navItems.map(item => {
            const active = path === item.path || (item.path === "/projets" && path.startsWith("/projets"));
            return (
              <div key={item.path} onClick={() => navigate(item.path)} style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", cursor: "pointer", marginBottom: "3px", color: active ? C.greenDark : C.textMuted, background: active ? C.greenLight : "transparent", fontWeight: active ? "600" : "400", borderLeft: active ? `3px solid ${C.green}` : "3px solid transparent", transition: "all 0.15s" }}>
                {item.label}
              </div>
            );
          })}
        </div>
        <div style={{ height: "1px", background: C.border, margin: "16px" }} />
        <div style={{ padding: "0 12px" }}>
          <p style={{ fontSize: "10px", color: C.textLight, textTransform: "uppercase", letterSpacing: "1px", padding: "0 14px", margin: "0 0 6px" }}>Compte</p>
          <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.textMuted, cursor: "pointer", marginBottom: "2px" }} onClick={() => navigate("/profil")}>Mon profil</div>
          <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.pink, cursor: "pointer", fontWeight: "500" }} onClick={handleLogout}>Déconnexion</div>
        </div>
      </div>
      <div style={{ margin: "0 16px" }}>
        <div style={{ background: C.greenLight, borderRadius: "14px", padding: "12px", display: "flex", alignItems: "center", gap: "10px", border: `1px solid ${C.greenMid}` }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: "700", color: "#fff", flexShrink: 0, boxShadow: `0 2px 6px ${C.greenMid}` }}>
            {user.name?.charAt(0)?.toUpperCase() || "A"}
          </div>
          <div>
            <p style={{ fontSize: "13px", fontWeight: "600", color: C.text, margin: 0 }}>{user.name || "Admin"}</p>
            <p style={{ fontSize: "11px", color: C.textMuted, margin: 0 }}>{user.isAdmin ? "Administrateur" : "Membre"}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}