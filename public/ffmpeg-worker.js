/**
 * Same-origin wrapper for @ffmpeg/ffmpeg's worker.
 *
 * Cross-origin isolated pages (crossOriginIsolated = true) cannot create Workers
 * from cross-origin URLs. By serving this file from our own origin and importing
 * the CDN worker as a module, we satisfy the same-origin constraint while letting
 * the CDN module's relative imports (./const.js, ./errors.js) resolve correctly
 * against the CDN base URL.
 *
 * COEP 'credentialless' allows cross-origin no-credentials imports, and
 * cdn.jsdelivr.net serves Access-Control-Allow-Origin: *.
 */
import 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js'
