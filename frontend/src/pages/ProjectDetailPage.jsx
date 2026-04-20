import React, { useState, useEffect, useCallback } from "react";
import {
  fetchTasks, fetchMembers, fetchProjectMembers,
  patchTask, createTask, addTimeLog, fetchTimeLogs,
  deleteTimeLog, addProjectMember, removeProjectMember,
  fetchDependencies, addDependency, removeDependency,
} from "../services/api";
import "./ProjectDetailPage.css";
import CustomSelect from "./CustomSelect";


// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function getTaskStatus(task) {
  const title = task._links?.status?.title || "";
  const lower = title.toLowerCase();
  if (lower.includes("closed") || lower.includes("terminé") || lower.includes("done"))
    return { label: title || "Terminée", color: "#6dc87a", done: true };
  if (lower.includes("progress") || lower.includes("cours"))
    return { label: title || "En cours", color: "#A8D0E6", done: false };
  return { label: title || "À faire", color: "#F8E9A1", done: false };
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date()) / 86400000);
}

const emptyTask       = () => ({ title: "", description: "", startDate: "", dueDate: "", estimatedHours: "" });
const emptySubProject = () => ({ title: "", description: "" });

// ═══════════════════════════════════════════════════════════════
//  PANNEAU DÉPENDANCES (dans la ligne expandée d'une tâche)
// ═══════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
//  REMPLACE uniquement le composant DependenciesPanel
//  dans ton ProjectDetailPage.jsx
//
//  Colle ce composant AVANT le composant MembersSection,
//  et assure-toi d'importer CustomSelect en haut du fichier :
//
//    import CustomSelect from "./CustomSelect";
//
//  (ou mets le code de CustomSelect directement dans le même fichier)
// ─────────────────────────────────────────────────────────────

function DependenciesPanel({ task, projectId, allTasks, isManager }) {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [addingId, setAddingId] = useState("");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDependencies(task.id, projectId);
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [task.id, projectId]);

  useEffect(() => { load(); }, [load]);

  // Options pour le CustomSelect — exclut la tâche elle-même + déjà liées
  const alreadyLinked = new Set([
    task.id,
    ...(data?.dependsOn   || []).map((d) => d.taskId),
    ...(data?.blockingFor || []).map((d) => d.taskId),
  ]);

  const selectOptions = allTasks
    .filter((t) => !alreadyLinked.has(t.id))
    .map((t) => ({
      value: String(t.id),
      label: `#${t.id} — ${t.subject}`,
    }));

  async function handleAdd() {
    if (!addingId) return;
    setSaving(true);
    setError(null);
    try {
      await addDependency(task.id, Number(addingId), projectId);
      setAddingId("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(dependsOnTaskId) {
    setSaving(true);
    try {
      await removeDependency(task.id, dependsOnTaskId, projectId);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="pdp-deps-loading">Chargement des dépendances…</div>;

  return (
    <div className="pdp-deps-panel">

      {/* Bannière bloquée */}
      {data?.isBlocked && (
        <div className="pdp-deps-blocked-banner">
          🔒 Cette tâche est <strong>bloquée</strong> — une ou plusieurs dépendances ne sont pas terminées.
        </div>
      )}

      {/* Cette tâche dépend de */}
      <div className="pdp-deps-col">
        <div className="pdp-deps-col-title">Cette tâche dépend de</div>
        {(data?.dependsOn || []).length === 0 ? (
          <span className="pdp-deps-empty">Aucune dépendance entrante.</span>
        ) : (
          <div className="pdp-deps-list">
            {data.dependsOn.map((dep) => (
              <div key={dep.taskId} className={`pdp-dep-chip ${dep.isDone ? "done" : "pending"}`}>
                <span className="pdp-dep-dot">{dep.isDone ? "✓" : "⏳"}</span>
                <span className="pdp-dep-name">#{dep.taskId} — {dep.title}</span>
                <span className="pdp-dep-status">{dep.status}</span>
                {isManager && (
                  <button
                    className="pdp-dep-remove"
                    onClick={() => handleRemove(dep.taskId)}
                    disabled={saving}
                    title="Retirer cette dépendance"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cette tâche bloque */}
      <div className="pdp-deps-col">
        <div className="pdp-deps-col-title">Cette tâche bloque</div>
        {(data?.blockingFor || []).length === 0 ? (
          <span className="pdp-deps-empty">Ne bloque aucune tâche.</span>
        ) : (
          <div className="pdp-deps-list">
            {data.blockingFor.map((dep) => (
              <div key={dep.taskId} className={`pdp-dep-chip blocking ${dep.isBlocked ? "active-block" : ""}`}>
                <span className="pdp-dep-dot">{dep.isBlocked ? "🔒" : "✓"}</span>
                <span className="pdp-dep-name">#{dep.taskId} — {dep.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ajouter une dépendance — manager seulement */}
      {isManager && (
        <div className="pdp-deps-add">
          <div className="pdp-deps-col-title">Ajouter une dépendance</div>
          <div className="pdp-deps-add-row">
            {/* ✅ CustomSelect remplace le <select> natif */}
            <CustomSelect
              value={addingId}
              onChange={setAddingId}
              options={selectOptions}
              placeholder="— Sélectionner une tâche dont cette tâche dépend —"
              disabled={saving || selectOptions.length === 0}
            />
            <button
              className="pdp-deps-add-btn"
              onClick={handleAdd}
              disabled={saving || !addingId}
            >
              {saving ? "…" : "+ Lier"}
            </button>
          </div>
          {selectOptions.length === 0 && (
            <span className="pdp-deps-empty">Toutes les tâches sont déjà liées.</span>
          )}
        </div>
      )}

      {error && (
        <p className="pdp-form-error" style={{ marginTop: 8 }}>⚠️ {error}</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SECTION MEMBRES
// ═══════════════════════════════════════════════════════════════
function MembersSection({ project, allMembers, projectMembers, onRefresh }) {
  const [adding,         setAdding]         = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [error,          setError]          = useState(null);
  const [loading,        setLoading]        = useState(false);

  const availableToAdd = allMembers.filter(
    (m) => !projectMembers.some((pm) => String(pm.op_user_id) === String(m.id))
  );

  async function handleAdd() {
    if (!selectedUserId) return;
    const userToAdd = allMembers.find((m) => String(m.id) === String(selectedUserId));
    if (!userToAdd) return;
    setLoading(true);
    setError(null);
    try {
      await addProjectMember(project.id, {
        opUserId: userToAdd.id,
        name:     userToAdd.name,
        email:    userToAdd.email,
        role:     "member",
      });
      setSelectedUserId("");
      setAdding(false);
      await onRefresh();
    } catch (err) {
      setError(err.message || "Erreur ajout membre.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(opUserId) {
    if (!window.confirm("Retirer ce membre du projet ?")) return;
    try {
      await removeProjectMember(project.id, opUserId);
      await onRefresh();
    } catch (err) {
      setError(err.message || "Erreur suppression membre.");
    }
  }

  return (
    <div className="pdp-members-section">
      <div className="pdp-members-header">
        <div className="pdp-section-title">👥 Membres du projet ({projectMembers.length})</div>
        {!adding && (
          <button className="pdp-add-member-btn" onClick={() => setAdding(true)}>
            + Ajouter un membre
          </button>
        )}
      </div>

      {error && <p className="pdp-form-error">⚠️ {error}</p>}

      {adding && (
        <div className="pdp-add-member-form">
          <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
            <option value="">— Sélectionner un utilisateur —</option>
            {availableToAdd.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button className="pdp-ntf-submit" onClick={handleAdd} disabled={loading || !selectedUserId}>
            {loading ? "..." : "✅ Ajouter"}
          </button>
          <button className="pdp-ntf-cancel" onClick={() => { setAdding(false); setSelectedUserId(""); }}>
            Annuler
          </button>
        </div>
      )}

      <div className="pdp-members-list">
        {projectMembers.length === 0 ? (
          <p className="pdp-members-empty">Aucun membre dans ce projet.</p>
        ) : (
          projectMembers.map((m) => (
            <div key={m.op_user_id} className="pdp-member-row">
              <div className="pdp-member-avatar">{m.name?.charAt(0).toUpperCase()}</div>
              <div className="pdp-member-info">
                <div className="pdp-member-name">{m.name}</div>
                <div className="pdp-member-email">{m.email}</div>
              </div>
              <span className={`pdp-role-badge ${m.role === "manager" ? "manager" : "member"}`}>
                {m.role === "manager" ? "Chef de projet" : "Membre"}
              </span>
              {m.role !== "manager" && (
                <button className="pdp-remove-member-btn" onClick={() => handleRemove(m.op_user_id)}>✕</button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  VUE MEMBRE
//  - Taux horaire déplacé PAR TÂCHE (dans le formulaire d'ajout d'heures)
//  - Panel dépendances visible en lecture seule
// ═══════════════════════════════════════════════════════════════
function MemberView({ project, user, tasks, projectMembers, onRefresh }) {
  const [expandedTask, setExpandedTask] = useState(null);
  const [expandedTab,  setExpandedTab]  = useState({}); // { [taskId]: "logs" | "deps" }
  const [taskLogs,     setTaskLogs]     = useState({});
  const [logForm,      setLogForm]      = useState({});
  const [savingLog,    setSavingLog]    = useState(null);
  const [updatingTask, setUpdatingTask] = useState(null);

  const myTasks = tasks.filter((t) => t._links?.assignee?.href?.endsWith(`/${user?.id}`));

  async function handleStatusChange(task, newStatus) {
    setUpdatingTask(task.id);
    try {
      await patchTask(task.id, task.lockVersion, { status: newStatus }, project.id);
      await onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingTask(null);
    }
  }

  async function handleExpandTask(taskId) {
    if (expandedTask === taskId) { setExpandedTask(null); return; }
    setExpandedTask(taskId);
    setExpandedTab((p) => ({ ...p, [taskId]: p[taskId] || "logs" }));
    if (!taskLogs[taskId]) {
      try {
        const logs = await fetchTimeLogs(taskId, project.id);
        setTaskLogs((prev) => ({ ...prev, [taskId]: logs }));
      } catch {
        setTaskLogs((prev) => ({ ...prev, [taskId]: [] }));
      }
    }
  }

  // Saisie heures avec taux horaire par tâche
  async function handleAddLog(taskId) {
    const form = logForm[taskId] || {};
    if (!form.hours) return;
    setSavingLog(taskId);
    try {
      await addTimeLog(taskId, {
        opUserId:    Number(user.id),
        hoursWorked: Number(form.hours),
        loggedDate:  form.date || new Date().toISOString().slice(0, 10),
        note:        form.note || "",
        hourlyRate:  form.hourlyRate ? Number(form.hourlyRate) : null, // taux par tâche
        projectId:   project.id,
      });
      const logs = await fetchTimeLogs(taskId, project.id);
      setTaskLogs((prev) => ({ ...prev, [taskId]: logs }));
      setLogForm((prev) => ({ ...prev, [taskId]: {} }));
    } catch (err) {
      console.error(err);
    } finally {
      setSavingLog(null);
    }
  }

  return (
    <div className="pdp-member-view">
      <div className="pdp-project-card">
        <div className="pdp-project-card-header">
          <div className="pdp-project-card-name">{project.name}</div>
          <span className="pdp-project-card-id">{project.identifier}</span>
        </div>
        <p className="pdp-project-card-desc">
          {project.description?.raw || "Aucune description disponible."}
        </p>
      </div>

      <div className="pdp-section-title" style={{ marginTop: 24 }}>
        ✅ Mes tâches ({myTasks.length})
      </div>

      {myTasks.length === 0 ? (
        <div className="pdp-empty">Aucune tâche assignée pour le moment.</div>
      ) : (
        <div className="pdp-table-wrap">
          <table className="pdp-tasks-table">
            <thead>
              <tr>
                <th style={{ width: 8 }} />
                <th>Tâche</th>
                <th>Statut</th>
                <th>Échéance</th>
                <th>Estimé</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {myTasks.map((task) => {
                const status     = getTaskStatus(task);
                const isLate     = task.dueDate && new Date(task.dueDate) < new Date() && !status.done;
                const isExpanded = expandedTask === task.id;
                const logs       = taskLogs[task.id] || [];
                const form       = logForm[task.id]  || {};
                const activeTab  = expandedTab[task.id] || "logs";

                return (
                  <React.Fragment key={task.id}>
                    <tr
                      className={`pdp-task-row ${isLate ? "row-late" : ""} ${isExpanded ? "row-expanded" : ""}`}
                      onClick={() => handleExpandTask(task.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <span className="pdp-task-dot" style={{ background: isLate ? "#F76C6C" : status.color }} />
                      </td>
                      <td>
                        <div className="pdp-task-title-cell">{task.subject}</div>
                        {task.description?.raw && (
                          <div className="pdp-task-desc-cell">{task.description.raw}</div>
                        )}
                      </td>
                      <td>
                        <span className="pdp-status-pill" style={{ color: status.color, borderColor: status.color + "55" }}>
                          {status.label}
                        </span>
                      </td>
                      <td style={isLate ? { color: "#F76C6C" } : {}}>
                        {isLate ? "⚠️ " : ""}{formatDate(task.dueDate)}
                      </td>
                      <td>
                        {task.estimatedTime
                          ? task.estimatedTime.replace("PT", "").replace("H", "h")
                          : "—"}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="pdp-status-select"
                          value={task._links?.status?.title || ""}
                          disabled={updatingTask === task.id}
                          onChange={(e) => handleStatusChange(task, e.target.value)}
                          style={{ borderColor: status.color + "66", color: status.color }}
                        >
                          <option value="New">À faire</option>
                          <option value="In Progress">En cours</option>
                          <option value="Closed">Terminée</option>
                        </select>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="pdp-expand-row">
                        <td colSpan={6}>
                          {/* Tabs logs / dépendances */}
                          <div className="pdp-expand-tabs">
                            <button
                              className={`pdp-expand-tab ${activeTab === "logs" ? "active" : ""}`}
                              onClick={() => setExpandedTab((p) => ({ ...p, [task.id]: "logs" }))}
                            >
                              ⏱ Mes heures
                            </button>
                            <button
                              className={`pdp-expand-tab ${activeTab === "deps" ? "active" : ""}`}
                              onClick={() => setExpandedTab((p) => ({ ...p, [task.id]: "deps" }))}
                            >
                              🔗 Dépendances
                            </button>
                          </div>

                          {/* ── Heures + taux par tâche ── */}
                          {activeTab === "logs" && (
                            <div className="pdp-logs-section">
                              <div className="pdp-log-form">
                                <input
                                  type="number" placeholder="Heures" value={form.hours || ""}
                                  onChange={(e) => setLogForm((p) => ({ ...p, [task.id]: { ...form, hours: e.target.value } }))}
                                />
                                <input
                                  type="number" placeholder="Taux (DA/h)" value={form.hourlyRate || ""}
                                  title="Taux horaire pour cette tâche"
                                  onChange={(e) => setLogForm((p) => ({ ...p, [task.id]: { ...form, hourlyRate: e.target.value } }))}
                                />
                                <input
                                  type="date" value={form.date || new Date().toISOString().slice(0, 10)}
                                  onChange={(e) => setLogForm((p) => ({ ...p, [task.id]: { ...form, date: e.target.value } }))}
                                />
                                <input
                                  type="text" placeholder="Note (optionnel)" value={form.note || ""}
                                  onChange={(e) => setLogForm((p) => ({ ...p, [task.id]: { ...form, note: e.target.value } }))}
                                />
                                <button onClick={() => handleAddLog(task.id)} disabled={savingLog === task.id}>
                                  {savingLog === task.id ? "..." : "+ Ajouter"}
                                </button>
                              </div>
                              <p className="pdp-rate-hint">
                                💡 Le taux horaire est enregistré par entrée — il peut varier selon la tâche.
                              </p>
                              {logs.length > 0 ? (
                                <table className="pdp-logs-table">
                                  <thead>
                                    <tr><th>Heures</th><th>Taux</th><th>Coût</th><th>Date</th><th>Note</th></tr>
                                  </thead>
                                  <tbody>
                                    {logs.map((log) => (
                                      <tr key={log.id}>
                                        <td>{log.hours_worked}h</td>
                                        <td>{log.hourly_rate ? `${log.hourly_rate} DA/h` : "—"}</td>
                                        <td>
                                          {log.hourly_rate
                                            ? `${(log.hours_worked * log.hourly_rate).toLocaleString("fr-FR")} DA`
                                            : "—"}
                                        </td>
                                        <td>{formatDate(log.logged_date)}</td>
                                        <td style={{ opacity: 0.5 }}>{log.note || "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <div className="pdp-logs-empty">Aucune heure enregistrée.</div>
                              )}
                            </div>
                          )}

                          {/* ── Dépendances (lecture seule pour membre) ── */}
                          {activeTab === "deps" && (
                            <DependenciesPanel
                              task={task}
                              projectId={project.id}
                              allTasks={tasks}
                              isManager={false}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  VUE ADMIN / CHEF DE PROJET
// ═══════════════════════════════════════════════════════════════
function ManagerView({ project, user, tasks, allMembers, projectMembers, onRefresh, onSubProjectCreated }) {
  const [showNewTask,     setShowNewTask]     = useState(false);
  const [newTask,         setNewTask]         = useState(emptyTask());
  const [creatingTask,    setCreatingTask]    = useState(false);
  const [createTaskError, setCreateTaskError] = useState(null);
  const [editingTask,     setEditingTask]     = useState(null);
  const [taskSearch,      setTaskSearch]      = useState("");
  const [expandedTask,    setExpandedTask]    = useState(null);
  const [expandedTab,     setExpandedTab]     = useState({}); // { [taskId]: "logs"|"deps" }
  const [taskLogs,        setTaskLogs]        = useState({});
  const [logForm,         setLogForm]         = useState({});
  const [savingLog,       setSavingLog]       = useState(null);
  const [updatingTask,    setUpdatingTask]    = useState(null);
  const [activeSection,   setActiveSection]   = useState("tasks");

  const [showNewSub,     setShowNewSub]     = useState(false);
  const [newSub,         setNewSub]         = useState(emptySubProject());
  const [creatingSub,    setCreatingSub]    = useState(false);
  const [createSubError, setCreateSubError] = useState(null);

  const daysLeft  = daysUntil(project.endDate);
  const doneTasks = tasks.filter((t) => getTaskStatus(t).done).length;
  const progress  = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const lateTasks = tasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < new Date() && !getTaskStatus(t).done
  ).length;
  const filtered = tasks.filter((t) =>
    t.subject?.toLowerCase().includes(taskSearch.toLowerCase())
  );

  async function handleCreateTask() {
    if (!newTask.title.trim()) { setCreateTaskError("Le titre est obligatoire."); return; }
    setCreatingTask(true);
    setCreateTaskError(null);
    try {
      await createTask(project.id, newTask);
      setNewTask(emptyTask());
      setShowNewTask(false);
      await onRefresh();
    } catch (err) {
      setCreateTaskError("Erreur : " + err.message);
    } finally {
      setCreatingTask(false);
    }
  }

  async function handleCreateSubProject() {
    if (!newSub.title.trim())       { setCreateSubError("Le titre est obligatoire."); return; }
    if (!newSub.description.trim()) { setCreateSubError("La description est obligatoire."); return; }
    setCreatingSub(true);
    setCreateSubError(null);
    try {
      const { createSubProject } = await import("../services/api");
      await createSubProject(project.id, {
        title:       newSub.title.trim(),
        description: newSub.description.trim(),
      });
      setNewSub(emptySubProject());
      setShowNewSub(false);
      if (onSubProjectCreated) onSubProjectCreated();
    } catch (err) {
      setCreateSubError("Erreur : " + err.message);
    } finally {
      setCreatingSub(false);
    }
  }

  async function handlePatchTask(task, fields) {
    setUpdatingTask(task.id);
    try {
      await patchTask(task.id, task.lockVersion, fields, project.id);
      await onRefresh();
      setEditingTask(null);
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingTask(null);
    }
  }

  async function handleExpandTask(taskId) {
    if (expandedTask === taskId) { setExpandedTask(null); return; }
    setExpandedTask(taskId);
    setExpandedTab((p) => ({ ...p, [taskId]: p[taskId] || "logs" }));
    if (!taskLogs[taskId]) {
      try {
        const logs = await fetchTimeLogs(taskId, project.id);
        setTaskLogs((prev) => ({ ...prev, [taskId]: logs }));
      } catch {
        setTaskLogs((prev) => ({ ...prev, [taskId]: [] }));
      }
    }
  }

  // Saisie heures avec taux par tâche
  async function handleAddLog(taskId) {
    const form = logForm[taskId] || {};
    if (!form.opUserId || !form.hours) return;
    setSavingLog(taskId);
    try {
      await addTimeLog(taskId, {
        opUserId:    Number(form.opUserId),
        hoursWorked: Number(form.hours),
        loggedDate:  form.date || new Date().toISOString().slice(0, 10),
        note:        form.note || "",
        hourlyRate:  form.hourlyRate ? Number(form.hourlyRate) : null,
        projectId:   project.id,
      });
      const logs = await fetchTimeLogs(taskId, project.id);
      setTaskLogs((prev) => ({ ...prev, [taskId]: logs }));
      setLogForm((prev) => ({ ...prev, [taskId]: {} }));
    } catch (err) {
      console.error(err);
    } finally {
      setSavingLog(null);
    }
  }

  async function handleDeleteLog(taskId, logId) {
    if (!window.confirm("Supprimer cette entrée ?")) return;
    try {
      await deleteTimeLog(taskId, logId, project.id);
      const logs = await fetchTimeLogs(taskId, project.id);
      setTaskLogs((prev) => ({ ...prev, [taskId]: logs }));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="pdp-manager-view">

      {/* ── Infos projet ── */}
      <div className="pdp-project-info-grid">
        <div className="pdp-info-card">
          <div className="pdp-info-card-label">Description</div>
          <div className="pdp-info-card-value desc">{project.description?.raw || "—"}</div>
        </div>
        <div className="pdp-info-card">
          <div className="pdp-info-card-label">Date de début</div>
          <div className="pdp-info-card-value">{formatDate(project.startDate || project.createdAt)}</div>
        </div>
        <div className="pdp-info-card">
          <div className="pdp-info-card-label">Date de fin</div>
          <div className="pdp-info-card-value"
            style={daysLeft !== null && daysLeft < 7 ? { color: "#F76C6C" } : {}}>
            {formatDate(project.endDate)}
            {daysLeft !== null && (
              <span className="pdp-days-left">
                {daysLeft > 0 ? `J-${daysLeft}` : daysLeft === 0 ? "Aujourd'hui" : "Dépassé"}
              </span>
            )}
          </div>
        </div>
        <div className="pdp-info-card">
          <div className="pdp-info-card-label">Workload estimé</div>
          <div className="pdp-info-card-value">{project.workload ? `${project.workload}h` : "—"}</div>
        </div>
        <div className="pdp-info-card">
          <div className="pdp-info-card-label">Progression</div>
          <div className="pdp-info-card-value">
            <div className="pdp-mini-progress">
              <div className="pdp-mini-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}% — {doneTasks}/{tasks.length} tâches</span>
          </div>
        </div>
        <div className="pdp-info-card">
          <div className="pdp-info-card-label">En retard</div>
          <div className="pdp-info-card-value"
            style={lateTasks > 0 ? { color: "#F76C6C" } : { color: "#6dc87a" }}>
            {lateTasks > 0 ? `⚠️ ${lateTasks} tâche${lateTasks > 1 ? "s" : ""}` : "✅ Aucun retard"}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="pdp-section-tabs">
        <button
          className={`pdp-section-tab ${activeSection === "tasks" ? "active" : ""}`}
          onClick={() => setActiveSection("tasks")}
        >
          📋 Tâches ({tasks.length})
        </button>
        <button
          className={`pdp-section-tab ${activeSection === "members" ? "active" : ""}`}
          onClick={() => setActiveSection("members")}
        >
          👥 Membres ({projectMembers.length})
        </button>
        <button
          className={`pdp-section-tab ${activeSection === "subprojects" ? "active" : ""}`}
          onClick={() => setActiveSection("subprojects")}
        >
          📁 Sous-projets
        </button>
      </div>

      {/* ══ MEMBRES ══ */}
      {activeSection === "members" && (
        <MembersSection
          project={project}
          allMembers={allMembers}
          projectMembers={projectMembers}
          onRefresh={onRefresh}
        />
      )}

      {/* ══ SOUS-PROJETS ══ */}
      {activeSection === "subprojects" && (
        <div className="pdp-subprojects-section">
          <div className="pdp-tasks-header">
            <div className="pdp-section-title" style={{ margin: 0 }}>📁 Sous-projets</div>
            <button className="pdp-new-task-btn" onClick={() => setShowNewSub(!showNewSub)}>
              {showNewSub ? "Annuler" : "+ Nouveau sous-projet"}
            </button>
          </div>

          {showNewSub && (
            <div className="pdp-new-task-form">
              <div className="pdp-ntf-grid">
                <div className="pdp-ntf-field full">
                  <label>Titre *</label>
                  <input type="text" placeholder="Titre du sous-projet"
                    value={newSub.title}
                    onChange={(e) => setNewSub({ ...newSub, title: e.target.value })} />
                </div>
                <div className="pdp-ntf-field full">
                  <label>Description *</label>
                  <textarea placeholder="Description..."
                    value={newSub.description}
                    onChange={(e) => setNewSub({ ...newSub, description: e.target.value })} />
                </div>
              </div>
              {createSubError && <p className="pdp-form-error">⚠️ {createSubError}</p>}
              <div className="pdp-ntf-actions">
                <button className="pdp-ntf-cancel"
                  onClick={() => { setShowNewSub(false); setCreateSubError(null); setNewSub(emptySubProject()); }}>
                  Annuler
                </button>
                <button className="pdp-ntf-submit" onClick={handleCreateSubProject} disabled={creatingSub}>
                  {creatingSub ? "Création..." : "✅ Créer"}
                </button>
              </div>
            </div>
          )}

          <p className="pdp-subprojects-hint">
            Les sous-projets créés apparaissent dans la liste "Mes Projets" sous ce projet parent.
          </p>
        </div>
      )}

      {/* ══ TÂCHES ══ */}
      {activeSection === "tasks" && (
        <>
          <div className="pdp-tasks-header">
            <div className="pdp-section-title" style={{ margin: 0 }}>Tâches</div>
            <button className="pdp-new-task-btn" onClick={() => setShowNewTask(!showNewTask)}>
              {showNewTask ? "Annuler" : "+ Nouvelle tâche"}
            </button>
          </div>

          {showNewTask && (
            <div className="pdp-new-task-form">
              <div className="pdp-ntf-grid">
                <div className="pdp-ntf-field full">
                  <label>Titre *</label>
                  <input type="text" placeholder="Titre de la tâche"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
                </div>
                <div className="pdp-ntf-field full">
                  <label>Description</label>
                  <textarea placeholder="Description..."
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} />
                </div>
                <div className="pdp-ntf-field">
                  <label>Date de début</label>
                  <input type="date" value={newTask.startDate}
                    onChange={(e) => setNewTask({ ...newTask, startDate: e.target.value })} />
                </div>
                <div className="pdp-ntf-field">
                  <label>Date de fin</label>
                  <input type="date" value={newTask.dueDate}
                    onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} />
                </div>
                <div className="pdp-ntf-field">
                  <label>Heures estimées</label>
                  <input type="number" placeholder="Ex: 8" value={newTask.estimatedHours}
                    onChange={(e) => setNewTask({ ...newTask, estimatedHours: e.target.value })} />
                </div>
              </div>
              {createTaskError && <p className="pdp-form-error">⚠️ {createTaskError}</p>}
              <div className="pdp-ntf-actions">
                <button className="pdp-ntf-cancel"
                  onClick={() => { setShowNewTask(false); setCreateTaskError(null); setNewTask(emptyTask()); }}>
                  Annuler
                </button>
                <button className="pdp-ntf-submit" onClick={handleCreateTask} disabled={creatingTask}>
                  {creatingTask ? "Création..." : "✅ Créer"}
                </button>
              </div>
            </div>
          )}

          <div className="pdp-search">
            <span>🔍</span>
            <input type="text" placeholder="Rechercher une tâche..."
              value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} />
          </div>

          {filtered.length === 0 ? (
            <div className="pdp-empty">Aucune tâche trouvée.</div>
          ) : (
            <div className="pdp-table-wrap">
              <table className="pdp-tasks-table">
                <thead>
                  <tr>
                    <th style={{ width: 8 }} />
                    <th>Tâche</th>
                    <th>Responsable</th>
                    <th>Statut</th>
                    <th>Échéance</th>
                    <th>Estimé</th>
                    <th style={{ width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((task) => {
                    const status     = getTaskStatus(task);
                    const isLate     = task.dueDate && new Date(task.dueDate) < new Date() && !status.done;
                    const isExpanded = expandedTask === task.id;
                    const isEditing  = editingTask?.id === task.id;
                    const logs       = taskLogs[task.id] || [];
                    const form       = logForm[task.id]  || {};
                    const activeTab  = expandedTab[task.id] || "logs";
                    const assigneeId = task._links?.assignee?.href?.split("/").pop();
                    const assignee   = projectMembers.find(
                      (m) => String(m.op_user_id) === String(assigneeId)
                    );

                    return (
                      <React.Fragment key={task.id}>
                        <tr
                          className={`pdp-task-row ${isLate ? "row-late" : ""} ${isExpanded ? "row-expanded" : ""}`}
                          onClick={() => !isEditing && handleExpandTask(task.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <span className="pdp-task-dot"
                              style={{ background: isLate ? "#F76C6C" : status.color }} />
                          </td>
                          <td>
                            <div className="pdp-task-title-cell">{task.subject}</div>
                          </td>
                          <td>
                            {assignee
                              ? <span className="pdp-assignee-pill">👤 {assignee.name}</span>
                              : <span style={{ opacity: 0.3, fontSize: 12 }}>Non assigné</span>}
                          </td>
                          <td>
                            <span className="pdp-status-pill"
                              style={{ color: status.color, borderColor: status.color + "55" }}>
                              {status.label}
                            </span>
                          </td>
                          <td style={isLate ? { color: "#F76C6C" } : { opacity: 0.7 }}>
                            {isLate ? "⚠️ " : ""}{formatDate(task.dueDate)}
                          </td>
                          <td style={{ opacity: 0.7 }}>
                            {task.estimatedTime
                              ? task.estimatedTime.replace("PT", "").replace("H", "h")
                              : "—"}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              className="pdp-edit-task-btn"
                              onClick={() => setEditingTask(isEditing ? null : {
                                id:             task.id,
                                subject:        task.subject,
                                startDate:      task.startDate  || "",
                                dueDate:        task.dueDate    || "",
                                estimatedHours: task.estimatedTime
                                  ? parseFloat(task.estimatedTime.replace("PT", "").replace("H", ""))
                                  : "",
                                assigneeId: assigneeId || "",
                                status:     task._links?.status?.title || "",
                              })}
                            >
                              {isEditing ? "✕" : "✏️"}
                            </button>
                          </td>
                        </tr>

                        {/* ── Formulaire d'édition ── */}
                        {isEditing && (
                          <tr className="pdp-edit-row">
                            <td colSpan={7}>
                              <div className="pdp-edit-form">
                                <div className="pdp-edit-grid">
                                  <div className="pdp-ntf-field full">
                                    <label>Titre</label>
                                    <input type="text" value={editingTask.subject}
                                      onChange={(e) =>
                                        setEditingTask({ ...editingTask, subject: e.target.value })} />
                                  </div>
                                  <div className="pdp-ntf-field">
                                    <label>Statut</label>
                                    <select value={editingTask.status}
                                      onChange={(e) =>
                                        setEditingTask({ ...editingTask, status: e.target.value })}>
                                      <option value="New">À faire</option>
                                      <option value="In Progress">En cours</option>
                                      <option value="Closed">Terminée</option>
                                    </select>
                                  </div>
                                  <div className="pdp-ntf-field">
                                    <label>Responsable</label>
                                    <select value={editingTask.assigneeId}
                                      onChange={(e) =>
                                        setEditingTask({ ...editingTask, assigneeId: e.target.value })}>
                                      <option value="">— Non assigné —</option>
                                      {projectMembers.map((m) => (
                                        <option key={m.op_user_id} value={m.op_user_id}>{m.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="pdp-ntf-field">
                                    <label>Date de début</label>
                                    <input type="date" value={editingTask.startDate}
                                      onChange={(e) =>
                                        setEditingTask({ ...editingTask, startDate: e.target.value })} />
                                  </div>
                                  <div className="pdp-ntf-field">
                                    <label>Date de fin</label>
                                    <input type="date" value={editingTask.dueDate}
                                      onChange={(e) =>
                                        setEditingTask({ ...editingTask, dueDate: e.target.value })} />
                                  </div>
                                  <div className="pdp-ntf-field">
                                    <label>Heures estimées</label>
                                    <input type="number" value={editingTask.estimatedHours}
                                      onChange={(e) =>
                                        setEditingTask({ ...editingTask, estimatedHours: e.target.value })} />
                                  </div>
                                </div>
                                <div className="pdp-ntf-actions">
                                  <button className="pdp-ntf-cancel" onClick={() => setEditingTask(null)}>
                                    Annuler
                                  </button>
                                  <button
                                    className="pdp-ntf-submit"
                                    disabled={updatingTask === task.id}
                                    onClick={() => handlePatchTask(task, {
                                      subject:        editingTask.subject,
                                      status:         editingTask.status,
                                      startDate:      editingTask.startDate || null,
                                      dueDate:        editingTask.dueDate   || null,
                                      estimatedHours: editingTask.estimatedHours || null,
                                      assignee:       editingTask.assigneeId
                                        ? { href: `/api/v3/users/${editingTask.assigneeId}` }
                                        : null,
                                    })}
                                  >
                                    {updatingTask === task.id ? "Sauvegarde..." : "✅ Enregistrer"}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* ── Zone expandée : Heures + Dépendances ── */}
                        {isExpanded && !isEditing && (
                          <tr className="pdp-expand-row">
                            <td colSpan={7}>
                              {/* Tabs */}
                              <div className="pdp-expand-tabs">
                                <button
                                  className={`pdp-expand-tab ${activeTab === "logs" ? "active" : ""}`}
                                  onClick={() => setExpandedTab((p) => ({ ...p, [task.id]: "logs" }))}
                                >
                                  ⏱ Heures travaillées
                                </button>
                                <button
                                  className={`pdp-expand-tab ${activeTab === "deps" ? "active" : ""}`}
                                  onClick={() => setExpandedTab((p) => ({ ...p, [task.id]: "deps" }))}
                                >
                                  🔗 Dépendances
                                </button>
                              </div>

                              {/* ── Heures + taux par tâche ── */}
                              {activeTab === "logs" && (
                                <div className="pdp-logs-section">
                                  <div className="pdp-log-form">
                                    <select
                                      value={form.opUserId || ""}
                                      onChange={(e) =>
                                        setLogForm((p) => ({ ...p, [task.id]: { ...form, opUserId: e.target.value } }))}
                                    >
                                      <option value="">— Membre —</option>
                                      {projectMembers.map((m) => (
                                        <option key={m.op_user_id} value={m.op_user_id}>{m.name}</option>
                                      ))}
                                    </select>
                                    <input
                                      type="number" placeholder="Heures" value={form.hours || ""}
                                      onChange={(e) =>
                                        setLogForm((p) => ({ ...p, [task.id]: { ...form, hours: e.target.value } }))}
                                    />
                                    <input
                                      type="number" placeholder="Taux DA/h" value={form.hourlyRate || ""}
                                      title="Taux horaire pour cette tâche"
                                      onChange={(e) =>
                                        setLogForm((p) => ({ ...p, [task.id]: { ...form, hourlyRate: e.target.value } }))}
                                    />
                                    <input
                                      type="date"
                                      value={form.date || new Date().toISOString().slice(0, 10)}
                                      onChange={(e) =>
                                        setLogForm((p) => ({ ...p, [task.id]: { ...form, date: e.target.value } }))}
                                    />
                                    <input
                                      type="text" placeholder="Note (optionnel)" value={form.note || ""}
                                      onChange={(e) =>
                                        setLogForm((p) => ({ ...p, [task.id]: { ...form, note: e.target.value } }))}
                                    />
                                    <button
                                      onClick={() => handleAddLog(task.id)}
                                      disabled={savingLog === task.id}
                                    >
                                      {savingLog === task.id ? "..." : "+ Ajouter"}
                                    </button>
                                  </div>
                                  {logs.length > 0 ? (
                                    <table className="pdp-logs-table">
                                      <thead>
                                        <tr>
                                          <th>Membre</th>
                                          <th>Heures</th>
                                          <th>Taux</th>
                                          <th>Coût</th>
                                          <th>Date</th>
                                          <th>Note</th>
                                          <th />
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {logs.map((log) => (
                                          <tr key={log.id}>
                                            <td>{log.name}</td>
                                            <td>{log.hours_worked}h</td>
                                            <td>{log.hourly_rate ? `${log.hourly_rate} DA/h` : "—"}</td>
                                            <td>
                                              {log.hourly_rate
                                                ? `${(log.hours_worked * log.hourly_rate).toLocaleString("fr-FR")} DA`
                                                : "—"}
                                            </td>
                                            <td>{formatDate(log.logged_date)}</td>
                                            <td style={{ opacity: 0.5 }}>{log.note || "—"}</td>
                                            <td>
                                              <button
                                                className="pdp-log-del"
                                                onClick={() => handleDeleteLog(task.id, log.id)}
                                              >✕</button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div className="pdp-logs-empty">Aucune heure enregistrée.</div>
                                  )}
                                </div>
                              )}

                              {/* ── Dépendances ── */}
                              {activeTab === "deps" && (
                                <DependenciesPanel
                                  task={task}
                                  projectId={project.id}
                                  allTasks={tasks}
                                  isManager={true}
                                />
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════
export default function ProjectDetailPage({
  project, user, onBack, onProjectDeleted, onSubProjectCreated,
}) {
  const isAdmin = user?.isAdmin === true;

  const [tasks,          setTasks]         = useState([]);
  const [allMembers,     setAllMembers]     = useState([]);
  const [projectMembers, setProjectMembers] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);

  const myMembership = projectMembers.find((m) => String(m.op_user_id) === String(user?.id));
  const isManager    = isAdmin || myMembership?.role === "manager";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [taskData, memberData, projectMemberData] = await Promise.all([
        fetchTasks(project.id),
        fetchMembers(),
        fetchProjectMembers(project.id),
      ]);
      setTasks(taskData || []);
      setAllMembers(memberData || []);
      setProjectMembers(projectMemberData || []);
    } catch (err) {
      setError(err.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const manager  = projectMembers.find((m) => m.role === "manager");
  const daysLeft = daysUntil(project.endDate);
  const parentName = project._links?.parent?.title;

  return (
    <div className="pdp-page">
      <button className="pdp-back-btn" onClick={onBack}>← Retour aux projets</button>

      {parentName && (
        <div className="pdp-parent-breadcrumb">
          📁 Sous-projet de <strong>{parentName}</strong>
        </div>
      )}

      <div className="pdp-hero">
        <div className="pdp-hero-left">
          <p className="pdp-eyebrow">{project.identifier}</p>
          <h1 className="pdp-title">{project.name}</h1>
          <div className="pdp-hero-meta">
            {manager && <span className="pdp-meta-chip">👤 {manager.name}</span>}
            {project.endDate && (
              <span
                className="pdp-meta-chip"
                style={
                  daysLeft !== null && daysLeft < 7
                    ? { color: "#F76C6C", borderColor: "rgba(247,108,108,0.3)" }
                    : {}
                }
              >
                🏁 {formatDate(project.endDate)}
                {daysLeft !== null && (
                  <em style={{ marginLeft: 6, opacity: 0.6, fontStyle: "normal" }}>
                    {daysLeft > 0 ? `J-${daysLeft}` : daysLeft === 0 ? "Aujourd'hui" : "Dépassé"}
                  </em>
                )}
              </span>
            )}
          </div>
          {isAdmin && onProjectDeleted && (
            <button className="pdp-delete-project-btn" onClick={() => onProjectDeleted(project)}>
              🗑️ Supprimer le projet
            </button>
          )}
        </div>
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

      {!loading && !error && (
        isManager
          ? <ManagerView
              project={project}
              user={user}
              tasks={tasks}
              allMembers={allMembers}
              projectMembers={projectMembers}
              onRefresh={loadData}
              onSubProjectCreated={onSubProjectCreated}
            />
          : <MemberView
              project={project}
              user={user}
              tasks={tasks}
              projectMembers={projectMembers}
              onRefresh={loadData}
            />
      )}
    </div>
  );
}