const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const {
  analyzeProject,
  analyzeProjectRisk,
  chatWithAI,
  generateWeeklyReport,
  generateTaskPlan,
  generateTaskGuide,
  detectTaskBlockage,
  generateMemberSummary,
} = require("../services/groq");

function handleAIError(err, res) {
  console.error("Erreur IA:", err.message);
  if (err.message?.includes("GROQ_API_KEY")) {
    return res.status(500).json({ message: "Clé Groq non configurée dans .env" });
  }
  if (err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("rate_limit")) {
    return res.status(429).json({ message: "Quota Groq dépassé — attends quelques secondes" });
  }
  if (err.message?.includes("Format IA invalide")) {
    return res.status(500).json({ message: "L'IA n'a pas retourné un format valide, réessaie" });
  }
  if (err.message?.includes("401") || err.message?.includes("invalid_api_key")) {
    return res.status(401).json({ message: "Clé Groq invalide — vérifie ton .env" });
  }
  res.status(500).json({ message: "Erreur IA", detail: err.message });
}

// POST /api/ai/analyze — générer tâches d'un projet
router.post("/analyze", auth, async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ message: "Titre et description obligatoires" });
  }
  try {
    const result = await analyzeProject(title, description);
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

// POST /api/ai/risk — score de risque d'un projet
router.post("/risk", auth, async (req, res) => {
  const { name, totalTasks, doneTasks, lateTasks, progress } = req.body;
  if (!name) return res.status(400).json({ message: "Données du projet obligatoires" });
  try {
    const result = await analyzeProjectRisk({ name, totalTasks, doneTasks, lateTasks, progress });
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

// POST /api/ai/chat — chat sur un projet
router.post("/chat", auth, async (req, res) => {
  const { projectContext, question } = req.body;
  if (!question) return res.status(400).json({ message: "Question obligatoire" });
  try {
    const result = await chatWithAI(projectContext || {}, question);
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

// POST /api/ai/report — rapport hebdomadaire
router.post("/report", auth, async (req, res) => {
  const { projects } = req.body;
  if (!projects || !Array.isArray(projects)) {
    return res.status(400).json({ message: "Liste de projets obligatoire" });
  }
  try {
    const result = await generateWeeklyReport(projects);
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

// POST /api/ai/task-plan — plan de travail pour une tâche
router.post("/task-plan", auth, async (req, res) => {
  const { title, description, type, estimatedHours } = req.body;
  if (!title || !description) {
    return res.status(400).json({ message: "Titre et description obligatoires" });
  }
  try {
    const result = await generateTaskPlan({ title, description, type, estimatedHours });
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

// POST /api/ai/task-guide — guide Q&R automatique
router.post("/task-guide", auth, async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ message: "Titre et description obligatoires" });
  }
  try {
    const result = await generateTaskGuide({ title, description });
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

// POST /api/ai/task-blockage — détection de blocage
router.post("/task-blockage", auth, async (req, res) => {
  const { title, description, status, daysStuck } = req.body;
  if (!title || !description) {
    return res.status(400).json({ message: "Titre et description obligatoires" });
  }
  try {
    const result = await detectTaskBlockage({ title, description, status, daysStuck });
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

// POST /api/ai/member-summary — résumé personnalisé membre
router.post("/member-summary", auth, async (req, res) => {
  const { name, totalTasks, doneTasks, lateTasks, inProgressTasks, tasks } = req.body;
  if (!name) return res.status(400).json({ message: "Nom du membre obligatoire" });
  try {
    const result = await generateMemberSummary({ name, totalTasks, doneTasks, lateTasks, inProgressTasks, tasks });
    res.json(result);
  } catch (err) {
    handleAIError(err, res);
  }
});

module.exports = router;