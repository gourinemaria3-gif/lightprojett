"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — syncProjectStats.js  (v5)
//
//  CORRECTION vs v4 :
//    3. aiSummary persisté avec stats.explanation (la valeur fraîche)
//       Avant : meta.ai_summary || null → on réécrivait l'ancienne valeur
//       en DB, donc l'explication affichée dans le frontend était toujours
//       obsolète ("aucun signal d'alerte" même avec score > 30).
// ══════════════════════════════════════════════════════════════════════════════

const { getTasks }            = require("./openproject");
const { computeProjectStats } = require("./riskAndProgress");
const {
  db,
  getAllProjectsMeta,
  getProjectMeta,
  upsertProjectMeta,
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

  const stats = computeProjectStats(tasks, meta, taskExtensions);

  upsertProjectMeta(projectId, {
    startDate:         meta.start_date   || null,
    endDate:           meta.end_date     || null,
    workload:          meta.workload     || null,
    budgetTotal:       meta.budget_total || null,
    // ✅ CORRECTION 3 : on persiste stats.explanation (valeur fraîche)
    // Avant : meta.ai_summary || null → l'explication n'était jamais mise à jour
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