import React, { useState, useEffect } from "react";
import { fetchProjects, deleteProject, invalidateCache } from "../services/api";
import ProjectDetailPage  from "./ProjectDetailPage";
import NewSubProjectPage  from "./NewSubProjectPage";
import DeleteProjectModal from "../components/DeleteProjectModal";
import "./ProjectsPage.css";

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

export default function ProjectsPage({ user }) {
  const isAdmin = user?.isAdmin === true;

  const [projects,        setProjects]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [search,          setSearch]          = useState("");
  const [selectedProject, setSelected]        = useState(null);
  const [expandedParents, setExpandedParents] = useState(new Set());
  const [creatingSubFor,  setCreatingSubFor]  = useState(null); // project object ou null

  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteError,     setDeleteError]     = useState(null);

  // forceRefresh=true vide le cache avant de recharger
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

  // ── Hiérarchie parent / enfants ──────────────────────────────
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

  // ── Rendu d'une ligne projet ─────────────────────────────────
  function renderProjectRow(project, isChild = false) {
    const status     = getStatus(project);
    const progress   = project.progress ?? 0;
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
            <div className="pp-row-accent" style={{ background: status.color }} />
            <div>
              <div className="pp-row-title">{project.name}</div>
              <div className="pp-row-id">{project.identifier}</div>
            </div>
            {!isChild && canManage && (
              <button
                className="pp-add-sub-btn"
                title="Créer un sous-projet"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreatingSubFor(project); // ouvre NewSubProjectPage
                }}
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
              <div className="pp-progress-fill" style={{ width: `${progress}%`, background: status.color }} />
            </div>
            <span className="pp-progress-label">{progress}%</span>
          </td>
        </tr>

        {/* Sous-projets (enfants) */}
        {!isChild && isExpanded && children.map((child) => renderProjectRow(child, true))}
      </React.Fragment>
    );
  }

  // ── Écran création sous-projet ────────────────────────────────
  if (creatingSubFor) {
    return (
      <NewSubProjectPage
        parentProject={creatingSubFor}
        user={user}
        onBack={() => setCreatingSubFor(null)}
        onCreated={() => {
          setCreatingSubFor(null);
          // Auto-expand le projet parent pour voir le sous-projet créé
          setExpandedParents((prev) => new Set([...prev, creatingSubFor.id]));
          loadProjects(true); // force refresh sans cache
        }}
      />
    );
  }

  // ── Écran détail projet ───────────────────────────────────────
  if (selectedProject) {
    return (
      <ProjectDetailPage
        project={selectedProject}
        user={user}
        onBack={() => setSelected(null)}
        onProjectDeleted={isAdmin ? handleDeleteProjectRequest : null}
        onSubProjectCreated={() => loadProjects(true)}
      />
    );
  }

  // ── Liste des projets ─────────────────────────────────────────
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
                filtered.map((project) => renderProjectRow(project, false))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}