import React, { useState } from "react";
import "./LoginPage.css";
import { requestPushPermission } from "../services/firebase";
import beeMascot from "../assets/beee_mascot.png";

const BASE_URL = process.env.REACT_APP_API_URL || "https://localhost:5001";

export default function LoginPage({ onLogin }) {
  const [token,    setToken]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleLogin() {
    if (!token.trim()) {
      setError("Veuillez entrer votre token API OpenProject.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const deviceId = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? "mobile" : "web";
const res = await fetch(`${BASE_URL}/api/auth/login`, {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body:    JSON.stringify({ token: token.trim(), deviceId }),
});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erreur de connexion.");

      localStorage.setItem("jwt",  data.jwt);
      localStorage.setItem("user", JSON.stringify(data.user));

      // Token FCM en arrière-plan (silencieux si non supporté)
      requestPushPermission().catch(() => {});

      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lp-page">
      {/* Blobs de fond */}
      <div className="lp-blob lp-blob--tl" />
      <div className="lp-blob lp-blob--br" />

      <div className="lp-card">

        {/* ── GAUCHE ── */}
        <div className="lp-left">
          <div className="lp-blob lp-blob--left1" />
          <div className="lp-blob lp-blob--left2" />

          <div className="lp-logo">
            <div className="lp-logo__dot" />
            <span className="lp-logo__text">lightproject</span>
          </div>

          <div className="lp-mascot">
            <img src={beeMascot} alt="mascotte abeille" className="lp-mascot__img" />
          </div>

          <h1 className="lp-title">
            Gérez vos projets<br />
            <em className="lp-title__em">avec élégance</em>
          </h1>
          <p className="lp-subtitle">
            Une plateforme moderne pour suivre vos projets et collaborer en équipe.
          </p>

          <div className="lp-features">
            {[
              { icon: "📁", label: "Gestion de projets simplifiée" },
              { icon: "✅", label: "Suivi des tâches en temps réel" },
              { icon: "✨", label: "Analyse IA avec Google Gemini" },
              { icon: "🔗", label: "Synchronisé avec OpenProject" },
            ].map(({ icon, label }) => (
              <div className="lp-feat" key={label}>
                <div className="lp-feat__icon">{icon}</div>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── DROITE ── */}
        <div className="lp-right">
          <span className="lp-badge">✦ Connexion sécurisée</span>

          <h2 className="lp-form-title">Bon retour !</h2>
          <p className="lp-form-sub">
            Entre ton token OpenProject pour accéder à ton espace de travail.
          </p>

          <label className="lp-label">TOKEN OPENPROJECT</label>
          <div className="lp-input-wrap">
            <span className="lp-input-icon">🔑</span>
            <input
              type="password"
              placeholder="Entre ton token ici..."
              className="lp-input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          <p className="lp-hint">OpenProject → Profil → Token d'accès</p>

          {error && <p className="lp-error">⚠️ {error}</p>}

          <button
            className="lp-btn"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <><span className="lp-spinner" /> Connexion en cours...</>
            ) : (
              "Se connecter →"
            )}
          </button>

          <div className="lp-divider">
            <div className="lp-divider__line" />
            <span className="lp-divider__text">besoin d'aide ?</span>
            <div className="lp-divider__line" />
          </div>

          <p className="lp-footer">
            Contacte ton administrateur ou consulte{" "}
            <span className="lp-footer__link">la documentation OpenProject</span>
          </p>
        </div>

      </div>
    </div>
  );
}