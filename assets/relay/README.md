# Antarctic Relay

This folder contains a standalone relay page at `assets/relay/`. It supports
Scramjet and the vendored Ultraviolet 3.2.7 package; Antarctic selects the
backend with the `backend=scramjet` or `backend=ultraviolet` query parameter.

The Scramjet page registers the scoped `sw.js` service worker, loads the
matching controller/runtime bundles, and uses the bundled Epoxy transport
over Wisp. Ultraviolet registers its own narrower service-worker scope under
`assets/relay/ultraviolet/`, connects BareMux 2.0.4 to the same Epoxy/Wisp
transport, and uses the archive at
`titaniumnetwork-dev-ultraviolet-3.2.7.tgz` as its source package.
The default Wisp endpoint is `wss://wisp.mercurywork.shop/`; override it with
a `wisp` query parameter when deploying a private endpoint, for example
`assets/relay/?wisp=wss%3A%2F%2Fproxy.example%2Fwisp%2F`.
Only `ws:` and `wss:` endpoints are accepted. Both relay startup paths have a
15-second transport/controller timeout, and Scramjet's worker URL is
cache-busted so a new relay build does not remain attached to an old worker.

Service workers require HTTPS in production (localhost is allowed for local testing). The controller and transport bundles are vendored beside the existing Scramjet package so the relay does not depend on a build step or CDN at runtime.

For an iframe-ready relay view, pass `embed=1&url=<encoded-http-url>`; Antarctic's search bar uses this mode for external lookups.

The site server also exposes `POST /api/relay/session` with a JSON body such
as `{ "backend": "scramjet", "url": "https://example.com/" }`. It returns a
short-lived `/relay/<random-id>` route. That route serves the relay shell with
the target and backend kept in the server-side session, so external pages and
music embeds do not expose the target URL in an `/assets/relay/` iframe URL.
The session shell bootstraps its target over same-origin
`/api/relay/session/<id>` and the embedded frames use `no-referrer`, so the
remote target is not carried in the visible relay frame URL or as an Antarctic
page referrer.

Antarctic prewarms a hidden embedded Scramjet relay when the site loads. The
visible external-navigation frame uses the short-lived `/relay/<random-id>`
shell, which forwards messages to an in-scope relay document and keeps the
target out of the visible iframe URL while preserving each backend's isolated
service-worker initialization path.
The external-viewer "Open in New Tab" control uses that same shell instead of
opening Scramjet's internal encoded document path directly.
Both backend service workers inject the shared `antarctic-link-rewriter.js`
into proxied HTML documents. External links are rewritten at delivery time to
`antarctic://relay/<random-id>.<encoded-target>` paths, while the original
remote destination remains attached as metadata for the trusted click handler
used by the active relay backend. UV's URL rewriter explicitly allows the
Antarctic protocol through so it cannot turn the token back into a backend
encoded URL.
Rewriting is limited to HTML responses and reads a clone, preserving binary,
JSON, and no-head responses for the browser. A document-level backend failure
now renders a small Antarctic error page with the backend and target instead
of leaving the frame on an unhelpful blank network error.
Known proxy implementation headers are removed from relay responses while
cookies and normal site headers remain available to the proxied page.

YouTube embed targets also expose a small parent-window media bridge for the
custom Antarctic Music player. The parent can send
`antarctic:relay-media-command` messages with `command` values `play`, `pause`,
`toggle`, `seek`, or `volume`; the relay publishes `antarctic:relay-media-state`
updates containing the current time, duration, paused state, volume, mute state,
and ended state. The bridge also forwards YouTube iframe-player API state when
the proxied document does not expose its media element directly. YouTube Music search pages also support the
`antarctic:relay-search` request and return `antarctic:relay-search-results`
messages with normalized video IDs, titles, thumbnails, and source URLs. The
music site can serve a deprecated-browser fallback inside relay frames, so the
music page uses YouTube's standard search route for dependable extraction while
the Antarctic UI remains a custom player.

The local site server also exposes `GET /api/music/search?q=...`. The music page
uses this endpoint for result discovery and keeps the selected video playback
inside the configured relay backend.

Music discovery still follows the relay backend selected in Antarctic
Settings. Playback uses a privacy-enhanced YouTube iframe directly because
YouTube's anti-abuse `GenerateIT` request does not reliably complete through
Wisp/Scramjet/Ultraviolet; the custom dock controls that direct player and no
longer leaves tracks frozen at `0:00` because of a relay-only request failure.

For loopback development only, the bundled Epoxy transport disables certificate
validation for `localhost`/`127.0.0.1` Wisp endpoints. Public Wisp endpoints keep
normal certificate validation.

The bundled Scramjet controller preserves proxied site state across reloads.
Ultraviolet also namespaces proxied storage by remote origin. Do not clear
the relay origin's site data if you want those sessions and preferences to
remain available.

## User-input boundary

The relay only honors navigation messages and media commands from the
Antarctic parent when they are marked as user initiated. Inside proxied pages,
trusted clicks, key presses, pointer presses, form submissions, and touch
starts open a short navigation window. Top-level redirects outside that
window are restored to the last accepted page, so page scripts cannot silently
change the active destination. This is an interaction boundary, not a block on
normal subresource loading required to render a page.
