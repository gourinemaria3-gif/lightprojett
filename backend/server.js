// Charger les variables d'environnement depuis le fichier .env
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const express = require("express");
// Importer le middleware CORS pour autoriser les requêtes depuis le frontend
const cors    = require("cors");
// Importer les routes de l'application
const projectsRouter = require("./src/routes/projects");  // gestion des projets
const tasksRouter    = require("./src/routes/tasks");     // gestion des tâches
const createRouter   = require("./src/routes/createproject");    
const aiRouter       = require("./src/routes/ai");         // analyse IA avec Gemini
// Créer l'application Express
const app = express();
// Activer CORS pour permettre au frontend de communiquer avec ce backend
app.use(cors());
// Middleware pour lire le JSON envoyé dans les requêtes
app.use(express.json());

// Définir les routes de l'application
app.use("/api/projects", projectsRouter);
app.use("/api/tasks",    tasksRouter);
app.use("/api/createproject",   createRouter);
app.use("/api/ai",       aiRouter);

// Route simple pour tester si le serveur fonctionne
app.get("/", (req, res) => {
  res.send("Backend Light Project fonctionne ✅");
});

// Définir le port du serveur
// si PORT existe dans .env on l'utilise
// sinon on utilise 5000 par défaut
const PORT = process.env.PORT || 5000;
// Démarrer le serveur Express
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});