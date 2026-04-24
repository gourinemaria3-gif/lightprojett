// ══════════════════════════════════════════════════════════════════════════════
//  src/services/firebase.js  (FRONTEND)
//
//  Initialise Firebase côté client et gère :
//    - La demande de permission push
//    - La récupération du FCM token
//    - L'envoi du token au backend pour le stocker dans current_session
//    - La réception des messages quand l'app est au premier plan
//
//  npm install firebase
// ══════════════════════════════════════════════════════════════════════════════

import { initializeApp }       from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            "AIzaSyCujZRzksLQa9Tk0zQ93I6fuAmnY2E3Hb4",
  authDomain:        "lightproject-a629d.firebaseapp.com",
  projectId:         "lightproject-a629d",
  storageBucket:     "lightproject-a629d.firebasestorage.app",
  messagingSenderId: "11994852223",
  appId:             "1:11994852223:web:845b4442163dab6606084a",
};

// Clé VAPID (depuis Firebase Console → Cloud Messaging → Certificats Web push)
const VAPID_KEY = "BFRvoDEcBPEuQ2rjcGfRs2ZZw1XPdlnfO5EbRGVjpG65rTcGGNCKYz9xskgaxYKNSaf3a6BHxY4VoivvWOqw03s";

const app       = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// ──────────────────────────────────────────────────────────────────────────────
//  requestPushPermission
//
//  Demande la permission push à l'utilisateur, récupère le FCM token
//  et l'envoie au backend via PATCH /api/auth/fcm-token
//
//  À appeler une fois après le login de l'utilisateur.
// ──────────────────────────────────────────────────────────────────────────────
export async function requestPushPermission() {
  try {
    // 1. Vérifie que le navigateur supporte les notifications
    if (!("Notification" in window)) {
      console.info("[FCM] Navigateur sans support notifications.");
      return null;
    }

    // 2. Demande la permission (affiche le popup navigateur)
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.info("[FCM] Permission refusée par l'utilisateur.");
      return null;
    }

    // 3. Enregistre le service worker
    const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    // 4. Récupère le FCM token
    const token = await getToken(messaging, {
      vapidKey:        VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (!token) {
      console.warn("[FCM] Token FCM vide.");
      return null;
    }

    console.log("[FCM] Token obtenu:", token.slice(0, 30) + "…");

    // 5. Envoie le token au backend
    await saveFcmTokenToBackend(token);

    return token;

  } catch (err) {
    console.error("[FCM] Erreur requestPushPermission:", err.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  saveFcmTokenToBackend — envoie le token FCM au serveur
// ──────────────────────────────────────────────────────────────────────────────
async function saveFcmTokenToBackend(fcmToken) {
  const jwt = localStorage.getItem("jwt");
  if (!jwt) return;

  try {
    await fetch("/api/auth/fcm-token", {
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

// ──────────────────────────────────────────────────────────────────────────────
//  onForegroundMessage
//
//  Callback appelé quand une notif arrive ET que l'app est au premier plan.
//  Le service worker ne gère QUE l'arrière-plan.
//
//  Usage dans App.jsx :
//    onForegroundMessage((payload) => {
//      // afficher une toast notification dans l'UI
//    });
// ──────────────────────────────────────────────────────────────────────────────
export function onForegroundMessage(callback) {
  return onMessage(messaging, (payload) => {
    console.log("[FCM] Message au premier plan:", payload);
    callback(payload);
  });
}