import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:5000",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
  },
});

api.interceptors.request.use(
  (config) => {
    const jwt = localStorage.getItem("jwt");
    if (jwt) {
      config.headers["Authorization"] = `Bearer ${jwt}`;
    }

    if (config.params) {
      Object.keys(config.params).forEach((key) => {
        if (typeof config.params[key] === "string") {
          config.params[key] = config.params[key].replace(/<[^>]*>/g, "");
        }
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

    return {
      code: status,
      message: messages[status] || `Erreur ${status}.`,
      raw: error.response.data,
    };
  }

  if (error.code === "ECONNABORTED") {
    return { code: "TIMEOUT", message: "Délai d'attente dépassé. Vérifiez votre connexion." };
  }

  if (!navigator.onLine) {
    return { code: "OFFLINE", message: "Aucune connexion réseau." };
  }

  return { code: "UNKNOWN", message: error.message || "Erreur inconnue." };
}

const cache = new Map();

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache(key, data, ttlMs = 60_000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(prefix = "") {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

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

export async function fetchProjects({ page = 1, pageSize = 20, search = "" } = {}) {
  const cacheKey = `projects:${page}:${pageSize}:${search}`;
  const cached = getFromCache(cacheKey);
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

export async function fetchTasks(projectId) {
  if (!projectId) throw new Error("projectId manquant.");

  const cacheKey = `tasks:${projectId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const res = await api.get(`/api/tasks/${projectId}`);
  setInCache(cacheKey, res.data, 30_000);
  return res.data;
}

export async function fetchMembers() {
  const cacheKey = "members";
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const res = await api.get("/api/projects/members");

  const members = (res.data || []).map((m) => ({
    id:   m.id,
    name: m.name || m.login || `Utilisateur #${m.id}`,
  }));

  setInCache(cacheKey, members, 300_000);
  return members;
}

export async function createProject(title, description, tasks = [], managerId, endDate, workload) {
  validateProject({ title, description });
  (tasks || []).forEach(validateTask);

  const payload = {
    title:       sanitize(title),
    description: sanitize(description),
    managerId:   managerId || null,
    endDate:     endDate   || null,
    workload:    workload  ? Number(workload) : null,
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

export async function analyzeWithAI(title, description) {
  if (!title?.trim() || !description?.trim()) {
    throw new Error("Titre et description requis pour l'analyse IA.");
  }

  const res = await api.post("/api/ai/analyze", {
    title:       sanitize(title),
    description: sanitize(description),
  });

  return res.data;
}

export async function patchTask(taskId, lockVersion, body) {
  if (!taskId) throw new Error("taskId manquant.");

  const res = await api.patch(`/api/tasks/${taskId}`, {
    lockVersion,
    ...body,
  });

  invalidateCache(`tasks:`);
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