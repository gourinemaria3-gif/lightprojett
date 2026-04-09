import React, { useState, useEffect } from "react";
import Dashboard  from "./pages/Dashboard";
import LoginPage  from "./pages/LoginPage";

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Vérifier si un JWT existe déjà
    const jwt  = localStorage.getItem("jwt");
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

  function handleLogin(userData) {
    setUser(userData);
  }

  function handleLogout() {
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
    setUser(null);
  }

  if (checking) return null; // évite le flash

  if (!user) return <LoginPage onLogin={handleLogin} />;

  return <Dashboard user={user} onLogout={handleLogout} />;
}