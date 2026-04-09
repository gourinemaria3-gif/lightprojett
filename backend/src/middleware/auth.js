const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
  return res.status(401).json({
    message:"Accès refusé : aucun token d'authentification fourni"
  });
}

if (!authHeader.startsWith("Bearer ")) {
  return res.status(401).json({
    message: "Format d'autorisation invalide"
  });
}

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;   
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token JWT invalide ou expiré." });
  }
}

module.exports = verifyToken;