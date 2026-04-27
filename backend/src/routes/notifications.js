"use strict";

const express = require("express");
const router  = express.Router();

const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationSettings,
  upsertNotificationSettings,
  db,
} = require("../database/db");

const { getUserPrefs } = require("../services/notificationEngine");

// GET /api/notifications
router.get("/", (req, res) => {
  const opUserId   = req.user.userId;
  const unreadOnly = req.query.unread === "true";
  const limit      = Math.min(parseInt(req.query.limit || "50"), 100);

  try {
    const all   = getNotifications(opUserId, { unreadOnly });
    const items = all.slice(0, limit);
    const unreadCount = unreadOnly
      ? items.length
      : all.filter((n) => n.is_read === 0).length;

    return res.json({ notifications: items, unreadCount, total: all.length });
  } catch (err) {
    console.error("[Notifications] GET error:", err.message);
    return res.status(500).json({ message: "Erreur récupération des notifications." });
  }
});

// GET /api/notifications/count  ← NOUVEAU
router.get("/count", (req, res) => {
  const opUserId = req.user.userId;
  try {
    const all   = getNotifications(opUserId, { unreadOnly: false });
    const count = all.filter((n) => n.is_read === 0).length;
    return res.json({ count });
  } catch (err) {
    console.error("[Notifications] COUNT error:", err.message);
    return res.status(500).json({ message: "Erreur récupération du compteur." });
  }
});

// PATCH /api/notifications/read-all
router.patch("/read-all", (req, res) => {
  try {
    markAllNotificationsRead(req.user.userId);
    return res.json({ message: "Toutes les notifications marquées comme lues." });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

// GET /api/notifications/preferences
router.get("/preferences", (req, res) => {
  try {
    const row = getNotificationSettings(req.user.userId);
    return res.json({
      pushEnabled:  row ? Boolean(row.enabled) : true,
      emailEnabled: row ? Boolean(row.enabled) : true,
      deadlineDays: row ? row.reminder_days    : 3,
    });
  } catch (err) {
    return res.status(500).json({ message: "Erreur récupération des préférences." });
  }
});

// PUT /api/notifications/preferences
router.put("/preferences", (req, res) => {
  const { pushEnabled, emailEnabled, deadlineDays } = req.body;
  const opUserId = req.user.userId;

  if (deadlineDays !== undefined) {
    const days = parseInt(deadlineDays);
    if (isNaN(days) || days < 0 || days > 30) {
      return res.status(400).json({
        message: "deadlineDays doit être un entier entre 0 et 30.",
      });
    }
  }

  try {
    const current = getNotificationSettings(opUserId) || {
      enabled: 1, reminder_days: 3,
    };

    const newEnabled = (pushEnabled !== undefined || emailEnabled !== undefined)
      ? ((pushEnabled || emailEnabled) ? 1 : 0)
      : current.enabled;

    const newDays = deadlineDays !== undefined
      ? parseInt(deadlineDays)
      : current.reminder_days;

    upsertNotificationSettings(opUserId, {
      enabled:      Boolean(newEnabled),
      reminderDays: newDays,
    });

    return res.json({
      message:      "Préférences mises à jour.",
      pushEnabled:  Boolean(newEnabled),
      emailEnabled: Boolean(newEnabled),
      deadlineDays: newDays,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Erreur mise à jour des préférences.",
      detail:  err.message,
    });
  }
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", (req, res) => {
  const id       = parseInt(req.params.id);
  const opUserId = req.user.userId;

  if (isNaN(id)) return res.status(400).json({ message: "ID invalide." });

  try {
    const notif = db.prepare(
      `SELECT id FROM notifications WHERE id = ? AND op_user_id = ?`
    ).get(id, opUserId);

    if (!notif) return res.status(404).json({ message: "Notification introuvable." });

    markNotificationRead(id);
    return res.json({ message: "Notification marquée comme lue." });
  } catch (err) {
    return res.status(500).json({ message: "Erreur.", detail: err.message });
  }
});

// DELETE /api/notifications/:id
router.delete("/:id", (req, res) => {
  const id       = parseInt(req.params.id);
  const opUserId = req.user.userId;

  if (isNaN(id)) return res.status(400).json({ message: "ID invalide." });

  try {
    const notif = db.prepare(
      `SELECT id FROM notifications WHERE id = ? AND op_user_id = ?`
    ).get(id, opUserId);

    if (!notif) return res.status(404).json({ message: "Notification introuvable." });

    db.prepare(`DELETE FROM notifications WHERE id = ?`).run(id);
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ message: "Erreur suppression.", detail: err.message });
  }
});

module.exports = router;