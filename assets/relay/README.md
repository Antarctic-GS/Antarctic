# Antarctic Relay

This folder contains a standalone Scramjet relay page at `assets/relay/`.

The page registers the scoped `sw.js` service worker, loads the matching Scramjet controller/runtime bundles, and uses the bundled Epoxy transport over Wisp. The default Wisp endpoint is `wss://wisp.mercurywork.shop/`; override it with a `wisp` query parameter when deploying a private endpoint, for example `assets/relay/?wisp=wss%3A%2F%2Fproxy.example%2Fwisp%2F`.

Service workers require HTTPS in production (localhost is allowed for local testing). The controller and transport bundles are vendored beside the existing Scramjet package so the relay does not depend on a build step or CDN at runtime.

For an iframe-ready relay view, pass `embed=1&url=<encoded-http-url>`; Antarctic's search bar uses this mode for external lookups.
