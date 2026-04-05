const express = require("express");
const router  = express.Router();
const { analyzeProject } = require("../services/gemini");

router.post("/analyze", async (req, res) => {
  const { title, description } = req.body;

  if (!title || !description) {
    return res.status(400).json({ 
      message: "Titre et description obligatoires" 
    });
  }

  try {
    const result = await analyzeProject(title, description);
    res.json(result);
  } catch (error) {
    console.error("Erreur Gemini:", error.message);

    // Quota dépassé
    if (error.message?.includes("429") || error.message?.includes("quota")) {
      return res.status(429).json({ 
        message: "Quota Gemini dépassé",
        detail: "Génère une nouvelle clé sur aistudio.google.com"
      });
    }

    res.status(500).json({ 
      message: "Erreur IA", 
      detail: error.message 
    });
  }
});

module.exports = router;