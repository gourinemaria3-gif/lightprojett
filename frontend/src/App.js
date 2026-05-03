import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import LoginPage                from "./pages/LoginPage";
import Dashboard                from "./pages/Dashboard";
import ProjectsPage             from "./pages/ProjectsPage";
import ProjectDetailPage        from "./pages/ProjectDetailPage";
import NewProjectPage           from "./pages/NewProjectPage";
import NewSubProjectPage        from "./pages/NewSubProjectPage";
import MyTasksPage              from "./pages/MyTasksPage";
import NotificationSettingsPage from "./pages/NotificationSettingsPage";

import { requestPushPermission, onForegroundMessage } from "./services/firebase";
import { register }             from "./services/serviceWorkerRegistration";
import { initSyncManager }      from "./services/syncManager";

import OfflineBanner from "./components/OfflineBanner.js";
import GanttPage from "./pages/GanttPage";

export default function App() {
  const [user,     setUser]     = useState(null);
  const [checking, setChecking] = useState(true);

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

  useEffect(() => {
    register({
      onUpdate:  () => console.log("[SW] Nouvelle version disponible"),
      onSuccess: () => console.log("[SW] App disponible hors ligne"),
    });
    initSyncManager();
  }, []);

  useEffect(() => {
    if (!user) return;
    if (window.location.protocol !== "https:") return;
    requestPushPermission().catch(() => {});

    let unsubscribe = null;
    onForegroundMessage((payload) => {
      const title = payload.notification?.title || "LightProject";
      const body  = payload.notification?.body  || "";
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

  function handleLogin(userData) { setUser(userData); }
  function handleLogout() {
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
    setUser(null);
  }

  if (checking) return null;
  if (!user) return <LoginPage onLogin={handleLogin} />;

  return (
    <>
      <Routes>
        <Route path="/dashboard"                        element={<Dashboard user={user} onLogout={handleLogout} />} />
        <Route path="/projets"                          element={<ProjectsPage />} />
        <Route path="/projets/nouveau"                  element={<NewProjectPage />} />
        <Route path="/projets/:id"                      element={<ProjectDetailPage />} />
        <Route path="/projets/:id/sous-projet/nouveau"  element={<NewSubProjectPage />} />
        <Route path="/taches"                           element={<MyTasksPage />} />
        <Route path="/notifications"                    element={<NotificationSettingsPage />} />
        <Route path="/gantt" element={<GanttPage />} />
        <Route path="*"                                 element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <OfflineBanner />
    </>
  );
}