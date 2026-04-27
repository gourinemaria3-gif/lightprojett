import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import LoginPage               from "./pages/LoginPage";
import Dashboard               from "./pages/Dashboard";
import ProjectsPage            from "./pages/ProjectsPage";
import ProjectDetailPage       from "./pages/ProjectDetailPage";
import NewProjectPage          from "./pages/NewProjectPage";
import NewSubProjectPage       from "./pages/NewSubProjectPage";
import MyTasksPage             from "./pages/MyTasksPage";
import { ManagerBudgetPanel, MemberBudgetPanel } from "./pages/BudgetPanel";
import NotificationSettingsPage from "./pages/NotificationSettingsPage";

import { requestPushPermission, onForegroundMessage } from "./services/firebase";

export default function App() {
  const [user,     setUser]     = useState(null);
  const [checking, setChecking] = useState(true);

  // ── Restauration de session au démarrage ────────────────────────────────
  useEffect(() => {
    const jwt    = localStorage.getItem("jwt");
    const stored = localStorage.getItem("user");
    if (jwt && stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("jwt");
        localStorage.removeItem("user");
      }
    }
    setChecking(false);
  }, []);

  // ── Firebase FCM ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    requestPushPermission().catch(() => {});

    let unsubscribe = null;
    onForegroundMessage((payload) => {
      const title = payload.notification?.title || "LightProject";
      const body  = payload.notification?.body  || "";
      console.log("[FCM] Notif premier plan:", title, body);
      if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "/logo192.png" });
      }
    }).then((unsub) => {
      unsubscribe = unsub;
    }).catch(() => {});

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [user]);

  function handleLogin(userData) {
    setUser(userData);
  }

  function handleLogout() {
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
    setUser(null);
  }

  if (checking) return null;

  // ── Si pas connecté → Login ──────────────────────────────────────────────
  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // ── Connecté → Router avec toutes les pages ──────────────────────────────
  return (
    <Routes>

      {/* Dashboard */}
      <Route path="/dashboard" element={<Dashboard user={user} onLogout={handleLogout} />} />

      {/* Projets */}
      <Route path="/projets"                          element={<ProjectsPage />} />
      <Route path="/projets/nouveau"                  element={<NewProjectPage />} />
      <Route path="/projets/:id"                      element={<ProjectDetailPage />} />
      <Route path="/projets/:id/sous-projet/nouveau"  element={<NewSubProjectPage />} />

      {/* Tâches */}
      <Route path="/taches" element={<MyTasksPage />} />

      {/* Budget */}
      <Route path="/budget" element={user?.isAdmin ? <ManagerBudgetPanel /> : <MemberBudgetPanel />} />

      {/* Notifications */}
      <Route path="/notifications" element={<NotificationSettingsPage />} />

      {/* Par défaut → dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />

    </Routes>
  );
}