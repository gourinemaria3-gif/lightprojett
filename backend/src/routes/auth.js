"use strict";

const express    = require("express");
const router     = express.Router();
const axios      = require("axios");
const jwt        = require("jsonwebtoken");
const { db, upsertUser, saveSession, clearSession } = require("../database/db");
const verifyToken = require("../middleware/auth");

const BASE_URL   = process.env.OP_BASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const rawToken = req.body?.token;

  if (!rawToken || typeof rawToken !== "string") {
    return res.status(400).json({ message: "Veuillez entrer votre token OpenProject." });
  }

  const token = rawToken.trim();

  if (token.length < 20) {
    return res.status(400).json({ message: "Token OpenProject invalide (trop court)." });
  }

  try {
    const opResponse = await axios.get(`${BASE_URL}/api/v3/users/me`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`apikey:${token}`).toString("base64"),
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const opUser = opResponse.data;

    const userId  = opUser.id;
    const name    = opUser.name;
    const email   = opUser.email;
    const isAdmin = opUser.admin === true;

    upsertUser(userId, { name, email, isAdmin });
    saveSession(userId, { opToken: token, isAdmin });

    const jwtToken = jwt.sign(
      { userId, isAdmin },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

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
    // Session déjà inexistante — pas grave
  }
  return res.status(200).json({ message: "Déconnexion réussie." });
});

// ─────────────────────────────────────────────────────────────
//  PATCH /api/auth/fcm-token
// ─────────────────────────────────────────────────────────────
router.patch("/fcm-token", verifyToken, (req, res) => {
  const { fcmToken } = req.body;
  const userId = req.user.userId;

  if (!fcmToken) return res.status(400).json({ message: "Token FCM manquant." });

  try {
    db.prepare(`
      UPDATE current_session 
      SET fcm_token = ? 
      WHERE op_user_id = ?
    `).run(fcmToken, userId);

    res.json({ message: "FCM token sauvegardé." });
  } catch (err) {
    res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

module.exports = router;