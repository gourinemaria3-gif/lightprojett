"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Middleware — vérification du JWT LightProject
//
//  CORRECTIONS APPORTÉES :
//    - Vérification que JWT_SECRET est défini au démarrage
//    - Messages d'erreur distincts pour token manquant / format invalide /
//      expiré / signature incorrecte
//    - req.user enrichi avec les champs complets du payload JWT
// ══════════════════════════════════════════════════════════════════════════════

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

// Vérification au démarrage — pas à l'exécution de chaque requête
if (!JWT_SECRET) {
  console.error("FATAL : JWT_SECRET manquant dans .env. Le serveur va s'arrêter.");
  process.exit(1);
}

/**
 * Vérifie le Bearer JWT sur toutes les routes protégées.
 * Attache req.user = { userId, isAdmin, iat, exp } si valide.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({
      message: "Accès refusé : aucun token d'authentification fourni.",
    });
  }

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Format d'autorisation invalide. Utilisez : Bearer <token>",
    });
  }

  const token = authHeader.slice(7).trim(); // plus robuste que split(" ")[1]

  if (!token) {
    return res.status(401).json({ message: "Token vide après 'Bearer '." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, isAdmin, iat, exp }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expirée. Veuillez vous reconnecter." });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Token JWT invalide." });
    }
    // Autre erreur inattendue
    return res.status(401).json({ message: "Erreur d'authentification." });
  }
}

module.exports = verifyToken;