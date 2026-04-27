"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/budget
//
//  GET  /api/budget/:projectId              → résumé budgétaire (tous membres)
//  GET  /api/budget/:projectId/tasks        → détail par tâche (manager/admin)
//  GET  /api/budget/:projectId/timeline     → évolution chronologique (manager/admin)
//  PATCH /api/budget/:projectId             → définir/modifier budget total (admin)
//  PATCH /api/budget/:projectId/tasks/:taskId/hours  → chef fixe heures estimées
//  PATCH /api/budget/:projectId/tasks/:taskId/rate   → membre fixe son taux
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
} = require("../database/db");

const { requireManager } = require("../middleware/checkRole");

// ──────────────────────────────────────────────────────────────────────────────
//  Helper — vérifie l'accès au projet
// ──────────────────────────────────────────────────────────────────────────────
function getAccess(userId, projectId, isAdmin) {
  if (isAdmin) return { role: "admin" };
  return getMemberRole(userId, projectId);
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId
//  Résumé : budget total, coût estimé, coût réel, restant, % consommé
//  Accès : tous les membres du projet
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
    console.error("[budget GET] Erreur:", err.message);
    res.status(500).json({ message: "Erreur récupération budget.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId/tasks
//  Détail par tâche : heures estimées, taux, coût estimé vs réel
//  Accès : manager / admin uniquement
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/tasks", (req, res) => {
  const { projectId } = req.params;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut voir le détail budgétaire par tâche.",
    });
  }

  try {
    const tasks = getBudgetByTask(projectId);
    res.json(tasks);
  } catch (err) {
    console.error("[budget/tasks GET] Erreur:", err.message);
    res.status(500).json({ message: "Erreur récupération budget par tâche.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId/timeline
//  Évolution chronologique du coût réel
//  Accès : manager / admin uniquement
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/timeline", (req, res) => {
  const { projectId } = req.params;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Accès réservé au chef de projet ou à l'administrateur.",
    });
  }

  try {
    const timeline = getBudgetTimeline(projectId);
    res.json(timeline);
  } catch (err) {
    console.error("[budget/timeline GET] Erreur:", err.message);
    res.status(500).json({ message: "Erreur récupération timeline budget.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/budget/:projectId
//  Définir ou modifier le budget total du projet.
//  Accès : ADMIN uniquement (le budget global est fixé par l'admin)
//
//  Body : { budgetTotal: number }
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const isAdmin       = req.user.isAdmin;

  // Seul l'admin peut fixer le budget total
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

    // Si le budget change de valeur → reset des flags d'alerte (nouveau seuil)
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

    // Vérifie immédiatement si une alerte doit être déclenchée
    const summary = await refreshBudgetForProject(projectId);

    res.json({
      message:     "Budget total mis à jour.",
      budgetTotal: parsed,
      summary,
    });
  } catch (err) {
    console.error("[budget PATCH] Erreur:", err.message);
    res.status(500).json({ message: "Erreur mise à jour budget.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/budget/:projectId/tasks/:taskId/hours
//  Chef de projet — fixe les heures estimées d'une tâche.
//  Recalcule estimated_cost si le member_rate est déjà défini.
//
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

    // Récupère l'extension mise à jour
    const ext = getTaskExtension(Number(taskId));

    res.json({
      message:        "Heures estimées mises à jour.",
      taskId:         Number(taskId),
      estimatedHours: parsed,
      memberRate:     ext?.member_rate     ?? null,
      estimatedCost:  ext?.estimated_cost  ?? null,
    });
  } catch (err) {
    console.error("[budget/hours PATCH] Erreur:", err.message);
    res.status(500).json({ message: "Erreur mise à jour heures estimées.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/budget/:projectId/tasks/:taskId/rate
//  Membre — déclare son taux horaire pour cette tâche spécifique.
//  Recalcule estimated_cost et actual_cost immédiatement.
//  Déclenche refreshBudgetForProject pour vérifier les alertes.
//
//  Body : { memberRate: number }
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId/tasks/:taskId/rate", async (req, res) => {
  const { projectId, taskId } = req.params;
  const callerId              = req.user.userId;
  const isAdmin               = req.user.isAdmin;

  // Vérification accès : membre du projet (ou manager/admin)
  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Accès refusé à ce projet." });
  }

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

    // Recalcul budget projet + alertes
    const summary = await refreshBudgetForProject(projectId);

    // Récupère l'extension mise à jour
    const ext = getTaskExtension(Number(taskId));

    res.json({
      message:        "Taux horaire mis à jour.",
      taskId:         Number(taskId),
      memberRate:     parsed,
      estimatedCost:  ext?.estimated_cost ?? null,
      actualCost:     ext?.actual_cost    ?? null,
      budgetSummary:  summary,
    });
  } catch (err) {
    console.error("[budget/rate PATCH] Erreur:", err.message);
    res.status(500).json({ message: "Erreur mise à jour taux horaire.", detail: err.message });
  }
});

module.exports = router;