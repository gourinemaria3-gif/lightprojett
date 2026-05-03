import { useState, useEffect } from "react";

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      setWasOffline(true);
      setTimeout(() => setWasOffline(false), 5000);
    }
    function handleOffline() {
      setIsOnline(false);
      setVisible(true);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) { setVisible(true); return; }
    if (wasOffline) {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [isOnline, wasOffline]);

  if (!visible) return null;

  const base = {
    position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 20px", fontSize: "13px", fontWeight: 600,
    fontFamily: "'Segoe UI', Arial, sans-serif",
    boxShadow: "0 -2px 16px rgba(0,0,0,0.10)",
  };

  if (!isOnline) {
    return (
      <div style={{ ...base, background: "#b23a3a", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span>📡</span>
          <div>Vous êtes hors ligne — vos modifications seront synchronisées à la reconnexion.</div>
        </div>
        <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: "999px", padding: "3px 10px", fontSize: "11px" }}>
          Mode hors ligne actif
        </span>
      </div>
    );
  }

  if (wasOffline) {
    return (
      <div style={{ ...base, background: "#9FB878", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span>✅</span>
          <div>Connexion rétablie — synchronisation en cours…</div>
        </div>
      </div>
    );
  }

  return null;
}