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

Service workers require HTTPS in production (localhost is allowed for local testing). The controller and transport bundles are vendored beside the existing Scramjet package so the relay does not depend on a build step or CDN at runtime.

For an iframe-ready relay view, pass `embed=1&url=<encoded-http-url>`; Antarctic's search bar uses this mode for external lookups.

Antarctic prewarms a hidden embedded Scramjet relay when the site loads. The
visible external-navigation frame receives its target in the relay URL, so
each backend has an isolated service-worker initialization path.

The bundled Scramjet controller preserves proxied site state across reloads.
Ultraviolet also namespaces proxied storage by remote origin. Do not clear
the relay origin's site data if you want those sessions and preferences to
remain available.
