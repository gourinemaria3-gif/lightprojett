"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — emailService.js
//  Envoi d'emails via Nodemailer (SMTP)
//
//  Variables d'environnement requises dans .env :
//    SMTP_HOST=smtp.gmail.com
//    SMTP_PORT=587
//    SMTP_USER=ton@email.com
//    SMTP_PASS=ton_mot_de_passe_app
//    SMTP_FROM="LightProject <noreply@lightproject.com>"
//
//  3 types d'emails :
//    1. sendPersonalDigest()   — tâches en retard + deadlines proches (si du nouveau)
//    2. sendCriticalAlert()    — PROJECT_CRITICAL ou BUDGET_CRITICAL (immédiat)
//    3. sendWeeklyReport()     — rapport hebdomadaire chef + admin
// ══════════════════════════════════════════════════════════════════════════════

const nodemailer = require("nodemailer");

// ──────────────────────────────────────────────────────────────────────────────
//  Transporter SMTP — singleton
// ──────────────────────────────────────────────────────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("[Email] Variables SMTP manquantes — emails DÉSACTIVÉS.");
    return null;
  }

  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return _transporter;
}

// ──────────────────────────────────────────────────────────────────────────────
//  sendMail — wrapper interne
// ──────────────────────────────────────────────────────────────────────────────
async function sendMail({ to, subject, html }) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const from = process.env.SMTP_FROM || "LightProject <noreply@lightproject.com>";

  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log(`[Email] ✅ Envoyé à ${to} — "${subject}"`);
    return true;
  } catch (err) {
    console.error(`[Email] ❌ Erreur envoi à ${to}:`, err.message);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Templates HTML
// ──────────────────────────────────────────────────────────────────────────────
function baseTemplate(title, content) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f4f6f9; margin: 0; padding: 20px; color: #1a1a2e; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff;
                 border-radius: 12px; overflow: hidden;
                 box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 28px 32px; color: white; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header p  { margin: 6px 0 0; opacity: 0.85; font-size: 13px; }
    .body { padding: 28px 32px; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 15px; font-weight: 600; color: #374151;
                  margin: 0 0 12px; padding-bottom: 8px;
                  border-bottom: 2px solid #e5e7eb; }
    .task-item { background: #f9fafb; border-left: 3px solid #667eea;
                 border-radius: 6px; padding: 12px 14px; margin-bottom: 8px; }
    .task-item.overdue  { border-left-color: #ef4444; background: #fef2f2; }
    .task-item.warning  { border-left-color: #f59e0b; background: #fffbeb; }
    .task-item.blocked  { border-left-color: #6366f1; background: #eef2ff; }
    .task-item.critical { border-left-color: #dc2626; background: #fef2f2; }
    .task-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
    .task-meta  { font-size: 12px; color: #6b7280; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 99px;
             font-size: 11px; font-weight: 600; margin-left: 6px; }
    .badge-red    { background: #fee2e2; color: #dc2626; }
    .badge-yellow { background: #fef3c7; color: #d97706; }
    .badge-purple { background: #ede9fe; color: #7c3aed; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
                 margin: 16px 0; }
    .stat-box { text-align: center; padding: 16px; background: #f9fafb;
                border-radius: 8px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #667eea; }
    .stat-label { font-size: 11px; color: #6b7280; margin-top: 4px; }
    .alert-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
                 padding: 16px; margin: 16px 0; }
    .alert-box h3 { margin: 0 0 8px; color: #dc2626; font-size: 15px; }
    .footer { padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;
              text-align: center; font-size: 11px; color: #9ca3af; }
    .risk-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
    .risk-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      <p>LightProject — Gestion de projets intelligente</p>
      <p>Vous recevez cet email car vous êtes chef de projet ou administrateur.</p>
    </div>
  </div>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
//  1. EMAIL PERSONNEL (digest intelligent)
//
//  Envoyé UNIQUEMENT s'il y a des tâches en retard ou des deadlines proches.
//  Regroupé en un seul email par utilisateur.
//
//  @param {object} opts
//    to          {string}   — email destinataire
//    name        {string}   — prénom
//    overdueTasks   {Array} — tâches en retard
//    dueSoonTasks   {Array} — tâches avec deadline proche
// ──────────────────────────────────────────────────────────────────────────────
async function sendPersonalDigest({ to, name, overdueTasks = [], dueSoonTasks = [] }) {
  // Guard : ne pas envoyer si rien à signaler
  if (overdueTasks.length === 0 && dueSoonTasks.length === 0) return false;

  const overdueHtml = overdueTasks.length
    ? `
    <div class="section">
      <h2>🔴 Tâches en retard (${overdueTasks.length})</h2>
      ${overdueTasks.map((t) => `
        <div class="task-item overdue">
          <div class="task-title">${escHtml(t.title)}</div>
          <div class="task-meta">
            Projet : ${escHtml(t.projectName || "–")} •
            Échéance : ${formatDate(t.dueDate)}
            <span class="badge badge-red">${daysSince(t.dueDate)} j de retard</span>
          </div>
        </div>`).join("")}
    </div>`
    : "";

  const dueSoonHtml = dueSoonTasks.length
    ? `
    <div class="section">
      <h2>⏰ Deadlines proches (${dueSoonTasks.length})</h2>
      ${dueSoonTasks.map((t) => `
        <div class="task-item warning">
          <div class="task-title">${escHtml(t.title)}</div>
          <div class="task-meta">
            Projet : ${escHtml(t.projectName || "–")} •
            Échéance : ${formatDate(t.dueDate)}
            <span class="badge badge-yellow">dans ${daysUntil(t.dueDate)} j</span>
          </div>
        </div>`).join("")}
    </div>`
    : "";

  const content = `
    <div class="header">
      <h1>📋 Résumé de vos tâches</h1>
      <p>Bonjour ${escHtml(name)}, voici les points qui nécessitent votre attention.</p>
    </div>
    <div class="body">
      ${overdueHtml}
      ${dueSoonHtml}
    </div>`;

  return sendMail({
    to,
    subject: `LightProject — ${overdueTasks.length} retard(s), ${dueSoonTasks.length} deadline(s) proche(s)`,
    html: baseTemplate("Résumé de vos tâches", content),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  2. EMAIL CRITIQUE (immédiat)
//
//  Déclenché par PROJECT_CRITICAL ou BUDGET_CRITICAL.
//  Envoyé immédiatement au chef de projet + admin.
//
//  @param {object} opts
//    to          {string}  — email destinataire
//    name        {string}  — prénom
//    type        {string}  — "project_critical" | "budget_critical"
//    projectName {string}
//    detail      {string}  — texte d'explication
// ──────────────────────────────────────────────────────────────────────────────
async function sendCriticalAlert({ to, name, type, projectName, detail }) {
  const isProject = type === "project_critical";
  const emoji     = isProject ? "🚨" : "💰";
  const title     = isProject ? "Projet en état CRITIQUE" : "Budget DÉPASSÉ";

  const content = `
    <div class="header" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
      <h1>${emoji} ${title}</h1>
      <p>Action immédiate requise sur le projet ${escHtml(projectName)}.</p>
    </div>
    <div class="body">
      <div class="alert-box">
        <h3>${emoji} ${title}</h3>
        <p>Bonjour ${escHtml(name)},</p>
        <p>${escHtml(detail)}</p>
      </div>
      <p style="color: #6b7280; font-size: 13px;">
        Connectez-vous à LightProject pour analyser la situation et prendre les mesures nécessaires.
      </p>
    </div>`;

  return sendMail({
    to,
    subject: `🚨 LightProject — ${title} : ${projectName}`,
    html: baseTemplate(title, content),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  3. RAPPORT HEBDOMADAIRE
//
//  Envoyé chaque semaine (lundi matin) aux chefs de projet + admins.
//  Contient l'état complet de tous leurs projets.
//
//  @param {object} opts
//    to        {string}  — email destinataire
//    name      {string}  — prénom
//    projects  {Array}   — liste de projets avec leurs stats
//      [{
//        name, progress, riskScore, lateTasks, blockedTasks,
//        budgetTotal, budgetUsed
//      }]
// ──────────────────────────────────────────────────────────────────────────────
async function sendWeeklyReport({ to, name, projects = [] }) {
  if (projects.length === 0) return false;

  const totalLate    = projects.reduce((s, p) => s + (p.lateTasks    || 0), 0);
  const totalBlocked = projects.reduce((s, p) => s + (p.blockedTasks || 0), 0);
  const criticalProjects = projects.filter((p) => p.riskScore > 70);

  const projectsHtml = projects.map((p) => {
    const riskColor = p.riskScore > 70 ? "#ef4444" : p.riskScore > 40 ? "#f59e0b" : "#10b981";
    const budgetPct = p.budgetTotal && p.budgetUsed
      ? Math.round((p.budgetUsed / p.budgetTotal) * 100)
      : null;

    return `
    <div class="task-item ${p.riskScore > 70 ? "critical" : p.riskScore > 40 ? "warning" : ""}">
      <div class="task-title">${escHtml(p.name)}</div>
      <div style="margin: 8px 0;">
        <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px;">
          Progression : ${p.progress}%
        </div>
        <div class="risk-bar">
          <div class="risk-fill" style="width:${p.progress}%; background:#667eea;"></div>
        </div>
      </div>
      <div class="task-meta">
        Risque : <strong style="color:${riskColor}">${p.riskScore}/100</strong> •
        ${p.lateTasks} en retard •
        ${p.blockedTasks} bloqué(s)
        ${budgetPct !== null ? `• Budget : ${budgetPct}%` : ""}
      </div>
    </div>`;
  }).join("");

  const content = `
    <div class="header">
      <h1>📊 Rapport hebdomadaire</h1>
      <p>Bonjour ${escHtml(name)}, voici l'état de vos projets cette semaine.</p>
    </div>
    <div class="body">
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-value">${projects.length}</div>
          <div class="stat-label">Projets actifs</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color: #ef4444;">${totalLate}</div>
          <div class="stat-label">Tâches en retard</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color: #f59e0b;">${totalBlocked}</div>
          <div class="stat-label">Tâches bloquées</div>
        </div>
      </div>
      ${criticalProjects.length ? `
        <div class="alert-box">
          <h3>🚨 ${criticalProjects.length} projet(s) en état critique</h3>
          <p>${criticalProjects.map((p) => escHtml(p.name)).join(", ")}</p>
        </div>` : ""}
      <div class="section">
        <h2>État des projets</h2>
        ${projectsHtml}
      </div>
    </div>`;

  return sendMail({
    to,
    subject: `📊 LightProject — Rapport hebdomadaire (${formatDateNow()})`,
    html: baseTemplate("Rapport hebdomadaire", content),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  if (!dateStr) return "–";
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatDateNow() {
  return new Date().toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function daysUntil(dateStr) {
  if (!dateStr) return 0;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

module.exports = {
  sendPersonalDigest,
  sendCriticalAlert,
  sendWeeklyReport,
};