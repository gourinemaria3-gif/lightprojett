/**
 * useOnlineStatus.js
 * Hook React qui expose l'état de la connexion réseau
 * et le nombre de mutations en attente.
 */

import { useState, useEffect, useRef } from "react";
import { getPendingCount } from "../services/offlineDB";

// ─────────────────────────────────────────────────────────────
//  useOnlineStatus
// ─────────────────────────────────────────────────────────────
export function useOnlineStatus() {
  const [isOnline,   setIsOnline]   = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const prevOnline = useRef(navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      if (!prevOnline.current) {
        setWasOffline(true);
        setTimeout(() => setWasOffline(false), 5000);
      }
      prevOnline.current = true;
    }

    function handleOffline() {
      setIsOnline(false);
      prevOnline.current = false;
    }

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline, wasOffline };
}

// ─────────────────────────────────────────────────────────────
//  useOfflineQueue — nombre de mutations en attente
// ─────────────────────────────────────────────────────────────
export function useOfflineQueue() {
  const [count, setCount] = useState(0);
  const { isOnline }      = useOnlineStatus();

  useEffect(() => {
    let id;

    async function refresh() {
      try {
        const n = await getPendingCount();
        setCount(n);
      } catch {}
    }

    refresh();
    const interval = isOnline ? 30_000 : 5_000;
    id = setInterval(refresh, interval);
    return () => clearInterval(id);
  }, [isOnline]);

  return count;
}