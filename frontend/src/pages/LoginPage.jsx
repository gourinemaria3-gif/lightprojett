import React, { useState } from "react";
import "./LoginPage.css";

export default function LoginPage({ onLogin }) {
  const [token, setToken]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  async function handleLogin() {
    if (!token.trim()) {
      setError("Veuillez entrer votre token API OpenProject.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erreur de connexion.");

      // Stocker JWT + user dans localStorage
      localStorage.setItem("jwt", data.jwt);
      localStorage.setItem("user", JSON.stringify(data.user));

      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">Light<span>Project</span></div>
        <p className="login-version">v1.0 — Bêta</p>

        <h1 className="login-title">Connexion</h1>
        <p className="login-sub">
          Entrez votre token API OpenProject pour accéder à l'application.
        </p>

        <div className="login-field">
          <label>Token API OpenProject</label>
          <input
            type="password"
            placeholder="Collez votre token ici..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
        </div>

        <p className="login-hint">
          💡 Trouvez votre token dans OpenProject → Mon compte → Tokens d'accès API
        </p>

        {error && (
          <p className="login-error">⚠️ {error}</p>
        )}

        <button
          className="login-btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <><span className="login-spinner" /> Connexion en cours...</>
          ) : (
            "Se connecter →"
          )}
        </button>
      </div>
    </div>
  );
}