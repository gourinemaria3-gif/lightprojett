"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/createproject
//
//  CORRECTIONS :
//    - Rollback : flag booléen `rolledBack` remplace le fragile
//      error.message.includes("Erreur DB locale") → logique de contrôle fiable
//    - Guard task.title conservé
//    - opToken via req.opToken (middleware attachOpToken)
//    - Validation inchangée
// ══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();

const { createProject, createTask, deleteProject, addMember } = require("../services/openproject");
const {
  upsertProjectMeta,
  deleteProjectMeta,
  upsertProjectMember,
  upsertUser,
  getMemberRole,
} = require("../database/db");
const { requireAdmin, requireManager } = require("../middleware/checkRole");

// ──────────────────────────────────────────────────────────────────────────────
//  VALIDATION
// ──────────────────────────────────────────────────────────────────────────────

function validateProjectPayload({ title, description, startDate, endDate, workload }) {
  const errors = [];
  if (!title || typeof title !== "string" || title.trim().length < 2)
    errors.push("Le titre doit contenir au moins 2 caractères.");
  if (title && title.trim().length > 200)
    errors.push("Le titre ne doit pas dépasser 200 caractères.");
  if (!description || typeof description !== "string" || description.trim().length < 5)
    errors.push("La description doit contenir au moins 5 caractères.");
  if (startDate && isNaN(Date.parse(startDate)))
    errors.push("La date de début est invalide.");
  if (endDate && isNaN(Date.parse(endDate)))
    errors.push("La date de fin est invalide.");
  if (startDate && endDate && new Date(startDate) > new Date(endDate))
    errors.push("La date de début ne peut pas être après la date de fin.");
  if (workload !== undefined && workload !== null && workload !== "") {
    if (isNaN(Number(workload)) || Number(workload) < 0)
      errors.push("Le workload doit être un nombre positif.");
  }
  return errors;
}

function validateTasksPayload(tasks) {
  const errors = [];
  (tasks || []).forEach((task, i) => {
    if (!task || typeof task !== "object") {
      errors.push(`Tâche ${i + 1} : objet invalide.`);
      return;
    }
    const p = `Tâche ${i + 1}`;
    if (!task.title || typeof task.title !== "string" || task.title.trim().length < 1)
      errors.push(`${p} : le titre est obligatoire.`);
    if (task.title && task.title.trim().length > 255)
      errors.push(`${p} : le titre ne doit pas dépasser 255 caractères.`);
    if (task.estimatedHours !== undefined && task.estimatedHours !== null && task.estimatedHours !== "") {
      if (isNaN(Number(task.estimatedHours)) || Number(task.estimatedHours) < 0)
        errors.push(`${p} : les heures estimées doivent être un nombre positif.`);
    }
    if (task.startDate && isNaN(Date.parse(task.startDate)))
      errors.push(`${p} : la date de début est invalide.`);
    if (task.dueDate && isNaN(Date.parse(task.dueDate)))
      errors.push(`${p} : la date de fin est invalide.`);
    if (task.startDate && task.dueDate && new Date(task.startDate) > new Date(task.dueDate))
      errors.push(`${p} : la date de début est après la date de fin.`);
  });
  return errors;
}

// ──────────────────────────────────────────────────────────────────────────────
//  safeDeleteProject — rollback sans exception
// ──────────────────────────────────────────────────────────────────────────────
async function safeDeleteProject(projectId, opToken) {
  try {
    await deleteProject(projectId, opToken);
  } catch (err) {
    console.error(`Rollback échoué pour projet ${projectId}:`, err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  handleProjectCreation
//
//  CORRECTION CRITIQUE : le rollback utilisait error.message.includes(...)
//  pour décider si le projet OP avait déjà été rollback — fragile et cassant
//  si le message change.
//
//  Remplacement par deux flags booléens :
//    - `opProjectCreated`  : true dès que createProject() réussit
//    - `rolledBack`        : true dès qu'un rollback OP a été exécuté
//
//  Le catch final ne tente un rollback que si opProjectCreated && !rolledBack.
// ──────────────────────────────────────────────────────────────────────────────
async function handleProjectCreation({
  projectData,
  tasks = [],
  managerId,
  managerName,
  managerEmail,
  opToken,
  parentId = null,
}) {
  let createdProject  = null;
  let metaSaved       = false;
  let opProjectCreated = false;
  let rolledBack       = false;

  try {
    // ── A. Créer le projet dans OpenProject ──────────────────
    createdProject = await createProject(
      { ...projectData, parentId },
      opToken
    );
    opProjectCreated = true;
    const projectId = createdProject.id;

    // ── B. Sauvegarder les métadonnées en DB locale ──────────
    try {
      upsertProjectMeta(projectId, {
        startDate: projectData.startDate,
        endDate:   projectData.endDate,
        workload:  projectData.workload,
      });
      metaSaved = true;
    } catch (dbError) {
      // Rollback OP si la DB locale échoue
      await safeDeleteProject(projectId, opToken);
      rolledBack = true;
      throw new Error(`Erreur DB locale : ${dbError.message}`);
    }

    // ── C. Enregistrer le chef de projet ─────────────────────
    if (managerId) {
      if (managerName && managerEmail) {
        upsertUser(managerId, { name: managerName, email: managerEmail });
      }
      upsertProjectMember(managerId, projectId, { role: "manager" });
      try {
        await addMember(projectId, managerId, opToken);
      } catch (memberError) {
        // 422 = déjà membre dans OP — pas grave
        if (memberError.response?.status !== 422) {
          console.warn("Impossible d'ajouter le manager dans OP:", memberError.message);
        }
      }
    }

    // ── D. Créer les tâches ───────────────────────────────────
    const createdTasks = [];
    for (const [i, task] of tasks.entries()) {
      if (!task?.title?.trim()) {
        await safeDeleteProject(projectId, opToken);
        rolledBack = true;
        if (metaSaved) deleteProjectMeta(projectId);
        throw new Error(`Tâche ${i + 1} : titre manquant.`);
      }
      try {
        const created = await createTask(projectId, task, opToken);
        createdTasks.push(created);
      } catch (taskError) {
        console.error(`Erreur tâche ${i + 1} détail:`, taskError.response?.data);
        await safeDeleteProject(projectId, opToken);
        rolledBack = true;
        if (metaSaved) deleteProjectMeta(projectId);
        throw new Error(
          `Échec tâche "${task.title}" (${i + 1}/${tasks.length}) : ${taskError.message}`
        );
      }
    }

    return { project: createdProject, tasks: createdTasks };

  } catch (error) {
    // Rollback de sécurité uniquement si le projet OP existe et n'a pas
    // encore été rollback par un bloc interne
    if (opProjectCreated && !rolledBack && createdProject?.id) {
      await safeDeleteProject(createdProject.id, opToken);
      if (metaSaved) deleteProjectMeta(createdProject.id);
    }
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  POST /api/createproject — Admin uniquement
// ──────────────────────────────────────────────────────────────────────────────
router.post("/", requireAdmin, async (req, res) => {
  const {
    title, description,
    startDate, endDate, workload,
    managerId, managerName, managerEmail,
    tasks = [],
  } = req.body;

  const projectErrors = validateProjectPayload({ title, description, startDate, endDate, workload });
  if (projectErrors.length)
    return res.status(400).json({ message: "Données projet invalides.", errors: projectErrors });

  const taskErrors = validateTasksPayload(tasks);
  if (taskErrors.length)
    return res.status(400).json({ message: "Tâches invalides.", errors: taskErrors });

  try {
    const result = await handleProjectCreation({
      projectData: { title, description, startDate, endDate, workload },
      tasks,
      managerId,
      managerName,
      managerEmail,
      opToken: req.opToken,
      parentId: null,
    });

    return res.status(201).json({
      message: "Projet créé avec succès.",
      project: result.project,
      tasks:   result.tasks,
    });

  } catch (error) {
    console.error("Erreur création projet principal:", error.message);
    return res.status(500).json({
      message: "Erreur lors de la création du projet.",
      detail:  error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
//  POST /api/createproject/sub/:parentProjectId — Manager ou Admin
// ──────────────────────────────────────────────────────────────────────────────
router.post("/sub/:parentProjectId", requireManager, async (req, res) => {
  const parentProjectId = parseInt(req.params.parentProjectId);
  const {
    title, description,
    startDate, endDate, workload,
    tasks = [],
    managerId,
    managerName,
    managerEmail,
  } = req.body;

  const projectErrors = validateProjectPayload({ title, description, startDate, endDate, workload });
  if (projectErrors.length)
    return res.status(400).json({ message: "Données sous-projet invalides.", errors: projectErrors });

  const taskErrors = validateTasksPayload(tasks);
  if (taskErrors.length)
    return res.status(400).json({ message: "Tâches invalides.", errors: taskErrors });

  const subManagerId    = managerId    || req.user.userId;
  const subManagerName  = managerName  || req.user.name;
  const subManagerEmail = managerEmail || req.user.email;

  if (managerId && managerId !== req.user.userId) {
    const membership = getMemberRole(managerId, parentProjectId);
    if (!membership) {
      return res.status(400).json({
        message: "La personne choisie n'est pas membre de ce projet parent.",
      });
    }
  }

  try {
    const result = await handleProjectCreation({
      projectData: { title, description, startDate, endDate, workload },
      tasks,
      managerId:    subManagerId,
      managerName:  subManagerName,
      managerEmail: subManagerEmail,
      opToken:      req.opToken,
      parentId:     parentProjectId,
    });

    return res.status(201).json({
      message:       "Sous-projet créé avec succès.",
      project:       result.project,
      tasks:         result.tasks,
      parentProject: parentProjectId,
      subManager: {
        id:   subManagerId,
        name: subManagerName,
      },
    });

  } catch (error) {
    console.error("Erreur création sous-projet:", error.message);
    return res.status(500).json({
      message: "Erreur lors de la création du sous-projet.",
      detail:  error.message,
    });
  }
});

module.exports = router;