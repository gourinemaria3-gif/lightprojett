"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Middleware — attachOpToken
//
//  NOUVEAU FICHIER (correction de l'architecture)
//
//  Problème corrigé :
//    Avant, chaque route appelait getSessionByUser(req.user.userId) + vérifiait
//    session?.op_token manuellement → code dupliqué dans tasks.js, projects.js,
//    createproject.js, etc.
//
//  Solution :
//    Ce middleware s'exécute APRÈS verifyToken sur toutes les routes protégées.
//    Il récupère le op_token déchiffré depuis la DB et l'attache à req.opToken.
//    Les routes n'ont plus qu'à utiliser req.opToken directement.
//
//  Usage dans server.js :
//    app.use("/api/projects", verifyToken, attachOpToken, projectsRouter);
//    app.use("/api/tasks",    verifyToken, attachOpToken, tasksRouter);
//    ...
// ══════════════════════════════════════════════════════════════════════════════

const { getSessionByUser } = require("../database/db");

function attachOpToken(req, res, next) {
  const session = getSessionByUser(req.user.userId);

  if (!session || !session.op_token) {
    return res.status(401).json({
      message: "Session expirée ou invalide. Veuillez vous reconnecter.",
    });
  }

  req.opToken = session.op_token; // token OP déchiffré, prêt à l'emploi
  next();
}

module.exports = attachOpToken;