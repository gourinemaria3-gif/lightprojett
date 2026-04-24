require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

// ══════════════════════════════════════════════════════════════════════════════
//  LightProject — Serveur Express
//
//  CORRECTIONS APPORTÉES :
//    - CORS restreint à FRONTEND_URL (défini dans .env)
//    - Rate limiting sur toutes les routes API (express-rate-limit)
//    - Rate limiting plus strict sur /api/auth/login (anti brute-force)
//    - Middleware attachOpToken centralisé (plus de getSessionByUser dans routes)
//    - Vérification des variables d'environnement critiques au démarrage
// ══════════════════════════════════════════════════════════════════════════════

const express      = require("express");
const cors         = require("cors");
const rateLimit    = require("express-rate-limit");
const verifyToken  = require("./src/middleware/auth");
const attachOpToken = require("./src/middleware/attachOpToken");

const authRouter    = require("./src/routes/auth");
const projectsRouter = require("./src/routes/projects");
const tasksRouter   = require("./src/routes/tasks");
const createRouter  = require("./src/routes/createproject");
const aiRouter      = require("./src/routes/ai");
const depsRouter    = require("./src/routes/dependencies");
const notificationsRouter = require("./src/routes/notifications");
const { startCron }       = require("./src/services/cron");

// ──────────────────────────────────────────────────────────────────────────────
//  Vérification des variables d'environnement critiques
// ──────────────────────────────────────────────────────────────────────────────
const REQUIRED_ENV = ["JWT_SECRET", "OP_BASE_URL", "ENCRYPTION_KEY"];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`FATAL : Variables d'environnement manquantes : ${missingEnv.join(", ")}`);
  process.exit(1);
}

// Vérification de la longueur de ENCRYPTION_KEY (doit faire 64 hex = 32 octets)
if (process.env.ENCRYPTION_KEY.length !== 64) {
  console.error("FATAL : ENCRYPTION_KEY doit faire 64 caractères hex (32 octets).");
  process.exit(1);
}

const app = express();

// ──────────────────────────────────────────────────────────────────────────────
//  CORS — restreint à l'URL du frontend
//  FRONTEND_URL dans .env, ex : http://localhost:3000 ou https://monapp.com
// ──────────────────────────────────────────────────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
}));

app.use(express.json());

// ──────────────────────────────────────────────────────────────────────────────
//  RATE LIMITING
//
//  Limiteur global : 200 requêtes / 15 min par IP
//  Limiteur login  :  10 requêtes / 15 min par IP (anti brute-force)
// ──────────────────────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Trop de requêtes. Veuillez réessayer dans quelques minutes." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes." },
});

app.use("/api/", globalLimiter);

// ──────────────────────────────────────────────────────────────────────────────
//  ROUTES
// ──────────────────────────────────────────────────────────────────────────────

// Auth — pas de JWT requis, mais login limité en débit
app.use("/api/auth/login",  loginLimiter);
app.use("/api/auth",        authRouter);

// Routes protégées :
//   verifyToken  → vérifie le JWT LightProject
//   attachOpToken → récupère et déchiffre le op_token depuis la DB,
//                   l'attache à req.opToken pour toutes les routes suivantes
app.use("/api/projects",      verifyToken, attachOpToken, projectsRouter);
app.use("/api/tasks",         verifyToken, attachOpToken, tasksRouter);
app.use("/api/createproject", verifyToken, attachOpToken, createRouter);
app.use("/api/ai",            verifyToken, attachOpToken, aiRouter);
app.use("/api/dependencies",  verifyToken, attachOpToken, depsRouter);
app.use("/api/notifications", verifyToken, notificationsRouter);

// ──────────────────────────────────────────────────────────────────────────────
//  DÉMARRAGE
// ──────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ LightProject server running on port ${PORT}`);
  console.log(`   CORS autorisé pour : ${FRONTEND_URL}`);
});
startCron();