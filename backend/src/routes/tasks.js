"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/tasks
//
//  CORRECTIONS :
//    - PATCH /:taskId : filtre les champs inconnus d'OP (percentageDone, etc.)
//      pour éviter le 500 → OP retourne 422 sur champs non reconnus
//    - PATCH /:taskId : lockVersion récupéré automatiquement si absent
//    - PATCH /:taskId : meilleur message d'erreur avec détail OP
// ══════════════════════════════════════════════════════════════════════════════
const axios = require("axios");
const BASE_URL = process.env.OP_BASE_URL;
const makeAuthHeader = (opToken) => ({
  Authorization: "Basic " + Buffer.from(`apikey:${opToken}`).toString("base64"),
  "Content-Type": "application/json",
});
const express = require("express");
const router  = express.Router();

const { getTasks, patchTask, createTask, deleteTask } = require("../services/openproject");
const {
  addTimeLog,
  getTimeLogsForTask,
  deleteTimeLog,
  refreshActualCost,
  getMemberRole,
  getTaskExtension,
} = require("../database/db");
const { propagateBlockingFrom }   = require("../services/dependencies");
const { syncOneProject }          = require("../services/syncProjectStats");
const {
  notifyTaskAssigned,
  notifyTaskOverdue,
} = require("../services/notificationEngine");
const {
  updateEstimatedCostForTask,
  refreshBudgetForProject,
} = require("../services/budgetService");

// ──────────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────────
function getAccess(userId, projectId, isAdmin) {
  if (isAdmin) return { role: "admin" };
  return getMemberRole(userId, projectId);
}

function isOverdue(task) {
  if (!task?.dueDate) return false;
  const isClosed = task.isClosed === true ||
    ["done", "closed", "finished", "resolved", "rejected",
     "terminé", "terminée", "fermé", "fermée"]
      .includes((task._links?.status?.title || "").toLowerCase());
  if (isClosed) return false;
  // Comparaison string pour éviter décalage UTC
  const due   = String(task.dueDate).slice(0, 10);
  const now   = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  return due < today;
}

// ── CORRECTION : liste des champs acceptés par patchTask ─────────────────────
//  OP refuse les champs inconnus avec une 422 silencieuse côté OP
//  qui se transforme en 500 côté notre API car on ne l'intercepte pas.
//  On whiteliste explicitement les champs qu'on sait gérer.
const PATCH_ALLOWED_FIELDS = new Set([
  "subject",
  "description",
  "startDate",
  "dueDate",
  "estimatedHours",
  "assignee",
  "status",
  "lockVersion",
  // percentageDone est géré séparément via OP si nécessaire
]);

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/tasks/:projectId
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId", async (req, res) => {
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;
  const { projectId } = req.params;
  const opToken       = req.opToken;

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Vous n'avez pas accès à ce projet." });
  }

  try {
    const tasks = await getTasks(projectId, opToken);

    syncOneProject(projectId, opToken).catch(err =>
      console.error(`[tasks GET] Erreur sync stats projet ${projectId}:`, err.message)
    );

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
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;
  const { projectId } = req.params;
  const opToken       = req.opToken;

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

    if (req.body.estimatedHours) {
      updateEstimatedCostForTask(created.id, {
        estimatedHours: req.body.estimatedHours,
        projectId,
      });
    }

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

    syncOneProject(projectId, opToken).catch(err =>
      console.error("[tasks POST] Erreur sync stats:", err.message)
    );

    res.status(201).json(created);
  } catch (error) {
    console.error("Erreur création tâche:", error.response?.data || error.message);
    res.status(500).json({
      message: "Erreur création tâche.",
      detail:  error.response?.data || error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/tasks/:taskId
//
//  CORRECTIONS :
//    1. Filtre les champs non reconnus par OP avant d'appeler patchTask
//       → évite les 422 OP silencieux qui causaient le 500
//    2. Meilleure gestion d'erreur : on distingue 409 (lockVersion conflict),
//       422 (validation OP), et les autres erreurs
//    3. percentageDone : géré séparément si présent dans le body
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:taskId", async (req, res) => {
  const callerId          = req.user.userId;
  const isAdmin           = req.user.isAdmin;
  const { projectId }     = req.body;
  const opToken           = req.opToken;

  if (!projectId) {
    return res.status(400).json({ message: "projectId est requis dans le body." });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Vous n'avez pas accès à ce projet." });
  }

  if (access.role === "member") {
    const allowedKeys = ["status", "lockVersion", "projectId"];
    const forbidden   = Object.keys(req.body).filter((k) => !allowedKeys.includes(k));
    if (forbidden.length > 0) {
      return res.status(403).json({
        message: `En tant que membre, vous ne pouvez modifier que le statut. Champs refusés : ${forbidden.join(", ")}.`,
      });
    }
  }

  try {
    const { projectId: _removed, ...rawPatchData } = req.body;

    // ── CORRECTION : filtrer les champs non supportés par OP ─────────────
    //  percentageDone, type, priority, version, etc. ne se patchent pas
    //  directement via work_packages PATCH → OP répond 422 → notre catch → 500
    const patchData = {};
    for (const key of Object.keys(rawPatchData)) {
      if (PATCH_ALLOWED_FIELDS.has(key)) {
        patchData[key] = rawPatchData[key];
      } else {
        console.log(`[PATCH tasks] Champ ignoré (non supporté par OP): "${key}"`);
      }
    }

    // Récupère l'ancien assignee pour détecter le changement
    let oldAssigneeId = null;
    try {
      const taskRes = await axios.get(
        `${BASE_URL}/api/v3/work_packages/${req.params.taskId}`,
        { headers: makeAuthHeader(opToken), timeout: 8000 }
      );
      oldAssigneeId = taskRes.data._links?.assignee?.href
        ? Number(taskRes.data._links.assignee.href.split("/").pop())
        : null;

      // ── Si lockVersion absent du body, on le récupère depuis OP ─────────
      //  Évite le 409 "Stale object" quand le frontend oublie de l'envoyer
      if (patchData.lockVersion === undefined || patchData.lockVersion === null) {
        patchData.lockVersion = taskRes.data.lockVersion;
        console.log(`[PATCH tasks] lockVersion récupéré depuis OP: ${patchData.lockVersion}`);
      }
    } catch (e) {
      console.warn("Impossible de récupérer la tâche actuelle:", e.message);
    }

    const result = await patchTask(req.params.taskId, patchData, opToken);

    // Notif assignation si changée
    if (patchData.assignee !== undefined) {
      const newAssigneeId = result._links?.assignee?.href
        ? Number(result._links.assignee.href.split("/").pop())
        : null;

      if (newAssigneeId && newAssigneeId !== oldAssigneeId) {
        await notifyTaskAssigned({
          assigneeId:  newAssigneeId,
          taskTitle:   result.subject,
          projectName: `Projet #${projectId}`,
          taskId:      req.params.taskId,
        }).catch((err) => console.error("Erreur notifyTaskAssigned:", err.message));
      }
    }

    // Notif retard si dueDate définie et déjà dépassée
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

    // Recalcul coût estimé
    if (patchData.estimatedHours !== undefined) {
      let estimatedHours = patchData.estimatedHours;
      if (!estimatedHours && result.estimatedTime) {
        const str   = String(result.estimatedTime).toUpperCase();
        const days  = Number(str.match(/(\d+(?:\.\d+)?)D/)?.[1]  ?? 0);
        const hours = Number(str.match(/T(\d+(?:\.\d+)?)H/)?.[1] ?? 0);
        estimatedHours = days * 8 + hours;
      }
      if (estimatedHours) {
        updateEstimatedCostForTask(req.params.taskId, { estimatedHours, projectId });
      }
    }

    // Post-patch async
    try {
      await Promise.all([
        patchData.status
          ? propagateBlockingFrom(req.params.taskId, projectId, opToken)
          : Promise.resolve(),
        syncOneProject(projectId, opToken),
        refreshBudgetForProject(projectId),
      ]);
    } catch (err) {
      console.error("Erreur post-patch (propagation/stats/budget):", err.message);
    }

    res.json(result);

  } catch (error) {
    const opStatus = error.response?.status;
    const opData   = error.response?.data;

    console.error(`[PATCH tasks] Erreur OP status=${opStatus}:`, JSON.stringify(opData, null, 2));

    // ── Erreurs OP spécifiques → messages utiles côté client ─────────────
    if (opStatus === 409) {
      return res.status(409).json({
        message: "Conflit de version : la tâche a été modifiée entre-temps. Veuillez rafraîchir.",
        detail: opData,
      });
    }
    if (opStatus === 422) {
      const opMessage = opData?._embedded?.errors?.map(e => e.message).join(", ")
                     || opData?.message
                     || "Données invalides.";
      return res.status(422).json({
        message: `OpenProject a rejeté la mise à jour : ${opMessage}`,
        detail: opData,
      });
    }
    if (opStatus === 403) {
      return res.status(403).json({
        message: "OpenProject a refusé cette modification (droits insuffisants).",
        detail: opData,
      });
    }

    res.status(500).json({
      message: "Erreur mise à jour tâche.",
      detail:  opData || error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/tasks/:taskId
// ══════════════════════════════════════════════════════════════════════════════
router.delete("/:taskId", async (req, res) => {
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;
  const { projectId } = req.body;
  const opToken       = req.opToken;

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

    syncOneProject(projectId, opToken).catch(err =>
      console.error("[tasks DELETE] Erreur sync stats:", err.message)
    );

    res.status(204).send();
  } catch (error) {
    console.error("Erreur suppression tâche:", error.response?.data || error.message);
    if (error.response?.status === 403)
      return res.status(403).json({ message: "Droits insuffisants." });
    if (error.response?.status === 404)
      return res.status(404).json({ message: "Tâche introuvable." });
    res.status(500).json({
      message: "Impossible de supprimer la tâche.",
      detail:  error.response?.data || error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/tasks/:taskId/timelogs
// ══════════════════════════════════════════════════════════════════════════════
router.post("/:taskId/timelogs", async (req, res) => {
  const callerId   = req.user.userId;
  const isAdmin    = req.user.isAdmin;
  const { taskId } = req.params;
  const { opUserId, hoursWorked, loggedDate, note, projectId } = req.body;

  if (!opUserId || !hoursWorked || !projectId) {
    return res.status(400).json({
      message: "opUserId, hoursWorked et projectId sont obligatoires.",
    });
  }

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access) {
    return res.status(403).json({ message: "Accès refusé à ce projet." });
  }

  if (access.role === "member" && String(opUserId) !== String(callerId)) {
    return res.status(403).json({
      message: "En tant que membre, vous ne pouvez saisir que vos propres heures.",
    });
  }

  if (isNaN(Number(hoursWorked)) || Number(hoursWorked) <= 0) {
    return res.status(400).json({ message: "Les heures doivent être un nombre positif." });
  }

  try {
    const id = addTimeLog(taskId, opUserId, {
      hoursWorked: Number(hoursWorked),
      loggedDate:  loggedDate || new Date().toISOString().slice(0, 10),
      note:        note       || null,
    });

    refreshBudgetForProject(projectId).catch(err =>
      console.error("[budget] Erreur après time log:", err.message)
    );

    res.status(201).json({ message: "Heures enregistrées.", id });
  } catch (err) {
    console.error("Erreur time log:", err.message);
    res.status(500).json({ message: "Erreur enregistrement des heures.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/tasks/:taskId/timelogs
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:taskId/timelogs", async (req, res) => {
  const { projectId } = req.query;
  const callerId      = req.user.userId;
  const isAdmin       = req.user.isAdmin;

  if (projectId) {
    const access = getAccess(callerId, projectId, isAdmin);
    if (!access) return res.status(403).json({ message: "Accès refusé." });
  }

  try {
    const logs = getTimeLogsForTask(req.params.taskId);
    const ext  = getTaskExtension(Number(req.params.taskId));
    const rate = ext?.member_rate ?? null;

    const enriched = logs.map(log => ({
      ...log,
      member_rate:   rate,
      computed_cost: rate != null
        ? Math.round(log.hours_worked * rate * 100) / 100
        : null,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: "Erreur récupération des heures.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/tasks/:taskId/timelogs/:logId
// ══════════════════════════════════════════════════════════════════════════════
router.delete("/:taskId/timelogs/:logId", async (req, res) => {
  const { taskId, logId } = req.params;
  const { projectId }     = req.body;
  const callerId          = req.user.userId;
  const isAdmin           = req.user.isAdmin;

  if (!projectId) return res.status(400).json({ message: "projectId requis." });

  const access = getAccess(callerId, projectId, isAdmin);
  if (!access || access.role === "member") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut supprimer des heures.",
    });
  }

  try {
    deleteTimeLog(logId);

    refreshBudgetForProject(projectId).catch(err =>
      console.error("[budget] Erreur après suppression time log:", err.message)
    );

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Erreur suppression.", detail: err.message });
  }
});

module.exports = router;