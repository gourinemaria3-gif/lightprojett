require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const express       = require("express");
const cors          = require("cors");
const https         = require("https");
const fs            = require("fs");
const path          = require("path");
const rateLimit     = require("express-rate-limit");
const verifyToken   = require("./src/middleware/auth");
const attachOpToken = require("./src/middleware/attachOpToken");

const authRouter          = require("./src/routes/auth");
const projectsRouter      = require("./src/routes/projects");
const tasksRouter         = require("./src/routes/tasks");
const createRouter        = require("./src/routes/createproject");
const aiRouter            = require("./src/routes/ai");
const depsRouter          = require("./src/routes/dependencies");
const notificationsRouter = require("./src/routes/notifications");
const budgetRouter        = require("./src/routes/budget");
const debugRouter         = require("./src/routes/debug");
const statsRouter         = require("./src/routes/stats");
const { startCron }       = require("./src/services/cron");

const REQUIRED_ENV = ["JWT_SECRET", "OP_BASE_URL", "ENCRYPTION_KEY"];
const missingEnv   = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`FATAL : Variables d'environnement manquantes : ${missingEnv.join(", ")}`);
  process.exit(1);
}

if (process.env.ENCRYPTION_KEY.length !== 64) {
  console.error("FATAL : ENCRYPTION_KEY doit faire 64 caractères hex (32 octets).");
  process.exit(1);
}

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

app.use(cors({
  origin:         "*",
  methods:        ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials:    false,
}));

app.use(express.json());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 1000,
  standardHeaders: true, legacyHeaders: false,
  message: { message: "Trop de requêtes." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { message: "Trop de tentatives de connexion." },
});

app.use("/api/", globalLimiter);
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth",       authRouter);

app.use("/api/projects/:projectId/stats", verifyToken, attachOpToken, statsRouter);
app.use("/api/projects",      verifyToken, attachOpToken, projectsRouter);
app.use("/api/tasks",         verifyToken, attachOpToken, tasksRouter);
app.use("/api/createproject", verifyToken, attachOpToken, createRouter);
app.use("/api/ai",            verifyToken, attachOpToken, aiRouter);
app.use("/api/dependencies",  verifyToken, attachOpToken, depsRouter);
app.use("/api/notifications", verifyToken, notificationsRouter);
app.use("/api/budget",        verifyToken, budgetRouter);
app.use("/api/debug",         verifyToken, debugRouter);

const PORT = process.env.PORT || 5001;

// ── Cherche les certificats SSL dans le dossier parent (même dossier que le frontend) ──
const certPath = path.resolve(__dirname, "..", "frontend", "192.168.1.72+2.pem");
const keyPath  = path.resolve(__dirname, "..", "frontend", "192.168.1.72+2-key.pem");

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  // ✅ HTTPS avec les mêmes certificats mkcert que le frontend
  const sslOptions = {
    cert: fs.readFileSync(certPath),
    key:  fs.readFileSync(keyPath),
  };
  https.createServer(sslOptions, app).listen(PORT, "0.0.0.0", () => {
    console.log(`✅ LightProject server running on HTTPS port ${PORT}`);
    console.log(`   CORS autorisé pour : ${FRONTEND_URL}`);
    console.log(`   Routes actives :`);
    console.log(`     /api/auth | /api/projects | /api/tasks | /api/createproject`);
    console.log(`     /api/ai   | /api/dependencies | /api/notifications | /api/budget | /api/debug`);
    console.log(`     /api/projects/:projectId/stats`);
  });
} else {
  // Fallback HTTP si pas de certificats
  console.warn(`⚠️  Certificats SSL non trouvés — démarrage en HTTP`);
  console.warn(`   Cherché : ${certPath}`);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ LightProject server running on HTTP port ${PORT}`);
  });
}

startCron();