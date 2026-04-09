import React, { useState, useEffect, useCallback } from "react";
import { fetchTasks, fetchMembers, patchTask, createTask } from "../services/api";
import "./ProjectDetailPage.css";

const STATUS_MAP = {
  on_track:  { label: "En cours",  color: "#6dc87a" },
  off_track: { label: "En retard", color: "#F76C6C" },
  at_risk:   { label: "À risque",  color: "#F8E9A1" },
};

function getProjectStatus(project) {
  const href = project._links?.status?.href || "";
  const key  = href.split("/").pop();
  return STATUS_MAP[key] || { label: "Actif", color: "#F8E9A1" };
}

function getTaskStatus(task) {
  const title = task._links?.status?.title || "";
  const lower = title.toLowerCase();
  if (lower.includes("closed") || lower.includes("terminé") || lower.includes("done"))
    return { label: title || "Terminée", color: "#6dc87a", done: true };
  if (lower.includes("progress") || lower.includes("cours"))
    return { label: title || "En cours", color: "#A8D0E6", done: false };
  return { label: title || "À faire", color: "#F8E9A1", done: false };
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const TASK_STATUSES = [
  { label: "À faire",  href: "/api/v3/statuses/1"  },
  { label: "En cours", href: "/api/v3/statuses/7"  },
  { label: "Terminée", href: "/api/v3/statuses/12" },
  { label: "Rejetée",  href: "/api/v3/statuses/6"  },
];

const emptyNewTask = () => ({
  title: "", description: "", startDate: "", dueDate: "", estimatedHours: "",
});

export default function ProjectDetailPage({ project, onBack }) {
  const [tasks,           setTasks]           = useState([]);
  const [members,         setMembers]         = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [activeTab,       setActiveTab]       = useState("tasks");
  const [taskSearch,      setTaskSearch]      = useState("");
  const [editingTask,     setEditingTask]     = useState(null);
  const [editValues,      setEditValues]      = useState({});
  const [saving,          setSaving]          = useState(false);
  const [showNewTask,     setShowNewTask]     = useState(false);
  const [newTask,         setNewTask]         = useState(emptyNewTask());
  const [creatingTask,    setCreatingTask]    = useState(false);
  const [createTaskError, setCreateTaskError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskData, memberData] = await Promise.all([
        fetchTasks(project.id),
        fetchMembers(),
      ]);
      setTasks(taskData || []);
      setMembers(memberData || []);
    } catch (err) {
      setError(err.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Stats
  const totalTasks    = tasks.length;
  const doneTasks     = tasks.filter((t) => getTaskStatus(t).done).length;
  const progress      = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const projectStatus = getProjectStatus(project);
  const daysLeft      = daysUntil(project.endDate);
  const manager       = members.find((m) => String(m.id) === String(project.managerId));

  // Filtrage
  const filteredTasks = tasks.filter((t) =>
    t.subject?.toLowerCase().includes(taskSearch.toLowerCase())
  );

  // Édition inline
  function startEdit(task) {
    setEditingTask(task.id);
    setEditValues({
      dueDate:       task.dueDate || "",
      estimatedTime: task.estimatedTime
        ? task.estimatedTime.replace("PT", "").replace("H", "")
        : "",
      statusHref: task._links?.status?.href || "",
    });
  }

  function cancelEdit() {
    setEditingTask(null);
    setEditValues({});
  }

  async function saveEdit(task) {
    setSaving(true);
    try {
      const body = {
        dueDate:       editValues.dueDate || null,
        estimatedTime: editValues.estimatedTime
          ? `PT${editValues.estimatedTime}H`
          : null,
        _links: {
          status: editValues.statusHref
            ? { href: editValues.statusHref }
            : task._links?.status,
        },
      };
      await patchTask(task.id, task.lockVersion, body);
      await loadData();
      setEditingTask(null);
    } catch (err) {
      alert("Erreur lors de la sauvegarde : " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // Création nouvelle tâche
  async function handleCreateTask() {
    if (!newTask.title.trim()) {
      setCreateTaskError("Le titre est obligatoire.");
      return;
    }
    setCreatingTask(true);
    setCreateTaskError(null);
    try {
      await createTask(project.id, newTask);
      setNewTask(emptyNewTask());
      setShowNewTask(false);
      await loadData();
    } catch (err) {
      setCreateTaskError("Erreur : " + err.message);
    } finally {
      setCreatingTask(false);
    }
  }

  return (
    <div className="pdp-page">

      {/* Header */}
      <div className="pdp-header">
        <button className="pdp-back-btn" onClick={onBack}>← Retour aux projets</button>
        <div className="pdp-hero">
          <div className="pdp-hero-left">
            <p className="pdp-eyebrow">Light Project · {project.identifier}</p>
            <h1 className="pdp-title">{project.name}</h1>
            <div className="pdp-hero-meta">
              <span className="pdp-status-badge"
                style={{ color: projectStatus.color, borderColor: projectStatus.color }}>
                {projectStatus.label}
              </span>
              {manager && <span className="pdp-meta-chip">👤 {manager.name}</span>}
              {project.endDate && (
                <span className="pdp-meta-chip"
                  style={daysLeft !== null && daysLeft < 7
                    ? { color: "#F76C6C", borderColor: "rgba(247,108,108,0.3)" } : {}}>
                  🏁 {formatDate(project.endDate)}
                  {daysLeft !== null && (
                    <em style={{ marginLeft: 6, opacity: 0.6 }}>
                      {daysLeft > 0 ? `J-${daysLeft}` : daysLeft === 0 ? "Aujourd'hui" : "Dépassé"}
                    </em>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Jauge progression */}
          <div className="pdp-progress-ring-wrap">
            <svg className="pdp-ring" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="32" className="pdp-ring-bg" />
              <circle cx="40" cy="40" r="32" className="pdp-ring-fill"
                style={{
                  strokeDasharray: `${2 * Math.PI * 32}`,
                  strokeDashoffset: `${2 * Math.PI * 32 * (1 - progress / 100)}`,
                  stroke: projectStatus.color,
                }}
              />
            </svg>
            <div className="pdp-ring-label">
              <span className="pdp-ring-pct">{progress}%</span>
              <span className="pdp-ring-sub">terminé</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="pdp-kpis">
        <div className="pdp-kpi">
          <span className="pdp-kpi-icon">📋</span>
          <div>
            <div className="pdp-kpi-value">{totalTasks}</div>
            <div className="pdp-kpi-label">Tâches totales</div>
          </div>
        </div>
        <div className="pdp-kpi">
          <span className="pdp-kpi-icon">✅</span>
          <div>
            <div className="pdp-kpi-value" style={{ color: "#6dc87a" }}>{doneTasks}</div>
            <div className="pdp-kpi-label">Terminées</div>
          </div>
        </div>
        <div className="pdp-kpi">
          <span className="pdp-kpi-icon">⏳</span>
          <div>
            <div className="pdp-kpi-value" style={{ color: "#A8D0E6" }}>{totalTasks - doneTasks}</div>
            <div className="pdp-kpi-label">Restantes</div>
          </div>
        </div>
        <div className="pdp-kpi">
          <span className="pdp-kpi-icon">⏱</span>
          <div>
            <div className="pdp-kpi-value">{project.workload ? `${project.workload}h` : "—"}</div>
            <div className="pdp-kpi-label">Workload estimé</div>
          </div>
        </div>
      </div>

      {/* Onglets */}
      <div className="pdp-tabs">
        <button className={`pdp-tab ${activeTab === "tasks" ? "active" : ""}`}
          onClick={() => setActiveTab("tasks")}>
          📝 Tâches {totalTasks > 0 && <span className="pdp-tab-count">{totalTasks}</span>}
        </button>
        <button className={`pdp-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}>
          📊 Vue d'ensemble
        </button>
      </div>

      {loading && (
        <div className="pdp-state">
          <div className="pdp-spinner" />
          <p>Chargement...</p>
        </div>
      )}

      {error && !loading && (
        <div className="pdp-state error">
          <p>⚠️ {error}</p>
          <button className="pdp-retry-btn" onClick={loadData}>Réessayer</button>
        </div>
      )}

      {/* ═══ ONGLET TÂCHES ═══ */}
      {!loading && !error && activeTab === "tasks" && (
        <div className="pdp-tasks-section">

          {/* Bouton + formulaire nouvelle tâche */}
          <div className="pdp-new-task-bar">
            {!showNewTask ? (
              <button className="pdp-new-task-btn" onClick={() => setShowNewTask(true)}>
                + Nouvelle tâche
              </button>
            ) : (
              <div className="pdp-new-task-form">
                <h3 className="pdp-new-task-title">✨ Nouvelle tâche</h3>

                <div className="pdp-ntf-grid">
                  <div className="pdp-ntf-field full">
                    <label>Titre *</label>
                    <input
                      type="text"
                      placeholder="Titre de la tâche"
                      value={newTask.title}
                      onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    />
                  </div>

                  <div className="pdp-ntf-field full">
                    <label>Description</label>
                    <textarea
                      placeholder="Description de la tâche..."
                      value={newTask.description}
                      onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    />
                  </div>

                  <div className="pdp-ntf-field">
                    <label>Date de début</label>
                    <input
                      type="date"
                      value={newTask.startDate}
                      onChange={(e) => setNewTask({ ...newTask, startDate: e.target.value })}
                    />
                  </div>

                  <div className="pdp-ntf-field">
                    <label>Date de fin</label>
                    <input
                      type="date"
                      value={newTask.dueDate}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                    />
                  </div>

                  <div className="pdp-ntf-field">
                    <label>Workload estimé (heures)</label>
                    <input
                      type="number"
                      placeholder="Ex: 8"
                      value={newTask.estimatedHours}
                      onChange={(e) => setNewTask({ ...newTask, estimatedHours: e.target.value })}
                    />
                  </div>
                </div>

                {createTaskError && (
                  <p style={{ color: "var(--coral)", fontSize: 13, marginTop: 8 }}>
                    ⚠️ {createTaskError}
                  </p>
                )}

                <div className="pdp-ntf-actions">
                  <button className="pdp-ntf-cancel" onClick={() => {
                    setShowNewTask(false);
                    setCreateTaskError(null);
                    setNewTask(emptyNewTask());
                  }}>
                    Annuler
                  </button>
                  <button
                    className="pdp-ntf-submit"
                    onClick={handleCreateTask}
                    disabled={creatingTask}
                  >
                    {creatingTask ? "Création..." : "✅ Créer la tâche"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Recherche */}
          <div className="pdp-search">
            <span>🔍</span>
            <input
              type="text"
              placeholder="Rechercher une tâche..."
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
            />
          </div>

          {/* Tableau tâches */}
          {filteredTasks.length === 0 ? (
            <div className="pdp-empty">
              <p>Aucune tâche trouvée.</p>
            </div>
          ) : (
            <div className="pdp-table-wrap">
              <table className="pdp-table">
                <thead>
                  <tr>
                    <th>Titre</th>
                    <th>Responsable</th>
                    <th>Statut</th>
                    <th>Date de fin</th>
                    <th>Workload</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task, i) => {
                    const status    = getTaskStatus(task);
                    const assignee  = members.find(
                      (m) => String(m.id) === String(
                        task._links?.assignee?.href?.split("/").pop()
                      )
                    );
                    const isEditing = editingTask === task.id;
                    const isLate    = task.dueDate &&
                      new Date(task.dueDate) < new Date() && !status.done;

                    return (
                      <tr key={task.id} className="pdp-tr"
                        style={{ animationDelay: `${i * 40}ms` }}>

                        {/* Titre */}
                        <td className="pdp-td-title">
                          <div className="pdp-task-dot-inline"
                            style={{ background: status.color }} />
                          {task.subject || "Sans titre"}
                        </td>

                        {/* Responsable */}
                        <td className="pdp-td-assignee">
                          {assignee
                            ? <span className="pdp-assignee-chip">👤 {assignee.name}</span>
                            : "—"}
                        </td>

                        {/* Statut — éditable */}
                        <td>
                          {isEditing ? (
                            <select className="pdp-edit-select"
                              value={editValues.statusHref}
                              onChange={(e) => setEditValues({
                                ...editValues, statusHref: e.target.value
                              })}>
                              {TASK_STATUSES.map((s) => (
                                <option key={s.href} value={s.href}>{s.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="pdp-status-chip"
                              style={{ color: status.color, borderColor: `${status.color}44` }}>
                              {status.label}
                            </span>
                          )}
                        </td>

                        {/* Due date — éditable */}
                        <td>
                          {isEditing ? (
                            <input type="date" className="pdp-edit-input"
                              value={editValues.dueDate}
                              onChange={(e) => setEditValues({
                                ...editValues, dueDate: e.target.value
                              })}
                            />
                          ) : (
                            <span style={isLate ? { color: "#F76C6C", fontWeight: 500 } : {}}>
                              {isLate && "⚠️ "}{formatDate(task.dueDate)}
                            </span>
                          )}
                        </td>

                        {/* Workload — éditable */}
                        <td>
                          {isEditing ? (
                            <input type="number" className="pdp-edit-input"
                              placeholder="Heures"
                              value={editValues.estimatedTime}
                              onChange={(e) => setEditValues({
                                ...editValues, estimatedTime: e.target.value
                              })}
                              style={{ width: 80 }}
                            />
                          ) : (
                            <span>
                              {task.estimatedTime
                                ? task.estimatedTime.replace("PT", "").replace("H", "h")
                                : "—"}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="pdp-td-actions">
                          {isEditing ? (
                            <>
                              <button className="pdp-save-btn"
                                onClick={() => saveEdit(task)} disabled={saving}>
                                {saving ? "..." : "✅"}
                              </button>
                              <button className="pdp-cancel-btn" onClick={cancelEdit}>✕</button>
                            </>
                          ) : (
                            <button className="pdp-edit-btn" onClick={() => startEdit(task)}>
                              ✏️
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ ONGLET VUE D'ENSEMBLE ═══ */}
      {!loading && !error && activeTab === "overview" && (
        <div className="pdp-overview">
          <div className="pdp-overview-block">
            <div className="pdp-overview-block-title">📋 Description du projet</div>
            <p className="pdp-overview-text">
              {project.description?.raw || "Aucune description disponible."}
            </p>
          </div>

          <div className="pdp-overview-block">
            <div className="pdp-overview-block-title">📊 Progression détaillée</div>
            <div className="pdp-progress-bar-big-wrap">
              <div className="pdp-progress-bar-big">
                <div className="pdp-progress-fill-big"
                  style={{ width: `${progress}%`, background: projectStatus.color }} />
              </div>
              <div className="pdp-progress-stats">
                <span style={{ color: "#6dc87a" }}>✅ {doneTasks} terminées</span>
                <span style={{ color: "#A8D0E6" }}>⏳ {totalTasks - doneTasks} restantes</span>
                <span style={{ color: projectStatus.color }}>{progress}% complété</span>
              </div>
            </div>

            {totalTasks > 0 && (
              <div className="pdp-distribution">
                {Object.entries(
                  tasks.reduce((acc, t) => {
                    const s = getTaskStatus(t).label;
                    acc[s] = (acc[s] || 0) + 1;
                    return acc;
                  }, {})
                ).map(([label, count]) => {
                  const color = getTaskStatus(
                    tasks.find((t) => getTaskStatus(t).label === label)
                  ).color;
                  return (
                    <div key={label} className="pdp-dist-item">
                      <div className="pdp-dist-label">{label}</div>
                      <div className="pdp-dist-bar-wrap">
                        <div className="pdp-dist-bar"
                          style={{ width: `${(count / totalTasks) * 100}%`, background: color }} />
                      </div>
                      <span className="pdp-dist-count">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pdp-overview-block">
            <div className="pdp-overview-block-title">ℹ️ Informations</div>
            <div className="pdp-info-grid">
              <div className="pdp-info-item">
                <span className="pdp-info-label">Identifiant</span>
                <span className="pdp-info-value">{project.identifier || "—"}</span>
              </div>
              <div className="pdp-info-item">
                <span className="pdp-info-label">Chef de projet</span>
                <span className="pdp-info-value">{manager?.name || "—"}</span>
              </div>
              <div className="pdp-info-item">
                <span className="pdp-info-label">Date de création</span>
                <span className="pdp-info-value">{formatDate(project.createdAt)}</span>
              </div>
              <div className="pdp-info-item">
                <span className="pdp-info-label">Date de fin cible</span>
                <span className="pdp-info-value">{formatDate(project.endDate)}</span>
              </div>
              <div className="pdp-info-item">
                <span className="pdp-info-label">Workload estimé</span>
                <span className="pdp-info-value">{project.workload ? `${project.workload}h` : "—"}</span>
              </div>
              <div className="pdp-info-item">
                <span className="pdp-info-label">Statut</span>
                <span className="pdp-info-value" style={{ color: projectStatus.color }}>
                  {projectStatus.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}