"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  cron.js (v3)
//
//  CORRECTIONS :
//    1. Budget/risque : vérification anti-spam AVANT d'appeler les fonctions
//       notif (évite les envois répétés chaque jour)
//    2. runDailyAlerts : sépare clairement les notifs MEMBRE vs MANAGER
//    3. Logs détaillés pour déboguer
// ══════════════════════════════════════════════════════════════════════════════

const cron = require("node-cron");

const { db, getAllProjectsMeta, getProjectManager } = require("../database/db");
const { getTasks }          = require("./openproject");
const { getBudgetSummary }  = require("./budgetService");

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

// ── Récupère le premier opToken valide (admin EN PRIORITÉ) ────────────────────
function getSystemOpToken() {
  try {
    const { getSessionByUser } = require("../database/db");

    const adminRow = db.prepare(
      `SELECT op_user_id FROM users WHERE is_admin = 1 ORDER BY op_user_id LIMIT 1`
    ).get();
    if (adminRow) {
      const session = getSessionByUser(adminRow.op_user_id);
      if (session?.op_token) {
        console.log(`[CRON] Token admin trouvé (user ${adminRow.op_user_id})`);
        return session.op_token;
      }
    }

    const anyUser = db.prepare(
      `SELECT u.op_user_id FROM users u
       JOIN current_session s ON s.op_user_id = u.op_user_id
       WHERE s.op_token IS NOT NULL LIMIT 1`
    ).get();
    if (anyUser) {
      const session = getSessionByUser(anyUser.op_user_id);
      if (session?.op_token) {
        console.log(`[CRON] Token non-admin trouvé (user ${anyUser.op_user_id})`);
        return session.op_token;
      }
    }

    console.warn("[CRON] Aucun token valide — connectez-vous d'abord.");
    return null;
  } catch (err) {
    console.error("[CRON] Erreur getSystemOpToken:", err.message);
    return null;
  }
}

function getAdminIds() {
  return db.prepare(`SELECT op_user_id FROM users WHERE is_admin = 1`)
    .all().map(r => r.op_user_id);
}

// ── Anti-spam interne (complète celui du notificationEngine) ─────────────────
// Évite de redemander les alertes projet/budget si déjà envoyées aujourd'hui
function alreadySentCronToday(eventType, entityId) {
  return !!db.prepare(`
    SELECT id FROM notification_log
    WHERE event_type = ? AND entity_id = ? AND sent_date = date('now')
    LIMIT 1
  `).get(eventType, String(entityId));
}
const { isDone: isTaskDone, DONE_STATUSES } = require("../utils/taskStatus");
function isOverdue(task) {
  if (!task?.dueDate || isTaskDone(task)) return false;
  const due = new Date(task.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// ══════════════════════════════════════════════════════════════════════════════
//  08h00 — ALERTES PERSONNELLES (membres) + ALERTES PROJET (managers + admins)
// ══════════════════════════════════════════════════════════════════════════════
async function runDailyAlerts() {
  console.log("[CRON 08h00] Démarrage —", new Date().toISOString());

  const opToken = getSystemOpToken();
  if (!opToken) {
    console.warn("[CRON 08h00] Aucun token disponible — ignoré.");
    return;
  }

  const allProjects = getAllProjectsMeta();
  if (!allProjects.length) {
    console.log("[CRON 08h00] Aucun projet en base.");
    return;
  }

  console.log(`[CRON 08h00] ${allProjects.length} projet(s) à analyser`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

    console.log(`[CRON 08h00] Projet ${projectId} — ${tasks.length} tâche(s)`);

    // ── ALERTES MEMBRES : overdue + due_soon ──────────────────────────────────
    for (const task of tasks) {
      if (isTaskDone(task)) continue;

      const assigneeId = task._links?.assignee?.href
        ? Number(task._links.assignee.href.split("/").pop())
        : null;

      // Pas d'assignee → pas de notif membre (le manager sera notifié via
      // le résumé quotidien du soir, pas ici pour éviter le spam)
      if (!assigneeId) continue;

      const prefs   = getUserPrefs(assigneeId);
      const dueDate = task.dueDate ? new Date(task.dueDate) : null;

      // Tâche en retard → notif membre
      if (dueDate && dueDate < today) {
        console.log(`[CRON 08h00] "${task.subject}" en retard → user ${assigneeId}`);
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

      // Deadline proche → notif membre
      if (dueDate && dueDate >= today) {
        const daysLeft = Math.round((dueDate - today) / 86_400_000);
        if (daysLeft <= prefs.deadline_days) {
          console.log(`[CRON 08h00] "${task.subject}" deadline J-${daysLeft} → user ${assigneeId}`);
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

    // ── ALERTES MANAGER + ADMIN : budget + risque ─────────────────────────────
    const manager  = getProjectManager(projectId);
    const adminIds = getAdminIds();

    // Alerte budget (anti-spam : 1 fois par projet par jour)
    if (meta.budget_total && meta.budget_total > 0 && manager) {
      // On vérifie si une alerte budget a déjà été envoyée aujourd'hui
      const budgetAlreadySent = alreadySentCronToday("cron_budget", projectId);
      if (!budgetAlreadySent) {
        try {
          const budgetSummary = getBudgetSummary(projectId);
          const budgetPct     = budgetSummary.consumedPct;

          if (budgetPct !== null) {
            console.log(`[CRON 08h00] Budget projet ${projectId} : ${budgetPct}%`);
            if (budgetPct >= 100) {
              await notifyBudgetCritical({
                projectId, projectName, budgetPct,
                managerId: manager.op_user_id, adminIds,
              });
            } else if (budgetPct >= 80) {
              await notifyBudgetWarning({
                projectId, projectName, budgetPct,
                managerId: manager.op_user_id, adminIds,
              });
            }
          }
        } catch (err) {
          console.warn(`[CRON 08h00] Budget projet ${projectId} :`, err.message);
        }
      }
    }

    // Alerte risque (anti-spam : 1 fois par projet par jour)
    const riskScore = meta.risk_score || 0;
    if (riskScore > 0 && manager) {
      const riskAlreadySent = alreadySentCronToday("cron_risk", projectId);
      if (!riskAlreadySent) {
        console.log(`[CRON 08h00] Risque projet ${projectId} : ${riskScore}/100`);
        if (riskScore > 70) {
          await notifyProjectCritical({
            projectId, projectName, riskScore,
            managerId: manager.op_user_id, adminIds,
          });
        } else if (riskScore > 40) {
          await notifyProjectDanger({
            projectId, projectName, riskScore,
            managerId: manager.op_user_id,
          });
        }
      }
    }
  }

  await _sendEmailDigests(emailDigests);
  console.log("[CRON 08h00] Terminé.");
}

// ══════════════════════════════════════════════════════════════════════════════
//  23h00 — RÉSUMÉ FIN DE JOURNÉE (managers uniquement)
// ══════════════════════════════════════════════════════════════════════════════
async function runEveningManagerSummary() {
  console.log("[CRON 23h00] Résumé chefs de projet —", new Date().toISOString());

  const opToken = getSystemOpToken();
  if (!opToken) {
    console.warn("[CRON 23h00] Aucun token disponible — ignoré.");
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

    let overdueCount = 0;
    let blockedCount = 0;

    for (const task of tasks) {
      if (isTaskDone(task)) continue;
      if (isOverdue(task)) overdueCount++;

      const ext = db.prepare(
        `SELECT is_blocked FROM task_extensions WHERE op_task_id = ?`
      ).get(task.id);
      if (ext?.is_blocked === 1) blockedCount++;
    }

    if (overdueCount > 0 || blockedCount > 0) {
      await notifyManagerDailySummary({
        managerId: manager.op_user_id,
        projectId,
        projectName,
        overdueCount,
        blockedCount,
        unblockedCount: 0,
      });
    }
  }

  console.log("[CRON 23h00] Terminé.");
}

// ══════════════════════════════════════════════════════════════════════════════
//  LUNDI 08h00 — RAPPORT HEBDOMADAIRE (managers + admins)
// ══════════════════════════════════════════════════════════════════════════════
async function runWeeklyReport() {
  console.log("[CRON Lundi] Rapport hebdomadaire —", new Date().toISOString());

  const allProjects = getAllProjectsMeta();
  const adminIds    = getAdminIds();
  const recipientMap = {};

  for (const meta of allProjects) {
    const manager = getProjectManager(meta.op_project_id);

    let budgetSummary = null;
    try { budgetSummary = getBudgetSummary(meta.op_project_id); } catch (_) {}

    const summary = {
      name:         `Projet #${meta.op_project_id}`,
      progress:     meta.progress      || 0,
      riskScore:    meta.risk_score    || 0,
      lateTasks:    meta.late_tasks    || 0,
      blockedTasks: meta.blocked_tasks || 0,
      budgetTotal:  budgetSummary?.budgetTotal ?? null,
      budgetUsed:   budgetSummary?.actualCost  ?? null,
      consumedPct:  budgetSummary?.consumedPct ?? null,
    };

    // Manager de ce projet
    if (manager) _addReport(recipientMap, manager.op_user_id, summary);
  }

  // Admins : tous les projets
  for (const adminId of adminIds) {
    recipientMap[adminId] = {
      projects: allProjects.map(meta => {
        let bs = null;
        try { bs = getBudgetSummary(meta.op_project_id); } catch (_) {}
        return {
          name:         `Projet #${meta.op_project_id}`,
          progress:     meta.progress      || 0,
          riskScore:    meta.risk_score    || 0,
          lateTasks:    meta.late_tasks    || 0,
          blockedTasks: meta.blocked_tasks || 0,
          budgetTotal:  bs?.budgetTotal ?? null,
          budgetUsed:   bs?.actualCost  ?? null,
        };
      }),
    };
  }

  for (const [userId, data] of Object.entries(recipientMap)) {
    if (!data.projects?.length) continue;
    const userInfo = db.prepare(
      `SELECT name, email FROM users WHERE op_user_id = ?`
    ).get(Number(userId));
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
  if (category === "overdue")  map[userId].overdueTasks.push(data);
  if (category === "due_soon") map[userId].dueSoonTasks.push(data);
}

function _addReport(map, userId, projectData) {
  if (!map[userId]) map[userId] = { projects: [] };
  map[userId].projects.push(projectData);
}

async function _sendEmailDigests(digestMap) {
  for (const [userId, data] of Object.entries(digestMap)) {
    if (!data.overdueTasks.length && !data.dueSoonTasks.length) continue;
    const userInfo = db.prepare(
      `SELECT name, email FROM users WHERE op_user_id = ?`
    ).get(Number(userId));
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

// ══════════════════════════════════════════════════════════════════════════════
//  startCron
// ══════════════════════════════════════════════════════════════════════════════
function startCron() {
  cron.schedule("0 8 * * *", async () => {
    try { await runDailyAlerts(); }
    catch (err) { console.error("[CRON 08h00] Erreur :", err.message); }
  }, { timezone: "Africa/Algiers" });

  cron.schedule("0 23 * * *", async () => {
    try { await runEveningManagerSummary(); }
    catch (err) { console.error("[CRON 23h00] Erreur :", err.message); }
  }, { timezone: "Africa/Algiers" });

  cron.schedule("0 8 * * 1", async () => {
    try { await runWeeklyReport(); }
    catch (err) { console.error("[CRON Lundi] Erreur :", err.message); }
  }, { timezone: "Africa/Algiers" });

  console.log("[CRON] Schedulers démarrés :");
  console.log("       - 08h00 quotidien  : alertes membres + alertes managers/admins");
  console.log("       - 23h00 quotidien  : résumé chefs de projet");
  console.log("       - Lundi 08h00      : rapport hebdomadaire");
}

module.exports = {
  startCron,
  runDailyAlerts,
  runEveningManagerSummary,
  runWeeklyReport,
};