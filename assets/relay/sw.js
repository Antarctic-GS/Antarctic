importScripts("./package/dist/controller.sw.js", "./antarctic-link-rewriter.js");

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.antarcticInjectLinkRewriter = async (response) => {
  if (!response?.body) return response;

  const body = await response.text();
  if (!/<head[\s>]/i.test(body) || body.includes("data-antarctic-link-rewriter")) {
    return response;
  }

  const script = `<script data-antarctic-link-rewriter>${self.antarcticLinkRewriterSource("scramjet")}<\/script>`;
  const rewrittenBody = /<\/head>/i.test(body)
    ? body.replace(/<\/head>/i, `${script}</head>`)
    : `${script}${body}`;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(rewrittenBody, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

self.addEventListener("fetch", (event) => {
  if (self.$scramjetController.shouldRoute(event)) {
    event.respondWith((async () => {
      const response = await self.$scramjetController.route(event);
      const destination = event.request.destination || "iframe";
      if (!["document", "iframe"].includes(destination)) return response;
      return self.antarcticInjectLinkRewriter(response);
    })());
  }
});
