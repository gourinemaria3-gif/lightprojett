"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  notificationEngine.js (v3)
//
//  CORRECTIONS :
//    1. PUSH sets corrigés — chaque rôle reçoit ce qui le concerne :
//         MEMBRE  : assigned, due_soon, overdue, blocked, unblocked
//         MANAGER : danger, budget_alert + blocked/unblocked si tâche non assignée
//         ADMIN   : danger, budget_alert
//    2. notifyTaskBlocked / notifyTaskUnblocked — notifie le MANAGER
//       si la tâche n'a pas d'assignee
//    3. Anti-spam fiable sur toutes les fonctions
// ══════════════════════════════════════════════════════════════════════════════

const {
  db,
  createNotification,
  getProjectManager,
  getNotificationSettings,
} = require("../database/db");
const { sendPushToUser }    = require("./firebase");
const { sendCriticalAlert } = require("./emailService");

const NOTIF_TYPES = {
  ASSIGNED:     "assigned",
  DUE_SOON:     "due_soon",
  OVERDUE:      "overdue",
  BLOCKED:      "blocked",
  UNBLOCKED:    "unblocked",
  DANGER:       "danger",
  BUDGET_ALERT: "budget_alert",
};

// ── Quels types déclenchent un push selon le rôle ────────────────────────────
// MEMBRE reçoit les notifs qui concernent SES tâches
const PUSH_MEMBER  = new Set(["assigned", "due_soon", "overdue", "blocked", "unblocked"]);
// MANAGER reçoit les alertes projet + budget + blocage de tâches non assignées
const PUSH_MANAGER = new Set(["danger", "budget_alert", "blocked", "unblocked"]);
// ADMIN reçoit uniquement les alertes critiques
const PUSH_ADMIN   = new Set(["danger", "budget_alert"]);

const CRITICAL_SUBTYPES = new Set(["project_critical", "budget_critical"]);

// ── Anti-spam : 1 envoi max par (user, event, entité, jour) ──────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS notification_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    op_user_id INTEGER NOT NULL,
    event_type TEXT    NOT NULL,
    entity_id  TEXT    NOT NULL,
    sent_date  TEXT    NOT NULL DEFAULT (date('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notif_log
    ON notification_log (op_user_id, event_type, entity_id, sent_date);
`);

function alreadySentToday(opUserId, eventType, entityId) {
  return !!db.prepare(`
    SELECT id FROM notification_log
    WHERE op_user_id = ? AND event_type = ? AND entity_id = ? AND sent_date = date('now')
  `).get(opUserId, eventType, String(entityId));
}

function markSent(opUserId, eventType, entityId) {
  db.prepare(`
    INSERT INTO notification_log (op_user_id, event_type, entity_id)
    VALUES (?, ?, ?)
  `).run(opUserId, eventType, String(entityId));
}

function getUserPrefs(opUserId) {
  const row = getNotificationSettings(opUserId);
  return {
    push_enabled:  row ? Boolean(row.enabled) : true,
    email_enabled: row ? Boolean(row.enabled) : true,
    deadline_days: row ? row.reminder_days : 3,
  };
}

// ── Dispatcher central ────────────────────────────────────────────────────────
// pushAllowed = le Set correspondant au rôle du destinataire
async function _dispatch({
  opUserId,
  type,
  message,
  entityId,
  pushAllowed,
  subType   = null,
  emailOpts = null,
  skipDedup = false,
}) {
  const dedupKey = subType ? `${type}:${subType}` : type;

  if (!skipDedup) {
    if (alreadySentToday(opUserId, dedupKey, entityId)) {
      console.log(`[NotifEngine] Anti-spam: (${dedupKey}) user=${opUserId} entity=${entityId} → ignorée`);
      return;
    }
    markSent(opUserId, dedupKey, entityId);
  }

  const prefs = getUserPrefs(opUserId);

  // 1. In-app (toujours)
  try {
    createNotification(opUserId, type, message);
    console.log(`[NotifEngine] In-app ✓ user=${opUserId} type=${type}`);
  } catch (err) {
    console.warn(`[NotifEngine] In-app erreur user ${opUserId}:`, err.message);
  }

  // 2. Push (si activé ET type autorisé pour ce rôle)
  if (prefs.push_enabled && pushAllowed.has(type)) {
    try {
      await sendPushToUser(opUserId, type, message, db);
      console.log(`[NotifEngine] Push ✓ user=${opUserId} type=${type}`);
    } catch (err) {
      console.warn(`[NotifEngine] Push erreur user ${opUserId}:`, err.message);
    }
  }

  // 3. Email critique immédiat (seulement pour project_critical et budget_critical)
  if (prefs.email_enabled && subType && CRITICAL_SUBTYPES.has(subType) && emailOpts?.to) {
    try {
      await sendCriticalAlert({
        to:          emailOpts.to,
        name:        emailOpts.name || "Chef de projet",
        type:        subType,
        projectName: emailOpts.projectName || "Projet inconnu",
        detail:      message,
      });
      console.log(`[NotifEngine] Email critique ✓ → ${emailOpts.to}`);
    } catch (err) {
      console.warn(`[NotifEngine] Email critique erreur user ${opUserId}:`, err.message);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MEMBRE — tâches personnelles
// ══════════════════════════════════════════════════════════════════════════════

// Appelé quand une tâche est assignée à quelqu'un
async function notifyTaskAssigned({ assigneeId, taskTitle, projectName, taskId }) {
  await _dispatch({
    opUserId:    assigneeId,
    type:        NOTIF_TYPES.ASSIGNED,
    message:     `Vous avez été assigné(e) à la tâche "${taskTitle}" dans ${projectName}.`,
    entityId:    `assigned:${taskId}:${assigneeId}`,
    pushAllowed: PUSH_MEMBER,
    skipDedup:   true, // une assignation = toujours notifier
  });
}

// Appelé quand une tâche est bloquée (dépendance non terminée)
// → notifie le membre assigné, OU le manager si la tâche est non assignée
async function notifyTaskBlocked({ taskId, taskTitle, blockedByTaskId, assigneeId, projectId }) {
  const entityId = `blocked:${taskId}:by:${blockedByTaskId}`;

  if (assigneeId) {
    // Notif membre
    await _dispatch({
      opUserId:    assigneeId,
      type:        NOTIF_TYPES.BLOCKED,
      message:     `Votre tâche "${taskTitle || `#${taskId}`}" est bloquée par la tâche #${blockedByTaskId}.`,
      entityId,
      pushAllowed: PUSH_MEMBER,
    });
  } else if (projectId) {
    // Pas d'assignee → notifie le manager
    const manager = getProjectManager(projectId);
    if (manager) {
      await _dispatch({
        opUserId:    manager.op_user_id,
        type:        NOTIF_TYPES.BLOCKED,
        message:     `La tâche "#${taskId} — ${taskTitle || taskId}" est bloquée par la tâche #${blockedByTaskId} (tâche non assignée).`,
        entityId,
        pushAllowed: PUSH_MANAGER,
      });
    }
  }
}

// Appelé quand une tâche est débloquée
async function notifyTaskUnblocked({ taskId, taskTitle, assigneeId, projectId }) {
  const entityId = `unblocked:${taskId}`;

  if (assigneeId) {
    await _dispatch({
      opUserId:    assigneeId,
      type:        NOTIF_TYPES.UNBLOCKED,
      message:     `Votre tâche "${taskTitle || `#${taskId}`}" est débloquée — vous pouvez reprendre le travail.`,
      entityId,
      pushAllowed: PUSH_MEMBER,
    });
  } else if (projectId) {
    const manager = getProjectManager(projectId);
    if (manager) {
      await _dispatch({
        opUserId:    manager.op_user_id,
        type:        NOTIF_TYPES.UNBLOCKED,
        message:     `La tâche "#${taskId} — ${taskTitle || taskId}" est maintenant débloquée (tâche non assignée).`,
        entityId,
        pushAllowed: PUSH_MANAGER,
      });
    }
  }
}

// Appelé par le CRON pour les tâches en retard (envoi au membre assigné)
async function notifyTaskOverdueMember({ opUserId, taskTitle, dueDate, taskId }) {
  await _dispatch({
    opUserId,
    type:        NOTIF_TYPES.OVERDUE,
    message:     `Votre tâche "${taskTitle}" est en retard (échéance : ${dueDate}).`,
    entityId:    `overdue:${taskId}`,
    pushAllowed: PUSH_MEMBER,
  });
}

// Appelé par le CRON pour les deadlines proches (envoi au membre assigné)
async function notifyDeadlineSoonMember({ opUserId, taskTitle, dueDate, taskId, daysLeft }) {
  await _dispatch({
    opUserId,
    type:        NOTIF_TYPES.DUE_SOON,
    message:     `Votre tâche "${taskTitle}" arrive à échéance dans ${daysLeft} jour(s) (${dueDate}).`,
    entityId:    `due_soon:${taskId}`,
    pushAllowed: PUSH_MEMBER,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  CHEF DE PROJET — résumés et alertes projet
// ══════════════════════════════════════════════════════════════════════════════

// Résumé quotidien envoyé au manager à 23h00
async function notifyManagerDailySummary({
  managerId, projectId, projectName, overdueCount = 0, blockedCount = 0, unblockedCount = 0,
}) {
  if (overdueCount === 0 && blockedCount === 0 && unblockedCount === 0) return;

  const parts = [];
  if (overdueCount   > 0) parts.push(`${overdueCount} tâche(s) en retard`);
  if (blockedCount   > 0) parts.push(`${blockedCount} tâche(s) bloquée(s)`);
  if (unblockedCount > 0) parts.push(`${unblockedCount} tâche(s) débloquée(s)`);

  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.OVERDUE,
    message:     `Résumé du jour — ${projectName} : ${parts.join(", ")}.`,
    entityId:    `daily_summary:${projectId}`,
    pushAllowed: PUSH_MANAGER,
  });
}

// Projet en danger (risque > 40) — envoyé uniquement au manager
async function notifyProjectDanger({ projectId, projectName, riskScore, managerId }) {
  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.DANGER,
    message:     `Le projet "${projectName}" est en danger (score de risque : ${riskScore}/100).`,
    entityId:    `danger:${projectId}`,
    pushAllowed: PUSH_MANAGER,
  });
}

// Projet critique (risque > 70) — envoyé au manager ET aux admins, avec email
async function notifyProjectCritical({
  projectId, projectName, riskScore,
  managerId, managerEmail, managerName,
  adminIds = [],
}) {
  const message = `⚠️ Le projet "${projectName}" est en état CRITIQUE (score : ${riskScore}/100). Intervention requise.`;
  const entityId = `critical:${projectId}`;

  const managerInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(managerId);
  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.DANGER,
    message,
    entityId,
    pushAllowed: PUSH_MANAGER,
    subType:     "project_critical",
    emailOpts:   {
      to:          managerEmail || managerInfo?.email,
      name:        managerName  || managerInfo?.name,
      projectName,
    },
  });

  // Admins : push avec PUSH_ADMIN (uniquement danger + budget_alert)
  for (const adminId of adminIds) {
    if (adminId === managerId) continue;
    const adminInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(adminId);
    await _dispatch({
      opUserId:    adminId,
      type:        NOTIF_TYPES.DANGER,
      message,
      entityId,
      pushAllowed: PUSH_ADMIN,
      subType:     "project_critical",
      emailOpts:   adminInfo ? { to: adminInfo.email, name: adminInfo.name, projectName } : null,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  BUDGET — alertes au manager + admins
// ══════════════════════════════════════════════════════════════════════════════

// Budget > 80% — avertissement au manager + admins
async function notifyBudgetWarning({ projectId, projectName, budgetPct, managerId, adminIds = [] }) {
  const message  = `Le budget du projet "${projectName}" est utilisé à ${budgetPct}% — surveillez les dépenses.`;
  const entityId = `budget_warn:${projectId}`;

  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.BUDGET_ALERT,
    message,
    entityId,
    pushAllowed: PUSH_MANAGER,
  });

  for (const adminId of adminIds) {
    if (adminId === managerId) continue;
    await _dispatch({
      opUserId:    adminId,
      type:        NOTIF_TYPES.BUDGET_ALERT,
      message,
      entityId,
      pushAllowed: PUSH_ADMIN,
    });
  }
}

// Budget >= 100% — dépassement critique au manager (email immédiat) + admins
async function notifyBudgetCritical({
  projectId, projectName, budgetPct,
  managerId, managerEmail, managerName,
  adminIds = [],
}) {
  const message  = `💰 Le budget du projet "${projectName}" est dépassé à ${budgetPct}%. Action immédiate requise.`;
  const entityId = `budget_critical:${projectId}`;

  const managerInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(managerId);
  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.BUDGET_ALERT,
    message,
    entityId,
    pushAllowed: PUSH_MANAGER,
    subType:     "budget_critical",
    emailOpts:   {
      to:   managerEmail || managerInfo?.email,
      name: managerName  || managerInfo?.name,
      projectName,
    },
  });

  for (const adminId of adminIds) {
    if (adminId === managerId) continue;
    const adminInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(adminId);
    await _dispatch({
      opUserId:    adminId,
      type:        NOTIF_TYPES.BUDGET_ALERT,
      message,
      entityId,
      pushAllowed: PUSH_ADMIN,
      subType:     "budget_critical",
      emailOpts:   adminInfo ? { to: adminInfo.email, name: adminInfo.name, projectName } : null,
    });
  }
}

// ── Aliases pour compatibilité (anciens imports) ──────────────────────────────
const notifyTaskOverdue   = notifyTaskOverdueMember;
const notifyDeadlineSoon  = notifyDeadlineSoonMember;

module.exports = {
  NOTIF_TYPES,
  getUserPrefs,
  notifyTaskAssigned,
  notifyTaskBlocked,
  notifyTaskUnblocked,
  notifyTaskOverdueMember,
  notifyDeadlineSoonMember,
  notifyManagerDailySummary,
  notifyProjectDanger,
  notifyProjectCritical,
  notifyBudgetWarning,
  notifyBudgetCritical,
  // aliases
  notifyTaskOverdue,
  notifyDeadlineSoon,
  // anciens noms (compat dependencies.js)
  notifyTaskBlockedMember:   notifyTaskBlocked,
  notifyTaskUnblockedMember: notifyTaskUnblocked,
};