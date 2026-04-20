import React, { useState, useEffect } from "react";
import { analyzeWithAI, createSubProject, fetchMembers, fetchProjectMembers } from "../services/api";
import "./NewProjectPage.css"; // réutilise le même CSS

const emptyTask = () => ({
  id: Date.now() + Math.random(),
  title: "",
  description: "",
  estimatedHours: "",
  startDate: "",
  dueDate: "",
});

/**
 * NewSubProjectPage
 *
 * Formulaire de création d'un sous-projet — même logique que NewProjectPage.
 * Différences :
 *   - Le chef par défaut = l'utilisateur connecté (manager du projet parent)
 *   - La liste des membres disponibles = membres du projet parent
 *   - Appelle createSubProject(parentId, payload) au lieu de createProject
 *
 * Props :
 *   - parentProject : le projet parent { id, name }
 *   - user          : l'utilisateur connecté { id, name, email, isAdmin }
 *   - onBack        : fonction pour revenir en arrière
 *   - onCreated     : fonction appelée après création réussie
 */
export default function NewSubProjectPage({ parentProject, user, onBack, onCreated }) {
  const [step, setStep] = useState(1);

  // Étape 1 — infos projet
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [workload,    setWorkload]     = useState("");
  const [managerId,   setManagerId]   = useState(String(user?.id || ""));
  const [useAI,       setUseAI]       = useState(false);

  // Membres disponibles = membres du projet parent
  const [members, setMembers] = useState([]);

  // Erreurs temps réel étape 1
  const [errors, setErrors] = useState({});

  // Étape 2 — tâches
  const [tasks,         setTasks]         = useState([]);
  const [taskErrors,    setTaskErrors]    = useState({});
  const [correctedDesc, setCorrectedDesc] = useState("");
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiError,       setAiError]       = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);

  // Étape 3 — création
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState(null);
  const [success,     setSuccess]     = useState(false);

  // Charge les membres du projet parent
  useEffect(() => {
    fetchProjectMembers(parentProject.id)
      .then((projectMembers) => {
        // On a les membres du projet parent avec leurs infos
        // On enrichit avec fetchMembers pour avoir les emails
        fetchMembers()
          .then((allMembers) => {
            const enriched = projectMembers.map((pm) => {
              const full = allMembers.find((m) => String(m.id) === String(pm.op_user_id));
              return {
                id:    pm.op_user_id,
                name:  full?.name  || pm.name  || `Utilisateur #${pm.op_user_id}`,
                email: full?.email || pm.email || "",
                role:  pm.role,
              };
            });
            setMembers(enriched);
          })
          .catch(() => {
            // Fallback : juste les membres du projet
            const fallback = projectMembers.map((pm) => ({
              id:    pm.op_user_id,
              name:  pm.name  || `Utilisateur #${pm.op_user_id}`,
              email: pm.email || "",
              role:  pm.role,
            }));
            setMembers(fallback);
          });
      })
      .catch(() => setMembers([]));
  }, [parentProject.id]);

  // ── Validation temps réel étape 1 ────────────────────────
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
      default:
        break;
    }
    setErrors((prev) => ({ ...prev, [field]: error }));
    return error;
  }

  // ── Validation temps réel tâches ─────────────────────────
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
      default:
        break;
    }
    setTaskErrors((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] || {}), [field]: error },
    }));
    return error;
  }

  // ── Étape 1 → 2 ──────────────────────────────────────────
  async function handleNext() {
    const e1 = validateField("title", title);
    const e2 = validateField("description", description);
    const e3 = validateField("startDate", startDate, { endDate });
    const e4 = validateField("endDate", endDate, { startDate });
    const e5 = validateField("workload", workload);
    if (e1 || e2 || e3 || e4 || e5) return;

    if (useAI) {
      setAiLoading(true);
      setAiError(null);
      try {
        const result = await analyzeWithAI(title, description);
        setCorrectedDesc(result.correctedDescription || description);
        setTasks(
          (result.tasks || []).map((t) => ({
            id:             Date.now() + Math.random(),
            title:          t.title          || "",
            description:    t.description    || "",
            estimatedHours: t.estimatedHours || "",
            startDate:      startDate        || "",
            dueDate:        endDate          || "",
          }))
        );
      } catch (err) {
        setAiError("Erreur IA : " + err.message);
        setAiLoading(false);
        return;
      } finally {
        setAiLoading(false);
      }
    } else {
      setTasks([emptyTask()]);
    }
    setStep(2);
  }

  // ── Gestion tâches ────────────────────────────────────────
  function updateTask(id, field, value) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    const task = tasks.find((t) => t.id === id);
    if (field === "startDate")      validateTaskField(id, field, value, { dueDate: task?.dueDate });
    if (field === "dueDate")        validateTaskField(id, field, value, { startDate: task?.startDate });
    if (field === "estimatedHours") validateTaskField(id, field, value);
    if (field === "title")          validateTaskField(id, field, value);
  }

  function deleteTaskItem(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setTaskErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (editingTaskId === id) setEditingTaskId(null);
  }

  function addTask() {
    const newTask = emptyTask();
    setTasks((prev) => [...prev, newTask]);
    setEditingTaskId(newTask.id);
  }

  // ── Création finale ───────────────────────────────────────
  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const finalDesc       = correctedDesc || description;
      const selectedManager = members.find((m) => String(m.id) === String(managerId));

      await createSubProject(parentProject.id, {
        title,
        description:  finalDesc,
        startDate:    startDate    || null,
        endDate:      endDate      || null,
        workload:     workload ? Number(workload) : null,
        managerId:    managerId    || null,
        managerName:  selectedManager?.name  || null,
        managerEmail: selectedManager?.email || null,
        tasks: tasks.map((t) => ({
          title:          t.title,
          description:    t.description    || "",
          estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null,
          startDate:      t.startDate      || null,
          dueDate:        t.dueDate        || null,
        })),
      });

      setSuccess(true);
    } catch (err) {
      setCreateError("Erreur : " + err.message);
    } finally {
      setCreating(false);
    }
  }

  const selectedManager = members.find((m) => String(m.id) === String(managerId));

  // ── Succès ────────────────────────────────────────────────
  if (success) {
    return (
      <div className="new-project-page">
        <div className="np-success">
          <div className="np-success-icon">🎉</div>
          <h2>Sous-projet créé avec succès !</h2>
          <p>
            Le sous-projet <strong>"{title}"</strong> a été créé sous{" "}
            <strong>"{parentProject.name}"</strong>.
          </p>
          <button className="np-success-btn" onClick={onCreated || onBack}>
            Retour aux projets →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="new-project-page">

      {/* Header */}
      <div className="np-header">
        <button
          className="np-back-btn"
          onClick={step === 1 ? onBack : step === 2 ? () => setStep(1) : () => setStep(2)}
        >
          ← {step === 1 ? "Retour" : "Étape précédente"}
        </button>
        <div className="np-header-text">
          <p className="np-eyebrow">
            Sous-projet de <strong>{parentProject.name}</strong> — Étape {step}/3
          </p>
          <h1 className="np-title">
            {step === 1 && <>Nouveau <span>Sous-projet</span></>}
            {step === 2 && <>Les <span>Tâches</span></>}
            {step === 3 && <>Récapitulatif &amp; <span>Validation</span></>}
          </h1>
        </div>
      </div>

      {/* Stepper */}
      <div className="np-stepper">
        <div className={`np-step ${step >= 1 ? "active" : ""}`}>
          <div className="np-step-dot">{step > 1 ? "✓" : "1"}</div>
          <span>Informations</span>
        </div>
        <div className="np-step-line" />
        <div className={`np-step ${step >= 2 ? "active" : ""}`}>
          <div className="np-step-dot">{step > 2 ? "✓" : "2"}</div>
          <span>Tâches</span>
        </div>
        <div className="np-step-line" />
        <div className={`np-step ${step >= 3 ? "active" : ""}`}>
          <div className="np-step-dot">3</div>
          <span>Validation</span>
        </div>
      </div>

      {/* ═══ ÉTAPE 1 ═══ */}
      {step === 1 && (
        <div className="np-section">
          <h2 className="np-section-title"><span>📋</span> Informations du sous-projet</h2>

          <div className="np-form-grid full">
            <div className="np-field">
              <label>Titre du sous-projet *</label>
              <input
                type="text"
                placeholder="Ex: Module paiement"
                value={title}
                onChange={(e) => { setTitle(e.target.value); validateField("title", e.target.value); }}
                className={errors.title ? "np-input-error" : ""}
              />
              {errors.title && <span className="np-field-error">⚠ {errors.title}</span>}
            </div>
          </div>

          <div className="np-form-grid full" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Description *</label>
              <textarea
                placeholder="Décrivez ce sous-projet..."
                value={description}
                onChange={(e) => { setDescription(e.target.value); validateField("description", e.target.value); }}
                className={errors.description ? "np-input-error" : ""}
              />
              {errors.description && <span className="np-field-error">⚠ {errors.description}</span>}
            </div>
          </div>

          {/* Chef du sous-projet — membres du projet parent uniquement */}
          <div className="np-form-grid full" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Responsable du sous-projet</label>
              <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">— Sélectionner un membre —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {String(m.id) === String(user?.id) ? "(vous)" : ""}
                    {m.role === "manager" ? " — Chef" : ""}
                  </option>
                ))}
              </select>
              <span className="np-field-hint">
                Seuls les membres du projet parent peuvent être responsables.
              </span>
            </div>
          </div>

          <div className="np-form-grid" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Date de début</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  validateField("startDate", e.target.value, { endDate });
                  validateField("endDate", endDate, { startDate: e.target.value });
                }}
                className={errors.startDate ? "np-input-error" : ""}
              />
              {errors.startDate && <span className="np-field-error">⚠ {errors.startDate}</span>}
            </div>
            <div className="np-field">
              <label>Date de fin cible</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  validateField("endDate", e.target.value, { startDate });
                  validateField("startDate", startDate, { endDate: e.target.value });
                }}
                className={errors.endDate ? "np-input-error" : ""}
              />
              {errors.endDate && <span className="np-field-error">⚠ {errors.endDate}</span>}
            </div>
          </div>

          <div className="np-form-grid full" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Workload global estimé (heures)</label>
              <input
                type="number"
                placeholder="Ex: 40"
                value={workload}
                onChange={(e) => { setWorkload(e.target.value); validateField("workload", e.target.value); }}
                className={errors.workload ? "np-input-error" : ""}
              />
              {errors.workload && <span className="np-field-error">⚠ {errors.workload}</span>}
            </div>
          </div>

          <div className="np-ai-checkbox" onClick={() => setUseAI(!useAI)}>
            <div className={`np-checkbox ${useAI ? "checked" : ""}`}>
              {useAI && <span>✓</span>}
            </div>
            <div className="np-checkbox-text">
              <span className="np-checkbox-label">✨ Analyser avec l'IA Gemini</span>
              <span className="np-checkbox-desc">
                L'IA corrigera la description et proposera des tâches automatiquement
              </span>
            </div>
          </div>

          {aiError && (
            <p style={{ color: "var(--coral)", fontSize: 13, marginTop: 10 }}>⚠️ {aiError}</p>
          )}

          <button
            className="np-submit-btn"
            onClick={handleNext}
            disabled={aiLoading}
            style={{ marginTop: 20 }}
          >
            {aiLoading
              ? <><span className="np-spinner" /> Analyse IA en cours...</>
              : "Suivant →"}
          </button>
        </div>
      )}

      {/* ═══ ÉTAPE 2 ═══ */}
      {step === 2 && (
        <div className="np-section np-ai-result">
          <h2 className="np-section-title">
            <span>{useAI ? "🤖" : "✏️"}</span>
            {useAI ? "Tâches proposées par l'IA" : "Tâches du sous-projet"}
          </h2>

          {correctedDesc && (
            <div className="np-corrected">
              <strong>Description corrigée par l'IA</strong>
              {correctedDesc}
            </div>
          )}

          <div className="np-tasks-list">
            {tasks.map((task, i) => (
              <div key={task.id} className="np-task-item" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="np-task-top">
                  <input
                    type="text"
                    value={task.title}
                    placeholder="Titre de la tâche"
                    onChange={(e) => updateTask(task.id, "title", e.target.value)}
                    className={taskErrors[task.id]?.title ? "np-input-error" : ""}
                  />
                  <button
                    className="np-task-edit-btn"
                    onClick={() => setEditingTaskId(editingTaskId === task.id ? null : task.id)}
                  >
                    {editingTaskId === task.id ? "▲" : "✏️"}
                  </button>
                  <button className="np-task-delete" onClick={() => deleteTaskItem(task.id)}>✕</button>
                </div>
                {taskErrors[task.id]?.title && (
                  <span className="np-field-error">⚠ {taskErrors[task.id].title}</span>
                )}

                {editingTaskId === task.id && (
                  <div className="np-task-details">
                    <div className="np-field" style={{ marginBottom: 10 }}>
                      <label>Description</label>
                      <textarea
                        value={task.description}
                        placeholder="Description de la tâche..."
                        onChange={(e) => updateTask(task.id, "description", e.target.value)}
                        style={{ minHeight: 70 }}
                      />
                    </div>
                    <div className="np-task-meta">
                      <div>
                        <input
                          type="number"
                          value={task.estimatedHours}
                          placeholder="Heures estimées"
                          onChange={(e) => updateTask(task.id, "estimatedHours", e.target.value)}
                          className={taskErrors[task.id]?.estimatedHours ? "np-input-error" : ""}
                        />
                        {taskErrors[task.id]?.estimatedHours && (
                          <span className="np-field-error">⚠ {taskErrors[task.id].estimatedHours}</span>
                        )}
                      </div>
                      <div>
                        <input
                          type="date"
                          value={task.startDate}
                          onChange={(e) => updateTask(task.id, "startDate", e.target.value)}
                          className={taskErrors[task.id]?.startDate ? "np-input-error" : ""}
                        />
                        {taskErrors[task.id]?.startDate && (
                          <span className="np-field-error">⚠ {taskErrors[task.id].startDate}</span>
                        )}
                      </div>
                      <div>
                        <input
                          type="date"
                          value={task.dueDate}
                          onChange={(e) => updateTask(task.id, "dueDate", e.target.value)}
                          className={taskErrors[task.id]?.dueDate ? "np-input-error" : ""}
                        />
                        {taskErrors[task.id]?.dueDate && (
                          <span className="np-field-error">⚠ {taskErrors[task.id].dueDate}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button className="np-add-task-btn" onClick={addTask}>+ Ajouter une tâche</button>

          <button className="np-submit-btn" onClick={() => setStep(3)} style={{ marginTop: 20 }}>
            Suivant → Récapitulatif
          </button>
        </div>
      )}

      {/* ═══ ÉTAPE 3 ═══ */}
      {step === 3 && (
        <div className="np-section np-review">
          <h2 className="np-section-title"><span>🔍</span> Récapitulatif du sous-projet</h2>

          <div className="np-review-block">
            <div className="np-review-block-title">📋 Informations générales</div>
            <div className="np-review-grid">
              {[
                ["Projet parent",     parentProject.name],
                ["Titre",             title || "—"],
                ["Responsable",       selectedManager?.name || "Non assigné"],
                ["Date de début",     startDate || "—"],
                ["Date de fin cible", endDate   || "—"],
                ["Workload estimé",   workload ? `${workload} heures` : "—"],
                ["Généré par IA",     useAI ? "✅ Oui" : "Non"],
              ].map(([label, value]) => (
                <div key={label} className="np-review-item">
                  <span className="np-review-label">{label}</span>
                  <span className="np-review-value">{value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <span className="np-review-label">Description</span>
              <div className="np-review-desc">{correctedDesc || description || "—"}</div>
            </div>
          </div>

          <div className="np-review-block" style={{ marginTop: 16 }}>
            <div className="np-review-block-title">📝 Tâches ({tasks.length})</div>
            {tasks.length === 0 ? (
              <p className="np-review-empty">Aucune tâche définie.</p>
            ) : (
              <div className="np-review-tasks">
                {tasks.map((task, i) => (
                  <div key={task.id} className="np-review-task">
                    <div className="np-review-task-header">
                      <span className="np-review-task-num">{i + 1}</span>
                      <span className="np-review-task-title">{task.title || <em>Sans titre</em>}</span>
                      {task.estimatedHours && (
                        <span className="np-review-task-badge">⏱ {task.estimatedHours}h</span>
                      )}
                    </div>
                    {(task.description || task.startDate || task.dueDate) && (
                      <div className="np-review-task-body">
                        {task.description && <p className="np-review-task-desc">{task.description}</p>}
                        <div className="np-review-task-dates">
                          {task.startDate && <span>🗓 Début : {task.startDate}</span>}
                          {task.dueDate   && <span>🏁 Fin : {task.dueDate}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {createError && (
            <p style={{ color: "var(--coral)", fontSize: 13, marginTop: 12 }}>⚠️ {createError}</p>
          )}

          <button
            className="np-submit-btn np-validate-btn"
            onClick={handleCreate}
            disabled={creating}
            style={{ marginTop: 24 }}
          >
            {creating
              ? <><span className="np-spinner" /> Création en cours...</>
              : <>✅ Valider et créer dans OpenProject</>
            }
          </button>
        </div>
      )}
    </div>
  );
}