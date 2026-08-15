const relayBase = new URL("./", document.baseURI);
const hostname = location.hostname;
const isLoopbackHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
const isPrivateIpv4 = /^(?:10|192\.168)\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);
const isLocalNetworkHost = isLoopbackHost || isPrivateIpv4 || hostname.endsWith(".local");
const isSecurePage = location.protocol === "https:";
const defaultWispUrl = isLocalNetworkHost
  ? `${isSecurePage ? "wss" : "ws"}://${isLoopbackHost ? "127.0.0.1" : hostname}:${isSecurePage ? "5002" : "5001"}/`
  : "wss://wisp.mercurywork.shop/";

const frameElement = document.querySelector("#relay-frame");
const statusElement = document.querySelector("#relay-status");

if (new URLSearchParams(location.search).get("embed") === "1") {
  document.body.classList.add("embed");
}

let frame;
let currentTarget = null;

function assetPath(file) {
  return new URL(`./package/dist/${file}`, relayBase).pathname;
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.dataset.state = isError ? "error" : "ready";
}

function getWispUrl() {
  const configured = new URLSearchParams(location.search).get("wisp");
  return configured || defaultWispUrl;
}

function getInitialTarget() {
  const target = new URLSearchParams(location.search).get("url");
  if (!target) return null;

  try {
    const url = new URL(target);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function publishPageMetadata() {
  if (!frame || !currentTarget) return;

  try {
    const pageDocument = frame.element.contentDocument;
    if (!pageDocument) return;

    // Scramjet exposes the client on the proxied document using this shared
    // symbol. The virtual document URL is the reliable source after in-page
    // navigation (for example, clicking a search result).
    const scramjetClient = pageDocument[Symbol.for("scramjet client global")];
    const targetUrl = scramjetClient?.url?.href || currentTarget;
    if (!/^https?:\/\//i.test(targetUrl)) return;

    currentTarget = targetUrl;

    const iconLink = pageDocument.querySelector('link[rel~="icon"], link[rel="shortcut icon"]');
    const iconHref = iconLink?.getAttribute("href");
    const resolvedIcon = iconHref ? new URL(iconHref, targetUrl).href : "";
    const favicon = /^(?:https?:\/\/|data:image\/)/i.test(resolvedIcon)
      ? resolvedIcon
      : new URL("/favicon.ico", targetUrl).href;

    window.parent.postMessage({
      type: "antarctic:page-metadata",
      url: targetUrl,
      title: pageDocument.title?.trim() || "",
      favicon,
    }, "*");
  } catch (error) {
    // Some proxied pages can still be unavailable while their document loads.
  }
}

function createTransport() {
  const client = new window.EpoxyTransport.default({ wisp: getWispUrl() });

  return {
    get ready() {
      return client.ready;
    },
    async init() {
      await client.init();
    },
    connect(...args) {
      return client.connect(...args);
    },
    async request(...args) {
      const response = await client.request(...args);
      const headers = Array.isArray(response.headers)
        ? response.headers
        : Object.entries(response.headers).flatMap(([name, values]) =>
            (Array.isArray(values) ? values : [values]).map((value) => [name, String(value)])
          );

      return { ...response, headers };
    },
  };
}

async function waitForController(registration) {
  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("The relay service worker did not take control of this page."));
    }, 10000);

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      clearTimeout(timeout);
      resolve(navigator.serviceWorker.controller || registration.active);
    }, { once: true });
  });
}

async function initializeRelay() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error("Scramjet requires HTTPS or localhost and service-worker support.");
  }

  const registration = await navigator.serviceWorker.register("./sw.js", {
    scope: "./",
    type: "classic",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  const serviceWorker = await waitForController(registration);

  const transport = createTransport();
  await transport.init();

  const { Controller } = window.$scramjetController;
  const controller = new Controller({
    serviceworker: serviceWorker,
    transport,
    config: {
      prefix: new URL("./scramjet/", relayBase).pathname,
      scramjetPath: assetPath("scramjet_bundled.js"),
      injectPath: assetPath("controller.inject.js"),
      wasmPath: assetPath("scramjet.wasm"),
    },
  });

  await controller.wait();
  frame = controller.createFrame(frameElement);
  frame.element.addEventListener("load", () => {
    window.setTimeout(publishPageMetadata, 50);
  });
  window.scramjetController = controller;
  setStatus(`Relay ready · ${getWispUrl()}`);

  const initialTarget = getInitialTarget();
  if (initialTarget) {
    currentTarget = initialTarget;
    frame.go(initialTarget);
    setStatus(`Loading · ${initialTarget}`);
  }
}

initializeRelay().catch((error) => {
  console.error("Scramjet relay failed to initialize:", error);
  setStatus(error.message, true);
});
