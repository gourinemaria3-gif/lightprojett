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

// ── Base URL helper (pour fetch natif) ────────────────────────
const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

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
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}`, {
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
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
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
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/timelogs/${logId}`, {
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
//  DÉPENDANCES
// ══════════════════════════════════════════════════════════════

export async function fetchDependencies(taskId, projectId) {
  if (!taskId)    throw new Error("taskId manquant.");
  if (!projectId) throw new Error("projectId manquant.");

  const res = await api.get(`/api/dependencies/${taskId}`, {
    params: { projectId },
  });
  return res.data;
}

export async function addDependency(taskId, dependsOnTaskId, projectId) {
  if (!taskId || !dependsOnTaskId || !projectId)
    throw new Error("taskId, dependsOnTaskId et projectId sont obligatoires.");

  const res = await api.post("/api/dependencies", {
    taskId:          Number(taskId),
    dependsOnTaskId: Number(dependsOnTaskId),
    projectId:       Number(projectId),
  });

  invalidateCache(`tasks:`);
  return res.data;
}

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
//  BUDGET
// ══════════════════════════════════════════════════════════════

export async function fetchBudgetSummary(projectId) {
  const res = await api.get(`/api/budget/${projectId}`);
  return res.data;
}

export async function setTaskEstimatedHours(projectId, taskId, estimatedHours) {
  const res = await api.patch(
    `/api/budget/${projectId}/tasks/${taskId}/hours`,
    { estimatedHours: Number(estimatedHours) }
  );
  return res.data;
}

export async function setTaskMemberRate(projectId, taskId, memberRate) {
  const res = await api.patch(
    `/api/budget/${projectId}/tasks/${taskId}/rate`,
    { memberRate: Number(memberRate) }
  );
  return res.data;
}

export async function fetchBudgetByTask(projectId) {
  const res = await api.get(`/api/budget/${projectId}/tasks`);
  return res.data;
}

export async function fetchBudgetTimeline(projectId) {
  const res = await api.get(`/api/budget/${projectId}/timeline`);
  return res.data;
}

export async function updateBudget(projectId, budgetTotal) {
  const res = await api.patch(`/api/budget/${projectId}`, {
    budgetTotal: Number(budgetTotal),
  });
  invalidateCache("projects:");
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

export async function fetchTaskPlan({ title, description, type, estimatedHours }) {
  const res = await api.post("/api/ai/task-plan", {
    title:          sanitize(title),
    description:    sanitize(description),
    type:           type || "Développement",
    estimatedHours: estimatedHours || null,
  });
  return res.data;
}

export async function fetchTaskGuide({ title, description }) {
  const res = await api.post("/api/ai/task-guide", {
    title:       sanitize(title),
    description: sanitize(description),
  });
  return res.data;
}

export async function fetchTaskBlockage({ title, description, status, daysStuck }) {
  const res = await api.post("/api/ai/task-blockage", {
    title:       sanitize(title),
    description: sanitize(description),
    status:      status    || "Nouveau",
    daysStuck:   daysStuck || null,
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

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

export async function fetchNotifications({ unreadOnly = false } = {}) {
  const res = await api.get("/api/notifications", {
    params: { unread: unreadOnly ? "true" : "false" },
  });
  return res.data;
}

export async function fetchNotificationCount() {
  const res = await api.get("/api/notifications/count");
  return res.data?.count ?? 0;
}

export async function markNotificationRead(id) {
  const res = await api.patch(`/api/notifications/${id}/read`);
  return res.data;
}

export async function markAllNotificationsRead() {
  const res = await api.patch("/api/notifications/read-all");
  return res.data;
}

export async function deleteNotification(id) {
  const res = await api.delete(`/api/notifications/${id}`);
  return res.data;
}

export async function clearReadNotifications() {
  const res = await api.get("/api/notifications", { params: { unread: "false" } });
  const all  = res.data?.notifications ?? [];
  const read = all.filter((n) => n.is_read === 1);

  await Promise.all(
    read.map((n) => api.delete(`/api/notifications/${n.id}`).catch(() => {}))
  );
  return { deleted: read.length };
}

export async function fetchNotificationSettings() {
  const res = await api.get("/api/notifications/preferences");
  return res.data;
}

export async function updateNotificationSettings({ enabled, reminderDays }) {
  const res = await api.put("/api/notifications/preferences", {
    pushEnabled:  Boolean(enabled),
    emailEnabled: Boolean(enabled),
    deadlineDays: Number(reminderDays),
  });
  return res.data;
}

// ══════════════════════════════════════════════════════════════
//  ALIAS — compatibilité avec le fichier de ta collègue
//  (ProjectsPage.jsx utilise ces noms-là)
// ══════════════════════════════════════════════════════════════

// getProjets retourne { data: [...] } pour matcher son code (pRes.data)
export const getProjets = async (...args) => ({
  data: await fetchProjects(...args),
});

// getStats retourne { data: {...} } pour matcher son code (statsRes.data)
export const getStats = async (projectId) => ({
  data: await fetchStats(projectId),
});

// getTaches retourne { data: [...] } pour matcher son code (tachesRes.data)
export const getTaches = async (projectId) => ({
  data: await fetchTasks(projectId),
});

// getProjectMembers retourne { data: [...] } pour matcher son code (membersRes.data)
export const getProjectMembers = async (projectId) => ({
  data: await fetchProjectMembers(projectId),
});

// logout — utilisé dans son handleLogout
export const logout = () => {
  localStorage.removeItem("jwt");
  localStorage.removeItem("user");
};
// updateTache — alias de patchTask (utilisé dans ProjectDetailPage.jsx)
// Son code : updateTache(taskId, data) sans lockVersion ni projectId
// On met lockVersion=1 par défaut et on extrait projectId du body si présent
export const updateTache = (taskId, data) =>
  api.patch(`/api/tasks/${taskId}`, data);
 
// deleteTache — alias de deleteTask (utilisé dans ProjectDetailPage.jsx)
export const deleteTache = (taskId, projectId) =>
  api.delete(`/api/tasks/${taskId}`, { data: { projectId } });