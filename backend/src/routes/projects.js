const express = require("express");
const router  = express.Router();
const { getProjects, getMembers } = require("../services/openproject");
const { getAllProjectsMeta }       = require("../database/db");

// GET /api/projects — fusionner OpenProject + SQLite
router.get("/", async (req, res) => {
  const opToken = req.user.opToken; // ✅ extrait depuis le JWT

  try {
    const [projects, allMeta] = await Promise.all([
      getProjects(opToken),                          // ✅
      Promise.resolve(getAllProjectsMeta()),
    ]);

    // Map id → meta pour accès O(1)
    const metaMap = {};
    allMeta.forEach((m) => { metaMap[m.project_id] = m; });

    // Fusionner les données OpenProject + SQLite
    const enriched = projects.map((p) => {
      const meta = metaMap[p.id] || {};
      return {
        ...p,
        startDate:  meta.start_date  || null,
        endDate:    meta.end_date    || null,
        workload:   meta.workload    || null,
        managerId:  meta.manager_id  || null,
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error("Erreur récupération projets", error.message);
    if (error.response?.status === 401)
      return res.status(401).json({ message: "Le token OpenProject est incorrect. Veuillez vous reconnecter." });
    res.status(500).json({ message: "Impossible de récupérer les projets pour le moment. Veuillez réessayer plus tard." });
  }
});

// GET /api/projects/members
router.get("/members", async (req, res) => {
  const opToken = req.user.opToken; // ✅ extrait depuis le JWT

  try {
    const members = await getMembers(opToken); // ✅
    res.json(members);
  } catch (error) {
    console.error("Erreur récupération membres:", error.message);
    res.status(500).json({ message: "Erreur serveur", detail: error.message });
  }
});

module.exports = router;