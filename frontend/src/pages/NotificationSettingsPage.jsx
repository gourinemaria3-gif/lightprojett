import React, { useState, useEffect } from "react";
import {
  fetchNotificationSettings,
  updateNotificationSettings,
} from "../services/api";

// ──────────────────────────────────────────────────────────────────────────────
//  Types de notifications (informatif — tous gérés automatiquement)
// ──────────────────────────────────────────────────────────────────────────────
const NOTIF_TYPES = [
  { icon: "👤", label: "Nouvelle tâche assignée",  type: "assigned",     auto: true },
  { icon: "🔔", label: "Échéance proche",           type: "due_soon",     auto: false },
  { icon: "⚠️", label: "Tâche en retard",           type: "overdue",      auto: false },
  { icon: "🔒", label: "Dépendance bloquée",        type: "blocked",      auto: true },
  { icon: "✅", label: "Tâche débloquée",           type: "unblocked",    auto: true },
  { icon: "🚨", label: "Projet en danger",          type: "danger",       auto: true },
  { icon: "💸", label: "Alerte budget",             type: "budget_alert", auto: true },
];

const REMINDER_OPTIONS = [
  { value: 1,  label: "J-1 — La veille" },
  { value: 2,  label: "J-2 — 2 jours avant" },
  { value: 3,  label: "J-3 — 3 jours avant" },
  { value: 5,  label: "J-5 — 5 jours avant" },
  { value: 7,  label: "J-7 — 1 semaine avant" },
  { value: 14, label: "J-14 — 2 semaines avant" },
];

export default function NotificationSettingsPage({ onBack }) {
  const [settings,  setSettings]  = useState({ enabled: true, reminder_days: 3 });
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    fetchNotificationSettings()
      .then(setSettings)
      .catch(() => setError("Impossible de charger les paramètres."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateNotificationSettings({
        enabled:      settings.enabled,
        reminderDays: settings.reminder_days,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 60 }}>
          Chargement…
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>

      {/* En-tête */}
      <button onClick={onBack} style={backBtnStyle}>← Retour</button>

      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#F76C6C", marginBottom: 8 }}>
          Light Project
        </p>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, color: "#fff", marginBottom: 4 }}>
          Notifications
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
          Gérez vos alertes et préférences de notification.
        </p>
      </div>

      {error && (
        <div style={{
          background: "rgba(247,108,108,0.1)", border: "1px solid rgba(247,108,108,0.3)",
          borderRadius: 10, padding: "12px 16px", color: "#F76C6C", fontSize: 13, marginBottom: 20,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Toggle global ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 4 }}>
              🔔 Activer les notifications
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
              Recevez des alertes pour vos tâches et projets.
            </div>
          </div>
          <Toggle
            checked={settings.enabled === 1 || settings.enabled === true}
            onChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
          />
        </div>
      </div>

      {/* ── Délai d'alerte ── */}
      <div style={{ ...cardStyle, opacity: (settings.enabled ? 1 : 0.4), transition: "opacity 0.3s" }}>
        <div style={sectionLabel}>⏱ Délai d'alerte pour les échéances</div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
          Combien de jours avant l'échéance souhaitez-vous être alerté ?
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {REMINDER_OPTIONS.map((opt) => {
            const active = settings.reminder_days === opt.value;
            return (
              <button
                key={opt.value}
                disabled={!settings.enabled}
                onClick={() => setSettings((s) => ({ ...s, reminder_days: opt.value }))}
                style={{
                  background:   active ? "rgba(248,233,161,0.15)" : "rgba(255,255,255,0.04)",
                  border:       `1px solid ${active ? "rgba(248,233,161,0.5)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: "9px",
                  color:        active ? "#F8E9A1" : "rgba(255,255,255,0.55)",
                  fontFamily:   "'DM Sans', sans-serif",
                  fontSize:     13,
                  fontWeight:   active ? 700 : 400,
                  padding:      "8px 16px",
                  cursor:       settings.enabled ? "pointer" : "not-allowed",
                  transition:   "all 0.15s",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Types de notifications ── */}
      <div style={{ ...cardStyle, opacity: (settings.enabled ? 1 : 0.4), transition: "opacity 0.3s" }}>
        <div style={sectionLabel}>📋 Types de notifications reçues</div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
          Ces alertes sont générées automatiquement par l'application.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {NOTIF_TYPES.map((t) => {
            const isDueSoon = t.type === "due_soon" || t.type === "overdue";
            return (
              <div key={t.type} style={{
                display:      "flex",
                alignItems:   "center",
                gap:          12,
                padding:      "11px 14px",
                background:   "rgba(255,255,255,0.03)",
                border:       "1px solid rgba(255,255,255,0.07)",
                borderRadius: "9px",
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{t.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
                    {t.label}
                  </div>
                  {isDueSoon && (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                      Délai configuré ci-dessus : J-{settings.reminder_days}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize:     11,
                  fontWeight:   600,
                  padding:      "2px 9px",
                  borderRadius: "20px",
                  background:   "rgba(109,200,122,0.1)",
                  border:       "1px solid rgba(109,200,122,0.25)",
                  color:        "#6dc87a",
                }}>
                  Actif
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Email ── */}
      <div style={{ ...cardStyle, opacity: (settings.enabled ? 1 : 0.4) }}>
        <div style={sectionLabel}>📧 Email récapitulatif</div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
          Un email récapitulatif est envoyé chaque matin à 08h00 si vous avez des tâches en retard
          ou dont l'échéance est proche.<br />
          L'email est envoyé à l'adresse associée à votre compte OpenProject.
        </p>
        <div style={{
          marginTop:    12,
          background:   "rgba(168,208,230,0.06)",
          border:       "1px solid rgba(168,208,230,0.15)",
          borderRadius: "8px",
          padding:      "10px 14px",
          fontSize:     13,
          color:        "#A8D0E6",
        }}>
          🕗 Envoi automatique chaque jour à 08h00 (Alger)
        </div>
      </div>

      {/* ── Bouton sauvegarder ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
        {saved && (
          <span style={{ color: "#6dc87a", fontSize: 13, alignSelf: "center" }}>
            ✅ Paramètres sauvegardés !
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background:   "#F8E9A1",
            border:       "none",
            borderRadius: "10px",
            color:        "#16203F",
            fontFamily:   "'DM Sans', sans-serif",
            fontSize:     14,
            fontWeight:   700,
            padding:      "11px 28px",
            cursor:       saving ? "not-allowed" : "pointer",
            opacity:      saving ? 0.7 : 1,
            transition:   "opacity 0.2s",
          }}
        >
          {saving ? "Sauvegarde…" : "💾 Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
//  Toggle switch
// ──────────────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width:        "48px",
        height:       "26px",
        borderRadius: "13px",
        background:   checked ? "#6dc87a" : "rgba(255,255,255,0.1)",
        border:       `1px solid ${checked ? "#6dc87a" : "rgba(255,255,255,0.15)"}`,
        cursor:       "pointer",
        position:     "relative",
        transition:   "background 0.25s, border-color 0.25s",
        flexShrink:   0,
      }}
    >
      <div style={{
        position:   "absolute",
        top:        "3px",
        left:       checked ? "24px" : "3px",
        width:      "18px",
        height:     "18px",
        borderRadius: "50%",
        background:  "#fff",
        boxShadow:  "0 1px 4px rgba(0,0,0,0.3)",
        transition: "left 0.25s",
      }} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
//  Styles communs
// ──────────────────────────────────────────────────────────────────────────────
const pageStyle = {
  maxWidth:   "720px",
  margin:     "0 auto",
  padding:    "52px 28px 80px",
  fontFamily: "'DM Sans', sans-serif",
};

const cardStyle = {
  background:   "rgba(36,48,94,0.5)",
  border:       "1px solid rgba(168,208,230,0.1)",
  borderRadius: "14px",
  padding:      "22px 24px",
  marginBottom: "16px",
};

const backBtnStyle = {
  background:   "rgba(168,208,230,0.08)",
  border:       "1px solid rgba(168,208,230,0.18)",
  color:        "#A8D0E6",
  borderRadius: "8px",
  padding:      "8px 16px",
  cursor:       "pointer",
  fontSize:     "13px",
  fontFamily:   "'DM Sans', sans-serif",
  marginBottom: "32px",
  display:      "inline-flex",
  alignItems:   "center",
  gap:          "6px",
};

const sectionLabel = {
  fontSize:      13,
  fontWeight:    700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color:         "#A8D0E6",
  opacity:       0.7,
  marginBottom:  12,
};