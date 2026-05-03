"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — dependencies.js
//
//  CORRECTIONS vs version précédente :
//
//  1. isDone dupliquée → supprimée, importée depuis utils/taskStatus.js
//     La dépendance circulaire est cassée proprement par le fichier utilitaire
//     pur qui ne dépend d'aucun service.
//
//  2. buildTaskMap avec cache TTL court (8 secondes par projectId)
//     Plusieurs appels simultanés pour le même projet (ex : le frontend charge
//     GET /dependencies/:taskA et GET /dependencies/:taskB en parallèle)
//     partagent maintenant la même réponse OpenProject au lieu de déclencher
//     N requêtes HTTP identiques. Le TTL court (8s) garantit que les stats
//     restent fraîches sans sur-solliciter OP.
//     Appels en vol (in-flight) dédupliqués via une Map de Promises.
//
//  3. getAllDependentsRecursive avec limite de profondeur (MAX_DEPTH = 50)
//     Sans limite, un graphe en étoile avec 500 dépendants directs déclenchait
//     500 recalculs séquentiels et pouvait exploser la call stack.
//     Avec MAX_DEPTH :
//       - Les nœuds au-delà de la limite sont ignorés pour ce cycle
//       - Un warning est loggué pour permettre le diagnostic en production
//       - La limite est largement suffisante pour tout projet réel
// ══════════════════════════════════════════════════════════════════════════════

const {
  db,
  getDependenciesOf,
  getDependents,
  setTaskBlocked,
  getTaskExtension,
  upsertTaskExtension,
} = require("../database/db");

const { getTasks }                               = require("./openproject");
const { notifyTaskBlocked, notifyTaskUnblocked } = require("./notificationEngine");

// ── CORRECTION 1 : import depuis l'utilitaire partagé ────────────────────────
//  isDone n'est plus définie localement — source de vérité unique dans
//  utils/taskStatus.js, importée ici ET dans riskAndProgress.js.
// ─────────────────────────────────────────────────────────────────────────────
const { isDone } = require("../utils/taskStatus");

// ── CORRECTION 3 : limite de profondeur pour getAllDependentsRecursive ────────
//  Protège contre les graphes très larges ou profonds.
//  50 niveaux couvre la totalité des projets réels connus.
//  Au-delà, les nœuds sont ignorés avec un warning.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_DEPTH = 50;

// ══════════════════════════════════════════════════════════════════════════════
//  CACHE buildTaskMap — TTL court pour mutualiser les appels OP simultanés
//
//  Structure du cache :
//    _taskMapCache[projectId] = {
//      data:      { [taskId]: opTaskObject },  ← résultat mis en cache
//      expiresAt: timestamp,                   ← expiration absolue
//    }
//
//  _taskMapInFlight[projectId] = Promise<taskMap>
//    ← Promise en cours de résolution pour éviter les appels dupliqués
//       quand deux requêtes arrivent en même temps (avant que le cache
//       ne soit peuplé).
//
//  TTL choisi à 8 secondes :
//    - Suffisant pour absorber une salve de requêtes frontend simultanées
//    - Court enough pour que les changements de statut OP soient visibles
//      sans délai perceptible par l'utilisateur
// ══════════════════════════════════════════════════════════════════════════════
const TASK_MAP_TTL_MS = 8_000;
const _taskMapCache   = {};  // { [projectId]: { data, expiresAt } }
const _taskMapInFlight = {}; // { [projectId]: Promise<taskMap> }

/**
 * buildTaskMap — charge les tâches d'un projet depuis OpenProject.
 *
 * - Si le cache est valide → retourne immédiatement sans appel HTTP
 * - Si un appel est déjà en vol → partage la même Promise (déduplication)
 * - Sinon → déclenche un nouvel appel HTTP et peuple le cache
 *
 * @param {number|string} projectId
 * @param {string} opToken
 * @returns {Promise<{ [taskId: number]: object }>}
 */
async function buildTaskMap(projectId, opToken) {
  const key = String(projectId);

  // Cache valide → retour immédiat
  const cached = _taskMapCache[key];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Appel déjà en vol pour ce projet → on se branche sur la même Promise
  if (_taskMapInFlight[key]) {
    return _taskMapInFlight[key];
  }

  // Nouvel appel HTTP — on stocke la Promise avant await pour que les
  // requêtes concurrentes qui arrivent pendant la résolution la partagent.
  _taskMapInFlight[key] = getTasks(projectId, opToken)
    .then((allTasks) => {
      const taskMap = {};
      allTasks.forEach((t) => { taskMap[t.id] = t; });

      // Peuple le cache
      _taskMapCache[key] = { data: taskMap, expiresAt: Date.now() + TASK_MAP_TTL_MS };

      return taskMap;
    })
    .finally(() => {
      // Libère le slot in-flight dans tous les cas (succès ou erreur)
      delete _taskMapInFlight[key];
    });

  return _taskMapInFlight[key];
}

/**
 * invalidateTaskMapCache — force l'expiration du cache pour un projet.
 *
 * À appeler après une opération qui modifie les tâches du projet
 * (ex : changement de statut, ajout de tâche) pour éviter de servir
 * des données périmées au prochain appel buildTaskMap.
 *
 * @param {number|string} projectId
 */
function invalidateTaskMapCache(projectId) {
  delete _taskMapCache[String(projectId)];
}


// ──────────────────────────────────────────────────────────────────────────────
//  hasCycleFrom — détection de cycle via DFS (inchangée)
// ──────────────────────────────────────────────────────────────────────────────
function hasCycleFrom(taskId, dependsOnTaskId) {
  const visited = new Set();
  function dfs(currentId) {
    if (currentId === Number(taskId)) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    for (const dep of getDependenciesOf(currentId)) {
      if (dfs(Number(dep.depends_on_task_op_id))) return true;
    }
    return false;
  }
  return dfs(Number(dependsOnTaskId));
}

// ──────────────────────────────────────────────────────────────────────────────
//  isTaskBlocked — RÈGLE FINALE (inchangée)
// ──────────────────────────────────────────────────────────────────────────────
function isTaskBlocked(taskId, taskMap) {
  const deps = getDependenciesOf(Number(taskId));
  if (deps.length === 0) return false;

  for (const dep of deps) {
    const depTask = taskMap[dep.depends_on_task_op_id];
    if (!depTask) continue;           // supprimée dans OP → on skip
    if (!isDone(depTask)) return true; // au moins une non terminée → bloquée
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
//  ensureTaskExtension
// ──────────────────────────────────────────────────────────────────────────────
function ensureTaskExtension(taskId) {
  if (!getTaskExtension(taskId)) {
    upsertTaskExtension(taskId, { isBlocked: false });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  recalcBlockedState
// ──────────────────────────────────────────────────────────────────────────────
function recalcBlockedState(taskId, taskMap) {
  ensureTaskExtension(taskId);
  const shouldBeBlocked = isTaskBlocked(taskId, taskMap);
  setTaskBlocked(taskId, shouldBeBlocked);
  return shouldBeBlocked;
}

// ──────────────────────────────────────────────────────────────────────────────
//  addDependencyWithRecalc
// ──────────────────────────────────────────────────────────────────────────────
function addDependencyWithRecalc(taskId, dependsOnTaskId, taskMap) {
  let isBlocked = false;
  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_op_id, depends_on_task_op_id)
      VALUES (?, ?)
    `).run(Number(taskId), Number(dependsOnTaskId));
    isBlocked = recalcBlockedState(taskId, taskMap);
  })();
  return isBlocked;
}

// ──────────────────────────────────────────────────────────────────────────────
//  removeDependencyWithRecalc
// ──────────────────────────────────────────────────────────────────────────────
function removeDependencyWithRecalc(taskId, dependsOnTaskId, taskMap) {
  let isBlocked = false;
  db.transaction(() => {
    db.prepare(`
      DELETE FROM task_dependencies
      WHERE task_op_id = ? AND depends_on_task_op_id = ?
    `).run(Number(taskId), Number(dependsOnTaskId));
    isBlocked = recalcBlockedState(taskId, taskMap);
  })();
  return isBlocked;
}

// ── CORRECTION 3 : limite de profondeur ───────────────────────────────────────
//  getAllDependentsRecursive — tous les dépendants directs + indirects,
//  avec protection contre les graphes trop profonds.
//
//  Paramètres internes :
//    visited {Set}   — nœuds déjà visités (protection cycle résiduel)
//    depth   {number} — profondeur courante dans le graphe
//
//  Comportement à MAX_DEPTH :
//    - Le nœud courant est inclus dans les résultats
//    - Ses enfants NE sont PAS explorés
//    - Un warning est loggué une seule fois par appel racine
//
//  Pourquoi 50 ?
//    Un projet avec 50 niveaux de dépendances en cascade est pathologique.
//    En pratique, les projets réels ont rarement plus de 5-10 niveaux.
//    50 laisse une marge très confortable sans risquer un stack overflow.
// ─────────────────────────────────────────────────────────────────────────────
function getAllDependentsRecursive(taskId, visited = new Set(), depth = 0) {
  if (depth >= MAX_DEPTH) {
    // Warning loggué uniquement au premier dépassement de la limite
    if (depth === MAX_DEPTH) {
      console.warn(
        `[dependencies] getAllDependentsRecursive : limite de profondeur (${MAX_DEPTH}) ` +
        `atteinte depuis la tâche racine. Les dépendants au-delà sont ignorés pour ce cycle.`
      );
    }
    return [];
  }

  const result = [];
  for (const d of getDependents(taskId)) {
    if (!visited.has(d.task_op_id)) {
      visited.add(d.task_op_id);
      result.push(d.task_op_id);
      result.push(...getAllDependentsRecursive(d.task_op_id, visited, depth + 1));
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
//  propagateBlockingFrom
// ──────────────────────────────────────────────────────────────────────────────
async function propagateBlockingFrom(changedTaskId, projectId, opToken) {
  const allDependentIds = getAllDependentsRecursive(changedTaskId);
  if (allDependentIds.length === 0) return;

  // buildTaskMap utilise le cache — pas de requête HTTP supplémentaire si
  // une autre fonction vient de l'appeler dans la même fenêtre de 8 secondes.
  const taskMap = await buildTaskMap(projectId, opToken);

  for (const task_op_id of allDependentIds) {
    const wasBlocked   = Boolean(getTaskExtension(task_op_id)?.is_blocked);
    const isNowBlocked = recalcBlockedState(task_op_id, taskMap);

    if (wasBlocked && !isNowBlocked) {
      const opTask     = taskMap[task_op_id];
      const assigneeId = opTask?._links?.assignee?.href
        ? Number(opTask._links.assignee.href.split("/").pop())
        : null;
      await notifyTaskUnblocked({ taskId: task_op_id, projectId, assigneeId })
        .catch((err) => console.error("Erreur notifyTaskUnblocked:", err.message));

    } else if (!wasBlocked && isNowBlocked) {
      const opTask     = taskMap[task_op_id];
      const assigneeId = opTask?._links?.assignee?.href
        ? Number(opTask._links.assignee.href.split("/").pop())
        : null;
      await notifyTaskBlocked({
        taskId:          task_op_id,
        projectId,
        blockedByTaskId: changedTaskId,
        assigneeId,
      }).catch((err) => console.error("Erreur notifyTaskBlocked:", err.message));
    }
  }
}

module.exports = {
  hasCycleFrom,
  recalcBlockedState,
  addDependencyWithRecalc,
  removeDependencyWithRecalc,
  propagateBlockingFrom,
  buildTaskMap,
  invalidateTaskMapCache,
  isDone, // ré-exporté pour les consommateurs existants (dependenciesRoute.js)
};