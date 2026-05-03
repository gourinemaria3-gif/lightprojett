const SW_URL = "/sw.js";

export function register(config = {}) {
  if (!("serviceWorker" in navigator)) {
    console.warn("[SW] Service Workers non supportés par ce navigateur.");
    return;
  }

  navigator.serviceWorker
    .register(SW_URL)
    .then((registration) => {
      console.log("[SW] Enregistré :", registration.scope);

      registration.onupdatefound = () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.onstatechange = () => {
          if (installing.state === "installed") {
            if (navigator.serviceWorker.controller) {
              console.log("[SW] Nouvelle version disponible.");
              config.onUpdate?.(registration);
            } else {
              console.log("[SW] Application disponible hors ligne.");
              config.onSuccess?.(registration);
            }
          }
        };
      };
    })
    .catch((err) => {
      console.error("[SW] Erreur d'enregistrement :", err);
    });

  navigator.serviceWorker.addEventListener("message", (event) => {
    config.onMessage?.(event.data);
  });
}

export function unregister() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.unregister())
      .catch((err) => console.error("[SW] Erreur de désenregistrement :", err));
  }
}

export function forceSWSync() {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "FORCE_SYNC" });
  }
}