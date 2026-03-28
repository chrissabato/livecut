/* coi-serviceworker v0.1.7 | MIT License | https://github.com/gzuidhof/coi-serviceworker */
/* Enables SharedArrayBuffer on GitHub Pages by injecting COOP/COEP headers via a service worker. */

if (typeof window === "undefined") {
  // ---- Service worker context ----

  self.addEventListener("install", () => self.skipWaiting());

  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener("fetch", (event) => {
    // Don't intercept opaque same-origin cache requests
    if (
      event.request.cache === "only-if-cached" &&
      event.request.mode !== "same-origin"
    ) {
      return;
    }

    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Opaque responses (status 0) can't have headers modified
          if (response.status === 0) {
            return response;
          }

          const newHeaders = new Headers(response.headers);
          newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
          // credentialless (not require-corp) so cross-origin HLS segments load without CORP headers
          newHeaders.set("Cross-Origin-Embedder-Policy", "credentialless");

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => {
          console.error("[coi-sw] fetch failed:", e);
          return new Response(null, { status: 500 });
        })
    );
  });
} else {
  // ---- Page context ----

  if (!window.crossOriginIsolated) {
    if (!("serviceWorker" in navigator)) {
      console.error(
        "[coi-sw] Service workers not supported — cross-origin isolation unavailable. " +
        "FFmpeg.wasm may not work correctly."
      );
    } else {
      const scriptSrc =
        document.currentScript instanceof HTMLScriptElement
          ? document.currentScript.src
          : "./coi-serviceworker.js";

      navigator.serviceWorker
        .register(scriptSrc)
        .then((registration) => {
          console.log(
            "[coi-sw] Registered at scope:",
            registration.scope,
            "— reloading to activate isolation headers."
          );

          const doReload = () => window.location.reload();

          if (registration.active) {
            // SW was already active from a previous session but isolation still
            // isn't set (e.g. cached page served before SW intercepted). Reload.
            doReload();
            return;
          }

          const sw = registration.installing || registration.waiting;
          if (sw) {
            sw.addEventListener("statechange", (e) => {
              if (e.target.state === "activated") {
                doReload();
              }
            });
          }
        })
        .catch((err) => {
          console.error("[coi-sw] Registration failed:", err);
        });
    }
  }
}
