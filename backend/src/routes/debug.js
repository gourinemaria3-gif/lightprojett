"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Route — /api/debug
//
//  Endpoints pour tester le système de notifications sans attendre le CRON.
//  À utiliser UNIQUEMENT en développement.
//  Ajoutez NODE_ENV=development dans votre .env pour les activer.
// ══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const router  = express.Router();
const { db }  = require("../database/db");
const { runDailyAlerts, runEveningManagerSummary } = require("../services/cron");
const { requireAdmin } = require("../middleware/checkRole");

// Guard : ces routes ne sont accessibles qu'en dev
function devOnly(req, res, next) {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ message: "Endpoint de debug désactivé en production." });
  }
  return next();
}

// ── POST /api/debug/run-daily-alerts ─────────────────────────────────────────
//  Déclenche immédiatement le CRON des alertes personnelles
router.post("/run-daily-alerts", devOnly, requireAdmin, async (req, res) => {
  console.log("[DEBUG] Déclenchement manuel des alertes quotidiennes...");
  try {
    await runDailyAlerts();
    return res.json({ message: "Alertes quotidiennes déclenchées. Regardez la console pour les détails." });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

// ── POST /api/debug/run-evening-summary ──────────────────────────────────────
//  Déclenche immédiatement le résumé de fin de journée
router.post("/run-evening-summary", devOnly, requireAdmin, async (req, res) => {
  console.log("[DEBUG] Déclenchement manuel du résumé de fin de journée...");
  try {
    await runEveningManagerSummary();
    return res.json({ message: "Résumé fin de journée déclenché." });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

// ── POST /api/debug/clear-notif-dedup ────────────────────────────────────────
//  Vide la table anti-spam pour aujourd'hui → permet de retester les notifs
router.post("/clear-notif-dedup", devOnly, requireAdmin, (req, res) => {
  try {
    const result = db.prepare(`DELETE FROM notification_log WHERE sent_date = date('now')`).run();
    console.log(`[DEBUG] ${result.changes} entrée(s) anti-spam supprimée(s)`);
    return res.json({ message: `Anti-spam vidé (${result.changes} entrée(s) supprimée(s)).` });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

// ── POST /api/debug/clear-all-notifications ───────────────────────────────────
//  Vide TOUTES les notifications in-app (pour repartir de zéro)
router.post("/clear-all-notifications", devOnly, requireAdmin, (req, res) => {
  try {
    const r1 = db.prepare(`DELETE FROM notifications`).run();
    const r2 = db.prepare(`DELETE FROM notification_log`).run();
    return res.json({
      message: `${r1.changes} notification(s) et ${r2.changes} entrée(s) anti-spam supprimées.`,
    });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

// ── GET /api/debug/notif-status ───────────────────────────────────────────────
//  Résumé de l'état du système de notifications
router.get("/notif-status", devOnly, requireAdmin, (req, res) => {
  try {
    const totalNotifs  = db.prepare(`SELECT COUNT(*) as n FROM notifications`).get().n;
    const unreadNotifs = db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE is_read = 0`).get().n;
    const dedupToday   = db.prepare(`SELECT COUNT(*) as n FROM notification_log WHERE sent_date = date('now')`).get().n;
    const users        = db.prepare(`SELECT op_user_id, name, is_admin FROM users`).all();
    const sessions     = db.prepare(`SELECT op_user_id, op_token IS NOT NULL as has_token FROM current_session`).all();

    const usersWithSession = users.map(u => ({
      ...u,
      hasSession: sessions.some(s => s.op_user_id === u.op_user_id && s.has_token),
    }));

    return res.json({
      notifications: { total: totalNotifs, unread: unreadNotifs },
      antiSpamToday: dedupToday,
      users:         usersWithSession,
      canRunCron:    usersWithSession.some(u => u.hasSession),
    });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

// ── POST /api/debug/test-notif ────────────────────────────────────────────────
//  Envoie une notif de test in-app directement à l'utilisateur connecté
router.post("/test-notif", devOnly, async (req, res) => {
  const { type = "overdue", message = "Ceci est une notification de test." } = req.body;
  const opUserId = req.user.userId;

  try {
    const { createNotification } = require("../database/db");
    createNotification(opUserId, type, message);
    return res.json({ message: `Notification de test (${type}) envoyée à user ${opUserId}.` });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

module.exports = router;