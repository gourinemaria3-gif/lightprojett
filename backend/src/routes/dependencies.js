"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/dependencies (version finale)
//
//  CORRECTIONS suite review senior :
//    - DELETE utilise removeDependencyWithRecalc (transaction)
//    - Boolean(ext?.is_blocked) partout
//    - Import de removeDependencyWithRecalc
// ══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();

const {
  getDependenciesOf,
  getDependents,
  getMemberRole,
  getTaskExtension,
} = require("../database/db");

const {
  hasCycleFrom,
  recalcBlockedState,
  addDependencyWithRecalc,
  removeDependencyWithRecalc,
  buildTaskMap,
  isDone,
} = require("../services/dependencies");

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER
// ──────────────────────────────────────────────────────────────────────────────
function getAccess(userId, projectId, isAdmin) {
  if (isAdmin) return { role: "admin" };
  return getMemberRole(userId, projectId);
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/dependencies/:taskId?projectId=X
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:taskId", async (req, res) => {
  const { taskId } = req.params;
  const { projectId } = req.query;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  if (!projectId) {
    return res.status(400).json({ message: "projectId est obligatoire en query param." });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Vous n'avez pas accès à ce projet." });
  }

  try {
    // UN SEUL appel API
    const taskMap = await buildTaskMap(projectId, req.opToken);

    // De quoi dépend cette tâche ?
    const depsRaw = getDependenciesOf(taskId);
    const dependsOn = depsRaw.map((dep) => {
      const opTask = taskMap[dep.depends_on_task_op_id];
      return {
        taskId:  dep.depends_on_task_op_id,
        title:   opTask?.subject || `Tâche #${dep.depends_on_task_op_id}`,
        status:  opTask?._links?.status?.title || "Inconnu",
        isDone:  isDone(opTask),
      };
    });

    // Qui est bloqué PAR cette tâche ?
    const depsOnMeRaw = getDependents(taskId);
    const blockingFor = depsOnMeRaw.map((dep) => {
      const opTask = taskMap[dep.task_op_id];
      const ext    = getTaskExtension(dep.task_op_id);
      return {
        taskId:    dep.task_op_id,
        title:     opTask?.subject || `Tâche #${dep.task_op_id}`,
        isBlocked: Boolean(ext?.is_blocked), // CORRECTION
      };
    });

    const ext = getTaskExtension(taskId);

    return res.json({
      taskId:     Number(taskId),
      isBlocked:  Boolean(ext?.is_blocked), // CORRECTION
      dependsOn,
      blockingFor,
    });

  } catch (err) {
    console.error("Erreur GET dependencies:", err.message);
    res.status(500).json({ message: "Erreur récupération des dépendances.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/dependencies
// ══════════════════════════════════════════════════════════════════════════════
router.post("/", async (req, res) => {
  const { taskId, dependsOnTaskId, projectId } = req.body;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  if (!taskId || !dependsOnTaskId || !projectId) {
    return res.status(400).json({
      message: "taskId, dependsOnTaskId et projectId sont obligatoires.",
    });
  }

  if (Number(taskId) === Number(dependsOnTaskId)) {
    return res.status(400).json({
      message: "Une tâche ne peut pas dépendre d'elle-même.",
    });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut gérer les dépendances.",
    });
  }

  try {
    const taskMap = await buildTaskMap(projectId, req.opToken);

    if (!taskMap[taskId]) {
      return res.status(404).json({ message: `Tâche #${taskId} introuvable dans ce projet.` });
    }
    if (!taskMap[dependsOnTaskId]) {
      return res.status(404).json({ message: `Tâche #${dependsOnTaskId} introuvable dans ce projet.` });
    }

    // Détection de cycle complète via DFS
    if (hasCycleFrom(taskId, dependsOnTaskId)) {
      return res.status(400).json({
        message: "Dépendance circulaire détectée : cela créerait une boucle dans le graphe.",
      });
    }

    // Insert + recalc dans une transaction
    const isNowBlocked = addDependencyWithRecalc(taskId, dependsOnTaskId, taskMap);

    return res.status(201).json({
      message:         "Dépendance ajoutée.",
      taskId:          Number(taskId),
      dependsOnTaskId: Number(dependsOnTaskId),
      isBlocked:       isNowBlocked,
      dependsOnTitle:  taskMap[dependsOnTaskId]?.subject || `Tâche #${dependsOnTaskId}`,
    });

  } catch (err) {
    console.error("Erreur POST dependency:", err.message);
    res.status(500).json({ message: "Erreur ajout dépendance.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/dependencies
//  CORRECTION : utilise removeDependencyWithRecalc (transaction)
// ══════════════════════════════════════════════════════════════════════════════
router.delete("/", async (req, res) => {
  const { taskId, dependsOnTaskId, projectId } = req.body;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  if (!taskId || !dependsOnTaskId || !projectId) {
    return res.status(400).json({
      message: "taskId, dependsOnTaskId et projectId sont obligatoires.",
    });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut gérer les dépendances.",
    });
  }

  try {
    const taskMap = await buildTaskMap(projectId, req.opToken);

    // CORRECTION : suppression + recalc dans une transaction
    const isNowBlocked = removeDependencyWithRecalc(taskId, dependsOnTaskId, taskMap);

    return res.json({
      message:   "Dépendance supprimée.",
      taskId:    Number(taskId),
      isBlocked: isNowBlocked,
    });

  } catch (err) {
    console.error("Erreur DELETE dependency:", err.message);
    res.status(500).json({ message: "Erreur suppression dépendance.", detail: err.message });
  }
});

module.exports = router;