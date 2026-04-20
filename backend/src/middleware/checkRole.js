"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Middleware — vérification des rôles LightProject
//
//  CORRECTIONS APPORTÉES :
//    - requireManager accepte aussi req.params.parentProjectId
//      (utilisé dans POST /createproject/sub/:parentProjectId)
//    - requireMember renvoie 403 si l'utilisateur n'est pas membre
//      (avant : le message était peu clair)
//    - Commentaires explicatifs sur la priorité admin → manager → member
// ══════════════════════════════════════════════════════════════════════════════

const { getMemberRole } = require("../database/db");

// ──────────────────────────────────────────────────────────────────────────────
//  requireAdmin — réservé à l'admin global LightProject
// ──────────────────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Accès réservé à l'administrateur." });
  }
  next();
}

// ──────────────────────────────────────────────────────────────────────────────
//  requireManager — admin OU chef de projet du projet concerné
//
//  Résolution du projectId (par ordre de priorité) :
//    1. req.params.projectId         → routes /:projectId/...
//    2. req.params.parentProjectId   → routes /sub/:parentProjectId
//    3. req.body.projectId           → routes POST avec projectId dans le body
//    4. req.query.projectId          → routes GET avec ?projectId=...
// ──────────────────────────────────────────────────────────────────────────────
function requireManager(req, res, next) {
  // Admin global → accès direct
  if (req.user?.isAdmin) return next();

  const projectId =
    req.params.projectId        ||
    req.params.parentProjectId  ||
    req.body?.projectId         ||
    req.query?.projectId;

  if (!projectId) {
    return res.status(400).json({ message: "projectId manquant pour vérifier le rôle." });
  }

  const membership = getMemberRole(req.user.userId, projectId);
  if (!membership || membership.role !== "manager") {
    return res.status(403).json({
      message: "Accès réservé au chef de projet ou à l'administrateur.",
    });
  }
  next();
}

// ──────────────────────────────────────────────────────────────────────────────
//  requireMember — admin OU n'importe quel membre du projet (manager inclus)
// ──────────────────────────────────────────────────────────────────────────────
function requireMember(req, res, next) {
  if (req.user?.isAdmin) return next();

  const projectId =
    req.params.projectId ||
    req.body?.projectId  ||
    req.query?.projectId;

  if (!projectId) {
    return res.status(400).json({ message: "projectId manquant pour vérifier l'accès." });
  }

  const membership = getMemberRole(req.user.userId, projectId);
  if (!membership) {
    return res.status(403).json({
      message: "Vous n'êtes pas membre de ce projet.",
    });
  }
  next();
}

module.exports = { requireAdmin, requireManager, requireMember };