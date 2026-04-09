const express = require("express");
const router  = express.Router();
const { createProject, createTask, deleteProject } = require("../services/openproject");
const { saveProjectMeta, deleteProjectMeta }       = require("../database/db");

// ══════════════════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════════════════
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
    const p = `Tâche ${i + 1}`;
    if (!task.title || task.title.trim().length < 1)
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

// ══════════════════════════════════════════════════════════════
//  POST /api/createproject
// ══════════════════════════════════════════════════════════════
router.post("/", async (req, res) => {
  const opToken = req.user.opToken; // ✅ extrait depuis le JWT

  const {
    title,
    description,
    tasks      = [],
    managerId,
    startDate,
    endDate,
    workload,
  } = req.body;

  // ── 1. Validation ───────────────────────────────────────────
  const projectErrors = validateProjectPayload({ title, description, startDate, endDate, workload });
  if (projectErrors.length)
    return res.status(400).json({ message: "Données projet invalides.", errors: projectErrors });

  const taskErrors = validateTasksPayload(tasks);
  if (taskErrors.length)
    return res.status(400).json({ message: "Tâches invalides.", errors: taskErrors });

  // ── 2. Création avec rollback ────────────────────────────────
  let createdProject = null;
  let metaSaved      = false;

  try {
    // Étape A — Créer le projet dans OpenProject
    createdProject = await createProject({ title, description, managerId }, opToken); // ✅
    const projectId = createdProject.id;

    // Étape B — Sauvegarder les métadonnées dans SQLite
    try {
      saveProjectMeta(projectId, { startDate, endDate, workload, managerId });
      metaSaved = true;
    } catch (dbError) {
      await deleteProject(projectId, opToken).catch(() => {}); // ✅
      return res.status(500).json({
        message: "Erreur base de données locale. Projet annulé.",
        detail:  dbError.message,
      });
    }

    // Étape C — Créer les tâches une par une
    const createdTasks = [];
    for (const [i, task] of tasks.entries()) {
      try {
        const created = await createTask(projectId, task, opToken); // ✅
        createdTasks.push(created);
      } catch (taskError) {
        // Rollback complet : supprimer projet OpenProject + meta SQLite
        await deleteProject(projectId, opToken).catch(() => {}); // ✅
        deleteProjectMeta(projectId);

        return res.status(500).json({
          message: `Échec à la tâche "${task.title}" (${i + 1}/${tasks.length}). Projet annulé.`,
          detail:  taskError.response?.data || taskError.message,
        });
      }
    }

    // ── Succès ─────────────────────────────────────────────────
    return res.status(201).json({
      message: "Projet créé avec succès",
      project: createdProject,
      tasks:   createdTasks,
    });

  } catch (error) {
    // Erreur inattendue — rollback si nécessaire
    if (createdProject?.id) {
      await deleteProject(createdProject.id, opToken).catch(() => {}); // ✅
      if (metaSaved) deleteProjectMeta(createdProject.id);
    }

    console.error("Erreur création projet:", error.response?.data || error.message);
    return res.status(500).json({
      message: "Erreur lors de la création du projet.",
      detail:  error.response?.data || error.message,
    });
  }
});

module.exports = router;