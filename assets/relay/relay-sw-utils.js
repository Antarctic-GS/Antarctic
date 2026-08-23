self.antarcticRelayIsHtmlResponse = (response) => {
  const contentType = response?.headers?.get("content-type") || "";
  return /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
};

self.antarcticRelayIsDocumentRequest = (request) => request?.mode === "navigate"
  || ["document", "iframe"].includes(request?.destination);

self.antarcticRelayHeaders = (response) => {
  const headers = new Headers(response?.headers);
  const privatePrefixes = ["x-scramjet-", "x-ultraviolet-", "x-uv-", "x-bare-", "x-wisp-"];
  const privateNames = new Set(["content-location", "server", "via", "x-powered-by"]);
  for (const [name] of [...headers]) {
    const lowerName = name.toLowerCase();
    if (privateNames.has(lowerName) || privatePrefixes.some(prefix => lowerName.startsWith(prefix))) {
      headers.delete(name);
    }
  }
  return headers;
};

self.antarcticRelaySanitizeResponse = (response) => {
  if (!response || response.status === 0) return response;
  return new Response(response.body, {
    headers: self.antarcticRelayHeaders(response),
    status: response.status,
    statusText: response.statusText,
  });
};

self.antarcticRelayErrorResponse = (backend, request, error) => {
  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const target = escapeHtml(request?.url || "Unknown target");
  const detail = escapeHtml(error?.message || "The relay backend could not load this page.");
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Antarctic relay error</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #081426; color: #edf6ff; }
      main { width: min(560px, calc(100% - 40px)); padding: 32px; border: 1px solid #234d6b; border-radius: 22px; background: linear-gradient(145deg, #122a42, #0b172b); box-shadow: 0 24px 80px #0006; }
      p { color: #a8bfd4; line-height: 1.55; }
      code { display: block; overflow-wrap: anywhere; margin-top: 18px; padding: 12px; border-radius: 10px; background: #06101f; color: #7ed7ff; font-size: .85rem; }
      strong { color: #7ed7ff; }
    </style>
  </head>
  <body><main>
    <strong>ANTARCTIC RELAY · ${escapeHtml(backend)}</strong>
    <h1>This page could not be loaded</h1>
    <p>${detail}</p>
    <p>Try refreshing, switching relay backends in Settings, or opening the page again.</p>
    <code>${target}</code>
  </main></body>
</html>`;
  return new Response(body, {
    status: 502,
    statusText: "Relay Bad Gateway",
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    },
  });
};
