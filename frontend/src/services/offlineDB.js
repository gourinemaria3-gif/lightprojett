/**
 * offlineDB.js
 * ─────────────────────────────────────────────────────────────
 * Wrapper IndexedDB pour le stockage local des données offline.
 *
 * Stores :
 *   • offlineData  — cache des entités (projets, tâches, membres…)
 *   • syncQueue    — file d'attente des mutations à rejouer
 *
 * Toutes les fonctions sont async/Promise.
 */

const DB_NAME    = "lp-sync-db";
const DB_VERSION = 1;

// ──────────────────────────────────────────────────────────────
//  Ouverture / initialisation
// ──────────────────────────────────────────────────────────────
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      /* Cache des données API */
      if (!db.objectStoreNames.contains("offlineData")) {
        const store = db.createObjectStore("offlineData", { keyPath: "key" });
        store.createIndex("entity",    "entity",    { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      /* File d'attente des mutations */
      if (!db.objectStoreNames.contains("syncQueue")) {
        const store = db.createObjectStore("syncQueue", { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("status",    "status",    { unique: false });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ──────────────────────────────────────────────────────────────
//  Helpers de transaction
// ──────────────────────────────────────────────────────────────
async function txGet(storeName, key) {
  const db    = await openDB();
  const tx    = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  return new Promise((res, rej) => {
    const req   = store.get(key);
    req.onsuccess = (e) => res(e.target.result ?? null);
    req.onerror   = (e) => rej(e.target.error);
  });
}

async function txGetAll(storeName, indexName = null, indexValue = null) {
  const db    = await openDB();
  const tx    = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);

  return new Promise((res, rej) => {
    const source = indexName ? store.index(indexName) : store;
    const req    = indexValue !== null
      ? source.getAll(IDBKeyRange.only(indexValue))
      : source.getAll();
    req.onsuccess = (e) => res(e.target.result ?? []);
    req.onerror   = (e) => rej(e.target.error);
  });
}

async function txPut(storeName, value) {
  const db    = await openDB();
  const tx    = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  return new Promise((res, rej) => {
    const req   = store.put(value);
    req.onsuccess = (e) => res(e.target.result);
    req.onerror   = (e) => rej(e.target.error);
  });
}

async function txDelete(storeName, key) {
  const db    = await openDB();
  const tx    = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  return new Promise((res, rej) => {
    const req   = store.delete(key);
    req.onsuccess = () => res();
    req.onerror   = (e) => rej(e.target.error);
  });
}

// ──────────────────────────────────────────────────────────────
//  offlineData — cache des entités
// ──────────────────────────────────────────────────────────────

/**
 * Sauvegarde ou met à jour une entrée dans le cache local.
 * @param {string} entity  — ex: "projects", "tasks", "members"
 * @param {string} key     — clé unique ex: "projects:all", "tasks:42"
 * @param {*}      data    — données à stocker
 */
export async function saveOfflineData(entity, key, data) {
  await txPut("offlineData", {
    key,
    entity,
    data,
    updatedAt: Date.now(),
  });
}

/**
 * Récupère une entrée du cache local.
 * @returns {*} données ou null
 */
export async function getOfflineData(key) {
  const row = await txGet("offlineData", key);
  return row ? row.data : null;
}

/**
 * Récupère toutes les entrées d'une entité.
 * @param {string} entity  ex: "tasks"
 */
export async function getAllOfflineData(entity) {
  const rows = await txGetAll("offlineData", "entity", entity);
  return rows.map((r) => r.data);
}

/**
 * Supprime une entrée du cache.
 */
export async function deleteOfflineData(key) {
  await txDelete("offlineData", key);
}

/**
 * Vide tout le cache d'une entité (ex: quand on se reconnecte).
 */
export async function clearOfflineEntity(entity) {
  const rows = await txGetAll("offlineData", "entity", entity);
  for (const row of rows) {
    await txDelete("offlineData", row.key);
  }
}

// ──────────────────────────────────────────────────────────────
//  syncQueue — file d'attente des mutations
// ──────────────────────────────────────────────────────────────

/**
 * Ajoute une mutation à la file d'attente.
 * @param {object} opts
 *   url, method, body, description (texte lisible par l'utilisateur)
 */
export async function enqueueMutation({ url, method, body, description = "" }) {
  const entry = {
    id:          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url,
    method,
    body:        body ? JSON.stringify(body) : null,
    description,
    status:      "pending",  // pending | done | error
    timestamp:   Date.now(),
    retries:     0,
  };
  await txPut("syncQueue", entry);
  return entry.id;
}

/**
 * Retourne toutes les mutations en attente, triées chronologiquement.
 */
export async function getPendingMutations() {
  const all = await txGetAll("syncQueue", "status", "pending");
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Retourne le nombre de mutations en attente.
 */
export async function getPendingCount() {
  const pending = await getPendingMutations();
  return pending.length;
}

/**
 * Marque une mutation comme traitée (succès).
 */
export async function markMutationDone(id) {
  const entry = await txGet("syncQueue", id);
  if (entry) await txPut("syncQueue", { ...entry, status: "done" });
}

/**
 * Marque une mutation en erreur.
 */
export async function markMutationError(id, errorMessage = "") {
  const entry = await txGet("syncQueue", id);
  if (entry) {
    await txPut("syncQueue", {
      ...entry,
      status:  "error",
      retries: (entry.retries || 0) + 1,
      error:   errorMessage,
    });
  }
}

/**
 * Supprime les mutations terminées ou en erreur (nettoyage).
 */
export async function clearCompletedMutations() {
  const all = await txGetAll("syncQueue");
  for (const entry of all) {
    if (entry.status === "done" || entry.status === "error") {
      await txDelete("syncQueue", entry.id);
    }
  }
}

/**
 * Retourne toutes les mutations (pour l'UI de debug).
 */
export async function getAllMutations() {
  return txGetAll("syncQueue");
}

// ──────────────────────────────────────────────────────────────
//  Helpers haut niveau — mise en cache des entités métier
// ──────────────────────────────────────────────────────────────

/** Sauvegarde la liste complète des projets */
export async function cacheProjects(projects) {
  await saveOfflineData("projects", "projects:all", projects);
}

/** Récupère la liste des projets depuis le cache */
export async function getCachedProjects() {
  return getOfflineData("projects:all");
}

/** Sauvegarde les tâches d'un projet */
export async function cacheTasks(projectId, tasks) {
  await saveOfflineData("tasks", `tasks:${projectId}`, tasks);
}

/** Récupère les tâches d'un projet depuis le cache */
export async function getCachedTasks(projectId) {
  return getOfflineData(`tasks:${projectId}`);
}

/** Met à jour une seule tâche dans le cache (optimistic update) */
export async function updateCachedTask(projectId, taskId, patch) {
  const tasks = await getCachedTasks(projectId);
  if (!tasks) return;
  const updated = tasks.map((t) =>
    String(t.id) === String(taskId) ? { ...t, ...patch } : t
  );
  await cacheTasks(projectId, updated);
}

/** Sauvegarde les membres d'un projet */
export async function cacheMembers(projectId, members) {
  await saveOfflineData("members", `members:${projectId}`, members);
}

/** Récupère les membres d'un projet depuis le cache */
export async function getCachedMembers(projectId) {
  return getOfflineData(`members:${projectId}`);
}

/** Sauvegarde les stats d'un projet */
export async function cacheStats(projectId, stats) {
  await saveOfflineData("stats", `stats:${projectId}`, stats);
}

/** Récupère les stats d'un projet depuis le cache */
export async function getCachedStats(projectId) {
  return getOfflineData(`stats:${projectId}`);
}

/** Sauvegarde le dashboard (projets + stats globales) */
export async function cacheDashboard(data) {
  await saveOfflineData("dashboard", "dashboard:main", data);
}

/** Récupère le dashboard depuis le cache */
export async function getCachedDashboard() {
  return getOfflineData("dashboard:main");
}
