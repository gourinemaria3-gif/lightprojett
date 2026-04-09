const express = require("express");
const router  = express.Router();
const { getTasks, patchTask, createTask } = require("../services/openproject");

// ⚠️  ORDRE IMPORTANT : la route statique "/project/:projectId" doit être
//     déclarée AVANT la route dynamique "/:taskId" pour éviter le conflit Express.

// POST /api/tasks/project/:projectId — créer une tâche dans un projet
router.post("/project/:projectId", async (req, res) => {
  const opToken = req.user.opToken; // ✅ extrait depuis le JWT

  try {
    const created = await createTask(req.params.projectId, req.body, opToken); // ✅
    res.status(201).json(created);
  } catch (error) {
    console.error("Erreur création tâche:", error.response?.data || error.message);
    res.status(500).json({
      message: "Erreur création tâche",
      detail:  error.response?.data || error.message,
    });
  }
});

// GET /api/tasks/:projectId — récupérer les tâches d'un projet
router.get("/:projectId", async (req, res) => {
  const opToken = req.user.opToken; // ✅ extrait depuis le JWT

  try {
    const tasks = await getTasks(req.params.projectId, opToken); // ✅
    res.json(tasks);
  } catch (error) {
    console.error("Erreur tâches:", error.message);
    if (error.response?.status === 401)
      return res.status(401).json({ message: "Token invalide" });
    res.status(500).json({ message: "Erreur serveur", detail: error.message });
  }
});

// PATCH /api/tasks/:taskId — modifier une tâche existante
router.patch("/:taskId", async (req, res) => {
  const opToken = req.user.opToken; // ✅ extrait depuis le JWT

  try {
    const result = await patchTask(req.params.taskId, req.body, opToken); // ✅
    res.json(result);
  } catch (error) {
    console.error("Erreur patch tâche:", error.response?.data || error.message);
    res.status(500).json({
      message: "Erreur mise à jour tâche",
      detail:  error.response?.data || error.message,
    });
  }
});

module.exports = router;