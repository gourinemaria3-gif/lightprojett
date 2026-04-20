"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — dependencies.js
//
//  CORRECTIONS :
//    1. notifyStateChange : déduplication temporelle (5 min) pour éviter
//       le flood de notifications lors de patchs rapides
//    2. Boolean(ext?.is_blocked) partout
//    3. Garantie que task_extensions existe (ensureTaskExtension)
//    4. removeDependencyWithRecalc en transaction
//    5. propagateBlockingFrom récursif (tous dépendants directs + indirects)
// ══════════════════════════════════════════════════════════════════════════════

const {
  db,
  getDependenciesOf,
  getDependents,
  setTaskBlocked,
  getTaskExtension,
  upsertTaskExtension,
  createNotification,
  getProjectManager,
  getNotifications,
} = require("../database/db");

const { getTasks } = require("./openproject");

// ──────────────────────────────────────────────────────────────────────────────
//  isDone
// ──────────────────────────────────────────────────────────────────────────────
const DONE_STATUSES = new Set([
  "done", "closed", "finished", "resolved",
  "rejected", "terminé", "terminée", "fermé", "fermée"
]);

function isDone(opTaskObject) {
  if (!opTaskObject) return false;
  if (typeof opTaskObject.isClosed === "boolean") return opTaskObject.isClosed;
  const statusTitle = opTaskObject._links?.status?.title || "";
  return DONE_STATUSES.has(statusTitle.toLowerCase());
}

// ──────────────────────────────────────────────────────────────────────────────
//  hasCycleFrom — détection de cycle via DFS
// ──────────────────────────────────────────────────────────────────────────────
function hasCycleFrom(taskId, dependsOnTaskId) {
  const visited = new Set();

  function dfs(currentId) {
    if (currentId === Number(taskId)) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);

    const deps = getDependenciesOf(currentId);
    for (const dep of deps) {
      if (dfs(Number(dep.depends_on_task_op_id))) return true;
    }
    return false;
  }

  return dfs(Number(dependsOnTaskId));
}

// ──────────────────────────────────────────────────────────────────────────────
//  isTaskBlockedRecursive — avec mémoïsation
// ──────────────────────────────────────────────────────────────────────────────
function isTaskBlockedRecursive(taskId, taskMap, visited = new Set(), cache = new Map()) {
  const id = Number(taskId);

  if (cache.has(id)) return cache.get(id);
  if (visited.has(id)) return false;
  visited.add(id);

  const deps = getDependenciesOf(id);

  let result = false;
  for (const dep of deps) {
    const depTask = taskMap[dep.depends_on_task_op_id];
    if (!depTask) { result = true; break; }
    if (!isDone(depTask)) { result = true; break; }
    if (isTaskBlockedRecursive(dep.depends_on_task_op_id, taskMap, visited, cache)) {
      result = true;
      break;
    }
  }

  cache.set(id, result);
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
//  getAllDependentsRecursive — tous les dépendants (directs + indirects)
// ──────────────────────────────────────────────────────────────────────────────
function getAllDependentsRecursive(taskId, visited = new Set()) {
  const result = [];
  const direct = getDependents(taskId);

  for (const d of direct) {
    if (!visited.has(d.task_op_id)) {
      visited.add(d.task_op_id);
      result.push(d.task_op_id);
      result.push(...getAllDependentsRecursive(d.task_op_id, visited));
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
//  ensureTaskExtension — garantit que la row existe dans task_extensions
// ──────────────────────────────────────────────────────────────────────────────
function ensureTaskExtension(taskId) {
  if (!getTaskExtension(taskId)) {
    upsertTaskExtension(taskId, { isBlocked: false });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  recalcBlockedState
// ──────────────────────────────────────────────────────────────────────────────
function recalcBlockedState(taskId, taskMap, cache = new Map()) {
  const deps = getDependenciesOf(taskId);
  ensureTaskExtension(taskId);

  if (deps.length === 0) {
    setTaskBlocked(taskId, false);
    return false;
  }

  const shouldBeBlocked = isTaskBlockedRecursive(taskId, taskMap, new Set(), cache);
  setTaskBlocked(taskId, shouldBeBlocked);
  return shouldBeBlocked;
}

// ──────────────────────────────────────────────────────────────────────────────
//  addDependencyWithRecalc — transaction : insert + recalc
// ──────────────────────────────────────────────────────────────────────────────
function addDependencyWithRecalc(taskId, dependsOnTaskId, taskMap) {
  let isBlocked = false;
  const cache   = new Map();

  const trx = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_op_id, depends_on_task_op_id)
      VALUES (?, ?)
    `).run(Number(taskId), Number(dependsOnTaskId));

    ensureTaskExtension(taskId);
    isBlocked = recalcBlockedState(taskId, taskMap, cache);
  });

  trx();
  return isBlocked;
}

// ──────────────────────────────────────────────────────────────────────────────
//  removeDependencyWithRecalc — transaction : delete + recalc
// ──────────────────────────────────────────────────────────────────────────────
function removeDependencyWithRecalc(taskId, dependsOnTaskId, taskMap) {
  let isBlocked = false;
  const cache   = new Map();

  const trx = db.transaction(() => {
    db.prepare(`
      DELETE FROM task_dependencies
      WHERE task_op_id = ? AND depends_on_task_op_id = ?
    `).run(Number(taskId), Number(dependsOnTaskId));

    ensureTaskExtension(taskId);
    isBlocked = recalcBlockedState(taskId, taskMap, cache);
  });

  trx();
  return isBlocked;
}

// ──────────────────────────────────────────────────────────────────────────────
//  propagateBlockingFrom — propagation récursive, un seul appel API
// ──────────────────────────────────────────────────────────────────────────────
async function propagateBlockingFrom(changedTaskId, projectId, opToken) {
  const allDependentIds = getAllDependentsRecursive(changedTaskId);
  if (allDependentIds.length === 0) return;

  const taskMap = await buildTaskMap(projectId, opToken);
  const cache   = new Map();

  for (const task_op_id of allDependentIds) {
    const wasBlocked   = Boolean(getTaskExtension(task_op_id)?.is_blocked);
    const isNowBlocked = recalcBlockedState(task_op_id, taskMap, cache);

    if (wasBlocked && !isNowBlocked) {
      await notifyStateChange(task_op_id, projectId, "unblocked", taskMap);
    } else if (!wasBlocked && isNowBlocked) {
      await notifyStateChange(task_op_id, projectId, "blocked", taskMap, changedTaskId);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  notifyStateChange
//
//  CORRECTION : déduplication temporelle — on ne recrée pas une notification
//  du même type pour la même tâche si une existe déjà dans les 5 dernières min.
//  Evite le flood lors de patchs rapides consécutifs.
// ──────────────────────────────────────────────────────────────────────────────
const NOTIF_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function _hasRecentNotification(opUserId, type, taskId) {
  try {
    const recent = getNotifications(opUserId, { unreadOnly: false });
    const cutoff = new Date(Date.now() - NOTIF_COOLDOWN_MS).toISOString();
    return recent.some(
      (n) =>
        n.type === type &&
        n.message.includes(`#${taskId}`) &&
        n.created_at >= cutoff
    );
  } catch {
    return false; // En cas d'erreur DB, on laisse passer la notification
  }
}

function _safeCreateNotification(opUserId, type, message, taskId) {
  if (_hasRecentNotification(opUserId, type, taskId)) return;
  try {
    createNotification(opUserId, type, message);
  } catch (err) {
    console.warn(`Erreur création notification pour user ${opUserId}:`, err.message);
  }
}

async function notifyStateChange(taskId, projectId, type, taskMap, blockedByTaskId = null) {
  try {
    const message = type === "blocked"
      ? `La tâche #${taskId} est bloquée car la tâche #${blockedByTaskId} n'est pas terminée.`
      : `La tâche #${taskId} est débloquée, toutes ses dépendances sont terminées.`;

    const notifiedIds = new Set();

    // Notifie le manager
    const manager = getProjectManager(projectId);
    if (manager) {
      _safeCreateNotification(manager.op_user_id, type, message, taskId);
      notifiedIds.add(manager.op_user_id);
    }

    // Notifie l'assignee (depuis taskMap, 0 appel API)
    const opTask       = taskMap[taskId];
    const assigneeHref = opTask?._links?.assignee?.href;
    if (assigneeHref) {
      const assigneeId = Number(assigneeHref.split("/").pop());
      if (assigneeId && !notifiedIds.has(assigneeId)) {
        _safeCreateNotification(assigneeId, type, message, taskId);
      }
    }

  } catch (err) {
    console.warn(`Erreur notification ${type} tâche #${taskId}:`, err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  buildTaskMap — charge les tâches OP une seule fois
// ──────────────────────────────────────────────────────────────────────────────
async function buildTaskMap(projectId, opToken) {
  const allTasks = await getTasks(projectId, opToken);
  const taskMap  = {};
  allTasks.forEach((t) => { taskMap[t.id] = t; });
  return taskMap;
}

module.exports = {
  hasCycleFrom,
  recalcBlockedState,
  addDependencyWithRecalc,
  removeDependencyWithRecalc,
  propagateBlockingFrom,
  buildTaskMap,
  isDone,
};