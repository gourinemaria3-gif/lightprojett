"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/auth
//
//  CORRECTIONS APPORTÉES :
//    - Timeout axios augmenté à 10s (8s trop court sur certains réseaux)
//    - Nettoyage du token avant envoi (trim)
//    - Longueur minimale du token vérifiée (évite les requêtes OP inutiles)
//    - Gestion explicite de l'erreur réseau (ETIMEDOUT)
//    - logout : clearSession ne plante plus si la session n'existe pas
// ══════════════════════════════════════════════════════════════════════════════

const express    = require("express");
const router     = express.Router();
const axios      = require("axios");
const jwt        = require("jsonwebtoken");
const { upsertUser, saveSession, clearSession } = require("../database/db");
const verifyToken = require("../middleware/auth");

const BASE_URL   = process.env.OP_BASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const rawToken = req.body?.token;

  // Validation basique avant tout appel réseau
  if (!rawToken || typeof rawToken !== "string") {
    return res.status(400).json({ message: "Veuillez entrer votre token OpenProject." });
  }

  const token = rawToken.trim();

  if (token.length < 20) {
    return res.status(400).json({ message: "Token OpenProject invalide (trop court)." });
  }

  try {
    // ── Étape 1 : Vérifier le token auprès d'OpenProject ──────────────
    const opResponse = await axios.get(`${BASE_URL}/api/v3/users/me`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`apikey:${token}`).toString("base64"),
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const opUser = opResponse.data;

    // ── Étape 2 : Extraire les infos ───────────────────────────────────
    const userId  = opUser.id;
    const name    = opUser.name;
    const email   = opUser.email;
    const isAdmin = opUser.admin === true; // SOURCE DE VÉRITÉ = OpenProject

    // ── Étape 3 : Mettre à jour le cache local ─────────────────────────
    upsertUser(userId, { name, email, isAdmin });
    saveSession(userId, { opToken: token, isAdmin }); // token chiffré dans saveSession

    // ── Étape 4 : Générer le JWT LightProject ──────────────────────────
    const jwtToken = jwt.sign(
      { userId, isAdmin },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    // ── Étape 5 : Répondre ────────────────────────────────────────────
    return res.status(200).json({
      message: "Connexion réussie.",
      jwt: jwtToken,
      user: { id: userId, name, email, isAdmin },
    });

  } catch (error) {
    if (error.response?.status === 401) {
      return res.status(401).json({ message: "Token OpenProject invalide ou expiré." });
    }

    if (
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND"    ||
      error.code === "ETIMEDOUT"
    ) {
      return res.status(503).json({
        message: "Impossible de joindre OpenProject. Vérifiez la configuration serveur.",
      });
    }

    console.error("Erreur login:", error.message);
    return res.status(500).json({ message: "Erreur interne du serveur." });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/logout
// ─────────────────────────────────────────────────────────────
router.post("/logout", verifyToken, (req, res) => {
  try {
    clearSession(req.user.userId);
  } catch {
    // Session déjà inexistante — pas grave, on renvoie 200 quand même
  }
  return res.status(200).json({ message: "Déconnexion réussie." });
});

module.exports = router;