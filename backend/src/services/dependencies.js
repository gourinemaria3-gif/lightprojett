"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — dependencies.js  (v3)
//
//  CHANGEMENTS vs v2 :
//    - isTaskBlockedRecursive supprimé — remplacé par isTaskBlocked (direct)
//    - Règle clarifiée : B est bloquée si AU MOINS UNE dépendance directe
//      n'est pas terminée (isDone = false). Le retard n'entre pas en compte
//      ici — il est géré par le score de risque.
//    - recalcBlockedState simplifié (plus de cache, plus de récursivité)
//    - Tâche supprimée dans OP → non bloquante (on skip)
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

// ──────────────────────────────────────────────────────────────────────────────
//  isDone — cascade de détection (identique à riskAndProgress.js)
//  Dupliquée ici pour éviter une dépendance circulaire entre services.
// ──────────────────────────────────────────────────────────────────────────────
const DONE_STATUSES = new Set([
  "done", "closed", "finished", "resolved", "rejected",
  "terminé", "terminée", "fermé", "fermée", "completed",
  "complete", "annulé", "annulée", "cancelled", "canceled",
]);

function isDone(opTaskObject) {
  if (!opTaskObject) return false;
  if (opTaskObject.isClosed === true) return true;
  const pct = Number(opTaskObject.percentageDone ?? opTaskObject.percentComplete ?? -1);
  if (pct === 100) return true;
  const statusTitle = (
    opTaskObject._links?.status?.title ||
    opTaskObject.status?.title ||
    ""
  ).toLowerCase().trim();
  if (statusTitle && DONE_STATUSES.has(statusTitle)) return true;
  const statusHref = (opTaskObject._links?.status?.href || "").toLowerCase();
  if (statusHref && (statusHref.includes("closed") || statusHref.includes("done"))) return true;
  return false;
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
//  isTaskBlocked — RÈGLE FINALE
//
//  B est bloquée si au moins une de ses dépendances DIRECTES n'est pas
//  terminée (isDone = false).
//
//  - On ne vérifie PAS le retard ici.
//  - Si une tâche parente a été supprimée dans OP (absente de taskMap),
//    on la considère comme "done" pour ne pas bloquer indéfiniment.
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
//  recalcBlockedState — recalcule et persiste l'état bloqué d'une tâche
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

// ──────────────────────────────────────────────────────────────────────────────
//  getAllDependentsRecursive — tous les dépendants directs + indirects
// ──────────────────────────────────────────────────────────────────────────────
function getAllDependentsRecursive(taskId, visited = new Set()) {
  const result = [];
  for (const d of getDependents(taskId)) {
    if (!visited.has(d.task_op_id)) {
      visited.add(d.task_op_id);
      result.push(d.task_op_id);
      result.push(...getAllDependentsRecursive(d.task_op_id, visited));
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
//  propagateBlockingFrom
//
//  Appelée quand une tâche (changedTaskId) change de statut dans OP.
//  Recalcule l'état bloqué de tous ses dépendants (directs + indirects)
//  et envoie les notifications si l'état a changé.
// ──────────────────────────────────────────────────────────────────────────────
async function propagateBlockingFrom(changedTaskId, projectId, opToken) {
  const allDependentIds = getAllDependentsRecursive(changedTaskId);
  if (allDependentIds.length === 0) return;

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
        .catch(err => console.error("Erreur notifyTaskUnblocked:", err.message));

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
      }).catch(err => console.error("Erreur notifyTaskBlocked:", err.message));
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  buildTaskMap
// ──────────────────────────────────────────────────────────────────────────────
async function buildTaskMap(projectId, opToken) {
  const allTasks = await getTasks(projectId, opToken);
  const taskMap  = {};
  allTasks.forEach(t => { taskMap[t.id] = t; });
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