import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchNotifications,
  fetchNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearReadNotifications,
} from "../services/api";

// ──────────────────────────────────────────────────────────────────────────────
//  Config par type de notification
// ──────────────────────────────────────────────────────────────────────────────
const NOTIF_CONFIG = {
  assigned:     { icon: "👤", color: "#A8D0E6", label: "Assignée" },
  due_soon:     { icon: "🔔", color: "#F8E9A1", label: "Échéance proche" },
  overdue:      { icon: "⚠️", color: "#F76C6C", label: "En retard" },
  blocked:      { icon: "🔒", color: "#F76C6C", label: "Bloquée" },
  unblocked:    { icon: "✅", color: "#6dc87a", label: "Débloquée" },
  danger:       { icon: "🚨", color: "#F76C6C", label: "Danger" },
  budget_alert: { icon: "💸", color: "#F8E9A1", label: "Budget" },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min  = Math.floor(diff / 60000);
  const h    = Math.floor(diff / 3600000);
  const d    = Math.floor(diff / 86400000);
  if (min < 1)  return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  if (h < 24)   return `Il y a ${h}h`;
  if (d < 7)    return `Il y a ${d}j`;
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

// ──────────────────────────────────────────────────────────────────────────────
//  Composant principal
// ──────────────────────────────────────────────────────────────────────────────
export default function NotificationBell() {
  const [open,    setOpen]    = useState(false);
  const [notifs,  setNotifs]  = useState([]);
  const [count,   setCount]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState("all"); // "all" | "unread"
  const ref = useRef(null);

  // Ferme si clic extérieur
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Charge le compteur toutes les 30 secondes
  const loadCount = useCallback(async () => {
    try {
      const c = await fetchNotificationCount();
      setCount(c);
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => {
    loadCount();
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, [loadCount]);

  // Charge la liste quand on ouvre
  const loadNotifs = useCallback(async () => {
  setLoading(true);
  try {
    const data = await fetchNotifications({ unreadOnly: filter === "unread" });
    // ✅ Extraire le tableau notifications de l'objet retourné
    setNotifs(data.notifications ?? []);
  } catch { /* silencieux */ }
  finally { setLoading(false); }
}, [filter]);

  useEffect(() => {
    if (open) loadNotifs();
  }, [open, loadNotifs]);

  async function handleMarkRead(id) {
    await markNotificationRead(id);
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, is_read: 1 } : n));
    setCount((c) => Math.max(0, c - 1));
  }

  async function handleMarkAll() {
    await markAllNotificationsRead();
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setCount(0);
  }

  async function handleDelete(id, wasUnread) {
    await deleteNotification(id);
    setNotifs((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setCount((c) => Math.max(0, c - 1));
  }

  async function handleClearRead() {
    await clearReadNotifications();
    setNotifs((prev) => prev.filter((n) => n.is_read === 0));
  }

  const displayed = filter === "unread"
    ? notifs.filter((n) => n.is_read === 0)
    : notifs;

  return (
    <div ref={ref} style={{ position: "relative" }}>

      {/* ── Cloche ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position:   "relative",
          background: open ? "rgba(168,208,230,0.12)" : "rgba(168,208,230,0.06)",
          border:     "1px solid rgba(168,208,230,0.18)",
          borderRadius: "10px",
          width:  "40px",
          height: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontSize: "18px",
          transition: "background 0.2s",
        }}
        title="Notifications"
      >
        🔔
        {count > 0 && (
          <span style={{
            position:   "absolute",
            top:        "-6px",
            right:      "-6px",
            background: "#F76C6C",
            color:      "#fff",
            fontSize:   "10px",
            fontWeight: "700",
            fontFamily: "'DM Sans', sans-serif",
            borderRadius: "10px",
            minWidth:   "18px",
            height:     "18px",
            display:    "flex",
            alignItems: "center",
            justifyContent: "center",
            padding:    "0 4px",
            border:     "2px solid #16203F",
          }}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div style={{
          position:     "absolute",
          top:          "calc(100% + 10px)",
          right:        0,
          width:        "380px",
          maxHeight:    "520px",
          background:   "#1a2540",
          border:       "1px solid rgba(168,208,230,0.15)",
          borderRadius: "14px",
          boxShadow:    "0 16px 48px rgba(0,0,0,0.5)",
          display:      "flex",
          flexDirection:"column",
          overflow:     "hidden",
          zIndex:       9999,
          fontFamily:   "'DM Sans', sans-serif",
        }}>

          {/* Header dropdown */}
          <div style={{
            padding:        "16px 18px 12px",
            borderBottom:   "1px solid rgba(255,255,255,0.07)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            flexShrink:     0,
          }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>
              Notifications {count > 0 && (
                <span style={{
                  background:   "#F76C6C",
                  color:        "#fff",
                  fontSize:     11,
                  borderRadius: "10px",
                  padding:      "1px 7px",
                  marginLeft:   6,
                }}>{count}</span>
              )}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {count > 0 && (
                <button onClick={handleMarkAll} style={ghostBtn("#A8D0E6")}>
                  Tout lire
                </button>
              )}
              <button onClick={handleClearRead} style={ghostBtn("#F76C6C")}>
                Vider
              </button>
            </div>
          </div>

          {/* Filtres */}
          <div style={{
            display:    "flex",
            gap:        4,
            padding:    "10px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}>
            {["all", "unread"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background:   filter === f ? "rgba(168,208,230,0.15)" : "transparent",
                  border:       `1px solid ${filter === f ? "rgba(168,208,230,0.35)" : "transparent"}`,
                  borderRadius: "7px",
                  color:        filter === f ? "#A8D0E6" : "rgba(255,255,255,0.4)",
                  fontSize:     12,
                  fontWeight:   600,
                  padding:      "4px 12px",
                  cursor:       "pointer",
                  fontFamily:   "'DM Sans', sans-serif",
                  transition:   "all 0.15s",
                }}
              >
                {f === "all" ? "Toutes" : "Non lues"}
              </button>
            ))}
          </div>

          {/* Liste */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading ? (
              <div style={{ padding: "32px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                Chargement…
              </div>
            ) : displayed.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                  {filter === "unread" ? "Aucune notification non lue." : "Aucune notification."}
                </div>
              </div>
            ) : (
              displayed.map((n) => {
                const cfg = NOTIF_CONFIG[n.type] || { icon: "📌", color: "#A8D0E6" };
                return (
                  <div
                    key={n.id}
                    onClick={() => n.is_read === 0 && handleMarkRead(n.id)}
                    style={{
                      display:      "flex",
                      alignItems:   "flex-start",
                      gap:          10,
                      padding:      "13px 16px",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      background:   n.is_read === 0 ? "rgba(168,208,230,0.04)" : "transparent",
                      cursor:       n.is_read === 0 ? "pointer" : "default",
                      transition:   "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (n.is_read === 0) e.currentTarget.style.background = "rgba(168,208,230,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = n.is_read === 0
                        ? "rgba(168,208,230,0.04)"
                        : "transparent";
                    }}
                  >
                    {/* Icône */}
                    <div style={{
                      width:          34,
                      height:         34,
                      borderRadius:   "9px",
                      background:     cfg.color + "18",
                      border:         `1px solid ${cfg.color}33`,
                      display:        "flex",
                      alignItems:     "center",
                      justifyContent: "center",
                      fontSize:       15,
                      flexShrink:     0,
                    }}>
                      {cfg.icon}
                    </div>

                    {/* Contenu */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize:   12,
                        fontWeight: 600,
                        color:      cfg.color,
                        marginBottom: 3,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}>
                        {cfg.label}
                        {n.is_read === 0 && (
                          <span style={{
                            display:      "inline-block",
                            width:        6,
                            height:       6,
                            borderRadius: "50%",
                            background:   "#F76C6C",
                            marginLeft:   6,
                            verticalAlign: "middle",
                          }} />
                        )}
                      </div>
                      <div style={{
                        fontSize:   13,
                        color:      n.is_read === 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)",
                        lineHeight: 1.5,
                        wordBreak:  "break-word",
                      }}>
                        {n.message}
                      </div>
                      <div style={{
                        fontSize:  11,
                        color:     "rgba(255,255,255,0.25)",
                        marginTop: 5,
                      }}>
                        {timeAgo(n.created_at)}
                      </div>
                    </div>

                    {/* Supprimer */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(n.id, n.is_read === 0); }}
                      style={{
                        background:   "none",
                        border:       "none",
                        color:        "rgba(255,255,255,0.2)",
                        cursor:       "pointer",
                        fontSize:     14,
                        padding:      "2px 4px",
                        borderRadius: "4px",
                        flexShrink:   0,
                        transition:   "color 0.15s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = "#F76C6C"}
                      onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.2)"}
                      title="Supprimer"
                    >✕</button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer lien paramètres */}
          <div style={{
            padding:      "12px 18px",
            borderTop:    "1px solid rgba(255,255,255,0.07)",
            textAlign:    "center",
            flexShrink:   0,
          }}>
            <button
              onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("navigate", { detail: "settings" })); }}
              style={{
                background:   "none",
                border:       "none",
                color:        "rgba(255,255,255,0.35)",
                fontSize:     12,
                cursor:       "pointer",
                fontFamily:   "'DM Sans', sans-serif",
                transition:   "color 0.15s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#A8D0E6"}
              onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.35)"}
            >
              ⚙️ Paramètres de notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper style bouton ghost
function ghostBtn(color) {
  return {
    background:   "transparent",
    border:       `1px solid ${color}44`,
    borderRadius: "7px",
    color:        color,
    fontSize:     11,
    fontWeight:   600,
    padding:      "3px 10px",
    cursor:       "pointer",
    fontFamily:   "'DM Sans', sans-serif",
    transition:   "background 0.15s",
  };
}