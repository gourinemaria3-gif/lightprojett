"use strict";

const express = require("express");
const router  = express.Router();
const { getTasks, patchTask, createTask, deleteTask } = require("../services/openproject");
const {
  addTimeLog,
  getTimeLogsForTask,
  deleteTimeLog,
  refreshActualCost,
  getMemberRole,
} = require("../database/db");
const { propagateBlockingFrom } = require("../services/dependencies");
const { syncOneProject } = require("../services/syncProjectStats");
const {
  notifyTaskAssigned,
  notifyTaskOverdue,
} = require("../services/notificationEngine");

function getAccess(userId, projectId, isAdmin) {
  if (isAdmin) return { role: "admin" };
  return getMemberRole(userId, projectId);
}

// ── Vérifie si une tâche est en retard ────────────────────────────────────────
function isOverdue(task) {
  if (!task?.dueDate) return false;
  const isClosed = task.isClosed === true ||
    ["done", "closed", "finished", "resolved", "rejected",
     "terminé", "terminée", "fermé", "fermée"]
      .includes((task._links?.status?.title || "").toLowerCase());
  if (isClosed) return false;
  return new Date(task.dueDate) < new Date(new Date().toDateString());
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/tasks/:projectId
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId", async (req, res) => {
  const callerId  = req.user.userId;
  const isAdmin   = req.user.isAdmin;
  const { projectId } = req.params;
  const opToken   = req.opToken;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Vous n'avez pas accès à ce projet." });
  }

  try {
    const tasks = await getTasks(projectId, opToken);

    if (access.role === "member") {
      const myTasks = tasks.filter((t) =>
        t._links?.assignee?.href?.endsWith(`/${callerId}`)
      );
      return res.json(myTasks);
    }

    res.json(tasks);
  } catch (error) {
    console.error("Erreur tâches:", error.message);
    if (error.response?.status === 401)
      return res.status(401).json({ message: "Token invalide." });
    res.status(500).json({ message: "Erreur serveur.", detail: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/tasks/project/:projectId
// ══════════════════════════════════════════════════════════════════════════════
router.post("/project/:projectId", async (req, res) => {
  const callerId  = req.user.userId;
  const isAdmin   = req.user.isAdmin;
  const { projectId } = req.params;
  const opToken   = req.opToken;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut créer des tâches.",
    });
  }

  if (!req.body?.title?.trim()) {
    return res.status(400).json({ message: "Le titre de la tâche est obligatoire." });
  }

  try {
    const created = await createTask(projectId, req.body, opToken);

    // ── Notif assignation si la tâche est créée avec un assignee ─────────────
    const newAssigneeId = created._links?.assignee?.href
      ? Number(created._links.assignee.href.split("/").pop())
      : null;
    if (newAssigneeId) {
      notifyTaskAssigned({
        assigneeId:  newAssigneeId,
        taskTitle:   created.subject,
        projectName: `Projet #${projectId}`,
        taskId:      created.id,
      }).catch((err) => console.error("[Notif] assignation création:", err.message));
    }

    res.status(201).json(created);
  } catch (error) {
    console.error("Erreur création tâche:", error.response?.data || error.message);
    res.status(500).json({
      message: "Erreur création tâche.",
      detail: error.response?.data || error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/tasks/:taskId
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:taskId", async (req, res) => {
  const callerId  = req.user.userId;
  const isAdmin   = req.user.isAdmin;
  const { projectId } = req.body;
  const opToken   = req.opToken;

  if (!projectId) {
    return res.status(400).json({ message: "projectId est requis dans le body." });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Vous n'avez pas accès à ce projet." });
  }

  if (access.role === "member") {
    const allowedKeys = ["status", "lockVersion", "projectId"];
    const forbidden = Object.keys(req.body).filter((k) => !allowedKeys.includes(k));
    if (forbidden.length > 0) {
      return res.status(403).json({
        message: `En tant que membre, vous ne pouvez modifier que le statut. Champs refusés : ${forbidden.join(", ")}.`,
      });
    }
  }

  try {
    const { projectId: _removed, ...patchData } = req.body;

    // ── Récupère l'état de la tâche AVANT le patch ────────────────────────
    const tasksBefore = await getTasks(projectId, opToken);
    const taskBefore  = tasksBefore.find((t) => String(t.id) === String(req.params.taskId));
    const oldAssigneeId = taskBefore?._links?.assignee?.href
      ? Number(taskBefore._links.assignee.href.split("/").pop())
      : null;

    // ── Applique le patch ─────────────────────────────────────────────────
    const result = await patchTask(req.params.taskId, patchData, opToken);

    // ── FIX 1 : Notif assignation si l'assignee a changé ──────────────────
    if (patchData.assignee !== undefined) {
      const newAssigneeId = result._links?.assignee?.href
        ? Number(result._links.assignee.href.split("/").pop())
        : null;

      if (newAssigneeId && newAssigneeId !== oldAssigneeId) {
        notifyTaskAssigned({
          assigneeId:  newAssigneeId,
          taskTitle:   result.subject,
          projectName: `Projet #${projectId}`,
          taskId:      req.params.taskId,
        }).catch((err) => console.error("[Notif] assignation patch:", err.message));
      }
    }

    // ── FIX 2 : Notif retard si la dueDate vient d'être définie (ou changée)
    //    et que la nouvelle date est déjà dans le passé ─────────────────────
    if (patchData.dueDate !== undefined) {
      const assigneeId = result._links?.assignee?.href
        ? Number(result._links.assignee.href.split("/").pop())
        : null;

      if (assigneeId && isOverdue(result)) {
        notifyTaskOverdue({
          opUserId:  assigneeId,
          taskTitle: result.subject,
          dueDate:   result.dueDate,
          taskId:    req.params.taskId,
        }).catch((err) => console.error("[Notif] retard patch dueDate:", err.message));
      }
    }

    // ── Propagation blocage + sync stats si statut changé ────────────────
    if (patchData.status) {
      Promise.all([
        propagateBlockingFrom(req.params.taskId, projectId, opToken),
        syncOneProject(projectId, opToken),
      ]).catch((err) => console.error("[Post-patch] propagation/stats:", err.message));
    }

    res.json(result);
  } catch (error) {
    console.error("Erreur patch tâche:", error.response?.data || error.message);
    res.status(500).json({
      message: "Erreur mise à jour tâche.",
      detail: error.response?.data || error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/tasks/:taskId
// ══════════════════════════════════════════════════════════════════════════════
router.delete("/:taskId", async (req, res) => {
  const callerId  = req.user.userId;
  const isAdmin   = req.user.isAdmin;
  const { projectId } = req.body;
  const opToken   = req.opToken;

  if (!projectId) {
    return res.status(400).json({ message: "projectId est requis dans le body." });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut supprimer des tâches.",
    });
  }

  try {
    await deleteTask(req.params.taskId, opToken);
    res.status(204).send();
  } catch (error) {
    console.error("Erreur suppression tâche:", error.response?.data || error.message);
    if (error.response?.status === 403)
      return res.status(403).json({ message: "Droits insuffisants." });
    if (error.response?.status === 404)
      return res.status(404).json({ message: "Tâche introuvable." });
    res.status(500).json({
      message: "Impossible de supprimer la tâche.",
      detail: error.response?.data || error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  TIME LOGS
// ══════════════════════════════════════════════════════════════════════════════

router.post("/:taskId/timelogs", async (req, res) => {
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;
  const { taskId } = req.params;
  const { opUserId, hoursWorked, loggedDate, note, projectId } = req.body;

  if (!opUserId || !hoursWorked || !projectId) {
    return res.status(400).json({
      message: "opUserId, hoursWorked et projectId sont obligatoires.",
    });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut saisir les heures.",
    });
  }

  if (isNaN(Number(hoursWorked)) || Number(hoursWorked) <= 0) {
    return res.status(400).json({ message: "Les heures doivent être un nombre positif." });
  }

  try {
    const id = addTimeLog(taskId, opUserId, { hoursWorked, loggedDate, note });
    refreshActualCost(taskId);
    res.status(201).json({ message: "Heures enregistrées.", id });
  } catch (err) {
    console.error("Erreur time log:", err.message);
    res.status(500).json({ message: "Erreur enregistrement des heures.", detail: err.message });
  }
});

router.get("/:taskId/timelogs", async (req, res) => {
  const { projectId } = req.query;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  if (projectId) {
    const access = getAccess(callerId, projectId, isAdmin);
    if (!access) return res.status(403).json({ message: "Accès refusé." });
  }

  try {
    const logs = getTimeLogsForTask(req.params.taskId);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: "Erreur récupération des heures.", detail: err.message });
  }
});

router.delete("/:taskId/timelogs/:logId", async (req, res) => {
  const { taskId, logId } = req.params;
  const { projectId } = req.body;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  if (!projectId) return res.status(400).json({ message: "projectId requis." });

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut supprimer des heures.",
    });
  }

  try {
    deleteTimeLog(logId);
    refreshActualCost(taskId);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Erreur suppression.", detail: err.message });
  }
});

module.exports = router;