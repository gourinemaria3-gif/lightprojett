const express = require("express");
const router = express.Router();
// Importer la fonction getTasks depuis le service openproject
// Cette fonction va récupérer les tâches depuis l'API OpenProject
const { getTasks } = require("../services/openproject");
// Cette route permet de récupérer les tâches d’un projet spécifique
router.get("/:projectId", async (req, res) => {
  try {
    const tasks = await getTasks(req.params.projectId);
    res.json(tasks);
  } catch (error) {
    console.error("Erreur tâches:", error.message);
    if (error.response?.status === 401)
      return res.status(401).json({ message: "Token invalide" });
    res.status(500).json({ message: "Erreur serveur", detail: error.message });
  }
});

module.exports = router;