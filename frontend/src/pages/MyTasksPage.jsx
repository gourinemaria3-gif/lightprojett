import React, { useState, useEffect } from "react";
import { fetchProjects, fetchTasks, patchTask } from "../services/api";
import "./MyTasksPage.css";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// Statuts disponibles venant d'OpenProject
// ⚠️ Adapte les hrefs à ceux réellement configurés dans ton instance OP
const TASK_STATUSES = [
  { label: "À faire",  href: "/api/v3/statuses/1"  },
  { label: "En cours", href: "/api/v3/statuses/7"  },
  { label: "Terminée", href: "/api/v3/statuses/12" },
];

export default function MyTasksPage({ user }) {
  const [myTasks,  setMyTasks]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [search,   setSearch]   = useState("");

  // Statut en cours de modification : { taskId, statusHref, saving }
  const [editingStatus, setEditingStatus] = useState(null);
  const [saveError,     setSaveError]     = useState(null);

  useEffect(() => {
    async function loadMyTasks() {
      setLoading(true);
      setError(null);
      try {
        const projects = await fetchProjects();
        const allTasks = [];

        await Promise.all(
          projects.map(async (p) => {
            try {
              const tasks = await fetchTasks(p.id);
              tasks.forEach((t) => {
                const assigneeId = t._links?.assignee?.href?.split("/").pop();
                if (String(assigneeId) === String(user.id)) {
                  allTasks.push({ ...t, projectName: p.name, projectId: p.id });
                }
              });
            } catch {
              // projet sans tâches accessibles — on ignore
            }
          })
        );

        setMyTasks(allTasks);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadMyTasks();
  }, [user.id]);

  const filtered = myTasks.filter((t) =>
    t.subject?.toLowerCase().includes(search.toLowerCase())
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function getStatus(task) {
    const title = task._links?.status?.title?.toLowerCase() || "";
    const isLate = task.dueDate && new Date(task.dueDate) < today;
    if (isLate && title !== "closed") return { label: "En retard", color: "#F76C6C" };
    if (title.includes("closed") || title.includes("terminé") || title.includes("done"))
      return { label: "Terminée", color: "#6dc87a" };
    if (title.includes("progress") || title.includes("cours"))
      return { label: "En cours",  color: "#A8D0E6" };
    return { label: "À faire", color: "#F8E9A1" };
  }

  // Ouvrir le select de changement de statut
  function startEditStatus(task) {
    setEditingStatus({
      taskId:    task.id,
      projectId: task.projectId,
      statusHref: task._links?.status?.href || TASK_STATUSES[0].href,
      saving:    false,
    });
    setSaveError(null);
  }

  // Sauvegarder le nouveau statut
  async function saveStatus(task) {
    if (!editingStatus) return;
    setEditingStatus((prev) => ({ ...prev, saving: true }));
    setSaveError(null);

    try {
      // Pour un membre, le backend n'accepte que le statut — on envoie uniquement ça
      await patchTask(
        task.id,
        task.lockVersion,
        { _links: { status: { href: editingStatus.statusHref } } },
        editingStatus.projectId
      );

      // Mettre à jour localement
      setMyTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                _links: {
                  ...t._links,
                  status: {
                    ...t._links?.status,
                    href: editingStatus.statusHref,
                    title: TASK_STATUSES.find((s) => s.href === editingStatus.statusHref)?.label || "",
                  },
                },
              }
            : t
        )
      );
      setEditingStatus(null);
    } catch (err) {
      setSaveError(err.message || "Erreur lors de la mise à jour du statut.");
      setEditingStatus((prev) => ({ ...prev, saving: false }));
    }
  }

  return (
    <div className="mt-page">
      <div className="mt-header">
        <p className="mt-eyebrow">Light Project</p>
        <h1 className="mt-title">Mes <span>Tâches</span></h1>
        <p className="mt-sub">
          {myTasks.length} tâche{myTasks.length !== 1 ? "s" : ""} assignée{myTasks.length !== 1 ? "s" : ""}
        </p>
      </div>

      {!loading && !error && (
        <div className="mt-search">
          <span>🔍</span>
          <input
            type="text"
            placeholder="Rechercher une tâche..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {saveError && (
        <div style={{
          background: "rgba(247,108,108,0.12)", border: "1px solid rgba(247,108,108,0.3)",
          borderRadius: 8, padding: "10px 16px", marginBottom: 12, color: "#F76C6C", fontSize: 13,
        }}>
          ⚠️ {saveError}
          <button onClick={() => setSaveError(null)}
            style={{ marginLeft: 12, background: "none", border: "none", color: "#F76C6C", cursor: "pointer" }}>
            ✕
          </button>
        </div>
      )}

      {loading && (
        <div className="mt-state">
          <div className="mt-spinner" />
          <p>Chargement de vos tâches...</p>
        </div>
      )}

      {error && <div className="mt-state error"><p>⚠️ {error}</p></div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="mt-state">
          <p>Aucune tâche assignée{search ? ` pour "${search}"` : ""}.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="mt-table-wrap">
          <table className="mt-table">
            <thead>
              <tr>
                <th>Titre</th>
                <th>Projet</th>
                <th>Statut</th>
                <th>Date de fin</th>
                <th>Workload</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task, i) => {
                const status    = getStatus(task);
                const isEditing = editingStatus?.taskId === task.id;

                return (
                  <tr key={task.id} className="mt-row" style={{ animationDelay: `${i * 40}ms` }}>

                    <td className="mt-td-title">
                      <div className="mt-dot" style={{ background: status.color }} />
                      {task.subject}
                    </td>

                    <td className="mt-td-project">{task.projectName}</td>

                    <td>
                      {isEditing ? (
                        <select
                          className="mt-status-select"
                          value={editingStatus.statusHref}
                          onChange={(e) =>
                            setEditingStatus((prev) => ({ ...prev, statusHref: e.target.value }))
                          }
                          disabled={editingStatus.saving}
                        >
                          {TASK_STATUSES.map((s) => (
                            <option key={s.href} value={s.href}>{s.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="mt-badge"
                          style={{ color: status.color, borderColor: `${status.color}44` }}>
                          {status.label}
                        </span>
                      )}
                    </td>

                    <td
                      className="mt-td-date"
                      style={status.label === "En retard" ? { color: "#F76C6C", fontWeight: 500 } : {}}
                    >
                      {status.label === "En retard" && "⚠️ "}
                      {formatDate(task.dueDate)}
                    </td>

                    <td>
                      {task.estimatedTime
                        ? task.estimatedTime.replace("PT", "").replace("H", "h")
                        : "—"}
                    </td>

                    {/* Action : changer statut uniquement */}
                    <td className="mt-td-action">
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            className="mt-save-btn"
                            onClick={() => saveStatus(task)}
                            disabled={editingStatus.saving}
                          >
                            {editingStatus.saving ? "..." : "✅"}
                          </button>
                          <button
                            className="mt-cancel-btn"
                            onClick={() => setEditingStatus(null)}
                            disabled={editingStatus.saving}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          className="mt-edit-status-btn"
                          onClick={() => startEditStatus(task)}
                          title="Changer le statut"
                        >
                          🔄 Statut
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
  );
}