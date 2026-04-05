const express = require("express");
const router  = express.Router();
const { getProjects, getMembers } = require("../services/openproject");
const { getAllProjectsMeta, getProjectMeta } = require("../database/db");

// GET /api/projects — fusionner OpenProject + SQLite
router.get("/", async (req, res) => {
  try {
    const projects = await getProjects();
    const allMeta  = getAllProjectsMeta();

    // Créer un map id → meta pour accès rapide
    const metaMap = {};
    allMeta.forEach((m) => { metaMap[m.project_id] = m; });

    // Fusionner
    const enriched = projects.map((p) => {
      const meta = metaMap[p.id] || {};
      return {
        ...p,
        endDate:   meta.end_date   || null,
        workload:  meta.workload   || null,
        managerId: meta.manager_id || null,
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error("Erreur projets:", error.message);
    if (error.response?.status === 401)
      return res.status(401).json({ message: "Token invalide" });
    res.status(500).json({ message: "Erreur serveur", detail: error.message });
  }
});

// GET /api/projects/members
router.get("/members", async (req, res) => {
  try {
    const members = await getMembers();
    res.json(members);
  } catch (error) {
    console.error("Erreur membres:", error.message);
    res.status(500).json({ message: "Erreur serveur", detail: error.message });
  }
});

module.exports = router;