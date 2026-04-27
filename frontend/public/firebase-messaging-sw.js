/* eslint-disable */
// public/firebase-messaging-sw.js
// Service Worker pour les notifications push Firebase en arrière-plan

importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyCujZRzksLQa9Tk0zQ93I6fuAmnY2E3Hb4",
  authDomain:        "lightproject-a629d.firebaseapp.com",
  projectId:         "lightproject-a629d",
  storageBucket:     "lightproject-a629d.firebasestorage.app",
  messagingSenderId: "11994852223",
  appId:             "1:11994852223:web:845b4442163dab6606084a",
});

const messaging = firebase.messaging();

// Notification reçue en arrière-plan (app fermée ou onglet inactif)
messaging.onBackgroundMessage((payload) => {
  console.log("[SW] Notification en arrière-plan reçue:", payload);

  const { title, body } = payload.notification || {};
  const notifTitle = title || "LightProject";
  const notifBody  = body  || "Vous avez une nouvelle notification.";

  self.registration.showNotification(notifTitle, {
    body:    notifBody,
    icon:    "/logo192.png",
    badge:   "/logo192.png",
    vibrate: [200, 100, 200],
    data:    payload.data || {},
    actions: [
      { action: "open",    title: "Ouvrir" },
      { action: "dismiss", title: "Ignorer" },
    ],
  });
});

// Clic sur la notification → ouvre l'app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("localhost:3000") && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("http://localhost:3000");
      }
    })
  );
});