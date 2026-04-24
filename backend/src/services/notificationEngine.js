"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  notificationEngine.js
//
//  RÈGLES PAR RÔLE :
//
//  MEMBRE
//    In-app  : assignée, bloquée, débloquée, en retard, deadline proche
//    Push    : en retard, deadline proche  (urgents seulement)
//    Email   : CRON selon préférence (résumé retards + deadlines)
//
//  CHEF DE PROJET  (peut aussi être membre d'un autre projet)
//    In-app  : idem membre pour SES tâches personnelles
//              + résumé fin de journée "N tâches en retard / bloquées" (CRON 23h)
//              + projet en danger, budget warning/critique
//    Push    : projet en danger, budget (warning + critique)
//    Email   : idem membre + rapport hebdomadaire
//
//  ADMIN
//    In-app  : projet en danger, budget critique seulement
//    Push    : projet en danger, budget critique + warning
//    Email   : rapport hebdomadaire uniquement
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

// Push par rôle — chaque rôle a son propre ensemble de types urgents
const PUSH_MEMBER  = new Set(["overdue", "due_soon"]);
const PUSH_MANAGER = new Set(["danger", "budget_alert"]);
const PUSH_ADMIN   = new Set(["danger", "budget_alert"]);
const PUSH_NONE    = new Set();

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
async function _dispatch({
  opUserId,
  type,
  message,
  entityId,
  pushAllowed,        // Set des types qui déclenchent un push pour ce rôle
  subType   = null,   // sous-type pour email critique immédiat
  emailOpts = null,   // { to, name, projectName } — email critique immédiat
  skipDedup = false,  // true = bypass anti-spam (assignation explicite)
}) {
  const dedupKey = subType ? `${type}:${subType}` : type;

  if (!skipDedup) {
    if (alreadySentToday(opUserId, dedupKey, entityId)) return;
    markSent(opUserId, dedupKey, entityId);
  }

  const prefs = getUserPrefs(opUserId);

  // 1. In-app (toujours, sauf si createNotification lève une erreur)
  try {
    createNotification(opUserId, type, message);
  } catch (err) {
    console.warn(`[NotifEngine] in-app user ${opUserId}:`, err.message);
  }

  // 2. Push — uniquement si le type est dans pushAllowed pour ce rôle
  if (prefs.push_enabled && pushAllowed.has(type)) {
    try {
      await sendPushToUser(opUserId, type, message, db);
    } catch (err) {
      console.warn(`[NotifEngine] push user ${opUserId}:`, err.message);
    }
  }

  // 3. Email critique immédiat (project_critical ou budget_critical)
  if (prefs.email_enabled && subType && CRITICAL_SUBTYPES.has(subType) && emailOpts?.to) {
    try {
      await sendCriticalAlert({
        to:          emailOpts.to,
        name:        emailOpts.name || "Chef de projet",
        type:        subType,
        projectName: emailOpts.projectName || "Projet inconnu",
        detail:      message,
      });
    } catch (err) {
      console.warn(`[NotifEngine] email critique user ${opUserId}:`, err.message);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MEMBRE — tâches personnelles
// ══════════════════════════════════════════════════════════════════════════════

// Assignation : skipDedup=true (acte explicite), entityId unique par (tâche×personne)
async function notifyTaskAssigned({ assigneeId, taskTitle, projectName, taskId }) {
  await _dispatch({
    opUserId:    assigneeId,
    type:        NOTIF_TYPES.ASSIGNED,
    message:     `Vous avez été assigné(e) à la tâche "${taskTitle}" dans ${projectName}.`,
    entityId:    `assigned:${taskId}:${assigneeId}`,
    pushAllowed: PUSH_NONE,
    skipDedup:   true,
  });
}

// Tâche bloquée — notifie l'assignee (membre)
async function notifyTaskBlockedMember({ taskId, taskTitle, blockedByTaskId, assigneeId }) {
  if (!assigneeId) return;
  await _dispatch({
    opUserId:    assigneeId,
    type:        NOTIF_TYPES.BLOCKED,
    message:     `Votre tâche "${taskTitle}" est bloquée par la tâche #${blockedByTaskId}.`,
    entityId:    `blocked:${taskId}:by:${blockedByTaskId}`,
    pushAllowed: PUSH_MEMBER,
  });
}

// Tâche débloquée — notifie l'assignee (membre)
async function notifyTaskUnblockedMember({ taskId, taskTitle, assigneeId }) {
  if (!assigneeId) return;
  await _dispatch({
    opUserId:    assigneeId,
    type:        NOTIF_TYPES.UNBLOCKED,
    message:     `Votre tâche "${taskTitle}" est débloquée — vous pouvez reprendre le travail.`,
    entityId:    `unblocked:${taskId}`,
    pushAllowed: PUSH_MEMBER,
  });
}

// Tâche en retard — notifie l'assignee (membre)
async function notifyTaskOverdueMember({ opUserId, taskTitle, dueDate, taskId }) {
  await _dispatch({
    opUserId,
    type:        NOTIF_TYPES.OVERDUE,
    message:     `Votre tâche "${taskTitle}" est en retard (échéance : ${dueDate}).`,
    entityId:    `overdue:${taskId}`,
    pushAllowed: PUSH_MEMBER,
  });
}

// Deadline proche — notifie l'assignee (membre)
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
//  CHEF DE PROJET — résumé global fin de journée
//
//  Appelé par le CRON à 23h00 avec les compteurs agrégés du projet.
//  UNE seule notif résumé au lieu de N notifs individuelles.
// ══════════════════════════════════════════════════════════════════════════════
async function notifyManagerDailySummary({
  managerId,
  projectId,
  projectName,
  overdueCount   = 0,
  blockedCount   = 0,
  unblockedCount = 0,
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
    pushAllowed: PUSH_NONE, // résumé = pas urgent, pas de push
  });
}

// ── Projet en danger — chef seulement ────────────────────────────────────────
async function notifyProjectDanger({ projectId, projectName, riskScore, managerId }) {
  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.DANGER,
    message:     `Le projet "${projectName}" est en danger (score de risque : ${riskScore}/100).`,
    entityId:    `danger:${projectId}`,
    pushAllowed: PUSH_MANAGER,
  });
}

// ── Projet critique — chef + admins (email critique immédiat) ─────────────────
async function notifyProjectCritical({
  projectId, projectName, riskScore,
  managerId, managerEmail, managerName,
  adminIds = [],
}) {
  const message = `⚠️ Le projet "${projectName}" est en état CRITIQUE (score : ${riskScore}/100). Intervention requise.`;

  const managerInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(managerId);
  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.DANGER,
    message,
    entityId:    `critical:${projectId}`,
    pushAllowed: PUSH_MANAGER,
    subType:     "project_critical",
    emailOpts:   {
      to:          managerEmail || managerInfo?.email,
      name:        managerName  || managerInfo?.name,
      projectName,
    },
  });

  for (const adminId of adminIds) {
    if (adminId === managerId) continue;
    const adminInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(adminId);
    await _dispatch({
      opUserId:    adminId,
      type:        NOTIF_TYPES.DANGER,
      message,
      entityId:    `critical:${projectId}`,
      pushAllowed: PUSH_ADMIN,
      subType:     "project_critical",
      emailOpts:   adminInfo ? { to: adminInfo.email, name: adminInfo.name, projectName } : null,
    });
  }
}

// ── Budget warning ≥ 80% — chef + admins in-app & push ───────────────────────
async function notifyBudgetWarning({ projectId, projectName, budgetPct, managerId, adminIds = [] }) {
  const message = `Le budget du projet "${projectName}" est utilisé à ${budgetPct}% — surveillez les dépenses.`;

  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.BUDGET_ALERT,
    message,
    entityId:    `budget_warn:${projectId}`,
    pushAllowed: PUSH_MANAGER,
  });

  for (const adminId of adminIds) {
    if (adminId === managerId) continue;
    await _dispatch({
      opUserId:    adminId,
      type:        NOTIF_TYPES.BUDGET_ALERT,
      message,
      entityId:    `budget_warn:${projectId}`,
      pushAllowed: PUSH_ADMIN,
    });
  }
}

// ── Budget critique ≥ 100% — chef + admins (email critique immédiat) ──────────
async function notifyBudgetCritical({
  projectId, projectName, budgetPct,
  managerId, managerEmail, managerName,
  adminIds = [],
}) {
  const message = `💰 Le budget du projet "${projectName}" est dépassé à ${budgetPct}%. Action immédiate requise.`;

  const managerInfo = db.prepare(`SELECT name, email FROM users WHERE op_user_id = ?`).get(managerId);
  await _dispatch({
    opUserId:    managerId,
    type:        NOTIF_TYPES.BUDGET_ALERT,
    message,
    entityId:    `budget_critical:${projectId}`,
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
      entityId:    `budget_critical:${projectId}`,
      pushAllowed: PUSH_ADMIN,
      subType:     "budget_critical",
      emailOpts:   adminInfo ? { to: adminInfo.email, name: adminInfo.name, projectName } : null,
    });
  }
}

// ── Aliases pour compatibilité avec l'ancien code ────────────────────────────
const notifyTaskOverdue   = notifyTaskOverdueMember;
const notifyDeadlineSoon  = notifyDeadlineSoonMember;
const notifyTaskBlocked   = notifyTaskBlockedMember;
const notifyTaskUnblocked = notifyTaskUnblockedMember;

module.exports = {
  NOTIF_TYPES,
  getUserPrefs,

  // Membre
  notifyTaskAssigned,
  notifyTaskBlockedMember,
  notifyTaskUnblockedMember,
  notifyTaskOverdueMember,
  notifyDeadlineSoonMember,

  // Chef
  notifyManagerDailySummary,
  notifyProjectDanger,
  notifyProjectCritical,

  // Budget
  notifyBudgetWarning,
  notifyBudgetCritical,

  // Aliases compat
  notifyTaskOverdue,
  notifyDeadlineSoon,
  notifyTaskBlocked,
  notifyTaskUnblocked,
};