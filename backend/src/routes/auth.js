const express = require("express");
const router  = express.Router();
const axios   = require("axios");
const jwt     = require("jsonwebtoken");

const BASE_URL    = process.env.OP_BASE_URL;
const JWT_SECRET  = process.env.JWT_SECRET;

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { token } = req.body;

  if (!token || token.trim() === "")
    return res.status(400).json({ message: "Veuillez entrer votre token OpenProject." });

  try {
    // Vérifier le token auprès d'OpenProject
    const authHeader = "Basic " + Buffer.from(`apikey:${token}`).toString("base64");

    const response = await axios.get(`${BASE_URL}/api/v3/users/me`, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    const opUser = response.data;

    // Générer un JWT qui contient le token OP + infos user
    const jwtPayload = {
      userId:   opUser.id,
      name:     opUser.name,
      email:    opUser.email,
      opToken:  token,          // ← on stocke le token OP dans le JWT
    };

    const jwtToken = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: "8h" });

    return res.json({
      message: "Connexion réussie",
      jwt:     jwtToken,
      user: {
        id:    opUser.id,
        name:  opUser.name,
        email: opUser.email,
      },
    });

  } catch (error) {
    if (error.response?.status === 401)
      return res.status(401).json({ message: "Le token OpenProject est incorrect." });

    console.error("Erreur login:", error.message);
    return res.status(500).json({ message: "Une erreur interne est survenue. Veuillez réessayer plus tard." });
  }
});

module.exports = router;