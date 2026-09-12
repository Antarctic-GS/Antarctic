# Antarctic Games

Antarctic is a static game launcher with optional relay, music-search, and
Altcha human-check services.

The sidebar also includes a VM shortcut to Puter’s Firefox-in-WebAssembly lab
and an Emulators launcher powered by EmulatorJS’s stable CDN. The emulator
launcher accepts a locally selected ROM and does not bundle game files.

## Local development

Run the complete local stack from the repository root:

```bash
./scripts/start.sh
```

The launcher installs the relay package dependencies when they are missing,
starts HTTP on `http://127.0.0.1:3000`, HTTPS on `https://127.0.0.1:3443`,
and starts the local Wisp transport. Set `ALTCHA_HMAC_SECRET` before starting
the stack outside local development.

Running `node scripts/antarctic-site-server.mjs` directly also starts the
static/API server, but CAPTCHA endpoints require the relay package dependencies
to be installed first.

## Validation

```bash
node --test scripts/antarctic-security.test.mjs
node --check script.js
node --check scripts/antarctic-site-server.mjs
```

The Terms of Service and [Privacy Policy](privacy.html) are available in the
launcher and as `TERMS.md` and `PRIVACY.md`.
