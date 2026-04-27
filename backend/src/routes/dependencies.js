"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/dependencies
//
//  CORRECTIONS :
//    1. POST → notif "blocked" envoyée au membre assigné quand dépendance créée
//    2. DELETE → notif "unblocked" envoyée si la tâche n'est plus bloquée
//    3. PATCH statut tâche → propagateBlockingFrom envoie "unblocked" si tâche
//       bloquante devient terminée
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
  addDependencyWithRecalc,
  removeDependencyWithRecalc,
  buildTaskMap,
  isDone,
} = require("../services/dependencies");

const { syncOneProject }   = require("../services/syncProjectStats");
const {
  notifyTaskBlocked,
  notifyTaskUnblocked,
} = require("../services/notificationEngine");

function getAccess(userId, projectId, isAdmin) {
  if (isAdmin) return { role: "admin" };
  return getMemberRole(userId, projectId);
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/dependencies/:taskId?projectId=X
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:taskId", async (req, res) => {
  const { taskId }    = req.params;
  const { projectId } = req.query;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  if (!projectId) {
    return res.status(400).json({ message: "projectId est obligatoire en query param." });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Vous n'avez pas accès à ce projet." });
  }

  try {
    const taskMap = await buildTaskMap(projectId, req.opToken);

    if (!taskMap[taskId]) {
      return res.status(404).json({ message: `Tâche #${taskId} introuvable dans ce projet.` });
    }

    const depsRaw   = getDependenciesOf(taskId);
    const dependsOn = depsRaw.map((dep) => {
      const opTask = taskMap[dep.depends_on_task_op_id];
      return {
        taskId:  dep.depends_on_task_op_id,
        title:   opTask?.subject || `Tâche #${dep.depends_on_task_op_id} (supprimée)`,
        status:  opTask?._links?.status?.title || "Inconnu",
        isDone:  opTask ? isDone(opTask) : false,
        missing: !opTask,
      };
    });

    const depsOnMeRaw = getDependents(taskId);
    const blockingFor = depsOnMeRaw.map((dep) => {
      const opTask = taskMap[dep.task_op_id];
      const ext    = getTaskExtension(dep.task_op_id);
      return {
        taskId:    dep.task_op_id,
        title:     opTask?.subject || `Tâche #${dep.task_op_id} (supprimée)`,
        isBlocked: Boolean(ext?.is_blocked),
        missing:   !opTask,
      };
    });

    const ext = getTaskExtension(taskId);

    return res.json({
      taskId:     Number(taskId),
      isBlocked:  Boolean(ext?.is_blocked),
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
//  → Notif "blocked" envoyée immédiatement si la tâche est maintenant bloquée
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

    if (hasCycleFrom(taskId, dependsOnTaskId)) {
      return res.status(400).json({
        message: "Dépendance circulaire détectée : cela créerait une boucle dans le graphe.",
      });
    }

    const isNowBlocked = addDependencyWithRecalc(taskId, dependsOnTaskId, taskMap);

    // ── Notif "blocked" si la tâche est maintenant bloquée ───────────────────
    if (isNowBlocked) {
      const blockedTask  = taskMap[taskId];
      const blockingTask = taskMap[dependsOnTaskId];
      const assigneeId   = blockedTask?._links?.assignee?.href
        ? Number(blockedTask._links.assignee.href.split("/").pop())
        : null;

      console.log(`[DEP] Tâche #${taskId} bloquée par #${dependsOnTaskId} → notif user ${assigneeId || "manager"}`);

      await notifyTaskBlocked({
        taskId,
        taskTitle:       blockedTask?.subject  || `#${taskId}`,
        blockedByTaskId: dependsOnTaskId,
        blockedByTitle:  blockingTask?.subject || `#${dependsOnTaskId}`,
        assigneeId,
        projectId,
      }).catch(err => console.error("[DEP] Erreur notifyTaskBlocked:", err.message));
    }

    // Sync stats
    await syncOneProject(projectId, req.opToken).catch((err) =>
      console.error("Erreur syncOneProject POST dep:", err.message)
    );

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
//  → Notif "unblocked" envoyée si la tâche n'est plus bloquée après suppression
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

    // État AVANT suppression
    const wasBlocked = Boolean(getTaskExtension(taskId)?.is_blocked);

    const isNowBlocked = removeDependencyWithRecalc(taskId, dependsOnTaskId, taskMap);

    // ── Notif "unblocked" si la tâche était bloquée et ne l'est plus ─────────
    if (wasBlocked && !isNowBlocked) {
      const task       = taskMap[taskId];
      const assigneeId = task?._links?.assignee?.href
        ? Number(task._links.assignee.href.split("/").pop())
        : null;

      console.log(`[DEP] Tâche #${taskId} débloquée → notif user ${assigneeId || "manager"}`);

      await notifyTaskUnblocked({
        taskId,
        taskTitle:  task?.subject || `#${taskId}`,
        assigneeId,
        projectId,
      }).catch(err => console.error("[DEP] Erreur notifyTaskUnblocked:", err.message));
    }

    // Sync stats
    await syncOneProject(projectId, req.opToken).catch((err) =>
      console.error("Erreur syncOneProject DELETE dep:", err.message)
    );

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