import React, { useState, useEffect } from "react";
import { fetchProjects, fetchTasks } from "../services/api";
import "./MyTasksPage.css";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function MyTasksPage({ user }) {
  const [myTasks,  setMyTasks]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [search,   setSearch]   = useState("");

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
                  allTasks.push({ ...t, projectName: p.name });
                }
              });
            } catch {
              // projet sans tâches — on ignore
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
    if (title.includes("closed") || title.includes("terminé"))
      return { label: "Terminée", color: "#6dc87a" };
    if (title.includes("progress") || title.includes("cours"))
      return { label: "En cours",  color: "#A8D0E6" };
    return { label: "À faire", color: "#F8E9A1" };
  }

  return (
    <div className="mt-page">
      <div className="mt-header">
        <p className="mt-eyebrow">Light Project</p>
        <h1 className="mt-title">Mes <span>Tâches</span></h1>
        <p className="mt-sub">{myTasks.length} tâche{myTasks.length !== 1 ? "s" : ""} assignée{myTasks.length !== 1 ? "s" : ""}</p>
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

      {loading && (
        <div className="mt-state">
          <div className="mt-spinner" />
          <p>Chargement de vos tâches...</p>
        </div>
      )}

      {error && (
        <div className="mt-state error">
          <p>⚠️ {error}</p>
        </div>
      )}

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
              </tr>
            </thead>
            <tbody>
              {filtered.map((task, i) => {
                const status = getStatus(task);
                return (
                  <tr key={task.id} className="mt-row"
                    style={{ animationDelay: `${i * 40}ms` }}>
                    <td className="mt-td-title">
                      <div className="mt-dot" style={{ background: status.color }} />
                      {task.subject}
                    </td>
                    <td className="mt-td-project">{task.projectName}</td>
                    <td>
                      <span className="mt-badge"
                        style={{ color: status.color, borderColor: `${status.color}44` }}>
                        {status.label}
                      </span>
                    </td>
                    <td className="mt-td-date"
                      style={status.label === "En retard"
                        ? { color: "#F76C6C", fontWeight: 500 } : {}}>
                      {status.label === "En retard" && "⚠️ "}
                      {formatDate(task.dueDate)}
                    </td>
                    <td>
                      {task.estimatedTime
                        ? task.estimatedTime.replace("PT", "").replace("H", "h")
                        : "—"}
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