// Importer la librairie axios pour faire des requêtes HTTP vers l'API OpenProject
const axios = require("axios");
// Récupérer l'URL et token depuis (.env)
const BASE_URL = process.env.OP_BASE_URL;
const TOKEN    = process.env.OP_TOKEN;
// Créer l'en-tête d'authentification pour toutes les requêtes
// OpenProject utilise l'authentification Basic avec "apikey:TOKEN"
const authHeader = {
  Authorization: "Basic " + Buffer.from("apikey:" + TOKEN).toString("base64"),
  "Content-Type": "application/json",
};

// Récupère tous les projets
async function getProjects() {
  const res = await axios.get(`${BASE_URL}/api/v3/projects?pageSize=50`, {
    headers: authHeader,
  });
  return res.data._embedded.elements;
}

// Récupère les tâches d'un projet
async function getTasks(projectId) {
  const filters = encodeURIComponent(
    JSON.stringify([{ project: { operator: "=", values: [String(projectId)] } }])
  );
  const res = await axios.get(
    `${BASE_URL}/api/v3/work_packages?filters=${filters}&pageSize=100`,
    { headers: authHeader }
  );
  return res.data._embedded.elements;
}

// Récupère tous les utilisateurs
async function getMembers() {
  const res = await axios.get(`${BASE_URL}/api/v3/users?pageSize=50`, {
    headers: authHeader,
  });
  return res.data._embedded.elements;
}

// Crée un projet dans OpenProject
async function createProject(data) {
  // Construire le corps (body) de la requête
  const body = {
    name: data.title,
     // Identifier unique du projet (généré automatiquement)
    identifier: data.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 100),
    description: {
      format: "markdown",
      raw: data.description,
    },
    _links: {},
  };

  const res = await axios.post(`${BASE_URL}/api/v3/projects`, body, {
    headers: authHeader,
  });
  return res.data;
}

async function createTask(projectId, task) {
  const typesRes = await axios.get(
    `${BASE_URL}/api/v3/projects/${projectId}/types`,
    { headers: authHeader }
  );
  const types = typesRes.data._embedded.elements;
  const taskType =
    types.find((t) =>
      t.name.toLowerCase().includes("task") ||
      t.name.toLowerCase().includes("tâche")
    ) || types[0];

  // Convertir heures → format ISO 8601 attendu par OpenProject
  function toIsoDuration(hours) {
    const h = parseFloat(hours);
    if (!hours || isNaN(h) || h <= 0) return null;
    return `PT${h}H`;
  }

  const body = {
    subject: task.title,
    description: {
      format: "markdown",
      raw: task.description || "",
    },
    _links: {
      project: { href: `/api/v3/projects/${projectId}` },
      type:    { href: taskType._links.self.href },
    },
  };

  // Ajouter les champs optionnels seulement s'ils ont une valeur
  if (task.startDate) body.startDate = task.startDate;
  if (task.dueDate)   body.dueDate   = task.dueDate;
  const duration = toIsoDuration(task.estimatedHours);
  if (duration)       body.estimatedTime = duration;

  console.log("=== BODY ENVOYÉ À OPENPROJECT ===", JSON.stringify(body, null, 2));

  const res = await axios.post(`${BASE_URL}/api/v3/work_packages`, body, {
    headers: authHeader,
  });
  return res.data;
}
// Exporter toutes les fonctions pour pouvoir les utiliser dans les routes
module.exports = { getProjects, getTasks, getMembers, createProject, createTask };