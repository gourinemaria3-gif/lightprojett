import React, { useState, useEffect } from "react";
import { fetchProjects, deleteProject, invalidateCache } from "../services/api";
import ProjectDetailPage  from "./ProjectDetailPage";
import NewSubProjectPage  from "./NewSubProjectPage";
import DeleteProjectModal from "../components/DeleteProjectModal";
import "./ProjectsPage.css";

// ──────────────────────────────────────────────────────────────
//  Status OP → label + couleur
// ──────────────────────────────────────────────────────────────
const STATUS_MAP = {
  on_track:  { label: "En cours",  color: "#6dc87a" },
  off_track: { label: "En retard", color: "#F76C6C" },
  at_risk:   { label: "À risque",  color: "#F8E9A1" },
};

function getStatus(project) {
  const href = project._links?.status?.href || "";
  const key  = href.split("/").pop();
  return STATUS_MAP[key] || { label: "Actif", color: "#F8E9A1" };
}

function getRiskConfig(score) {
  if (score === null || score === undefined) return null;
  if (score <= 30) return { color: "#6dc87a", bg: "rgba(109,200,122,0.12)", label: "Faible",  icon: "🟢" };
  if (score <= 60) return { color: "#F8E9A1", bg: "rgba(248,233,161,0.12)", label: "Modéré",  icon: "🟡" };
  return             { color: "#F76C6C", bg: "rgba(247,108,108,0.12)", label: "Élevé",   icon: "🔴" };
}

function RiskBadge({ score }) {
  const cfg = getRiskConfig(score);
  if (!cfg) return <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>;
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      gap:          5,
      background:   cfg.bg,
      border:       `1px solid ${cfg.color}44`,
      borderRadius: "20px",
      padding:      "3px 10px",
      fontSize:     11,
      fontWeight:   700,
      color:        cfg.color,
      whiteSpace:   "nowrap",
    }}>
      {cfg.icon} {score} — {cfg.label}
    </span>
  );
}

export default function ProjectsPage({ user }) {
  const isAdmin = user?.isAdmin === true;

  const [projects,        setProjects]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [search,          setSearch]          = useState("");
  const [selectedProject, setSelected]        = useState(null);
  const [expandedParents, setExpandedParents] = useState(new Set());
  const [creatingSubFor,  setCreatingSubFor]  = useState(null);

  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteError,     setDeleteError]     = useState(null);

  const loadProjects = (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    if (forceRefresh) invalidateCache();
    fetchProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message || "Erreur lors du chargement des projets."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProjects(); }, []);

  const parentProjects = projects.filter((p) => !p._links?.parent?.href);
  const childrenOf = (parentId) =>
    projects.filter((p) => (p._links?.parent?.href || "").endsWith(`/${parentId}`));

  const filtered = parentProjects.filter((p) =>
    (p.name || "").toLowerCase().includes(search.toLowerCase()) ||
    childrenOf(p.id).some((c) => (c.name || "").toLowerCase().includes(search.toLowerCase()))
  );

  function toggleExpand(projectId) {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      next.has(projectId) ? next.delete(projectId) : next.add(projectId);
      return next;
    });
  }

  function isManagerOf(project) {
    return String(project.managerId) === String(user?.id);
  }

  async function handleConfirmDeleteProject() {
    if (!projectToDelete) return;
    setDeletingProject(true);
    setDeleteError(null);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
    } catch (err) {
      setDeleteError(err.message || "Erreur lors de la suppression.");
    } finally {
      setDeletingProject(false);
    }
  }

  function handleDeleteProjectRequest(project) {
    setSelected(null);
    setProjectToDelete(project);
  }

  // ✅ CORRECTION : au retour de ProjectDetailPage, forcer le rechargement
  // des projets depuis le serveur (le cache a été invalidé par ProjectDetailPage
  // après le sync des stats)
  function handleBackFromDetail() {
    setSelected(null);
    loadProjects(true);
  }

  // ── Rendu d'une ligne projet ─────────────────────────────────
  function renderProjectRow(project, isChild = false) {
    const status       = getStatus(project);
    const progress     = project.progress     ?? 0;
    const riskScore    = project.riskScore    ?? null;
    const lateTasks    = project.lateTasks    ?? 0;
    const blockedTasks = project.blockedTasks ?? 0;

    const children   = childrenOf(project.id);
    const isExpanded = expandedParents.has(project.id);
    const canManage  = isAdmin || isManagerOf(project);

    const startDate = project.startDate || project.createdAt
      ? new Date(project.startDate || project.createdAt).toLocaleDateString("fr-FR", {
          day: "2-digit", month: "short", year: "numeric",
        })
      : "—";
    const endDate = project.endDate
      ? new Date(project.endDate).toLocaleDateString("fr-FR", {
          day: "2-digit", month: "short", year: "numeric",
        })
      : "—";

    const progressColor = riskScore !== null
      ? (riskScore > 60 ? "#F76C6C" : riskScore > 30 ? "#F8E9A1" : "#6dc87a")
      : status.color;

    return (
      <React.Fragment key={project.id}>
        <tr
          className={`pp-row ${isChild ? "pp-row-child" : ""}`}
          onClick={() => setSelected(project)}
          style={{ cursor: "pointer" }}
        >
          <td className="pp-td-name">
            {!isChild && children.length > 0 && (
              <button
                className="pp-expand-btn"
                onClick={(e) => { e.stopPropagation(); toggleExpand(project.id); }}
                title={isExpanded ? "Réduire" : "Voir les sous-projets"}
              >
                {isExpanded ? "▾" : "▸"}
              </button>
            )}
            {isChild && <span className="pp-child-indent">↳</span>}
            <div className="pp-row-accent" style={{ background: progressColor }} />
            <div>
              <div className="pp-row-title">{project.name}</div>
              <div className="pp-row-id">
                {project.identifier}
                {lateTasks > 0 && (
                  <span className="pp-late-badge">⚠️ {lateTasks} retard{lateTasks > 1 ? "s" : ""}</span>
                )}
                {blockedTasks > 0 && (
                  <span className="pp-blocked-badge">🔒 {blockedTasks} bloquée{blockedTasks > 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
            {!isChild && canManage && (
              <button
                className="pp-add-sub-btn"
                title="Créer un sous-projet"
                onClick={(e) => { e.stopPropagation(); setCreatingSubFor(project); }}
              >
                + Sous-projet
              </button>
            )}
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
                style={{ width: `${progress}%`, background: progressColor, transition: "width 0.6s ease" }}
              />
            </div>
            <span className="pp-progress-label">{progress}%</span>
          </td>

          <td className="pp-td-risk">
            <RiskBadge score={riskScore} />
          </td>
        </tr>

        {!isChild && isExpanded && children.map((child) => renderProjectRow(child, true))}
      </React.Fragment>
    );
  }

  if (creatingSubFor) {
    return (
      <NewSubProjectPage
        parentProject={creatingSubFor}
        user={user}
        onBack={() => setCreatingSubFor(null)}
        onCreated={() => {
          setCreatingSubFor(null);
          setExpandedParents((prev) => new Set([...prev, creatingSubFor.id]));
          loadProjects(true);
        }}
      />
    );
  }

  if (selectedProject) {
    return (
      <ProjectDetailPage
        project={selectedProject}
        user={user}
        onBack={handleBackFromDetail} // ✅ CORRECTION : était () => setSelected(null)
        onProjectDeleted={isAdmin ? handleDeleteProjectRequest : null}
        onSubProjectCreated={() => loadProjects(true)}
      />
    );
  }

  return (
    <div className="pp-page">

      {projectToDelete && (
        <DeleteProjectModal
          project={projectToDelete}
          onConfirm={handleConfirmDeleteProject}
          onCancel={() => { setProjectToDelete(null); setDeleteError(null); }}
          loading={deletingProject}
        />
      )}

      {deleteError && (
        <div className="pp-delete-error">
          ⚠️ {deleteError}
          <button onClick={() => setDeleteError(null)}>✕</button>
        </div>
      )}

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
          <span className="pp-search-count">{filtered.length} / {parentProjects.length}</span>
        </div>
      )}

      {loading && (
        <div className="pp-state">
          <div className="pp-spinner" />
          <p>Chargement...</p>
        </div>
      )}

      {error && <div className="pp-state error"><p>⚠️ {error}</p></div>}

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
                <th>Risque</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="pp-empty">
                    Aucun projet trouvé{search ? ` pour "${search}"` : ""}.
                  </td>
                </tr>
              ) : (
                filtered.map((project) => renderProjectRow(project, false))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}