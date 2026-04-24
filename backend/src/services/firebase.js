"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Service — firebase.js
//  Push notifications via Firebase Cloud Messaging (Admin SDK)
//
//  Utilise le fichier service account JSON référencé dans .env :
//    FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
//
//  Usage :
//    await sendPushToUser(userId, type, title, body, db);
//    await sendPushToUsers([userId1, userId2], type, title, body, db);
// ══════════════════════════════════════════════════════════════════════════════

const admin = require("firebase-admin");
const path  = require("path");
const fs    = require("fs");

// ──────────────────────────────────────────────────────────────────────────────
//  Initialisation Firebase (singleton — une seule fois au démarrage)
// ──────────────────────────────────────────────────────────────────────────────
let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized || admin.apps.length > 0) return;

  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.resolve(__dirname, "../../firebase-service-account.json");

  if (!fs.existsSync(saPath)) {
    console.warn("[Firebase] Fichier service account introuvable :", saPath);
    console.warn("[Firebase] Les push notifications sont DÉSACTIVÉES.");
    return;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log("[Firebase] ✅ SDK initialisé pour projet :", serviceAccount.project_id);
  } catch (err) {
    console.error("[Firebase] Erreur initialisation :", err.message);
  }
}

initFirebase();

// ──────────────────────────────────────────────────────────────────────────────
//  TYPES URGENTS → Push autorisé
//  Seuls ces types déclenchent une notification push (évite le spam)
// ──────────────────────────────────────────────────────────────────────────────
const PUSH_ALLOWED_TYPES = new Set([
  "overdue",        // tâche en retard
  "blocked",        // tâche bloquée
  "danger",         // projet en danger
  "budget_alert",   // alerte budget (warning + critical)
  "unblocked",      // tâche débloquée (optionnel selon config)
]);

// ──────────────────────────────────────────────────────────────────────────────
//  Titres lisibles par type de notification
// ──────────────────────────────────────────────────────────────────────────────
const PUSH_TITLES = {
  overdue:      "⚠️ Tâche en retard",
  blocked:      "🔴 Tâche bloquée",
  unblocked:    "✅ Tâche débloquée",
  danger:       "🚨 Projet en danger",
  budget_alert: "💰 Alerte budget",
  due_soon:     "⏰ Deadline proche",
  assigned:     "📋 Nouvelle tâche assignée",
};

// ──────────────────────────────────────────────────────────────────────────────
//  sendPush — envoie une notification FCM à un FCM token spécifique
//
//  @param {string} fcmToken  — token FCM de l'appareil
//  @param {string} type      — type de notification
//  @param {string} body      — message texte
//  @returns {boolean}        — true si envoi réussi
// ──────────────────────────────────────────────────────────────────────────────
async function sendPush(fcmToken, type, body) {
  if (!firebaseInitialized || admin.apps.length === 0) return false;
  if (!fcmToken) return false;

  const title = PUSH_TITLES[type] || "LightProject";

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: { type, timestamp: new Date().toISOString() },
      android: { priority: "high" },
      apns: {
        payload: {
          aps: { alert: { title, body }, sound: "default", badge: 1 },
        },
      },
    });
    return true;
  } catch (err) {
    // Token invalide / expiré → inutile de le conserver
    if (
      err.code === "messaging/registration-token-not-registered" ||
      err.code === "messaging/invalid-registration-token"
    ) {
      console.warn(`[Firebase] Token FCM invalide (${fcmToken.slice(0, 20)}...) — à purger.`);
      return false;
    }
    console.error("[Firebase] Erreur envoi push :", err.message);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  sendPushToUser — envoie un push à tous les appareils d'un utilisateur
//
//  @param {number} opUserId
//  @param {string} type
//  @param {string} body
//  @param {object} db       — instance better-sqlite3 (pour récupérer FCM tokens)
// ──────────────────────────────────────────────────────────────────────────────
async function sendPushToUser(opUserId, type, body, db) {
  // Vérification : ce type déclenche-t-il un push ?
  if (!PUSH_ALLOWED_TYPES.has(type)) return;

  // Récupère tous les FCM tokens de l'utilisateur (multi-appareil)
  const sessions = db
    .prepare(
      `SELECT fcm_token FROM current_session
       WHERE op_user_id = ? AND fcm_token IS NOT NULL`
    )
    .all(opUserId);

  if (sessions.length === 0) return;

  for (const session of sessions) {
    await sendPush(session.fcm_token, type, body);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  sendPushToUsers — envoie un push à plusieurs utilisateurs
//
//  @param {number[]} userIds
//  @param {string}   type
//  @param {string}   body
//  @param {object}   db
// ──────────────────────────────────────────────────────────────────────────────
async function sendPushToUsers(userIds, type, body, db) {
  if (!userIds || userIds.length === 0) return;
  for (const userId of userIds) {
    await sendPushToUser(userId, type, body, db);
  }
}

module.exports = {
  sendPush,
  sendPushToUser,
  sendPushToUsers,
  PUSH_ALLOWED_TYPES,
};