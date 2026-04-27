"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — budgetService.js
//
//  Logique budget :
//    Admin        → fixe budget_total dans projects_meta
//    Chef         → fixe estimated_hours dans task_extensions
//    Membre       → fixe member_rate dans task_extensions (par tâche)
//    Système      → calcule estimated_cost et actual_cost automatiquement
//
//  Formules :
//    estimated_cost   = estimated_hours × member_rate
//    actual_cost      = SUM(time_logs.hours_worked) × member_rate
//    budget_used      = SUM(actual_cost) toutes tâches du projet
//    budget_remaining = budget_total - budget_used
//    consumed_pct     = (budget_used / budget_total) × 100
// ══════════════════════════════════════════════════════════════════════════════

const {
  db,
  getProjectMeta,
  setBudgetAlertedFlags,
  resetBudgetAlertedFlags,
  setEstimatedHours,
  getTaskExtension,
} = require("../database/db");

const BUDGET_WARNING_PCT = 80;
const BUDGET_DANGER_PCT  = 100;

// ──────────────────────────────────────────────────────────────────────────────
//  updateEstimatedCostForTask
//  Appelé après createTask ou patchTask quand estimatedHours ou l'assigné change.
//  Met à jour estimated_hours dans task_extensions et recalcule estimated_cost
//  si member_rate est déjà connu.
//
//  @param {number|string} taskId
//  @param {object}        opts
//    estimatedHours {number}        — heures estimées (depuis OP)
//    projectId      {number|string} — pour rattacher la tâche au projet
//    assigneeOpId   {number|null}   — non utilisé ici (member_rate est par tâche)
// ──────────────────────────────────────────────────────────────────────────────
function updateEstimatedCostForTask(taskId, { estimatedHours, projectId }) {
  if (!taskId || estimatedHours == null) return;
  const hours = Number(estimatedHours);
  if (isNaN(hours) || hours <= 0) return;

  // setEstimatedHours gère la mise à jour de estimated_cost automatiquement
  setEstimatedHours(Number(taskId), hours, projectId ? Number(projectId) : null);
}

// ──────────────────────────────────────────────────────────────────────────────
//  getBudgetSummary
//  Retourne le résumé complet du budget d'un projet.
// ──────────────────────────────────────────────────────────────────────────────
function getBudgetSummary(projectId) {
  const meta        = getProjectMeta(projectId);
  const budgetTotal = meta?.budget_total ?? null;

  // Coût réel = SUM(actual_cost) des tâches du projet
  const actualCostRow = db.prepare(`
    SELECT COALESCE(SUM(te.actual_cost), 0) AS total
    FROM task_extensions te
    WHERE te.op_project_id = ?
      AND te.actual_cost IS NOT NULL
  `).get(projectId);

  const actualCost = Math.round(Number(actualCostRow?.total ?? 0) * 100) / 100;

  // Coût estimé = SUM(estimated_cost) des tâches du projet
  const estimatedCostRow = db.prepare(`
    SELECT COALESCE(SUM(te.estimated_cost), 0) AS total
    FROM task_extensions te
    WHERE te.op_project_id = ?
      AND te.estimated_cost IS NOT NULL
  `).get(projectId);

  const estimatedCost = Math.round(Number(estimatedCostRow?.total ?? 0) * 100) / 100;

  // Dérivés
  const remaining   = budgetTotal !== null ? Math.max(0, budgetTotal - actualCost)  : null;
  const overrun     = budgetTotal !== null ? Math.max(0, actualCost  - budgetTotal) : null;
  const consumedPct = budgetTotal !== null && budgetTotal > 0
    ? Math.round((actualCost / budgetTotal) * 100)
    : null;

  // Statut
  let status = "no_budget";
  if (budgetTotal !== null) {
    if (actualCost >= budgetTotal)              status = "danger";
    else if (consumedPct >= BUDGET_WARNING_PCT) status = "warning";
    else                                        status = "ok";
  }

  return {
    projectId:     Number(projectId),
    budgetTotal,
    estimatedCost,
    actualCost,
    remaining:     remaining !== null ? Math.round(remaining * 100) / 100 : null,
    overrun:       overrun   !== null ? Math.round(overrun   * 100) / 100 : null,
    consumedPct,
    status,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  getBudgetByTask
//  Détail par tâche : heures estimées, taux, coût estimé vs réel.
//  Accès réservé au manager / admin.
// ──────────────────────────────────────────────────────────────────────────────
function getBudgetByTask(projectId) {
  return db.prepare(`
    SELECT
      te.op_task_id       AS taskId,
      te.estimated_hours  AS estimatedHours,
      te.member_rate      AS memberRate,
      ROUND(COALESCE(te.estimated_cost, 0), 2) AS estimatedCost,
      ROUND(COALESCE(te.actual_cost,    0), 2) AS actualCost,
      (
        SELECT COALESCE(SUM(tl.hours_worked), 0)
        FROM time_logs tl
        WHERE tl.op_task_id = te.op_task_id
      ) AS hoursLogged
    FROM task_extensions te
    WHERE te.op_project_id = ?
    ORDER BY te.op_task_id
  `).all(projectId);
}

// ──────────────────────────────────────────────────────────────────────────────
//  getBudgetTimeline
//  Évolution chronologique du coût réel cumulé.
// ──────────────────────────────────────────────────────────────────────────────
function getBudgetTimeline(projectId) {
  const rows = db.prepare(`
    SELECT
      tl.logged_date                                           AS date,
      ROUND(
        COALESCE(SUM(tl.hours_worked * te.member_rate), 0)
      , 2)                                                     AS dailyCost
    FROM time_logs tl
    INNER JOIN task_extensions te ON te.op_task_id = tl.op_task_id
    WHERE te.op_project_id = ?
      AND te.member_rate IS NOT NULL
    GROUP BY tl.logged_date
    ORDER BY tl.logged_date ASC
  `).all(projectId);

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
//  checkBudgetAlerts
//  Vérifie les seuils et envoie les notifications via notificationEngine.
//  Anti-spam : un seul envoi par seuil grâce aux flags budget_alerted_*.
// ──────────────────────────────────────────────────────────────────────────────
async function checkBudgetAlerts(projectId, summary) {
  if (summary.status === "no_budget" || summary.status === "ok") {
    const meta = getProjectMeta(projectId);
    if (meta?.budget_alerted_warning || meta?.budget_alerted_danger) {
      resetBudgetAlertedFlags(projectId);
    }
    return;
  }

  const meta           = getProjectMeta(projectId);
  const alreadyWarning = Boolean(meta?.budget_alerted_warning);
  const alreadyDanger  = Boolean(meta?.budget_alerted_danger);

  const sendWarning = summary.status === "warning" && !alreadyWarning;
  const sendDanger  = summary.status === "danger"  && !alreadyDanger;

  if (!sendWarning && !sendDanger) return;

  const manager = db.prepare(`
    SELECT u.op_user_id, u.name, u.email
    FROM project_members pm
    JOIN users u ON u.op_user_id = pm.op_user_id
    WHERE pm.op_project_id = ? AND pm.role = 'manager'
    LIMIT 1
  `).get(projectId);

  const adminIds = db.prepare(`SELECT op_user_id FROM users WHERE is_admin = 1`)
    .all().map(r => r.op_user_id);

  const projectName = `Projet #${projectId}`;

  const {
    notifyBudgetWarning,
    notifyBudgetCritical,
  } = require("./notificationEngine");

  if (sendDanger && manager) {
    await notifyBudgetCritical({
      projectId,
      projectName,
      budgetPct:    summary.consumedPct,
      managerId:    manager.op_user_id,
      managerEmail: manager.email,
      managerName:  manager.name,
      adminIds,
    });
  } else if (sendWarning && manager) {
    await notifyBudgetWarning({
      projectId,
      projectName,
      budgetPct: summary.consumedPct,
      managerId: manager.op_user_id,
      adminIds,
    });
  }

  setBudgetAlertedFlags(projectId, {
    warning: alreadyWarning || sendWarning,
    danger:  alreadyDanger  || sendDanger,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  refreshBudgetForProject
//  Point d'entrée principal — appelé après chaque action qui modifie le budget.
// ──────────────────────────────────────────────────────────────────────────────
async function refreshBudgetForProject(projectId) {
  const summary = getBudgetSummary(projectId);
  await checkBudgetAlerts(projectId, summary);
  return summary;
}

module.exports = {
  getBudgetSummary,
  getBudgetByTask,
  getBudgetTimeline,
  checkBudgetAlerts,
  refreshBudgetForProject,
  updateEstimatedCostForTask,   // ← export ajouté (utilisé par tasks.js et createproject.js)
};