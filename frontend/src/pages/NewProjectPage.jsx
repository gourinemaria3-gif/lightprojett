import React, { useState, useEffect } from "react";
import { analyzeWithAI, createProject, fetchMembers } from "../services/api";
import "./NewProjectPage.css";

const emptyTask = () => ({
  id: Date.now() + Math.random(),
  title: "",
  description: "",
  estimatedHours: "",
  startDate: "",
  dueDate: "",
});

export default function NewProjectPage({ onBack }) {
  const [step, setStep] = useState(1);

  // Étape 1 — infos projet
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate]     = useState("");
  const [endDate, setEndDate]         = useState("");
  const [workload, setWorkload]       = useState("");
  const [managerId, setManagerId]     = useState("");
  const [useAI, setUseAI]             = useState(false);
  const [members, setMembers]         = useState([]);

  // Étape 2 — tâches
  const [tasks, setTasks]                 = useState([]);
  const [correctedDesc, setCorrectedDesc] = useState("");
  const [aiLoading, setAiLoading]         = useState(false);
  const [aiError, setAiError]             = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);

  // Étape 3 — création
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState(null);
  const [success, setSuccess]         = useState(false);

  useEffect(() => {
    fetchMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, []);

  // ── Étape 1 → 2 ──────────────────────────────────────────
  async function handleNext() {
    if (!title.trim() || !description.trim()) {
      alert("Veuillez remplir le titre et la description.");
      return;
    }

    if (useAI) {
      setAiLoading(true);
      setAiError(null);
      try {
        const result = await analyzeWithAI(title, description);
        setCorrectedDesc(result.correctedDescription || description);
        setTasks(
          (result.tasks || []).map((t) => ({
            id: Date.now() + Math.random(),
            title:          t.title || "",
            description:    t.description || "",
            estimatedHours: t.estimatedHours || "",
            startDate:      startDate || "",
            dueDate:        endDate   || "",
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
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  }

  function deleteTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (editingTaskId === id) setEditingTaskId(null);
  }

  function addTask() {
    const newTask = emptyTask();
    setTasks((prev) => [...prev, newTask]);
    setEditingTaskId(newTask.id);
  }

  // ── Étape 2 → 3 ──────────────────────────────────────────
  function handleGoToReview() {
    setStep(3);
  }

  // ── Création finale ───────────────────────────────────────
  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const finalDesc = correctedDesc || description;
      await createProject(title, finalDesc, tasks, managerId, endDate, workload);
      setSuccess(true);
    } catch (err) {
      setCreateError("Erreur : " + err.message);
    } finally {
      setCreating(false);
    }
  }

  // Nom du manager sélectionné
  const selectedManager = members.find((m) => String(m.id) === String(managerId));

  // ── Succès ────────────────────────────────────────────────
  if (success) {
    return (
      <div className="new-project-page">
        <div className="np-success">
          <div className="np-success-icon">🎉</div>
          <h2>Projet créé avec succès !</h2>
          <p>
            Le projet <strong>"{title}"</strong> et ses {tasks.length} tâche{tasks.length > 1 ? "s" : ""}{" "}
            ont été créés dans OpenProject.
          </p>
          <button className="np-success-btn" onClick={onBack}>
            Retour à l'accueil →
          </button>
        </div>
      </div>
    );
  }

  // ── Rendu ─────────────────────────────────────────────────
  return (
    <div className="new-project-page">

      {/* Header */}
      <div className="np-header">
        <button
          className="np-back-btn"
          onClick={
            step === 1 ? onBack :
            step === 2 ? () => setStep(1) :
            () => setStep(2)
          }
        >
          ← {step === 1 ? "Retour" : "Étape précédente"}
        </button>
        <div className="np-header-text">
          <p className="np-eyebrow">Light Project — Étape {step}/3</p>
          <h1 className="np-title">
            {step === 1 && <>Nouveau <span>Projet</span></>}
            {step === 2 && <>Les <span>Tâches</span></>}
            {step === 3 && <>Récapitulatif &amp; <span>Validation</span></>}
          </h1>
        </div>
      </div>

      {/* Stepper visuel */}
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
          <h2 className="np-section-title"><span>📋</span> Informations du projet</h2>

          <div className="np-form-grid full">
            <div className="np-field">
              <label>Titre du projet *</label>
              <input
                type="text"
                placeholder="Ex: Refonte du site web"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          <div className="np-form-grid full" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Description du projet *</label>
              <textarea
                placeholder="Décrivez votre projet en quelques phrases..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="np-form-grid full" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Chef de projet</label>
              <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">— Sélectionner un membre —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="np-form-grid" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Date de début</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="np-field">
              <label>Date de fin cible</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="np-form-grid full" style={{ marginTop: 14 }}>
            <div className="np-field">
              <label>Workload global estimé (heures)</label>
              <input
                type="number"
                placeholder="Ex: 120"
                value={workload}
                onChange={(e) => setWorkload(e.target.value)}
              />
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
            <p style={{ color: "var(--coral)", fontSize: 13, marginTop: 10 }}>
              ⚠️ {aiError}
            </p>
          )}

          <button
            className="np-submit-btn"
            onClick={handleNext}
            disabled={aiLoading}
            style={{ marginTop: 20 }}
          >
            {aiLoading ? (
              <><span className="np-spinner" /> Analyse IA en cours...</>
            ) : (
              "Suivant →"
            )}
          </button>
        </div>
      )}

      {/* ═══ ÉTAPE 2 ═══ */}
      {step === 2 && (
        <div className="np-section np-ai-result">
          <h2 className="np-section-title">
            <span>{useAI ? "🤖" : "✏️"}</span>
            {useAI ? "Tâches proposées par l'IA" : "Tâches du projet"}
          </h2>

          {correctedDesc && (
            <div className="np-corrected">
              <strong>Description corrigée par l'IA</strong>
              {correctedDesc}
            </div>
          )}

          <div className="np-tasks-list">
            {tasks.map((task, i) => (
              <div
                key={task.id}
                className="np-task-item"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="np-task-top">
                  <input
                    type="text"
                    value={task.title}
                    placeholder="Titre de la tâche"
                    onChange={(e) => updateTask(task.id, "title", e.target.value)}
                  />
                  <button
                    className="np-task-edit-btn"
                    onClick={() => setEditingTaskId(editingTaskId === task.id ? null : task.id)}
                    title="Modifier"
                  >
                    {editingTaskId === task.id ? "▲" : "✏️"}
                  </button>
                  <button
                    className="np-task-delete"
                    onClick={() => deleteTask(task.id)}
                    title="Supprimer"
                  >✕</button>
                </div>

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
                      <input
                        type="number"
                        value={task.estimatedHours}
                        placeholder="Heures estimées"
                        onChange={(e) => updateTask(task.id, "estimatedHours", e.target.value)}
                      />
                      <input
                        type="date"
                        value={task.startDate}
                        onChange={(e) => updateTask(task.id, "startDate", e.target.value)}
                        title="Date de début"
                      />
                      <input
                        type="date"
                        value={task.dueDate}
                        onChange={(e) => updateTask(task.id, "dueDate", e.target.value)}
                        title="Date de fin"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button className="np-add-task-btn" onClick={addTask}>
            + Ajouter une tâche
          </button>

          <button
            className="np-submit-btn"
            onClick={handleGoToReview}
            style={{ marginTop: 20 }}
          >
            Suivant → Récapitulatif
          </button>
        </div>
      )}

      {/* ═══ ÉTAPE 3 — RÉCAPITULATIF ═══ */}
      {step === 3 && (
        <div className="np-section np-review">
          <h2 className="np-section-title"><span>🔍</span> Récapitulatif du projet</h2>

          {/* Bloc infos projet */}
          <div className="np-review-block">
            <div className="np-review-block-title">📋 Informations générales</div>
            <div className="np-review-grid">
              <div className="np-review-item">
                <span className="np-review-label">Titre</span>
                <span className="np-review-value">{title || <em>Non renseigné</em>}</span>
              </div>
              <div className="np-review-item">
                <span className="np-review-label">Chef de projet</span>
                <span className="np-review-value">
                  {selectedManager ? selectedManager.name : <em>Non assigné</em>}
                </span>
              </div>
              <div className="np-review-item">
                <span className="np-review-label">Date de début</span>
                <span className="np-review-value">{startDate || <em>—</em>}</span>
              </div>
              <div className="np-review-item">
                <span className="np-review-label">Date de fin cible</span>
                <span className="np-review-value">{endDate || <em>—</em>}</span>
              </div>
              <div className="np-review-item">
                <span className="np-review-label">Workload estimé</span>
                <span className="np-review-value">
                  {workload ? `${workload} heures` : <em>—</em>}
                </span>
              </div>
              <div className="np-review-item">
                <span className="np-review-label">Généré par IA</span>
                <span className="np-review-value">{useAI ? "✅ Oui" : "Non"}</span>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <span className="np-review-label">Description</span>
              <div className="np-review-desc">
                {correctedDesc || description || <em>Non renseignée</em>}
              </div>
            </div>
          </div>

          {/* Bloc tâches */}
          <div className="np-review-block" style={{ marginTop: 16 }}>
            <div className="np-review-block-title">
              📝 Tâches ({tasks.length})
            </div>

            {tasks.length === 0 ? (
              <p className="np-review-empty">Aucune tâche définie.</p>
            ) : (
              <div className="np-review-tasks">
                {tasks.map((task, i) => (
                  <div key={task.id} className="np-review-task">
                    <div className="np-review-task-header">
                      <span className="np-review-task-num">{i + 1}</span>
                      <span className="np-review-task-title">
                        {task.title || <em>Sans titre</em>}
                      </span>
                      {task.estimatedHours && (
                        <span className="np-review-task-badge">
                          ⏱ {task.estimatedHours}h
                        </span>
                      )}
                    </div>
                    {(task.description || task.startDate || task.dueDate) && (
                      <div className="np-review-task-body">
                        {task.description && (
                          <p className="np-review-task-desc">{task.description}</p>
                        )}
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
            <p style={{ color: "var(--coral)", fontSize: 13, marginTop: 12 }}>
              ⚠️ {createError}
            </p>
          )}

          {/* Bouton validation finale */}
          <button
            className="np-submit-btn np-validate-btn"
            onClick={handleCreate}
            disabled={creating}
            style={{ marginTop: 24 }}
          >
            {creating ? (
              <><span className="np-spinner" /> Création en cours...</>
            ) : (
              <>✅ Valider et créer dans OpenProject</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}