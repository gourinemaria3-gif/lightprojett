"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/budget
//
//  Endpoints :
//    GET  /api/budget/:projectId              → résumé budgétaire
//    GET  /api/budget/:projectId/tasks        → détail par tâche
//    GET  /api/budget/:projectId/timeline     → évolution chronologique
//    PATCH /api/budget/:projectId             → définir/modifier budget total
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
  upsertProjectMeta,
  getProjectMeta,
} = require("../database/db");

const { requireManager } = require("../middleware/checkRole");

function getAccess(userId, projectId, isAdmin) {
  if (isAdmin) return { role: "admin" };
  return getMemberRole(userId, projectId);
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/budget/:projectId
//  Résumé complet : budget total, coût estimé, coût réel, restant, % consommé
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Accès refusé à ce projet." });
  }

  // Les membres voient uniquement le résumé (pas le détail par tâche)
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
//  Détail par tâche : coût estimé vs coût réel
//  Accès : admin + manager uniquement
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/tasks", async (req, res) => {
  const { projectId } = req.params;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

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
//  Évolution chronologique du coût réel (pour graphique)
//  Accès : admin + manager
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/timeline", async (req, res) => {
  const { projectId } = req.params;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

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
//  Accès : admin + manager
//
//  Body : { budgetTotal: number }
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId", requireManager, async (req, res) => {
  const { projectId } = req.params;
  const { budgetTotal } = req.body;

  // Validation
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
      message:     "Budget mis à jour.",
      budgetTotal: parsed,
      summary,
    });
  } catch (err) {
    console.error("[budget PATCH] Erreur:", err.message);
    res.status(500).json({ message: "Erreur mise à jour budget.", detail: err.message });
  }
});

module.exports = router;