const axios = require("axios");

const BASE_URL = process.env.OP_BASE_URL;

function makeAuthHeader(opToken) {
  return {
    Authorization: "Basic " + Buffer.from(`apikey:${opToken}`).toString("base64"),
    "Content-Type": "application/json",
  };
}

// ══════════════════════════════════════════════════════════════
//  HELPERS INTERNES
// ══════════════════════════════════════════════════════════════

// Cache des types par projet — évite N appels API pour N tâches
const _typesCache = {};

async function _getTaskType(projectId, opToken) {
  if (_typesCache[projectId]) return _typesCache[projectId];

  const res = await axios.get(
    `${BASE_URL}/api/v3/projects/${projectId}/types`,
    { headers: makeAuthHeader(opToken) }
  );
  const types = res.data._embedded.elements;
  const taskType =
    types.find((t) =>
      t.name.toLowerCase().includes("task") ||
      t.name.toLowerCase().includes("tâche")
    ) || types[0];

  _typesCache[projectId] = taskType;
  return taskType;
}

// Convertit des heures en durée ISO 8601 (ex: 8 → "PT8H")
function _toIsoDuration(hours) {
  const h = parseFloat(hours);
  if (!hours || isNaN(h) || h <= 0) return null;
  return `PT${h}H`;
}

// ══════════════════════════════════════════════════════════════
//  PROJETS
// ══════════════════════════════════════════════════════════════
async function getProjects(opToken) {
  const res = await axios.get(`${BASE_URL}/api/v3/projects?pageSize=50`, {
    headers: makeAuthHeader(opToken),
  });
  return res.data._embedded.elements;
}

async function createProject(data, opToken) {
  const body = {
    name: data.title.trim(),
    identifier: data.title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 100),
    description: {
      format: "markdown",
      raw: data.description.trim(),
    },
    _links: {},
  };

  const res = await axios.post(`${BASE_URL}/api/v3/projects`, body, {
    headers: makeAuthHeader(opToken), // ✅ corrigé
  });
  return res.data;
}

// Utilisé pour le rollback si la création des tâches échoue
async function deleteProject(projectId, opToken) {
  await axios.delete(`${BASE_URL}/api/v3/projects/${projectId}`, {
    headers: makeAuthHeader(opToken),
  });
}

// ══════════════════════════════════════════════════════════════
//  TÂCHES
// ══════════════════════════════════════════════════════════════
async function getTasks(projectId, opToken) {
  const filters = encodeURIComponent(
    JSON.stringify([{ project: { operator: "=", values: [String(projectId)] } }])
  );
  const res = await axios.get(
    `${BASE_URL}/api/v3/work_packages?filters=${filters}&pageSize=100`,
    { headers: makeAuthHeader(opToken) } // ✅ corrigé
  );
  return res.data._embedded.elements;
}

/**
 * Crée une tâche dans un projet OpenProject.
 * Fonction partagée — utilisée par la route création projet ET la route tâches.
 *
 * @param {number} projectId
 * @param {{ title, description, estimatedHours, startDate, dueDate }} task
 * @param {string} opToken
 */
async function createTask(projectId, task, opToken) {
  const taskType = await _getTaskType(projectId, opToken);

  const body = {
    subject: task.title.trim(),
    description: {
      format: "markdown",
      raw: task.description?.trim() || "",
    },
    _links: {
      project: { href: `/api/v3/projects/${projectId}` },
      type:    { href: taskType._links.self.href },
    },
  };

  if (task.startDate)  body.startDate     = task.startDate;
  if (task.dueDate)    body.dueDate       = task.dueDate;
  const duration = _toIsoDuration(task.estimatedHours);
  if (duration)        body.estimatedTime = duration;

  const res = await axios.post(`${BASE_URL}/api/v3/work_packages`, body, {
    headers: makeAuthHeader(opToken), // ✅ corrigé
  });
  return res.data;
}

/**
 * Met à jour partiellement une tâche existante.
 * OpenProject exige le lockVersion pour les PATCH.
 *
 * @param {number} taskId
 * @param {{ lockVersion?, subject?, description?, startDate?, dueDate?, estimatedHours? }} data
 * @param {string} opToken
 */
async function patchTask(taskId, data, opToken) {
  // Récupérer la version actuelle si non fournie (nécessaire pour OpenProject)
  let lockVersion = data.lockVersion;
  if (lockVersion === undefined || lockVersion === null) {
    const current = await axios.get(
      `${BASE_URL}/api/v3/work_packages/${taskId}`,
      { headers: makeAuthHeader(opToken) }
    );
    lockVersion = current.data.lockVersion;
  }

  // Construire uniquement les champs fournis
  const body = { lockVersion };

  if (data.subject !== undefined)
    body.subject = data.subject;

  if (data.description !== undefined)
    body.description = { format: "markdown", raw: data.description };

  if (data.startDate !== undefined)
    body.startDate = data.startDate;

  if (data.dueDate !== undefined)
    body.dueDate = data.dueDate;

  if (data.estimatedHours !== undefined) {
    const duration = _toIsoDuration(data.estimatedHours);
    if (duration) body.estimatedTime = duration;
  }

  const res = await axios.patch(
    `${BASE_URL}/api/v3/work_packages/${taskId}`,
    body,
    { headers: makeAuthHeader(opToken) } // ✅ corrigé
  );
  return res.data;
}

// ══════════════════════════════════════════════════════════════
//  MEMBRES
// ══════════════════════════════════════════════════════════════
async function getMembers(opToken) {
  const res = await axios.get(`${BASE_URL}/api/v3/users?pageSize=50`, {
    headers: makeAuthHeader(opToken),
  });
  return res.data._embedded.elements;
}

module.exports = {
  getProjects,
  createProject,
  deleteProject,
  getTasks,
  createTask,
  patchTask,
  getMembers,
};