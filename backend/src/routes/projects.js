"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/projects
//
//  CORRECTIONS :
//    - POST /:projectId/members : validation hourlyRate (Number(NaN) bloqué)
//    - opToken via req.opToken partout (middleware attachOpToken)
// ══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();
const {
  getProjects,
  getMembers,
  deleteProject,
  syncProjectMembers,
  createProject,
} = require("../services/openproject");
const {
  getAllProjectsMeta,
  getProjectManager,
  getProjectMembers,
  getMemberRole,
  upsertProjectMember,
  removeProjectMember,
  upsertUser,
} = require("../database/db");
const { requireAdmin, requireManager } = require("../middleware/checkRole");

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/projects
// ══════════════════════════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;
  const opToken  = req.opToken;

  try {
    const [projects, allMeta] = await Promise.all([
      getProjects(opToken),
      Promise.resolve(getAllProjectsMeta()),
    ]);

    const metaMap = {};
    allMeta.forEach((m) => { metaMap[m.op_project_id] = m; });

    const enriched = projects.map((p) => {
      const meta    = metaMap[p.id] || {};
      const manager = getProjectManager(p.id);
      return {
        ...p,
        startDate:    meta.start_date    || null,
        endDate:      meta.end_date      || null,
        workload:     meta.workload      || null,
        progress:     meta.progress      || 0,
        riskScore:    meta.risk_score    || 0,
        lateTasks:    meta.late_tasks    || 0,
        blockedTasks: meta.blocked_tasks || 0,
        aiSummary:    meta.ai_summary    || null,
        budgetTotal:  meta.budget_total  || null,
        managerId:    manager?.op_user_id || null,
        managerName:  manager?.name       || null,
      };
    });

    if (isAdmin) return res.json(enriched);

    const visible = enriched.filter((p) => !!getMemberRole(callerId, p.id));
    return res.json(visible);

  } catch (error) {
    console.error("Erreur récupération projets:", error.message);
    if (error.response?.status === 401)
      return res.status(401).json({ message: "Token invalide. Veuillez vous reconnecter." });
    res.status(500).json({ message: "Impossible de récupérer les projets." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/projects/members — tous les users OP (pour select)
//  ⚠️  DOIT être avant /:projectId pour éviter le conflit de route
// ══════════════════════════════════════════════════════════════════════════════
router.get("/members", async (req, res) => {
  try {
    const members = await getMembers(req.opToken);
    res.json(members);
  } catch (error) {
    console.error("Erreur récupération membres:", error.message);
    res.status(500).json({ message: "Impossible de récupérer les membres." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/projects/:projectId/members
// ══════════════════════════════════════════════════════════════════════════════
router.get("/:projectId/members", async (req, res) => {
  const { projectId } = req.params;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  if (!isAdmin && !getMemberRole(callerId, projectId)) {
    return res.status(403).json({ message: "Accès refusé à ce projet." });
  }

  try {
    const opMembers = await syncProjectMembers(projectId, req.opToken);

    for (const m of opMembers) {
      try {
        upsertUser(m.id, { name: m.name, email: m.email || `user${m.id}@openproject.local` });
        const existing = getMemberRole(m.id, projectId);
        if (!existing) {
          upsertProjectMember(m.id, projectId, { role: "member" });
        }
      } catch (e) {
        console.warn(`Skip membre ${m.id}:`, e.message);
      }
    }

    const members = getProjectMembers(projectId);
    res.json(members);
  } catch (err) {
    console.error("Erreur récupération membres du projet:", err.message);
    res.status(500).json({ message: "Erreur récupération membres du projet." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/projects/:projectId/members
//
//  CORRECTION : validation hourlyRate ajoutée
//  Avant : Number("abc") = NaN passait sans erreur
// ══════════════════════════════════════════════════════════════════════════════
router.post("/:projectId/members", requireManager, async (req, res) => {
  const { projectId } = req.params;
  const { opUserId, name, email, role = "member", hourlyRate } = req.body;

  if (!opUserId) {
    return res.status(400).json({ message: "opUserId est obligatoire." });
  }

  if (!["manager", "member"].includes(role)) {
    return res.status(400).json({ message: "Rôle invalide. Valeurs acceptées : manager, member." });
  }

  // CORRECTION : validation explicite de hourlyRate
  let parsedHourlyRate = null;
  if (hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== "") {
    parsedHourlyRate = Number(hourlyRate);
    if (isNaN(parsedHourlyRate) || parsedHourlyRate < 0) {
      return res.status(400).json({ message: "Taux horaire invalide (doit être un nombre positif)." });
    }
  }

  try {
    upsertUser(opUserId, { name, email: email || `user${opUserId}@openproject.local` });
    upsertProjectMember(opUserId, projectId, {
      role,
      hourlyRate: parsedHourlyRate,
    });
    const members = getProjectMembers(projectId);
    res.status(201).json(members);
  } catch (err) {
    console.error("Erreur ajout membre:", err.message);
    res.status(500).json({ message: "Erreur ajout membre.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/projects/:projectId/subprojects
// ══════════════════════════════════════════════════════════════════════════════
router.post("/:projectId/subprojects", async (req, res) => {
  const { projectId } = req.params;
  const { title, description } = req.body;
  const callerId = req.user.userId;
  const isAdmin  = req.user.isAdmin;

  const memberRole = getMemberRole(callerId, projectId);
  if (!isAdmin && memberRole?.role !== "manager") {
    return res.status(403).json({
      message: "Seul le chef de projet ou l'admin peut créer des sous-projets.",
    });
  }

  if (!title?.trim()) {
    return res.status(400).json({ message: "Le titre est obligatoire." });
  }
  if (!description?.trim()) {
    return res.status(400).json({ message: "La description est obligatoire." });
  }

  try {
    const created = await createProject(
      { title: title.trim(), description: description.trim(), parentId: projectId },
      req.opToken
    );
    res.status(201).json(created);
  } catch (error) {
    console.error("Erreur création sous-projet:", error.response?.data || error.message);
    if (error.response?.status === 403)
      return res.status(403).json({
        message: "Droits insuffisants pour créer un sous-projet dans OpenProject.",
      });
    res.status(500).json({
      message: "Impossible de créer le sous-projet.",
      detail: error.response?.data || error.message,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/projects/:projectId/members/:userId/role
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId/members/:userId/role", requireManager, async (req, res) => {
  const { projectId, userId } = req.params;
  const { role } = req.body;

  if (!["manager", "member"].includes(role)) {
    return res.status(400).json({ message: "Rôle invalide. Valeurs acceptées : manager, member." });
  }

  const existing = getMemberRole(userId, projectId);
  if (!existing) {
    return res.status(404).json({ message: "Cet utilisateur n'est pas membre du projet." });
  }

  try {
    upsertProjectMember(userId, projectId, { role, hourlyRate: existing.hourly_rate });
    res.json({ message: "Rôle mis à jour.", userId, role });
  } catch (err) {
    res.status(500).json({ message: "Erreur mise à jour du rôle.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PATCH /api/projects/:projectId/members/:userId/rate
// ══════════════════════════════════════════════════════════════════════════════
router.patch("/:projectId/members/:userId/rate", async (req, res) => {
  const { projectId, userId } = req.params;
  const { hourlyRate } = req.body;
  const callerId = req.user.userId;

  if (!req.user.isAdmin && String(callerId) !== String(userId)) {
    return res.status(403).json({
      message: "Vous ne pouvez modifier que votre propre taux horaire.",
    });
  }
  if (hourlyRate === undefined || isNaN(Number(hourlyRate)) || Number(hourlyRate) < 0) {
    return res.status(400).json({ message: "Taux horaire invalide." });
  }

  const existing = getMemberRole(userId, projectId);
  if (!existing) {
    return res.status(404).json({ message: "Cet utilisateur n'est pas membre de ce projet." });
  }

  try {
    upsertProjectMember(userId, projectId, { role: existing.role, hourlyRate: Number(hourlyRate) });
    res.json({ message: "Taux horaire mis à jour.", hourlyRate: Number(hourlyRate) });
  } catch (err) {
    res.status(500).json({ message: "Erreur mise à jour taux horaire.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/projects/:projectId/members/:userId
// ══════════════════════════════════════════════════════════════════════════════
router.delete("/:projectId/members/:userId", requireManager, async (req, res) => {
  const { projectId, userId } = req.params;

  const existing = getMemberRole(userId, projectId);
  if (!existing) {
    return res.status(404).json({ message: "Cet utilisateur n'est pas membre du projet." });
  }

  try {
    removeProjectMember(userId, projectId);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: "Erreur suppression membre.", detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/projects/:projectId — Admin uniquement
// ══════════════════════════════════════════════════════════════════════════════
router.delete("/:projectId", requireAdmin, async (req, res) => {
  try {
    await deleteProject(req.params.projectId, req.opToken);
    res.status(204).send();
  } catch (error) {
    console.error("Erreur suppression projet:", error.response?.data || error.message);
    if (error.response?.status === 403)
      return res.status(403).json({ message: "Vous n'avez pas les droits pour supprimer ce projet." });
    if (error.response?.status === 404)
      return res.status(404).json({ message: "Projet introuvable." });
    res.status(500).json({
      message: "Impossible de supprimer le projet.",
      detail: error.response?.data || error.message,
    });
  }
});

module.exports = router;