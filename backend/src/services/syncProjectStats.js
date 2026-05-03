"use strict";

const { getTasks }            = require("./openproject");
const { computeProjectStats } = require("./riskAndProgress");
const {
  db,
  getAllProjectsMeta,
  getProjectMeta,
  upsertProjectMeta,
  setAssigneeOpId,
} = require("../database/db");

function getTaskExtensionsForTaskIds(taskIds) {
  if (!taskIds || taskIds.length === 0) return [];
  const placeholders = taskIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT op_task_id, is_blocked FROM task_extensions WHERE op_task_id IN (${placeholders})`
    )
    .all(...taskIds);
}

// ── NOUVEAU : met à jour assignee_op_id dans task_extensions ─────────────────
//  Sans ça, les membres ne peuvent jamais fixer leur taux horaire (403).
//  On insère la ligne si elle n'existe pas, puis on met à jour l'assignee.
// ─────────────────────────────────────────────────────────────────────────────
function syncTaskExtensions(tasks, projectId) {
  const upsertExt = db.prepare(`
    INSERT INTO task_extensions (op_task_id, op_project_id, is_blocked)
    VALUES (?, ?, 0)
    ON CONFLICT(op_task_id) DO UPDATE SET
      op_project_id = COALESCE(excluded.op_project_id, op_project_id)
  `);

  const runAll = db.transaction(() => {
    for (const task of tasks) {
      upsertExt.run(Number(task.id), Number(projectId));

      const assigneeHref = task._links?.assignee?.href;
      const assigneeId   = assigneeHref
        ? Number(assigneeHref.split("/").pop())
        : null;

      if (assigneeId && !isNaN(assigneeId)) {
        setAssigneeOpId(Number(task.id), assigneeId);
      }
    }
  });

  runAll();
}

async function syncOneProject(projectId, opToken) {
  let tasks = [];
  try {
    tasks = await getTasks(projectId, opToken);
  } catch (err) {
    console.warn(`[syncStats] Impossible de charger les tâches du projet ${projectId}:`, err.message);
    return null;
  }

  const taskIds        = tasks.map(t => Number(t.id));
  const taskExtensions = getTaskExtensionsForTaskIds(taskIds);
  const meta           = getProjectMeta(projectId) || {};

  // ── FIX assignee_op_id — doit tourner AVANT computeProjectStats ──────────
  //  computeProjectStats n'a pas besoin de l'assignee, mais le fix doit
  //  être fait le plus tôt possible pour que le prochain appel budget/rate
  //  trouve les bonnes données.
  // ─────────────────────────────────────────────────────────────────────────
  try {
    syncTaskExtensions(tasks, projectId);
  } catch (err) {
    // Non bloquant — on continue même si ça échoue
    console.warn(`[syncStats] syncTaskExtensions échouée pour projet ${projectId}:`, err.message);
  }

  const stats = computeProjectStats(tasks, meta, taskExtensions);

  upsertProjectMeta(projectId, {
    startDate:         meta.start_date   || null,
    endDate:           meta.end_date     || null,
    workload:          meta.workload     || null,
    budgetTotal:       meta.budget_total || null,
    aiSummary:         stats.explanation,
    progress:          stats.progress,
    riskScore:         stats.riskScore,
    lateTasks:         stats.lateTasks,
    blockedTasks:      stats.blockedTasks,
    estimatesComplete: stats.estimatesComplete,
    missingEstimates:  stats.missingEstimates,
    riskIsPartial:     stats.isPartial,
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[syncStats] Projet ${projectId} → progress=${stats.progress}%` +
      ` (${stats.estimatesComplete ? "pondéré heures" : `simplifié — ${stats.missingEstimates} tâche(s) sans estimation`})` +
      ` | risk=${stats.riskScore}/100${stats.isPartial ? " [partiel]" : ""}`
    );
    console.log(`[syncStats] Explication : ${stats.explanation}`);
    if (stats.debug) {
      const d = stats.debug;
      console.log(
        `[syncStats] Scores : A(retard)=${d.scoreA}/40 | B(bloqué)=${d.scoreB}/30 | C(progress)=${d.scoreC}/30`
      );
      console.log(
        `[syncStats] Détails : ${d.activeTasks} tâches actives | ${d.lateCount} en retard | ${d.blockedNotLate} bloquées | today=${d.today}`
      );
    }
  }

  return stats;
}

async function syncAllProjects(opToken) {
  const allMeta = getAllProjectsMeta();
  console.log(`[syncStats] Synchronisation de ${allMeta.length} projet(s)...`);

  for (const meta of allMeta) {
    try {
      await syncOneProject(meta.op_project_id, opToken);
    } catch (err) {
      console.error(`[syncStats] Erreur projet ${meta.op_project_id}:`, err.message);
    }
  }

  console.log("[syncStats] Synchronisation terminée.");
}

module.exports = { syncOneProject, syncAllProjects };