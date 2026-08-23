importScripts("./package/dist/controller.sw.js", "./antarctic-link-rewriter.js", "./relay-sw-utils.js");

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.antarcticInjectLinkRewriter = async (response) => {
  if (!response?.body || !self.antarcticRelayIsHtmlResponse(response)) return response;

  const body = await response.clone().text();
  if (!/<head[\s>]/i.test(body) || body.includes("data-antarctic-link-rewriter")) {
    return response;
  }

  const script = `<script data-antarctic-link-rewriter>${self.antarcticLinkRewriterSource("scramjet")}<\/script>`;
  const rewrittenBody = /<\/head>/i.test(body)
    ? body.replace(/<\/head>/i, `${script}</head>`)
    : `${script}${body}`;
  const headers = self.antarcticRelayHeaders(response);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(rewrittenBody, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

self.addEventListener("fetch", (event) => {
  let shouldRoute;
  try {
    shouldRoute = self.$scramjetController.shouldRoute(event);
  } catch (error) {
    if (self.antarcticRelayIsDocumentRequest(event.request)) {
      event.respondWith(Promise.resolve(self.antarcticRelayErrorResponse("Scramjet", event.request, error)));
    }
    return;
  }
  if (!shouldRoute) return;

  event.respondWith((async () => {
    try {
      const response = await self.$scramjetController.route(event);
      if (!self.antarcticRelayIsDocumentRequest(event.request)) {
        return self.antarcticRelaySanitizeResponse(response);
      }
      return self.antarcticInjectLinkRewriter(response);
    } catch (error) {
      if (!self.antarcticRelayIsDocumentRequest(event.request)) throw error;
      return self.antarcticRelayErrorResponse("Scramjet", event.request, error);
    }
  })());
});
