"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/budget
//
//  Règles d'accès (résumé) :
//
//  MEMBRE      → GET  /:projectId            Voir le résumé budget du projet
//              → GET  /:projectId/my-tasks   Voir ses propres tâches (heures + coût)
//              → PATCH /:projectId/tasks/:taskId/rate
//                  Fixer son taux horaire — SEULEMENT sur une tâche qui lui est assignée
//
//  MANAGER     → tout ce que le membre peut faire, PLUS :
//              → GET  /:projectId/tasks      Détail budget par tâche (toutes les tâches)
//              → GET  /:projectId/timeline   Évolution chronologique du coût réel
//              → PATCH /:projectId/tasks/:taskId/hours
//                  Fixer les heures estimées d'une tâche
//              → PATCH /:projectId/tasks/:taskId/rate
//                  Peut aussi modifier le taux (pour débloquer un membre absent)
//
//  ADMIN       → tout ce que le manager peut faire, PLUS :
//              → PATCH /:projectId           Fixer / modifier le budget total
// ══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();

const {
  getBudgetSummary,
  getBudgetByTask,
  getBudgetTimeline,
  refreshBudgetForProject,
} = require("../services/budgetService");

const {
  getMemberRole,
  getProjectMeta,
  upsertProjectMeta,
  getTaskExtension,
  setEstimatedHours,
  setMemberRate,
  resetBudgetAlertedFlags,
  db,
} = require("../database/db");

const { requireManager } = require("../middleware/checkRole");

// ──────────────────────────────────────────────────────────────────────────────
//  Helpers d'accès
// ──────────────────────────────────────────────────────────────────────────────

// Retourne { role } ou null si l'utilisateur n'a aucun accès au projet.
// Un admin a toujours accès avec le rôle virtuel "admin".
function getAccess(userId, projectId, isAdmin) {
  if (isAdmin) return { role: "admin" };
  return getMemberRole(userId, projectId) || null;
}

// Retourne true si le rôle permet les actions manager/admin
function isManagerOrAdmin(access) {
  return access && (access.role === "manager" || access.role === "admin");
}

// Récupère l'assignee OpenProject d'une tâche depuis task_extensions.
// On stocke op_project_id dans task_extensions ; pour l'assignee on interroge
// la table time_logs (le dernier log = assignee le plus récent) OU on accepte
// un paramètre explicite passé par le client.
//
// ⚠️  OpenProject est la source de vérité pour l'assignee.
//     On ne re-sollicite pas l'API OP ici pour rester synchrone ;
//     on vérifie l'assignee stocké dans task_extensions (champ assignee_op_id
//     mis à jour par le webhook/sync existant).
//     Si le champ n'existe pas encore, les managers peuvent toujours modifier.
function getTaskAssignee(taskId) {
  const row = db.prepare(
    `SELECT assignee_op_id FROM task_extensions WHERE op_task_id = ?`
  ).get(taskId);
  return row?.assignee_op_id ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId
//  Résumé budget global : budget total, coût estimé, coût réel, restant, %
//  Accès : tous les membres du projet (membre, manager, admin)
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId", (req, res) => {
  const { projectId } = req.params;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Accès refusé à ce projet." });
  }

  try {
    const summary = getBudgetSummary(projectId);
    res.json(summary);
  } catch (err) {
    console.error("[budget GET /] Erreur:", err.message);
    res.status(500).json({ message: "Erreur récupération budget.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId/my-tasks
//  Tâches du membre connecté : heures estimées, taux, coût estimé vs réel.
//  Permet à un membre de voir uniquement ses propres tâches budgétaires.
//  Accès : tous les membres (chacun ne voit que ses propres tâches)
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/my-tasks", (req, res) => {
  const { projectId } = req.params;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Accès refusé à ce projet." });
  }

  try {
    // Un admin/manager voit toutes ses tâches assignées comme un membre normal
    const tasks = db.prepare(`
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
            AND tl.op_user_id = ?
        ) AS myHoursLogged
      FROM task_extensions te
      WHERE te.op_project_id  = ?
        AND te.assignee_op_id = ?
      ORDER BY te.op_task_id
    `).all(callerId, projectId, callerId);

    res.json(tasks);
  } catch (err) {
    console.error("[budget GET /my-tasks] Erreur:", err.message);
    res.status(500).json({ message: "Erreur récupération de vos tâches.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId/tasks
//  Détail budget par tâche — TOUTES les tâches du projet.
//  Accès : manager / admin uniquement
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/tasks", (req, res) => {
  const { projectId } = req.params;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!isManagerOrAdmin(access)) {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut consulter le détail budgétaire par tâche.",
    });
  }

  try {
    const tasks = getBudgetByTask(projectId);
    res.json(tasks);
  } catch (err) {
    console.error("[budget GET /tasks] Erreur:", err.message);
    res.status(500).json({ message: "Erreur récupération budget par tâche.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId/timeline
//  Évolution chronologique du coût réel cumulé.
//  Accès : manager / admin uniquement
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/timeline", (req, res) => {
  const { projectId } = req.params;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!isManagerOrAdmin(access)) {
    return res.status(403).json({
      message: "Accès réservé au chef de projet ou à l'administrateur.",
    });
  }

  try {
    const timeline = getBudgetTimeline(projectId);
    res.json(timeline);
  } catch (err) {
    console.error("[budget GET /timeline] Erreur:", err.message);
    res.status(500).json({ message: "Erreur récupération timeline budget.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/budget/:projectId
//  Définir ou modifier le budget total du projet.
//  Accès : ADMIN uniquement
//  Body : { budgetTotal: number }
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const isAdmin       = req.user.isAdmin;

  if (!isAdmin) {
    return res.status(403).json({
      message: "Seul l'administrateur peut définir le budget total du projet.",
    });
  }

  const { budgetTotal } = req.body;

  if (budgetTotal === undefined || budgetTotal === null) {
    return res.status(400).json({ message: "budgetTotal est obligatoire." });
  }

  const parsed = Number(budgetTotal);
  if (isNaN(parsed) || parsed < 0) {
    return res.status(400).json({
      message: "budgetTotal doit être un nombre positif ou nul.",
    });
  }

  try {
    const meta = getProjectMeta(projectId) || {};

    // Si le budget change → reset des flags d'alerte (nouveau seuil de référence)
    if (meta.budget_total !== parsed) {
      resetBudgetAlertedFlags(projectId);
    }

    upsertProjectMeta(projectId, {
      startDate:         meta.start_date    || null,
      endDate:           meta.end_date      || null,
      workload:          meta.workload      || null,
      aiSummary:         meta.ai_summary    || null,
      progress:          meta.progress      || 0,
      riskScore:         meta.risk_score    || 0,
      lateTasks:         meta.late_tasks    || 0,
      blockedTasks:      meta.blocked_tasks || 0,
      estimatesComplete: meta.estimates_complete !== undefined
        ? Boolean(meta.estimates_complete) : true,
      missingEstimates:  meta.missing_estimates  || 0,
      riskIsPartial:     Boolean(meta.risk_is_partial),
      budgetTotal:       parsed,
    });

    // Vérifie immédiatement si une alerte doit être déclenchée avec le nouveau budget
    const summary = await refreshBudgetForProject(projectId);

    res.json({
      message:     "Budget total mis à jour.",
      budgetTotal: parsed,
      summary,
    });
  } catch (err) {
    console.error("[budget PATCH /] Erreur:", err.message);
    res.status(500).json({ message: "Erreur mise à jour budget.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/budget/:projectId/tasks/:taskId/hours
//  Fixer les heures estimées d'une tâche.
//  Recalcule estimated_cost si le member_rate est déjà défini.
//  Accès : MANAGER / ADMIN uniquement (le membre ne peut pas modifier ça)
//  Body : { estimatedHours: number }
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId/tasks/:taskId/hours", requireManager, async (req, res) => {
  const { projectId, taskId } = req.params;
  const { estimatedHours }    = req.body;

  if (estimatedHours === undefined || estimatedHours === null) {
    return res.status(400).json({ message: "estimatedHours est obligatoire." });
  }

  const parsed = Number(estimatedHours);
  if (isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({
      message: "estimatedHours doit être un nombre strictement positif.",
    });
  }

  try {
    setEstimatedHours(Number(taskId), parsed, Number(projectId));

    const ext = getTaskExtension(Number(taskId));

    res.json({
      message:        "Heures estimées mises à jour.",
      taskId:         Number(taskId),
      estimatedHours: parsed,
      memberRate:     ext?.member_rate    ?? null,
      estimatedCost:  ext?.estimated_cost ?? null,
    });
  } catch (err) {
    console.error("[budget PATCH /hours] Erreur:", err.message);
    res.status(500).json({ message: "Erreur mise à jour heures estimées.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/budget/:projectId/tasks/:taskId/rate
//  Fixer le taux horaire pour une tâche.
//  Recalcule estimated_cost et actual_cost immédiatement.
//
//  Règles d'accès :
//    • ADMIN / MANAGER → peut toujours modifier le taux de n'importe quelle tâche
//    • MEMBRE          → peut modifier le taux SEULEMENT si la tâche lui est assignée
//                        (vérifié via task_extensions.assignee_op_id)
//
//  Body : { memberRate: number }
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId/tasks/:taskId/rate", async (req, res) => {
  const { projectId, taskId } = req.params;
  const callerId              = req.user.userId;
  const isAdmin               = req.user.isAdmin;

  // Vérification d'appartenance au projet
  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Accès refusé à ce projet." });
  }

  // Si c'est un simple membre (ni manager ni admin) → vérifier qu'il est
  // bien assigné à cette tâche spécifique
  if (!isManagerOrAdmin(access)) {
    const assigneeId = getTaskAssignee(Number(taskId));

    // Cas 1 : la tâche n'a pas encore d'assignee enregistré en base
    //         (le champ assignee_op_id n'est pas encore synchronisé)
    //         → On refuse avec un message explicite plutôt que d'autoriser par défaut
    if (assigneeId === null) {
      return res.status(403).json({
        message:
          "Impossible de vérifier l'assignation de cette tâche. " +
          "Contactez votre chef de projet pour définir le taux.",
      });
    }

    // Cas 2 : la tâche est assignée à quelqu'un d'autre
    if (assigneeId !== callerId) {
      return res.status(403).json({
        message: "Vous ne pouvez définir votre taux que sur les tâches qui vous sont assignées.",
      });
    }
  }

  // Validation du corps
  const { memberRate } = req.body;

  if (memberRate === undefined || memberRate === null) {
    return res.status(400).json({ message: "memberRate est obligatoire." });
  }

  const parsed = Number(memberRate);
  if (isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({
      message: "memberRate doit être un nombre strictement positif (DA/h).",
    });
  }

  try {
    setMemberRate(Number(taskId), parsed, Number(projectId));

    // Recalcul budget projet + vérification des alertes
    const summary = await refreshBudgetForProject(projectId);

    const ext = getTaskExtension(Number(taskId));

    res.json({
      message:       "Taux horaire mis à jour.",
      taskId:        Number(taskId),
      memberRate:    parsed,
      estimatedCost: ext?.estimated_cost ?? null,
      actualCost:    ext?.actual_cost    ?? null,
      budgetSummary: summary,
    });
  } catch (err) {
    console.error("[budget PATCH /rate] Erreur:", err.message);
    res.status(500).json({ message: "Erreur mise à jour taux horaire.", detail: err.message });
  }
});

module.exports = router;