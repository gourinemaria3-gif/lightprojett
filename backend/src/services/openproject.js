"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — openproject.js
//
//  CORRECTIONS :
//    - patchTask : status envoyé avec href correct (plus uniquement title)
//    - getMembers : déduplication des userHref AVANT les appels HTTP
//      + concurrence limitée via batchResolve() → fini le N+1 massif
//    - Guard sur task.title dans createTask
//    - _typesCache avec TTL de 10 minutes
// ══════════════════════════════════════════════════════════════════════════════

const axios = require("axios");

const BASE_URL = process.env.OP_BASE_URL;

function makeAuthHeader(opToken) {
  return {
    Authorization: "Basic " + Buffer.from(`apikey:${opToken}`).toString("base64"),
    "Content-Type": "application/json",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Cache du type de tâche par projet — avec TTL 10 min
//  ⚠️ En multi-instance (cluster/PM2) → utiliser Redis
// ──────────────────────────────────────────────────────────────────────────────
const _typesCache = {}; // { [projectId]: { value, expiresAt } }
const TYPES_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function _getTaskType(projectId, opToken) {
  const cached = _typesCache[projectId];
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const res = await axios.get(
    `${BASE_URL}/api/v3/projects/${projectId}/types`,
    { headers: makeAuthHeader(opToken), timeout: 8000 }
  );
  const types = res.data._embedded.elements;
  const taskType =
    types.find((t) =>
      t.name.toLowerCase().includes("task") ||
      t.name.toLowerCase().includes("tâche")
    ) || types[0];

  _typesCache[projectId] = { value: taskType, expiresAt: Date.now() + TYPES_TTL_MS };
  return taskType;
}

function _toIsoDuration(hours) {
  const h = parseFloat(hours);
  if (!hours || isNaN(h) || h <= 0) return null;
  return `PT${h}H`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  batchResolve — exécute des promesses avec concurrence limitée
//  Évite de lancer 100 requêtes simultanées vers OP
//
//  @param {any[]} items
//  @param {(item) => Promise<any>} fn
//  @param {number} concurrency — max requêtes simultanées (défaut 5)
// ──────────────────────────────────────────────────────────────────────────────
async function batchResolve(items, fn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value !== null) results.push(r.value);
    }
  }
  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PROJETS
// ══════════════════════════════════════════════════════════════════════════════

async function getProjects(opToken) {
  const res = await axios.get(`${BASE_URL}/api/v3/projects?pageSize=50`, {
    headers: makeAuthHeader(opToken),
    timeout: 8000,
  });
  return res.data._embedded.elements;
}

async function createProject(data, opToken) {
  const baseIdentifier = data.title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);

  const identifier = `${baseIdentifier}-${Date.now().toString(36)}`.slice(0, 100);

  const body = {
    name: data.title.trim(),
    identifier,
    description: {
      format: "markdown",
      raw: data.description.trim(),
    },
    _links: {},
  };

  if (data.parentId) {
    body._links.parent = { href: `/api/v3/projects/${data.parentId}` };
  }

  const res = await axios.post(`${BASE_URL}/api/v3/projects`, body, {
    headers: makeAuthHeader(opToken),
    timeout: 8000,
  });
  return res.data;
}

async function deleteProject(projectId, opToken) {
  await axios.delete(`${BASE_URL}/api/v3/projects/${projectId}`, {
    headers: makeAuthHeader(opToken),
    timeout: 8000,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  TÂCHES
// ══════════════════════════════════════════════════════════════════════════════

async function getTasks(projectId, opToken) {
  const filters = encodeURIComponent(
    JSON.stringify([{ project: { operator: "=", values: [String(projectId)] } }])
  );
  const res = await axios.get(
    `${BASE_URL}/api/v3/work_packages?filters=${filters}&pageSize=100`,
    { headers: makeAuthHeader(opToken), timeout: 15000 }
  );
  return res.data._embedded.elements;
}

async function createTask(projectId, task, opToken) {
  if (!task?.title?.trim()) {
    throw new Error("Le titre de la tâche est obligatoire.");
  }

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
    headers: makeAuthHeader(opToken),
    timeout: 8000,
  });
  return res.data;
}

// ──────────────────────────────────────────────────────────────────────────────
//  patchTask
//
//  CORRECTION CRITIQUE : le statut doit être envoyé avec un href valide.
//  OpenProject refuse { title } seul → 422 silencieux.
//
//  On résout le statusId via GET /api/v3/statuses si nécessaire.
//  Le résultat est mis en cache pour éviter un appel par patch.
// ──────────────────────────────────────────────────────────────────────────────
let _statusesCache = null; // { [titleLower]: { href, id, name } }
let _statusesCacheExpiry = 0;

async function _getStatusByTitle(title, opToken) {
  if (!_statusesCache || Date.now() > _statusesCacheExpiry) {
    const res = await axios.get(`${BASE_URL}/api/v3/statuses`, {
      headers: makeAuthHeader(opToken),
      timeout: 8000,
    });
    _statusesCache = {};
    for (const s of res.data._embedded.elements) {
      _statusesCache[s.name.toLowerCase()] = {
        href: s._links.self.href,
        id:   s.id,
        name: s.name,
      };
    }
    _statusesCacheExpiry = Date.now() + TYPES_TTL_MS;
  }
  return _statusesCache[title.toLowerCase()] || null;
}

async function patchTask(taskId, data, opToken) {
  let lockVersion = data.lockVersion;
  if (lockVersion === undefined || lockVersion === null) {
    const current = await axios.get(
      `${BASE_URL}/api/v3/work_packages/${taskId}`,
      { headers: makeAuthHeader(opToken), timeout: 8000 }
    );
    lockVersion = current.data.lockVersion;
  }

  const body = { lockVersion, _links: {} };

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
  if (data.assignee !== undefined) {
    body._links.assignee = data.assignee
      ? { href: data.assignee.href }
      : { href: null };
  }

  // CORRECTION CRITIQUE : status nécessite un href, pas uniquement un title
  if (data.status !== undefined) {
    const statusObj = await _getStatusByTitle(data.status, opToken);
    if (!statusObj) {
      throw new Error(`Statut introuvable dans OpenProject : "${data.status}"`);
    }
    body._links.status = { href: statusObj.href, title: statusObj.name };
  }

  try {
    const res = await axios.patch(
      `${BASE_URL}/api/v3/work_packages/${taskId}`,
      body,
      { headers: makeAuthHeader(opToken), timeout: 8000 }
    );
    return res.data;
  } catch (err) {
    console.error("✗ OP patch error status:", err.response?.status);
    console.error("✗ OP patch error body:", JSON.stringify(err.response?.data, null, 2));
    throw err;
  }
}

async function deleteTask(taskId, opToken) {
  await axios.delete(
    `${BASE_URL}/api/v3/work_packages/${taskId}`,
    { headers: makeAuthHeader(opToken), timeout: 8000 }
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MEMBRES
//
//  CORRECTION CRITIQUE : N+1 requêtes → déduplique les userHref en amont,
//  puis résout par batches de 5 (batchResolve).
//  Avant : 10 projets × 10 membres = 100 requêtes simultanées → timeout.
//  Après : collecte tous les hrefs uniques, résout 5 par 5.
// ══════════════════════════════════════════════════════════════════════════════

async function getMembers(opToken) {
  // Étape 1 : récupère tous les projets
  const projectsRes = await axios.get(`${BASE_URL}/api/v3/projects?pageSize=50`, {
    headers: makeAuthHeader(opToken),
    timeout: 8000,
  });
  const projects = projectsRes.data._embedded.elements || [];

  // Étape 2 : récupère tous les memberships (en parallèle, par projets)
  const membershipResults = await Promise.allSettled(
    projects.map((project) => {
      const filters = encodeURIComponent(
        JSON.stringify([{ project: { operator: "=", values: [String(project.id)] } }])
      );
      return axios.get(
        `${BASE_URL}/api/v3/memberships?filters=${filters}&pageSize=100`,
        { headers: makeAuthHeader(opToken), timeout: 8000 }
      );
    })
  );

  // Étape 3 : collecte les userHref uniques (déduplique ici, pas après)
  const uniqueUserHrefs = new Set();
  for (const result of membershipResults) {
    if (result.status !== "fulfilled") continue;
    const memberships = result.value.data._embedded?.elements || [];
    for (const m of memberships) {
      const userHref = m._links?.principal?.href;
      if (!userHref) continue;
      const userId = userHref.split("/").pop();
      if (!userId || isNaN(Number(userId))) continue;
      uniqueUserHrefs.add(userHref);
    }
  }

  // Étape 4 : résout les users par batches de 5 (évite le flood)
  const userHrefList = Array.from(uniqueUserHrefs);
  const users = await batchResolve(userHrefList, async (userHref) => {
    try {
      const userRes = await axios.get(`${BASE_URL}${userHref}`, {
        headers: makeAuthHeader(opToken),
        timeout: 8000,
      });
      const u = userRes.data;
      return {
        id:    u.id,
        name:  u.name || u.login || `Utilisateur #${u.id}`,
        email: u.email || null,
      };
    } catch {
      return null; // user inaccessible, ignoré
    }
  }, 5);

  return users;
}

async function addMember(projectId, opUserId, opToken) {
  const rolesRes = await axios.get(`${BASE_URL}/api/v3/roles`, {
    headers: makeAuthHeader(opToken),
    timeout: 8000,
  });
  const roles = rolesRes.data._embedded.elements;
  const role = roles.find((r) => r.name.toLowerCase() === "project admin")
            || roles.find((r) => r.name.toLowerCase() === "member")
            || roles[0];

  await axios.post(`${BASE_URL}/api/v3/memberships`, {
    _links: {
      project:   { href: `/api/v3/projects/${projectId}` },
      principal: { href: `/api/v3/users/${opUserId}` },
      roles:     [{ href: role._links.self.href }],
    },
  }, {
    headers: makeAuthHeader(opToken),
    timeout: 8000,
  });
}

async function syncProjectMembers(projectId, opToken) {
  const res = await axios.get(
    `${BASE_URL}/api/v3/memberships?filters=${encodeURIComponent(
      JSON.stringify([{ project: { operator: "=", values: [String(projectId)] } }])
    )}&pageSize=100`,
    { headers: makeAuthHeader(opToken), timeout: 8000 }
  );

  const memberships = res.data._embedded.elements || [];

  // Déduplique les userHref avant les appels
  const uniqueHrefs = [
    ...new Set(
      memberships
        .map((m) => m._links?.principal?.href)
        .filter((href) => href && !isNaN(Number(href.split("/").pop())))
    ),
  ];

  const members = await batchResolve(uniqueHrefs, async (userHref) => {
    try {
      const userRes = await axios.get(`${BASE_URL}${userHref}`, {
        headers: makeAuthHeader(opToken),
        timeout: 8000,
      });
      const u = userRes.data;
      return { id: u.id, name: u.name, email: u.email || null };
    } catch {
      return null;
    }
  }, 5);

  return members;
}

module.exports = {
  getProjects,
  createProject,
  deleteProject,
  getTasks,
  createTask,
  patchTask,
  deleteTask,
  getMembers,
  addMember,
  syncProjectMembers,
};