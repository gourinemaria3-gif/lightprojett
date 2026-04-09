import React, { useState, useEffect } from "react";
import { fetchProjects } from "../services/api";
import ProjectsPage   from "./ProjectsPage";
import NewProjectPage from "./NewProjectPage";
import MyTasksPage from "./MyTasksPage";
import "./Dashboard.css";

const NAV_ITEMS = [
  { id: "home",      icon: "🏠", label: "Accueil" },
  { id: "projects",  icon: "📁", label: "Mes projets" },
  { id: "mytasks",   icon: "✅", label: "Mes tâches" },
  { id: "new",       icon: "✨", label: "Nouveau projet" },
  { id: "alerts",    icon: "🔔", label: "Alertes" },
];

function Sidebar({ activePage, onNavigate, user, onLogout }) {
  return (
    <aside className="sidebar">
      <div>
        <div className="sidebar-logo">Light<span>Project</span></div>
        <div className="sidebar-version">v1.0 — Bêta</div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activePage === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <button className="sidebar-new-btn" onClick={() => onNavigate("new")}>
        + Nouveau projet
      </button>

      {/* Profil utilisateur */}
      {user && (
        <div className="sidebar-user">
          <div className="sidebar-user-name">👤 {user.name}</div>
          <div className="sidebar-user-email">{user.email}</div>
          <button className="sidebar-logout-btn" onClick={onLogout}>
            Déconnexion
          </button>
        </div>
      )}

      <div className="sidebar-footer">Light Project © 2026</div>
    </aside>
  );
}
function HomePage({ onNavigate, projectCount }) {
  return (
    <div className="home-page">
      <div className="home-header">
        <p className="home-greeting">Bienvenue sur</p>
        <h1 className="home-title">Light <span>Project</span></h1>
        <p className="home-sub">Gérez vos projets OpenProject avec l'aide de l'IA</p>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card yellow" style={{ animationDelay: "0ms" }}>
          <div className="stat-value">{projectCount ?? "—"}</div>
          <div className="stat-label">Projets actifs</div>
        </div>
        <div className="stat-card coral" style={{ animationDelay: "80ms" }}>
          <div className="stat-value">IA</div>
          <div className="stat-label">Gemini intégré</div>
        </div>
        <div className="stat-card blue" style={{ animationDelay: "160ms" }}>
          <div className="stat-value">API</div>
          <div className="stat-label">OpenProject connecté</div>
        </div>
      </div>

      {/* Actions */}
      <h2 className="section-title">Que voulez-vous faire ?</h2>
      <div className="actions-grid">
        <button
          className="action-card primary"
          onClick={() => onNavigate("new")}
          style={{ animationDelay: "0ms" }}
        >
          <div className="action-icon">✨</div>
          <div className="action-title">Nouveau projet</div>
          <div className="action-desc">
            Créez un projet avec l'aide de l'IA Gemini qui propose et structure vos tâches automatiquement.
          </div>
          <span className="action-arrow">→</span>
        </button>

        <button
          className="action-card secondary"
          onClick={() => onNavigate("projects")}
          style={{ animationDelay: "80ms" }}
        >
          <div className="action-icon">📁</div>
          <div className="action-title">Mes projets</div>
          <div className="action-desc">
            Consultez la liste de vos projets OpenProject, leurs statuts et leurs tâches.
          </div>
          <span className="action-arrow">→</span>
        </button>

        <button
          className="action-card tertiary"
          onClick={() => onNavigate("alerts")}
          style={{ animationDelay: "160ms" }}
        >
          <div className="action-icon">🔔</div>
          <div className="action-title">Alertes</div>
          <div className="action-desc">
            Configurez les notifications pour les échéances proches ou dépassées.
          </div>
          <span className="action-arrow">→</span>
        </button>
      </div>
    </div>
  );
}

export default function Dashboard({ user, onLogout }) {
  const [activePage, setActivePage]     = useState("home");
  const [projectCount, setProjectCount] = useState(null);

  useEffect(() => {
    fetchProjects()
      .then((projects) => setProjectCount(projects.length))
      .catch(() => setProjectCount(0));
  }, []);

  function renderPage() {
    switch (activePage) {
      case "projects":
        return (
          <ProjectsPage
            onNewProject={() => setActivePage("new")}
          />
        );
      case "new":
        return (
          <NewProjectPage
            onBack={() => setActivePage("home")}
          />
        );
        case "mytasks":
  return <MyTasksPage user={user} />;
      case "alerts":
        return (
          <div style={{ padding: "52px 40px", color: "var(--blue-light)", opacity: 0.5 }}>
            <h2 style={{ fontFamily: "Playfair Display, serif", color: "var(--white)", marginBottom: 12 }}>
              🔔 Alertes
            </h2>
            <p>Fonctionnalité en cours de développement...</p>
          </div>
        );
      default:
        return (
          <HomePage
            onNavigate={setActivePage}
            projectCount={projectCount}
          />
        );
    }
  }

  return (
    <div className="dashboard">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}
