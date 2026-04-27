import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            "AIzaSyCujZRzksLQa9Tk0zQ93I6fuAmnY2E3Hb4",
  authDomain:        "lightproject-a629d.firebaseapp.com",
  projectId:         "lightproject-a629d",
  storageBucket:     "lightproject-a629d.firebasestorage.app",
  messagingSenderId: "11994852223",
  appId:             "1:11994852223:web:845b4442163dab6606084a",
};

const VAPID_KEY = "BOQPwQyJd-xOGbOqCzC2EJRrWhLoCHemB4TZgKsoltfLj9j3bvoPGDR9_ZO8_B1uQUpmeCIw0OrjC7eArQEkh2E";

// Singleton Firebase app
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// ── getMessaging lazy — évite le crash sur Safari HTTP ───────────────────────
let _messaging = null;

async function getMessagingInstance() {
  try {
    const supported = await isSupported();
    if (!supported) {
      console.info("[FCM] Firebase Messaging non supporté sur ce navigateur.");
      return null;
    }
    if (!_messaging) {
      _messaging = getMessaging(app);
    }
    return _messaging;
  } catch (err) {
    console.info("[FCM] Messaging indisponible:", err.message);
    return null;
  }
}

// ── requestPushPermission ─────────────────────────────────────────────────────
export async function requestPushPermission() {
  try {
    if (!("Notification" in window)) {
      console.info("[FCM] Navigateur sans support notifications.");
      return null;
    }

    // Firebase Messaging nécessite HTTPS (sauf localhost)
    const isLocalhost = window.location.hostname === "localhost";
    const isHttps     = window.location.protocol === "https:";
    if (!isLocalhost && !isHttps) {
      console.info("[FCM] HTTPS requis pour les push — fonctionnera en production.");
      return null;
    }

    const messaging = await getMessagingInstance();
    if (!messaging) return null;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.info("[FCM] Permission refusée.");
      return null;
    }

    const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    const token = await getToken(messaging, {
      vapidKey:                  VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (!token) {
      console.warn("[FCM] Token FCM vide.");
      return null;
    }

    console.log("[FCM] Token obtenu:", token.slice(0, 30) + "…");
    await saveFcmTokenToBackend(token);
    return token;

  } catch (err) {
    console.error("[FCM] Erreur:", err.message);
    return null;
  }
}

// ── saveFcmTokenToBackend ─────────────────────────────────────────────────────
async function saveFcmTokenToBackend(fcmToken) {
  const jwt     = localStorage.getItem("jwt");
  if (!jwt) return;

  const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

  try {
    await fetch(`${BASE_URL}/api/auth/fcm-token`, {
      method:  "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({ fcmToken }),
    });
    console.log("[FCM] Token sauvegardé en backend.");
  } catch (err) {
    console.error("[FCM] Erreur sauvegarde token:", err.message);
  }
}

// ── onForegroundMessage ───────────────────────────────────────────────────────
export async function onForegroundMessage(callback) {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};

  return onMessage(messaging, (payload) => {
    console.log("[FCM] Message premier plan:", payload);
    callback(payload);
  });
}



