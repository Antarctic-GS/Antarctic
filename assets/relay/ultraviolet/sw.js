importScripts("./dist/uv.bundle.js", "./dist/uv.config.js", "./dist/uv.sw.js", "../antarctic-link-rewriter.js");

const ultraviolet = new UVServiceWorker();

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function cloneResponse(response, body) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function injectAntarcticLinkRewriter(body) {
  if (body.includes("data-antarctic-link-rewriter")) return body;

  const script = `<script data-antarctic-link-rewriter>${self.antarcticLinkRewriterSource("ultraviolet")}<\/script>`;
  return /<\/head>/i.test(body)
    ? body.replace(/<\/head>/i, `${script}</head>`)
    : `${script}${body}`;
}

function getTargetUrl(request) {
  const requestUrl = new URL(request.url);
  const prefix = self.__uv$config.prefix;
  const encodedTarget = requestUrl.href.startsWith(location.origin + prefix)
    ? requestUrl.href.slice((location.origin + prefix).length)
    : "";
  return encodedTarget ? self.__uv$config.decodeUrl(encodedTarget) : requestUrl.href;
}

function proxyTarget(target) {
  return `${location.origin}${self.__uv$config.prefix}${self.__uv$config.encodeUrl(target)}`;
}

function patchHtmlDocument(body, targetUrl) {
  const rewrittenAssets = body.replace(
    /(\b(?:src|href)=(["']))(\/[^"']*)\2/gi,
    (match, attribute, quote, value) => `${attribute}${proxyTarget(new URL(value, targetUrl).href)}${quote}`
  );
  const config = self.__uv$config;
  const inject = [
    `<script __uv-script="1">self.__uv$cookies = ""; self.__uv$referrer = "";<\/script>`,
    `<script src="${config.bundle}" __uv-script="1"><\/script>`,
    `<script src="${config.client}" __uv-script="1"><\/script>`,
    `<script src="${config.config}" __uv-script="1"><\/script>`,
    `<script src="${config.handler}" __uv-script="1"><\/script>`,
  ].join("");
  return injectAntarcticLinkRewriter(rewrittenAssets.replace(/<head([^>]*)>/i, `<head$1>${inject}`));
}

async function fetchUltravioletDocument(event, request) {
  const response = await ultraviolet.fetch({ request });
  if (!response.body || !["document", "iframe"].includes(request.destination)) return response;

  const body = await response.text();
  if (!/<head[\s>]/i.test(body)) {
    return cloneResponse(response, body);
  }

  if (body.includes("__uv-script")) return cloneResponse(response, injectAntarcticLinkRewriter(body));

  return cloneResponse(response, patchHtmlDocument(body, getTargetUrl(request)));
}

self.addEventListener("fetch", (event) => {
  if (!ultraviolet.route(event)) return;

  const request = new Proxy(event.request, {
    get(target, property) {
      if (property === "destination" && !target.destination) return "iframe";
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  event.respondWith(fetchUltravioletDocument(event, request));
});
