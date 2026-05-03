import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

async function fetchPrefs() {
  const jwt = localStorage.getItem("jwt");
  const res = await fetch("/api/notifications/preferences", {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error("Erreur chargement");
  return res.json();
}

async function savePrefs(body) {
  const jwt = localStorage.getItem("jwt");
  const res = await fetch("/api/notifications/preferences", {
    method: "PUT",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Erreur sauvegarde");
  return res.json();
}

const C = {
  green: "#9FB878", greenLight: "#f5f6ec", greenMid: "#dfe0c0", greenDark: "#5a6332",
  pink: "#d4538a", pinkLight: "#fce7f3", pinkMid: "#f4b8d4",
  blue: "#5a8ac4", blueLight: "#eaf2fb",
  bg: "#f6f6f2", card: "#ffffff",
  text: "#2d2d2a", textMuted: "#6e6e68", textLight: "#aaaaaa",
  border: "#e8e8e0", shadow: "0 2px 8px rgba(0,0,0,0.05)",
};

function Toggle({ checked, onChange, color = C.green }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: "52px", height: "28px", borderRadius: "999px",
        background: checked ? color : "#d1d5db",
        position: "relative", cursor: "pointer",
        transition: "background 0.25s", flexShrink: 0,
        boxShadow: checked ? `0 0 0 3px ${color}30` : "none",
      }}
    >
      <div style={{
        width: "22px", height: "22px", borderRadius: "50%",
        background: "#fff", position: "absolute", top: "3px",
        left: checked ? "27px" : "3px",
        transition: "left 0.25s",
        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
      }} />
    </div>
  );
}

function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div style={{
      position: "fixed", bottom: "28px", left: "50%",
      transform: "translateX(-50%)",
      background: type === "error" ? "#b23a3a" : C.greenDark,
      color: "#fff", padding: "12px 24px",
      borderRadius: "999px", fontSize: "13px", fontWeight: "600",
      boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
      zIndex: 9999, pointerEvents: "none",
      animation: "fadeUp 0.3s ease",
    }}>
      {type === "error" ? "❌" : "✅"} {msg}
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
    </div>
  );
}

export default function NotificationSettingsPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState(null);
  const [enabled,      setEnabled]      = useState(true);
  const [deadlineDays, setDeadlineDays] = useState(3);

  const showToast = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    fetchPrefs()
      .then(data => {
        setEnabled(data.pushEnabled ?? data.enabled ?? true);
        setDeadlineDays(data.deadlineDays ?? 3);
      })
      .catch(() => showToast("Impossible de charger les préférences.", "error"))
      .finally(() => setLoading(false));
  }, [showToast]);

  async function handleSave() {
    setSaving(true);
    try {
      await savePrefs({ pushEnabled: enabled, emailEnabled: enabled, deadlineDays });
      showToast("Préférences sauvegardées !");
    } catch {
      showToast("Erreur lors de la sauvegarde.", "error");
    } finally {
      setSaving(false);
    }
  }

  const marks = [1, 2, 3, 5, 7, 14];

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "220px 1fr",
      minHeight: "100vh", background: C.bg,
      fontFamily: "'Segoe UI', Arial, sans-serif",
    }}>
      {/* SIDEBAR */}
      <aside style={{
        background: "#fff", borderRight: `1px solid ${C.border}`,
        padding: "24px 0", display: "flex", flexDirection: "column",
        justifyContent: "space-between", position: "sticky", top: 0,
        height: "100vh", overflowY: "auto",
        boxShadow: "2px 0 8px rgba(0,0,0,0.03)",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 20px 28px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🐝</div>
            <span style={{ fontSize: "16px", fontWeight: "700", color: C.text }}>lightproject</span>
          </div>
          <div style={{ padding: "0 12px" }}>
            {[
              { label: "Dashboard",   path: "/dashboard" },
              { label: "Mes projets", path: "/projets" },
              { label: "Mes tâches",  path: "/taches" },
              { label: "Analyse IA",  path: "/ai" },
            ].map(item => (
              <div key={item.path} onClick={() => navigate(item.path)}
                style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", cursor: "pointer", marginBottom: "3px", color: C.textMuted, borderLeft: "3px solid transparent", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = C.greenLight; e.currentTarget.style.color = C.greenDark; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textMuted; }}
              >{item.label}</div>
            ))}
          </div>
          <div style={{ height: "1px", background: C.border, margin: "16px" }} />
          <div style={{ padding: "0 12px" }}>
            <p style={{ fontSize: "10px", color: C.textLight, textTransform: "uppercase", letterSpacing: "1px", padding: "0 14px", margin: "0 0 6px" }}>Compte</p>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.textMuted, cursor: "pointer", marginBottom: "2px", transition: "background 0.15s" }}
              onClick={() => navigate("/profil")}
              onMouseEnter={e => e.currentTarget.style.background = C.greenLight}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >Mon profil</div>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", cursor: "pointer", marginBottom: "2px", display: "flex", alignItems: "center", gap: "6px", color: C.greenDark, background: C.greenLight, fontWeight: "600", borderLeft: `3px solid ${C.green}` }}>
              <span>⚙️</span> Paramètres notifications
            </div>
            <div style={{ padding: "10px 14px", borderRadius: "12px", fontSize: "13px", color: C.pink, cursor: "pointer", fontWeight: "500" }}
              onClick={() => { localStorage.removeItem("jwt"); localStorage.removeItem("user"); navigate("/"); }}
            >Déconnexion</div>
          </div>
        </div>
        <div style={{ margin: "0 16px" }}>
          <div style={{ background: C.greenLight, borderRadius: "14px", padding: "12px", display: "flex", alignItems: "center", gap: "10px", border: `1px solid ${C.greenMid}` }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: "700", color: "#fff", flexShrink: 0 }}>
              {user.name?.charAt(0)?.toUpperCase() || "A"}
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: "600", color: C.text, margin: 0 }}>{user.name || "Admin"}</p>
              <p style={{ fontSize: "11px", color: C.textMuted, margin: 0 }}>{user.isAdmin ? "Administrateur" : "Membre"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ padding: "40px 48px", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "36px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <button onClick={() => navigate("/dashboard")} style={{ background: C.greenLight, border: `1px solid ${C.greenMid}`, borderRadius: "10px", padding: "8px 14px", fontSize: "13px", color: C.greenDark, cursor: "pointer", fontWeight: "600" }}>
              ← Retour
            </button>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: "700", color: C.text, margin: 0 }}>Paramètres de notifications</h1>
              <p style={{ fontSize: "12px", color: C.textMuted, margin: "4px 0 0" }}>Gérez comment et quand vous recevez des alertes</p>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving || loading} style={{
            background: saving ? C.greenMid : C.green, color: "#fff", border: "none",
            padding: "11px 28px", borderRadius: "999px", fontSize: "14px", fontWeight: "700",
            cursor: saving ? "not-allowed" : "pointer", boxShadow: `0 4px 14px ${C.greenMid}`,
          }}>
            {saving ? "⏳ Sauvegarde…" : "💾 Sauvegarder"}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px", color: C.textLight }}>Chargement…</div>
        ) : (
          <div style={{ maxWidth: "560px", display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* Carte 1 : ON/OFF global */}
            <div style={{
              background: enabled ? `linear-gradient(135deg, ${C.greenLight}, #fff)` : "#fafaf8",
              borderRadius: "20px", border: `1.5px solid ${enabled ? C.greenMid : C.border}`,
              padding: "28px 32px", boxShadow: C.shadow, transition: "all 0.3s",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: enabled ? C.green : "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", transition: "background 0.3s", flexShrink: 0 }}>
                    {enabled ? "🔔" : "🔕"}
                  </div>
                  <div>
                    <p style={{ fontSize: "16px", fontWeight: "700", color: C.text, margin: 0 }}>Notifications</p>
                    <p style={{ fontSize: "12px", color: C.textMuted, margin: "3px 0 0" }}>
                      {enabled ? "Vous recevez les alertes push et emails" : "Toutes les notifications sont désactivées"}
                    </p>
                  </div>
                </div>
                <Toggle checked={enabled} onChange={setEnabled} color={C.green} />
              </div>

              {enabled && (
                <div style={{ marginTop: "20px", paddingTop: "18px", borderTop: `1px solid ${C.greenMid}`, display: "flex", gap: "12px" }}>
                  {[
                    { icon: "🔔", label: "Push",     desc: "Temps réel" },
                    { icon: "📧", label: "Email",    desc: "Digest quotidien" },
                    { icon: "🚨", label: "Critique", desc: "Immédiat" },
                  ].map(item => (
                    <div key={item.label} style={{ flex: 1, background: "rgba(255,255,255,0.7)", borderRadius: "12px", padding: "12px", border: `1px solid ${C.greenMid}`, textAlign: "center" }}>
                      <div style={{ fontSize: "20px", marginBottom: "4px" }}>{item.icon}</div>
                      <p style={{ fontSize: "12px", fontWeight: "700", color: C.greenDark, margin: 0 }}>{item.label}</p>
                      <p style={{ fontSize: "10px", color: C.textMuted, margin: "2px 0 0" }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Carte 2 : Slider deadline */}
            {enabled && (
              <div style={{ background: C.card, borderRadius: "20px", border: `1.5px solid ${C.border}`, padding: "28px 32px", boxShadow: C.shadow }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px" }}>
                  <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: C.blueLight, border: `1px solid #c5daf5`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", flexShrink: 0 }}>📅</div>
                  <div>
                    <p style={{ fontSize: "16px", fontWeight: "700", color: C.text, margin: 0 }}>Rappel d'échéance</p>
                    <p style={{ fontSize: "12px", color: C.textMuted, margin: "3px 0 0" }}>Combien de jours avant la deadline recevoir une alerte ?</p>
                  </div>
                </div>

                <div style={{ textAlign: "center", marginBottom: "20px" }}>
                  <div style={{ display: "inline-flex", alignItems: "baseline", gap: "6px", background: C.greenLight, border: `2px solid ${C.greenMid}`, borderRadius: "16px", padding: "12px 28px" }}>
                    <span style={{ fontSize: "48px", fontWeight: "800", color: C.greenDark, lineHeight: 1 }}>{deadlineDays}</span>
                    <span style={{ fontSize: "16px", fontWeight: "600", color: C.textMuted }}>jour{deadlineDays > 1 ? "s" : ""}</span>
                  </div>
                  <p style={{ fontSize: "12px", color: C.textMuted, marginTop: "8px" }}>
                    Alerte envoyée <strong>{deadlineDays} jour{deadlineDays > 1 ? "s" : ""}</strong> avant l'échéance
                  </p>
                </div>

                <input type="range" min={1} max={14} value={deadlineDays}
                  onChange={e => setDeadlineDays(Number(e.target.value))}
                  style={{ width: "100%", accentColor: C.green, cursor: "pointer", marginBottom: "12px", height: "6px" }}
                />

                <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
                  {marks.map(m => (
                    <button key={m} onClick={() => setDeadlineDays(m)} style={{
                      flex: 1, padding: "8px 0", borderRadius: "10px", fontSize: "12px", fontWeight: "700",
                      cursor: "pointer", transition: "all 0.15s", border: "none",
                      background: deadlineDays === m ? C.green : C.greenLight,
                      color: deadlineDays === m ? "#fff" : C.greenDark,
                      boxShadow: deadlineDays === m ? `0 2px 8px ${C.greenMid}` : "none",
                    }}>{m}j</button>
                  ))}
                </div>
              </div>
            )}

            {/* Carte 3 : Planification */}
            {enabled && (
              <div style={{ background: C.blueLight, borderRadius: "16px", padding: "18px 22px", border: `1px solid #c5daf5`, display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span style={{ fontSize: "20px", flexShrink: 0 }}>ℹ️</span>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: "700", color: C.blue, margin: "0 0 8px" }}>Planification des envois</p>
                  <div style={{ fontSize: "12px", color: C.textMuted, lineHeight: 2 }}>
                    <div>🌅 Alertes retard + deadline → <strong>chaque matin à 08h00</strong></div>
                    <div>🌙 Résumé projet → <strong>chaque soir à 23h00</strong></div>
                    <div>📊 Rapport hebdomadaire → <strong>lundi à 08h00</strong></div>
                    <div>🚨 Alertes critiques → <strong>immédiatement</strong></div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </main>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}