/**
 * syncManager.js
 * Gère la synchronisation des mutations offline vers le serveur.
 */

import {
  getPendingMutations,
  markMutationDone,
  markMutationError,
  clearCompletedMutations,
  getPendingCount,
} from "./offlineDB";

// ── État interne ──────────────────────────────────────────────
let _isSyncing      = false;
let _onSyncStart    = null;
let _onSyncProgress = null;
let _onSyncComplete = null;

export function configureSyncCallbacks({
  onSyncStart    = null,
  onSyncProgress = null,
  onSyncComplete = null,
} = {}) {
  _onSyncStart    = onSyncStart;
  _onSyncProgress = onSyncProgress;
  _onSyncComplete = onSyncComplete;
}

// ── Synchronisation principale ────────────────────────────────
export async function syncPendingMutations() {
  if (_isSyncing)        return { success: 0, failed: 0, skipped: 0 };
  if (!navigator.onLine) return { success: 0, failed: 0, skipped: 0 };

  const pending = await getPendingMutations();
  if (pending.length === 0) return { success: 0, failed: 0, skipped: 0 };

  _isSyncing = true;
  _onSyncStart?.();

  const results = { success: 0, failed: 0, skipped: 0 };
  let done = 0;

  for (const mutation of pending) {
    try {
      const jwt  = localStorage.getItem("jwt");
      const init = {
        method:  mutation.method,
        headers: {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
      };
      if (mutation.body) init.body = mutation.body;

      const response = await fetch(mutation.url, init);

      if (response.ok || response.status === 409) {
        await markMutationDone(mutation.id);
        results.success++;
        console.log(`[Sync] OK ${mutation.method} ${mutation.url}`);
      } else if (response.status >= 400 && response.status < 500) {
        await markMutationError(mutation.id, `HTTP ${response.status}`);
        results.failed++;
        console.warn(`[Sync] Erreur ${response.status} ${mutation.url}`);
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.skipped += pending.length - done;
      console.warn("[Sync] Réseau perdu :", err.message);
      break;
    }

    done++;
    _onSyncProgress?.(done, pending.length);
  }

  await clearCompletedMutations();

  _isSyncing = false;
  _onSyncComplete?.(results);

  // Notifie le Service Worker
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "FORCE_SYNC" });
  }

  return results;
}

// ── Initialisation automatique ────────────────────────────────
let _initialized = false;

export function initSyncManager(callbacks = {}) {
  if (_initialized) return;
  _initialized = true;

  configureSyncCallbacks(callbacks);

  window.addEventListener("online", () => {
    console.log("[Sync] Connexion rétablie → synchronisation…");
    setTimeout(syncPendingMutations, 1000);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SYNC_COMPLETE") {
        console.log("[Sync SW] Synchronisation SW terminée");
        _onSyncComplete?.({ swSync: true });
      }
    });
  }

  if (navigator.onLine) {
    setTimeout(syncPendingMutations, 2000);
  }
}

export async function pendingCount() {
  return getPendingCount();
}

export function isSyncing() {
  return _isSyncing;
}
