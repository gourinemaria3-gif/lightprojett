const express = require("express");
const router  = express.Router();
const { createProject, createTask } = require("../services/openproject");
const { saveProjectMeta } = require("../database/db");

router.post("/", async (req, res) => {
  const { title, description, tasks, managerId, endDate, workload } = req.body;

  if (!title || !description) {
    return res.status(400).json({ message: "Titre et description obligatoires" });
  }

  try {
    // Créer le projet dans OpenProject
    const project = await createProject({ title, description, managerId });
    const projectId = project.id;

    // Sauvegarder les métadonnées dans SQLite
    saveProjectMeta(projectId, { endDate, workload, managerId });

    // Créer les tâches
    const createdTasks = [];
    for (const task of tasks || []) {
      const created = await createTask(projectId, task);
      createdTasks.push(created);
    }

    res.json({
      message: "Projet créé avec succès",
      project,
      tasks: createdTasks,
    });
  } catch (error) {
    console.error("Erreur création:", error.response?.data || error.message);
    res.status(500).json({
      message: "Erreur lors de la création",
      detail: error.response?.data || error.message,
    });
  }
});

module.exports = router;