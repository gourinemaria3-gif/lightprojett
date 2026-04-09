import React, { useState, useEffect } from "react";
import { fetchProjects, fetchTasks } from "../services/api";
import ProjectDetailPage from "./ProjectDetailPage";
import "./ProjectsPage.css";

const STATUS_MAP = {
  "on_track":  { label: "En cours",  color: "#6dc87a" },
  "off_track": { label: "En retard", color: "#F76C6C" },
  "at_risk":   { label: "À risque",  color: "#F8E9A1" },
};

function getStatus(project) {
  const href = project._links?.status?.href || "";
  const key = href.split("/").pop();
  return STATUS_MAP[key] || { label: "Actif", color: "#F8E9A1" };
}

async function calcProgress(projectId) {
  try {
    const tasks = await fetchTasks(projectId);
    if (!tasks || tasks.length === 0) return 0;
    const done = tasks.filter((t) => {
      const status = t._links?.status?.title?.toLowerCase() || "";
      return status.includes("closed") || status.includes("terminé") || status.includes("done");
    }).length;
    return Math.round((done / tasks.length) * 100);
  } catch {
    return 0;
  }
}

export default function ProjectsPage() {
  const [projects, setProjects]        = useState([]);
  const [loading, setLoading]          = useState(true);
  const [error, setError]              = useState(null);
  const [search, setSearch]            = useState("");
  const [selectedProject, setSelected] = useState(null);
  const [progressMap, setProgressMap]  = useState({});

  useEffect(() => {
    fetchProjects()
      .then(async (data) => {
        // ✅ Fix : s'assurer que data est toujours un tableau
        const list = Array.isArray(data) ? data : [];
        setProjects(list);

        const map = {};
        await Promise.all(
          list.map(async (p) => {
            map[p.id] = await calcProgress(p.id);
          })
        );
        setProgressMap(map);
      })
      .catch((err) => setError(err.message || "Erreur lors du chargement des projets."))
      .finally(() => setLoading(false));
  }, []);

  // ✅ Fix : projects est garanti tableau donc .filter() fonctionne
  const filtered = projects.filter((p) =>
    (p.name || "").toLowerCase().includes(search.toLowerCase())
  );

  if (selectedProject) {
    return (
      <ProjectDetailPage
        project={selectedProject}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="pp-page">
      <div className="pp-header">
        <div>
          <p className="pp-eyebrow">Light Project</p>
          <h1 className="pp-title">Mes <span>Projets</span></h1>
          <p className="pp-sub">{projects.length} projet{projects.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {!loading && !error && (
        <div className="pp-search">
          <span>🔍</span>
          <input
            type="text"
            placeholder="Rechercher un projet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="pp-search-count">{filtered.length} / {projects.length}</span>
        </div>
      )}

      {loading && (
        <div className="pp-state">
          <div className="pp-spinner" />
          <p>Chargement...</p>
        </div>
      )}

      {error && (
        <div className="pp-state error">
          <p>⚠️ {error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="pp-table-wrap">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Statut</th>
                <th>Date début</th>
                <th>Date fin</th>
                <th>Progression</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="pp-empty">
                    Aucun projet trouvé{search ? ` pour "${search}"` : ""}.
                  </td>
                </tr>
              ) : (
                filtered.map((project, i) => {
                  const status   = getStatus(project);
                  const progress = progressMap[project.id] ?? 0;

                  const startDate = project.createdAt
                    ? new Date(project.createdAt).toLocaleDateString("fr-FR", {
                        day: "2-digit", month: "short", year: "numeric",
                      })
                    : "—";

                  const endDate = project.endDate
                    ? new Date(project.endDate).toLocaleDateString("fr-FR", {
                        day: "2-digit", month: "short", year: "numeric",
                      })
                    : "—";

                  return (
                    <tr
                      key={project.id}
                      className="pp-row"
                      style={{ animationDelay: `${i * 50}ms` }}
                      onClick={() => setSelected(project)}
                    >
                      <td className="pp-td-name">
                        <div className="pp-row-accent" style={{ background: status.color }} />
                        <div>
                          <div className="pp-row-title">{project.name}</div>
                          <div className="pp-row-id">{project.identifier}</div>
                        </div>
                      </td>

                      <td>
                        <span className="pp-badge" style={{ color: status.color, borderColor: status.color }}>
                          {status.label}
                        </span>
                      </td>

                      <td className="pp-td-date">{startDate}</td>
                      <td className="pp-td-date">{endDate}</td>

                      <td className="pp-td-progress">
                        <div className="pp-progress-bar">
                          <div
                            className="pp-progress-fill"
                            style={{ width: `${progress}%`, background: status.color }}
                          />
                        </div>
                        <span className="pp-progress-label">{progress}%</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}