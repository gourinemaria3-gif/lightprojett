"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — budgetService.js  (v1)
//
//  Gestion du budget par projet :
//    - budget total défini par l'admin/manager
//    - coût estimé = somme(heures estimées × taux horaire membre)
//    - coût réel    = somme(heures travaillées × taux horaire membre)
//    - alertes automatiques : seuil proche (80%) et dépassement (100%)
// ══════════════════════════════════════════════════════════════════════════════

const { db, createNotification, getProjectMembers } = require("../database/db");

// ──────────────────────────────────────────────────────────────────────────────
//  CONSTANTES D'ALERTE
// ──────────────────────────────────────────────────────────────────────────────
const BUDGET_WARNING_THRESHOLD  = 0.80; // 80% → alerte "seuil proche"
const BUDGET_DANGER_THRESHOLD   = 1.00; // 100% → alerte "dépassement"

// ──────────────────────────────────────────────────────────────────────────────
//  getBudgetSummary
//
//  Calcule le résumé budgétaire complet d'un projet.
//  - budgetTotal   : depuis projects_meta.budget_total
//  - estimatedCost : somme des coûts estimés (heures estimées × taux horaire)
//  - actualCost    : somme des coûts réels   (heures travaillées × taux horaire)
//  - remaining     : budgetTotal - actualCost (null si budget non défini)
//  - consumedPct   : % consommé (null si budget non défini)
//  - status        : 'ok' | 'warning' | 'danger' | 'no_budget'
// ──────────────────────────────────────────────────────────────────────────────
function getBudgetSummary(projectId) {
  // Budget total
  const meta = db
    .prepare(`SELECT budget_total FROM projects_meta WHERE op_project_id = ?`)
    .get(projectId);

  const budgetTotal = meta?.budget_total ?? null;

  // Coût réel : somme depuis time_logs × taux horaire stocké dans time_logs
  const actualRow = db.prepare(`
    SELECT COALESCE(SUM(tl.hours_worked * COALESCE(tl.hourly_rate, pm.hourly_rate, 0)), 0) AS total
    FROM time_logs tl
    LEFT JOIN project_members pm
      ON pm.op_user_id = tl.op_user_id AND pm.op_project_id = ?
    WHERE tl.op_task_id IN (
      SELECT te.op_task_id FROM task_extensions te
    )
    AND tl.op_task_id IN (
      SELECT DISTINCT tl2.op_task_id
      FROM time_logs tl2
    )
  `).get(projectId);

  // Requête simplifiée et correcte pour le coût réel
  const actualCostRow = db.prepare(`
    SELECT COALESCE(SUM(
      tl.hours_worked * COALESCE(tl.hourly_rate, pm.hourly_rate, 0)
    ), 0) AS total
    FROM time_logs tl
    INNER JOIN project_members pm
      ON pm.op_user_id = tl.op_user_id AND pm.op_project_id = ?
  `).get(projectId);

  const actualCost = Number(actualCostRow?.total ?? 0);

  // Coût estimé : somme des coûts estimés depuis task_extensions
  // On joint avec project_members pour récupérer le taux horaire
  const estimatedCostRow = db.prepare(`
    SELECT COALESCE(SUM(te.estimated_cost), 0) AS total
    FROM task_extensions te
    WHERE te.estimated_cost IS NOT NULL
  `).get();

  // Coût estimé affiné par projet : via les work packages du projet
  // (stockés dans task_extensions avec le coût estimé calculé à partir des heures)
  const estimatedCostByProjectRow = db.prepare(`
    SELECT COALESCE(SUM(te.estimated_cost), 0) AS total
    FROM task_extensions te
    INNER JOIN (
      SELECT DISTINCT tl.op_task_id
      FROM time_logs tl
      INNER JOIN project_members pm
        ON pm.op_user_id = tl.op_user_id AND pm.op_project_id = ?
    ) task_proj ON task_proj.op_task_id = te.op_task_id
  `).get(projectId);

  const estimatedCost = Number(estimatedCostByProjectRow?.total ?? 0);

  // Calcul dérivé
  const remaining    = budgetTotal !== null ? Math.max(0, budgetTotal - actualCost) : null;
  const overrun      = budgetTotal !== null ? Math.max(0, actualCost - budgetTotal) : null;
  const consumedPct  = budgetTotal !== null && budgetTotal > 0
    ? Math.round((actualCost / budgetTotal) * 100)
    : null;

  let status = "no_budget";
  if (budgetTotal !== null) {
    if (actualCost >= budgetTotal)
      status = "danger";
    else if (actualCost >= budgetTotal * BUDGET_WARNING_THRESHOLD)
      status = "warning";
    else
      status = "ok";
  }

  return {
    projectId:     Number(projectId),
    budgetTotal,
    estimatedCost,
    actualCost,
    remaining,
    overrun,
    consumedPct,
    status,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  getBudgetByTask
//
//  Retourne le détail budgétaire par tâche pour un projet :
//  [ { taskId, estimatedCost, actualCost } ]
//  Utile pour afficher un tableau tâche par tâche dans le frontend.
// ──────────────────────────────────────────────────────────────────────────────
function getBudgetByTask(projectId) {
  return db.prepare(`
    SELECT
      tl.op_task_id                                        AS taskId,
      COALESCE(SUM(
        tl.hours_worked * COALESCE(tl.hourly_rate, pm.hourly_rate, 0)
      ), 0)                                                AS actualCost,
      MAX(te.estimated_cost)                               AS estimatedCost
    FROM time_logs tl
    INNER JOIN project_members pm
      ON pm.op_user_id = tl.op_user_id AND pm.op_project_id = ?
    LEFT JOIN task_extensions te
      ON te.op_task_id = tl.op_task_id
    GROUP BY tl.op_task_id
  `).all(projectId);
}

// ──────────────────────────────────────────────────────────────────────────────
//  getBudgetTimeline
//
//  Retourne l'évolution du coût réel jour par jour, pour afficher un graphique.
//  [ { date: "YYYY-MM-DD", dailyCost, cumulativeCost } ]
// ──────────────────────────────────────────────────────────────────────────────
function getBudgetTimeline(projectId) {
  const rows = db.prepare(`
    SELECT
      tl.logged_date                                              AS date,
      COALESCE(SUM(
        tl.hours_worked * COALESCE(tl.hourly_rate, pm.hourly_rate, 0)
      ), 0)                                                       AS dailyCost
    FROM time_logs tl
    INNER JOIN project_members pm
      ON pm.op_user_id = tl.op_user_id AND pm.op_project_id = ?
    GROUP BY tl.logged_date
    ORDER BY tl.logged_date ASC
  `).all(projectId);

  // Calcule le cumulatif
  let cumulative = 0;
  return rows.map(row => {
    cumulative += Number(row.dailyCost);
    return {
      date:           row.date,
      dailyCost:      Number(row.dailyCost),
      cumulativeCost: Math.round(cumulative * 100) / 100,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  updateEstimatedCostForTask
//
//  Recalcule et persiste le coût estimé d'une tâche en DB.
//  Appelée lors de la création/modification d'une tâche (via createproject ou tasks).
//
//  estimatedHours : heures estimées (depuis OP)
//  projectId      : pour récupérer le taux horaire du responsable
//  assigneeOpId   : op_user_id de l'assigné (peut être null)
// ──────────────────────────────────────────────────────────────────────────────
function updateEstimatedCostForTask(taskId, { estimatedHours, projectId, assigneeOpId }) {
  if (!estimatedHours || Number(estimatedHours) <= 0) return;

  let hourlyRate = 0;

  if (assigneeOpId && projectId) {
    const member = db.prepare(`
      SELECT hourly_rate FROM project_members
      WHERE op_user_id = ? AND op_project_id = ?
    `).get(assigneeOpId, projectId);
    hourlyRate = Number(member?.hourly_rate ?? 0);
  }

  const estimatedCost = Number(estimatedHours) * hourlyRate;

  db.prepare(`
    INSERT INTO task_extensions (op_task_id, estimated_cost, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(op_task_id) DO UPDATE SET
      estimated_cost = excluded.estimated_cost,
      updated_at     = excluded.updated_at
  `).run(taskId, estimatedCost);
}

// ──────────────────────────────────────────────────────────────────────────────
//  checkBudgetAlerts
//
//  Vérifie si des alertes budget doivent être envoyées (dépassement, seuil).
//  Envoie des notifications au manager et à l'admin du projet.
//
//  Logique anti-spam :
//    - On ne renvoie pas la même alerte si elle existe déjà en DB (is_read = 0)
//      pour le même projet et le même type dans les dernières 24h.
// ──────────────────────────────────────────────────────────────────────────────
async function checkBudgetAlerts(projectId) {
  const summary = getBudgetSummary(projectId);

  if (summary.status === "no_budget" || summary.status === "ok") return;

  const alertType    = summary.status === "danger" ? "budget_alert" : "budget_alert";
  const isOverrun    = summary.status === "danger";

  const message = isOverrun
    ? `⚠️ Budget dépassé : ${summary.actualCost.toFixed(2)} / ${summary.budgetTotal.toFixed(2)} (${summary.consumedPct}%)`
    : `⚠️ Budget à ${summary.consumedPct}% : ${summary.actualCost.toFixed(2)} / ${summary.budgetTotal.toFixed(2)}`;

  // Récupère les managers + admins du projet
  const recipients = db.prepare(`
    SELECT pm.op_user_id
    FROM project_members pm
    WHERE pm.op_project_id = ? AND pm.role = 'manager'
    UNION
    SELECT op_user_id FROM users WHERE is_admin = 1
  `).all(projectId);

  for (const r of recipients) {
    // Anti-spam : vérifie si une alerte non lue du même type existe dans les 24h
    const existing = db.prepare(`
      SELECT id FROM notifications
      WHERE op_user_id = ?
        AND type = 'budget_alert'
        AND is_read = 0
        AND created_at > datetime('now', '-24 hours')
        AND message LIKE ?
    `).get(r.op_user_id, `%Projet #${projectId}%`);

    if (!existing) {
      try {
        createNotification(
          r.op_user_id,
          "budget_alert",
          `Projet #${projectId} — ${message}`
        );
      } catch (err) {
        console.error(`[budget] Erreur notification user ${r.op_user_id}:`, err.message);
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  refreshBudgetForProject
//
//  Point d'entrée principal appelé après chaque time log (ajout/suppression).
//  Met à jour budget_total dans projects_meta si besoin, vérifie les alertes.
// ──────────────────────────────────────────────────────────────────────────────
async function refreshBudgetForProject(projectId) {
  const summary = getBudgetSummary(projectId);

  // Met à jour le champ budget_total dans projects_meta (non-destructif)
  // On ne touche PAS au budget_total défini par l'admin — on met juste à jour
  // les stats dérivées via upsertProjectMeta existant
  // (actual_cost et estimated_cost sont dans task_extensions — pas dans projects_meta)
  // → On vérifie juste les alertes ici.

  await checkBudgetAlerts(projectId);

  return summary;
}

module.exports = {
  getBudgetSummary,
  getBudgetByTask,
  getBudgetTimeline,
  updateEstimatedCostForTask,
  checkBudgetAlerts,
  refreshBudgetForProject,
};