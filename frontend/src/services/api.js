import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:5000",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json", 
  },
});

api.interceptors.request.use(
  (config) => {
    const jwt = localStorage.getItem("jwt");
    if (jwt) config.headers["Authorization"] = `Bearer ${jwt}`;
    if (config.params) {
      Object.keys(config.params).forEach((key) => {
        if (typeof config.params[key] === "string")
          config.params[key] = config.params[key].replace(/<[^>]*>/g, "");
      });
    }
    return config;
  },
  (error) => Promise.reject(normalizeError(error))
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = normalizeError(error);
    console.error(`[API Error] ${normalized.code} — ${normalized.message}`);
    if (normalized.code === 401) {
      localStorage.removeItem("jwt");
      localStorage.removeItem("user");
      window.location.href = "/";
    }
    return Promise.reject(normalized);
  }
);

function normalizeError(error) {
  if (error.response) {
    const status = error.response.status;
    const detail = error.response.data?.detail || error.response.data?.message || "";
    const messages = {
      400: `Données invalides. ${detail}`,
      401: "Session expirée. Reconnectez-vous.",
      403: "Accès refusé.",
      404: "Ressource introuvable.",
      429: "Trop de requêtes. Réessayez dans quelques secondes.",
      500: `Erreur serveur. ${detail}`,
      502: "Serveur indisponible (502).",
      503: "Service temporairement indisponible.",
    };
    return { code: status, message: messages[status] || `Erreur ${status}.`, raw: error.response.data };
  }
  if (error.code === "ECONNABORTED")
    return { code: "TIMEOUT", message: "Délai d'attente dépassé. Vérifiez votre connexion." };
  if (!navigator.onLine)
    return { code: "OFFLINE", message: "Aucune connexion réseau." };
  return { code: "UNKNOWN", message: error.message || "Erreur inconnue." };
}

// ── Cache ─────────────────────────────────────────────────────
const cache = new Map();

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setInCache(key, data, ttlMs = 60_000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(prefix = "") {
  if (!prefix) { cache.clear(); return; }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// ── Validation & sanitize ─────────────────────────────────────
function validateProject({ title, description }) {
  const errors = [];
  if (!title || typeof title !== "string" || title.trim().length < 2)
    errors.push("Le titre doit contenir au moins 2 caractères.");
  if (title && title.trim().length > 200)
    errors.push("Le titre ne doit pas dépasser 200 caractères.");
  if (!description || typeof description !== "string" || description.trim().length < 5)
    errors.push("La description doit contenir au moins 5 caractères.");
  if (errors.length) throw new Error(errors.join(" "));
}

function validateTask(task) {
  const errors = [];
  if (!task.title || task.title.trim().length < 1)
    errors.push("Chaque tâche doit avoir un titre.");
  if (task.estimatedHours && isNaN(Number(task.estimatedHours)))
    errors.push("Les heures estimées doivent être un nombre.");
  if (task.startDate && task.dueDate && task.startDate > task.dueDate)
    errors.push(`La date de début de "${task.title}" dépasse la date de fin.`);
  if (errors.length) throw new Error(errors.join(" "));
}

function sanitize(str) {
  if (typeof str !== "string") return str;
  return str.replace(/<[^>]*>/g, "").trim();
}

// ── Auth helper ────────────────────────────────────────────────
function getAuthHeaders() {
  const token = localStorage.getItem("jwt");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ══════════════════════════════════════════════════════════════
//  PROJETS
// ══════════════════════════════════════════════════════════════

export async function fetchProjects({ page = 1, pageSize = 20, search = "" } = {}) {
  const cacheKey = `projects:${page}:${pageSize}:${search}`;
  const cached   = getFromCache(cacheKey);
  if (cached) return cached;

  const res = await api.get("/api/projects", {
    params: { page, pageSize, search: sanitize(search) },
  });

  const projects = Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.data)
    ? res.data.data
    : [];

  setInCache(cacheKey, projects, 60_000);
  return projects;
}

export async function createProject(title, description, tasks = [], managerId, managerName, managerEmail, startDate, endDate, workload) {
  validateProject({ title, description });
  (tasks || []).forEach(validateTask);

  const payload = {
    title:        sanitize(title),
    description:  sanitize(description),
    managerId:    managerId    || null,
    managerName:  managerName  || null,
    managerEmail: managerEmail || null,
    startDate:    startDate    || null,
    endDate:      endDate      || null,
    workload:     workload ? Number(workload) : null,
    tasks: (tasks || []).map((t) => ({
      title:          sanitize(t.title),
      description:    sanitize(t.description || ""),
      estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null,
      startDate:      t.startDate || null,
      dueDate:        t.dueDate   || null,
    })),
  };

  const res = await api.post("/api/createproject", payload);
  invalidateCache("projects:");
  return res.data;
}

export async function deleteProject(projectId) {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur lors de la suppression du projet.");
  }
  invalidateCache("projects:");
}

export async function createSubProject(parentId, payload) {
  const {
    title, description,
    startDate, endDate, workload,
    managerId, managerName, managerEmail,
    tasks = [],
  } = payload;

  if (!title || title.trim().length < 2)
    throw new Error("Le titre doit contenir au moins 2 caractères.");
  if (!description || description.trim().length < 5)
    throw new Error("La description doit contenir au moins 5 caractères.");

  const res = await api.post(`/api/createproject/sub/${parentId}`, {
    title:        title.trim(),
    description:  description.trim(),
    startDate:    startDate    || null,
    endDate:      endDate      || null,
    workload:     workload ? Number(workload) : null,
    managerId:    managerId    || null,
    managerName:  managerName  || null,
    managerEmail: managerEmail || null,
    tasks: (tasks || []).map((t) => ({
      title:          t.title.trim(),
      description:    t.description?.trim() || "",
      estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null,
      startDate:      t.startDate || null,
      dueDate:        t.dueDate   || null,
    })),
  });

  invalidateCache();
  return res.data;
}


// ══════════════════════════════════════════════════════════════
//  MEMBRES DU PROJET
// ══════════════════════════════════════════════════════════════

export async function fetchMembers() {
  const cacheKey = "members";
  const cached   = getFromCache(cacheKey);
  if (cached) return cached;

  const res = await api.get("/api/projects/members");
  const members = (res.data || []).map((m) => ({
    id:    m.id,
    name:  m.name || m.login || `Utilisateur #${m.id}`,
    email: m.email || "",
  }));

  setInCache(cacheKey, members, 300_000);
  return members;
}

export async function fetchProjectMembers(projectId) {
  const res = await api.get(`/api/projects/${projectId}/members`);
  return res.data;
}

export async function addProjectMember(projectId, { opUserId, name, email, role = "member", hourlyRate }) {
  const res = await api.post(`/api/projects/${projectId}/members`, {
    opUserId, name, email, role,
    hourlyRate: hourlyRate ? Number(hourlyRate) : undefined,
  });
  return res.data;
}

export async function updateMemberRole(projectId, userId, role) {
  const res = await api.patch(`/api/projects/${projectId}/members/${userId}/role`, { role });
  return res.data;
}

export async function removeProjectMember(projectId, userId) {
  const res = await api.delete(`/api/projects/${projectId}/members/${userId}`);
  return res.data;
}

export async function updateMyHourlyRate(projectId, userId, hourlyRate) {
  const res = await api.patch(`/api/projects/${projectId}/members/${userId}/rate`, {
    hourlyRate: Number(hourlyRate),
  });
  return res.data;
}

// ══════════════════════════════════════════════════════════════
//  TÂCHES
// ══════════════════════════════════════════════════════════════

export async function fetchTasks(projectId) {
  if (!projectId) throw new Error("projectId manquant.");

  const cacheKey = `tasks:${projectId}`;
  const cached   = getFromCache(cacheKey);
  if (cached) return cached;

  const res = await api.get(`/api/tasks/${projectId}`);
  setInCache(cacheKey, res.data, 30_000);
  return res.data;
}

export async function createTask(projectId, task) {
  if (!projectId) throw new Error("projectId manquant.");

  const res = await api.post(`/api/tasks/project/${projectId}`, {
    title:          sanitize(task.title),
    description:    sanitize(task.description || ""),
    startDate:      task.startDate  || null,
    dueDate:        task.dueDate    || null,
    estimatedHours: task.estimatedHours ? Number(task.estimatedHours) : null,
  });

  invalidateCache(`tasks:`);
  return res.data;
}

export async function patchTask(taskId, lockVersion, body, projectId) {
  if (!taskId)    throw new Error("taskId manquant.");
  if (!projectId) throw new Error("projectId manquant.");

  const res = await api.patch(`/api/tasks/${taskId}`, {
    lockVersion,
    projectId,
    ...body,
  });

  invalidateCache(`tasks:`);
  return res.data;
}

export async function deleteTask(taskId, projectId) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur lors de la suppression de la tâche.");
  }
  invalidateCache(`tasks:`);
}

// ══════════════════════════════════════════════════════════════
//  TIME LOGS
// ══════════════════════════════════════════════════════════════

export async function fetchTimeLogs(taskId, projectId) {
  const res = await api.get(`/api/tasks/${taskId}/timelogs`, {
    params: { projectId },
  });
  return res.data;
}

export async function addTimeLog(taskId, { opUserId, hoursWorked, loggedDate, note, projectId }) {
  const res = await api.post(`/api/tasks/${taskId}/timelogs`, {
    opUserId, hoursWorked: Number(hoursWorked), loggedDate, note, projectId,
  });
  return res.data;
}

export async function deleteTimeLog(taskId, logId, projectId) {
  const res = await fetch(`/api/tasks/${taskId}/timelogs/${logId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur suppression time log.");
  }
}

// ══════════════════════════════════════════════════════════════
//  DÉPENDANCES — NOUVEAU
//
//  fetchDependencies  → récupère les dépendances d'une tâche
//  addDependency      → crée une dépendance (taskId dépend de dependsOnTaskId)
//  removeDependency   → supprime une dépendance
// ══════════════════════════════════════════════════════════════

/**
 * Récupère les dépendances d'une tâche.
 * Retourne :
 * {
 *   taskId, isBlocked,
 *   dependsOn:   [{ taskId, title, status, isDone }],
 *   blockingFor: [{ taskId, title, isBlocked }]
 * }
 */
export async function fetchDependencies(taskId, projectId) {
  if (!taskId)    throw new Error("taskId manquant.");
  if (!projectId) throw new Error("projectId manquant.");

  const res = await api.get(`/api/dependencies/${taskId}`, {
    params: { projectId },
  });
  return res.data;
}

/**
 * Ajoute une dépendance : taskId dépend de dependsOnTaskId.
 * Seul admin ou manager peut faire ça.
 */
export async function addDependency(taskId, dependsOnTaskId, projectId) {
  if (!taskId || !dependsOnTaskId || !projectId)
    throw new Error("taskId, dependsOnTaskId et projectId sont obligatoires.");

  const res = await api.post("/api/dependencies", {
    taskId:          Number(taskId),
    dependsOnTaskId: Number(dependsOnTaskId),
    projectId:       Number(projectId),
  });

  // Invalide le cache des tâches pour que isBlocked soit rechargé
  invalidateCache(`tasks:`);
  return res.data;
}

/**
 * Supprime une dépendance entre deux tâches.
 */
export async function removeDependency(taskId, dependsOnTaskId, projectId) {
  if (!taskId || !dependsOnTaskId || !projectId)
    throw new Error("taskId, dependsOnTaskId et projectId sont obligatoires.");

  const res = await api.delete("/api/dependencies", {
    data: {
      taskId:          Number(taskId),
      dependsOnTaskId: Number(dependsOnTaskId),
      projectId:       Number(projectId),
    },
  });

  invalidateCache(`tasks:`);
  return res.data;
}

// ══════════════════════════════════════════════════════════════
//  IA
// ══════════════════════════════════════════════════════════════

export async function analyzeWithAI(title, description) {
  if (!title?.trim() || !description?.trim())
    throw new Error("Titre et description requis pour l'analyse IA.");

  const res = await api.post("/api/ai/analyze", {
    title:       sanitize(title),
    description: sanitize(description),
  });
  return res.data;
}

// ══════════════════════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════════════════════

export async function fetchStats(projectId) {
  const res = await api.get(`/api/projects/${projectId}/stats`);
  return res.data;
}