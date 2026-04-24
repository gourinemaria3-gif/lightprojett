/* eslint-disable */

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

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || "Light Project", {
    body:    body || "",
    icon:    "/logo192.png",
    badge:   "/logo192.png",
    vibrate: [200, 100, 200],
    data:    { url: payload.fcmOptions?.link || "/" },
    actions: [
      { action: "open",    title: "Ouvrir" },
      { action: "dismiss", title: "Ignorer" },
    ],
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});