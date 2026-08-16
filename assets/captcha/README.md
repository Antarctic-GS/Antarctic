# Antarctic CAPTCHA assets

This folder vendors Altcha `3.2.1` locally under `vendor/altcha`.

The browser widget is available at:

```text
/assets/captcha/vendor/altcha/dist/main/altcha.min.js
```

Altcha is a web component. Load the local module and provide a server challenge endpoint:

```html
<script type="module" src="assets/captcha/vendor/altcha/dist/main/altcha.min.js"></script>
<altcha-widget challenge="https://your-domain.example/api/captcha/challenge"></altcha-widget>
```

The challenge endpoint must create and sign Altcha challenges. The frontend package alone is not a complete CAPTCHA service; token validation belongs on the server.

The local Antarctic launcher provides that endpoint at:

```text
http://127.0.0.1:3000/api/captcha/challenge
https://127.0.0.1:3443/api/captcha/challenge
```

It also verifies completed solutions at `/api/captcha/verify`. The widget is configured to call both routes on the current origin.

Set `ALTCHA_HMAC_SECRET` in production. The launcher uses a development-only fallback secret so the local CAPTCHA can run without extra setup.

Source: https://github.com/altcha-org/altcha
