/* eslint-disable */
/* global self, caches, fetch, indexedDB, clients */

/*
  LightProject — Service Worker (sw.js)
  Strategies:
    - App shell HTML/JS/CSS  : Cache First
    - GET /api/projects      : Network First, fallback cache
    - GET /api/tasks         : Network First, fallback cache
    - POST/PATCH/DELETE      : Background Sync queue
*/

var CACHE_VERSION = "lp-v1";
var STATIC_CACHE  = CACHE_VERSION + "-static";
var API_CACHE     = CACHE_VERSION + "-api";
var SYNC_TAG      = "lp-sync-queue";

var PRECACHE_URLS = [
  "/",
  "/index.html",
  "/offline.html",
  "/logo192.png",
  "/favicon.ico"
];

var MUTATION_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

// ── Vérifie si une URL d'API est cacheable ────────────────────
function isApiCacheable(pathname, search) {
  var full = pathname + (search || "");
  if (pathname === "/api/projects") return true;
  if (pathname === "/api/projects/members") return true;
  if (pathname.indexOf("/api/projects/") === 0 && pathname.indexOf("/stats") !== -1) return true;
  if (pathname.indexOf("/api/projects/") === 0 && pathname.indexOf("/members") !== -1) return true;
  if (pathname.indexOf("/api/tasks/") === 0) return true;
  if (pathname === "/api/notifications/count") return true;
  return false;
}

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener("install", function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE_URLS).catch(function(err) {
        console.warn("[SW] Precache partiel :", err);
      });
    })
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener("activate", function(event) {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(function(keys) {
        return Promise.all(
          keys.filter(function(k) {
            return k.indexOf("lp-") === 0 && k !== STATIC_CACHE && k !== API_CACHE;
          }).map(function(k) {
            return caches.delete(k);
          })
        );
      })
    ])
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener("fetch", function(event) {
  var request = event.request;
  var url;

  try {
    url = new URL(request.url);
  } catch(e) {
    return;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Mutations → tenter en ligne, sinon mettre en queue
  if (MUTATION_METHODS.indexOf(request.method) !== -1 && url.pathname.indexOf("/api/") === 0) {
    event.respondWith(handleMutation(request));
    return;
  }

  // API GET → Network First
  if (request.method === "GET" && url.pathname.indexOf("/api/") === 0) {
    if (isApiCacheable(url.pathname, url.search)) {
      event.respondWith(networkFirstAPI(request));
      return;
    }
  }

  // Assets statiques → Cache First
  if (request.method === "GET") {
    event.respondWith(cacheFirstStatic(request));
    return;
  }
});

function networkFirstAPI(request) {
  return caches.open(API_CACHE).then(function(cache) {
    return fetch(request.clone()).then(function(response) {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(function() {
      return cache.match(request).then(function(cached) {
        if (cached) return cached;
        return new Response(
          JSON.stringify({ offline: true, data: [], message: "Donnees hors ligne" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });
    });
  });
}

function cacheFirstStatic(request) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request.clone()).then(function(response) {
      if (response.ok) {
        return caches.open(STATIC_CACHE).then(function(cache) {
          cache.put(request, response.clone());
          return response;
        });
      }
      return response;
    }).catch(function() {
      var accept = request.headers.get("accept") || "";
      if (accept.indexOf("text/html") !== -1) {
        return caches.match("/index.html").then(function(shell) {
          return shell || new Response("Hors ligne", { status: 503 });
        });
      }
      return new Response("Hors ligne", { status: 503 });
    });
  });
}

function handleMutation(request) {
  return fetch(request.clone()).catch(function() {
    return queueMutation(request).then(function() {
      return new Response(
        JSON.stringify({
          queued: true,
          offline: true,
          message: "Action sauvegardee. Elle sera synchronisee a la reconnexion."
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      );
    });
  });
}

function queueMutation(request) {
  return request.clone().text().then(function(body) {
    var entry = {
      id:        Date.now() + "-" + Math.random().toString(36).slice(2),
      url:       request.url,
      method:    request.method,
      body:      body || null,
      timestamp: Date.now()
    };

    return openSyncDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx    = db.transaction("syncQueue", "readwrite");
        var store = tx.objectStore("syncQueue");
        var req   = store.add(entry);
        tx.oncomplete = resolve;
        tx.onerror    = reject;
      });
    }).then(function() {
      if (self.registration.sync) {
        return self.registration.sync.register(SYNC_TAG);
      }
    });
  }).catch(function(err) {
    console.error("[SW] Impossible de mettre en queue :", err);
  });
}

function openSyncDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open("lp-sync-db", 1);

    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains("syncQueue")) {
        var store = db.createObjectStore("syncQueue", { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains("offlineData")) {
        db.createObjectStore("offlineData", { keyPath: "key" });
      }
    };

    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror   = function(e) { reject(e.target.error); };
  });
}

// ── BACKGROUND SYNC ───────────────────────────────────────────
self.addEventListener("sync", function(event) {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(processSyncQueue());
  }
});

function processSyncQueue() {
  return openSyncDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx      = db.transaction("syncQueue", "readonly");
      var store   = tx.objectStore("syncQueue");
      var index   = store.index("timestamp");
      var entries = [];
      var cursor  = index.openCursor();

      cursor.onsuccess = function(e) {
        var c = e.target.result;
        if (c) { entries.push(c.value); c.continue(); }
        else resolve(entries);
      };
      cursor.onerror = reject;
    }).then(function(entries) {
      console.log("[SW Sync] " + entries.length + " operation(s) a synchroniser");

      var chain = Promise.resolve();

      entries.forEach(function(entry) {
        chain = chain.then(function() {
          var init = {
            method:  entry.method,
            headers: { "Content-Type": "application/json" }
          };
          if (entry.body) init.body = entry.body;

          return fetch(entry.url, init).then(function(response) {
            if (response.ok || response.status === 409) {
              return deleteFromQueue(db, entry.id);
            } else if (response.status >= 400 && response.status < 500) {
              return deleteFromQueue(db, entry.id);
            }
          }).catch(function(err) {
            console.warn("[SW Sync] Toujours offline :", err.message);
            return Promise.reject("offline");
          });
        });
      });

      return chain.catch(function() {});
    }).then(function() {
      return self.clients.matchAll().then(function(clientList) {
        clientList.forEach(function(client) {
          client.postMessage({ type: "SYNC_COMPLETE" });
        });
      });
    });
  }).catch(function(err) {
    console.error("[SW Sync] Erreur :", err);
  });
}

function deleteFromQueue(db, id) {
  return new Promise(function(resolve, reject) {
    var tx  = db.transaction("syncQueue", "readwrite");
    var req = tx.objectStore("syncQueue").delete(id);
    req.onsuccess = resolve;
    req.onerror   = reject;
  });
}

// ── MESSAGES ──────────────────────────────────────────────────
self.addEventListener("message", function(event) {
  if (!event.data) return;
  if (event.data.type === "FORCE_SYNC") {
    processSyncQueue();
  }
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});