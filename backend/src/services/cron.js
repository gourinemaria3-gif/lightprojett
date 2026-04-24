"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  cron.js — Scheduler des notifications
//
//  08h00 quotidien  : alertes personnelles (retard + deadline proche)
//                     envoyées à chaque membre/chef pour SES tâches
//
//  23h00 quotidien  : résumé de fin de journée pour les chefs de projet
//                     "N tâches en retard, N bloquées aujourd'hui"
//
//  Lundi 08h00      : rapport hebdomadaire (chef + admin) — email uniquement
// ══════════════════════════════════════════════════════════════════════════════

const cron = require("node-cron");

const { db, getAllProjectsMeta, getProjectManager, getProjectMembers } = require("../database/db");
const { getTasks } = require("./openproject");
const {
  notifyTaskOverdueMember,
  notifyDeadlineSoonMember,
  notifyManagerDailySummary,
  notifyProjectDanger,
  notifyProjectCritical,
  notifyBudgetWarning,
  notifyBudgetCritical,
  getUserPrefs,
} = require("./notificationEngine");
const { sendPersonalDigest, sendWeeklyReport } = require("./emailService");

// ── Récupère un opToken admin pour les appels CRON (pas de req.opToken ici) ──
function getSystemOpToken() {
  try {
    const { getSessionByUser } = require("../database/db");
    const adminRow = db.prepare(
      `SELECT op_user_id FROM users WHERE is_admin = 1 ORDER BY op_user_id LIMIT 1`
    ).get();
    if (!adminRow) return null;
    return getSessionByUser(adminRow.op_user_id)?.op_token || null;
  } catch {
    return null;
  }
}

function getAdminIds() {
  return db.prepare(`SELECT op_user_id FROM users WHERE is_admin = 1`)
    .all().map(r => r.op_user_id);
}

// Statuts "terminé" — cohérent avec le reste de l'app
const DONE_STATUSES = new Set([
  "done", "closed", "finished", "resolved", "rejected",
  "terminé", "terminée", "fermé", "fermée",
]);

function isTaskDone(task) {
  if (!task) return false;
  if (typeof task.isClosed === "boolean") return task.isClosed;
  return DONE_STATUSES.has((task._links?.status?.title || "").toLowerCase());
}

function isOverdue(task) {
  if (!task?.dueDate || isTaskDone(task)) return false;
  const due = new Date(task.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// ══════════════════════════════════════════════════════════════════════════════
//  08h00 — ALERTES PERSONNELLES
//
//  Pour chaque projet :
//    - Pour chaque membre assigné à une tâche en retard → notif overdue
//    - Pour chaque membre dont la deadline approche → notif due_soon
//  + Email digest personnel si préfs activées
// ══════════════════════════════════════════════════════════════════════════════
async function runDailyAlerts() {
  console.log("[CRON 08h00] Démarrage alertes personnelles —", new Date().toISOString());

  const opToken = getSystemOpToken();
  if (!opToken) {
    console.warn("[CRON 08h00] Aucun token admin — CRON ignoré.");
    return;
  }

  const allProjects = getAllProjectsMeta();
  if (!allProjects.length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Accumulateurs pour les digests email personnels
  // { [userId]: { overdueTasks: [], dueSoonTasks: [] } }
  const emailDigests = {};

  for (const meta of allProjects) {
    const projectId   = meta.op_project_id;
    const projectName = `Projet #${projectId}`;

    let tasks = [];
    try {
      tasks = await getTasks(projectId, opToken);
    } catch (err) {
      console.warn(`[CRON 08h00] Tâches projet ${projectId} :`, err.message);
      continue;
    }

    for (const task of tasks) {
      if (isTaskDone(task)) continue;

      const assigneeId = task._links?.assignee?.href
        ? Number(task._links.assignee.href.split("/").pop())
        : null;
      if (!assigneeId) continue;

      const prefs   = getUserPrefs(assigneeId);
      const dueDate = task.dueDate ? new Date(task.dueDate) : null;

      // ── Tâche en retard ───────────────────────────────────────────────────
      if (dueDate && dueDate < today) {
        await notifyTaskOverdueMember({
          opUserId:  assigneeId,
          taskTitle: task.subject,
          dueDate:   task.dueDate,
          taskId:    task.id,
        });

        _addDigest(emailDigests, assigneeId, "overdue", {
          title: task.subject, dueDate: task.dueDate, projectName,
        });
      }

      // ── Deadline proche (exactement J-N selon préf) ───────────────────────
      if (dueDate && dueDate >= today) {
        const daysLeft = Math.round((dueDate - today) / 86_400_000);
        if (daysLeft === prefs.deadline_days) {
          await notifyDeadlineSoonMember({
            opUserId:  assigneeId,
            taskTitle: task.subject,
            dueDate:   task.dueDate,
            taskId:    task.id,
            daysLeft,
          });
          _addDigest(emailDigests, assigneeId, "due_soon", {
            title: task.subject, dueDate: task.dueDate, projectName,
          });
        }
      }
    }

    // ── Budget (chef + admins) ────────────────────────────────────────────────
    const manager  = getProjectManager(projectId);
    const adminIds = getAdminIds();

    if (meta.budget_total && meta.budget_total > 0 && manager) {
      const budgetPct = _computeBudgetPct(projectId, meta.budget_total);
      if (budgetPct !== null) {
        if (budgetPct >= 100) {
          await notifyBudgetCritical({
            projectId, projectName, budgetPct,
            managerId: manager.op_user_id,
            adminIds,
          });
        } else if (budgetPct >= 80) {
          await notifyBudgetWarning({
            projectId, projectName, budgetPct,
            managerId: manager.op_user_id,
            adminIds,
          });
        }
      }
    }

    // ── Risque projet (chef + admins) ─────────────────────────────────────────
    const riskScore = meta.risk_score || 0;
    if (riskScore > 0 && manager) {
      if (riskScore > 70) {
        await notifyProjectCritical({
          projectId, projectName, riskScore,
          managerId: manager.op_user_id,
          adminIds,
        });
      } else if (riskScore > 40) {
        await notifyProjectDanger({
          projectId, projectName, riskScore,
          managerId: manager.op_user_id,
        });
      }
    }
  }

  // ── Envoi des digests email ───────────────────────────────────────────────
  await _sendEmailDigests(emailDigests);

  console.log("[CRON 08h00] Terminé.");
}

// ══════════════════════════════════════════════════════════════════════════════
//  23h00 — RÉSUMÉ FIN DE JOURNÉE (chefs de projet uniquement)
//
//  Pour chaque projet géré :
//    Compte tâches en retard + bloquées + débloquées → 1 notif résumé
// ══════════════════════════════════════════════════════════════════════════════
async function runEveningManagerSummary() {
  console.log("[CRON 23h00] Résumé chefs de projet —", new Date().toISOString());

  const opToken = getSystemOpToken();
  if (!opToken) {
    console.warn("[CRON 23h00] Aucun token admin — CRON ignoré.");
    return;
  }

  const allProjects = getAllProjectsMeta();
  if (!allProjects.length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const meta of allProjects) {
    const projectId   = meta.op_project_id;
    const projectName = `Projet #${projectId}`;
    const manager     = getProjectManager(projectId);
    if (!manager) continue;

    let tasks = [];
    try {
      tasks = await getTasks(projectId, opToken);
    } catch (err) {
      console.warn(`[CRON 23h00] Tâches projet ${projectId} :`, err.message);
      continue;
    }

    let overdueCount   = 0;
    let blockedCount   = 0;
    let unblockedCount = 0;

    for (const task of tasks) {
      if (isTaskDone(task)) continue;
      if (isOverdue(task)) overdueCount++;

      // blocked via task_extensions (DB locale)
      const ext = db.prepare(
        `SELECT is_blocked FROM task_extensions WHERE op_task_id = ?`
      ).get(task.id);
      if (ext?.is_blocked === 1) blockedCount++;
    }

    await notifyManagerDailySummary({
      managerId: manager.op_user_id,
      projectId,
      projectName,
      overdueCount,
      blockedCount,
      unblockedCount,
    });
  }

  console.log("[CRON 23h00] Terminé.");
}

// ══════════════════════════════════════════════════════════════════════════════
//  LUNDI 08h00 — RAPPORT HEBDOMADAIRE (chef + admin, email seulement)
// ══════════════════════════════════════════════════════════════════════════════
async function runWeeklyReport() {
  console.log("[CRON Lundi] Rapport hebdomadaire —", new Date().toISOString());

  const allProjects = getAllProjectsMeta();
  const adminIds    = getAdminIds();

  // { [userId]: { projects: [] } }
  const recipientMap = {};

  for (const meta of allProjects) {
    const manager = getProjectManager(meta.op_project_id);
    const summary = {
      name:         `Projet #${meta.op_project_id}`,
      progress:     meta.progress      || 0,
      riskScore:    meta.risk_score    || 0,
      lateTasks:    meta.late_tasks    || 0,
      blockedTasks: meta.blocked_tasks || 0,
      budgetTotal:  meta.budget_total  || null,
    };
    if (manager) _addReport(recipientMap, manager.op_user_id, summary);
  }

  // Admins voient tous les projets
  for (const adminId of adminIds) {
    recipientMap[adminId] = {
      projects: allProjects.map(meta => ({
        name:         `Projet #${meta.op_project_id}`,
        progress:     meta.progress      || 0,
        riskScore:    meta.risk_score    || 0,
        lateTasks:    meta.late_tasks    || 0,
        blockedTasks: meta.blocked_tasks || 0,
      })),
    };
  }

  for (const [userId, data] of Object.entries(recipientMap)) {
    if (!data.projects?.length) continue;
    const userInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(Number(userId));
    if (!userInfo?.email) continue;
    const prefs = getUserPrefs(Number(userId));
    if (!prefs.email_enabled) continue;
    await sendWeeklyReport({ to: userInfo.email, name: userInfo.name, projects: data.projects });
  }

  console.log("[CRON Lundi] Terminé.");
}

// ══════════════════════════════════════════════════════════════════════════════
//  Helpers internes
// ══════════════════════════════════════════════════════════════════════════════

function _addDigest(map, userId, category, data) {
  if (!map[userId]) map[userId] = { overdueTasks: [], dueSoonTasks: [] };
  if (category === "overdue")   map[userId].overdueTasks.push(data);
  if (category === "due_soon")  map[userId].dueSoonTasks.push(data);
}

function _addReport(map, userId, projectData) {
  if (!map[userId]) map[userId] = { projects: [] };
  map[userId].projects.push(projectData);
}

async function _sendEmailDigests(digestMap) {
  for (const [userId, data] of Object.entries(digestMap)) {
    if (!data.overdueTasks.length && !data.dueSoonTasks.length) continue;
    const userInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(Number(userId));
    if (!userInfo?.email) continue;
    const prefs = getUserPrefs(Number(userId));
    if (!prefs.email_enabled) continue;
    await sendPersonalDigest({
      to:           userInfo.email,
      name:         userInfo.name,
      overdueTasks: data.overdueTasks,
      dueSoonTasks: data.dueSoonTasks,
    });
  }
}

function _computeBudgetPct(projectId, budgetTotal) {
  if (!budgetTotal || budgetTotal <= 0) return null;
  const res = db.prepare(`
    SELECT SUM(tl.hours_worked * tl.hourly_rate) AS used
    FROM time_logs tl
    WHERE tl.hourly_rate IS NOT NULL
      AND tl.op_task_id IN (
        SELECT DISTINCT te.op_task_id FROM task_extensions te
      )
  `).get();
  const used = res?.used || 0;
  return Math.round((used / budgetTotal) * 100);
}

// ══════════════════════════════════════════════════════════════════════════════
//  startCron — appelé une fois au démarrage du serveur
// ══════════════════════════════════════════════════════════════════════════════
function startCron() {
  // Alertes personnelles — 08h00 chaque jour
  cron.schedule("0 8 * * *", async () => {
    try { await runDailyAlerts(); }
    catch (err) { console.error("[CRON 08h00] Erreur :", err.message); }
  }, { timezone: "Africa/Algiers" });

  // Résumé chefs — 23h00 chaque jour
  cron.schedule("0 23 * * *", async () => {
    try { await runEveningManagerSummary(); }
    catch (err) { console.error("[CRON 23h00] Erreur :", err.message); }
  }, { timezone: "Africa/Algiers" });

  // Rapport hebdomadaire — lundi 08h00
  cron.schedule("0 8 * * 1", async () => {
    try { await runWeeklyReport(); }
    catch (err) { console.error("[CRON Lundi] Erreur :", err.message); }
  }, { timezone: "Africa/Algiers" });

  console.log("[CRON] Schedulers démarrés :");
  console.log("       - 08h00 quotidien  : alertes personnelles");
  console.log("       - 23h00 quotidien  : résumé chefs de projet");
  console.log("       - Lundi 08h00      : rapport hebdomadaire");
}

module.exports = {
  startCron,
  runDailyAlerts,
  runEveningManagerSummary,
  runWeeklyReport,
};