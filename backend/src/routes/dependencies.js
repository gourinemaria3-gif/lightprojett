"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/dependencies
//
//  CORRECTIONS vs version précédente :
//
//  1. buildTaskMap mis en cache dans dependencies.js (TTL 8s)
//     GET /:taskId ne déclenche plus une requête HTTP OpenProject systématique.
//     Plusieurs endpoints appelés en parallèle pour le même projet partagent
//     la même réponse mise en cache.
//
//  2. invalidateTaskMapCache après POST et DELETE
//     Quand une dépendance est ajoutée ou supprimée, le cache du projet est
//     invalidé immédiatement. Ainsi, le prochain GET reçoit des données
//     fraîches et non le snapshot d'avant la mutation.
//
//  3. isDone importé depuis dependencies.js (qui le ré-exporte depuis
//     utils/taskStatus.js) — pas de duplication locale.
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
  invalidateTaskMapCache, // ← NOUVEAU : invalide le cache après mutation
  isDone,                  // ← ré-exporté depuis utils/taskStatus via dependencies.js
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
//
//  CORRECTION : buildTaskMap utilise maintenant le cache partagé.
//  Si POST /dependencies a été appelé juste avant pour le même projet,
//  le cache a été invalidé → cet appel reçoit des données fraîches.
//  Si aucune mutation récente, le cache évite un appel HTTP OP redondant.
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
    // buildTaskMap utilise le cache — pas d'appel HTTP si TTL encore valide
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
//
//  CORRECTION : invalidateTaskMapCache(projectId) est appelé après la mutation
//  pour que le prochain GET reçoive un taskMap à jour depuis OP.
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

    // ── Invalide le cache APRÈS la mutation ────────────────────────────────
    //  Le graphe de dépendances vient de changer. Le prochain appel
    //  buildTaskMap rechargera les tâches depuis OP plutôt que de servir
    //  le snapshot d'avant l'ajout de la dépendance.
    invalidateTaskMapCache(projectId);

    // ── Notif "blocked" si la tâche est maintenant bloquée ────────────────
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
      }).catch((err) => console.error("[DEP] Erreur notifyTaskBlocked:", err.message));
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
//
//  CORRECTION : invalidateTaskMapCache(projectId) est appelé après la mutation.
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

    // ── Invalide le cache APRÈS la mutation ────────────────────────────────
    invalidateTaskMapCache(projectId);

    // ── Notif "unblocked" si la tâche était bloquée et ne l'est plus ──────
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
      }).catch((err) => console.error("[DEP] Erreur notifyTaskUnblocked:", err.message));
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