const relayBase = new URL("./", document.baseURI);
const relayBackend = new URLSearchParams(location.search).get("backend") === "ultraviolet"
  ? "ultraviolet"
  : "scramjet";
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
let pendingTarget = getInitialTarget();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(src, relayBase).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load relay asset: ${src}`));
    document.head.appendChild(script);
  });
}

function assetPath(file) {
  return new URL(`./package/dist/${file}`, relayBase).pathname;
}

function setStatus(message, isError = false) {
  const messageElement = statusElement.querySelector(".relay-status-message");
  if (messageElement) {
    messageElement.textContent = message;
  } else {
    statusElement.textContent = message;
  }
  statusElement.dataset.state = isError ? "error" : "ready";
  statusElement.classList.remove("is-hidden");
  statusElement.setAttribute("aria-busy", String(!isError));
}

function hideLoadingScreen() {
  statusElement.classList.add("is-hidden");
  statusElement.setAttribute("aria-busy", "false");
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

function isValidTarget(target) {
  return typeof target === "string" && /^https?:\/\//i.test(target);
}

function navigateTarget(target) {
  if (!isValidTarget(target)) return;

  let normalizedTarget;
  try {
    normalizedTarget = new URL(target).href;
  } catch {
    return;
  }

  currentTarget = normalizedTarget;
  pendingTarget = currentTarget;
  if (relayBackend === "ultraviolet") {
    frameElement.src = ultravioletProxyUrl(currentTarget);
    pendingTarget = null;
    setStatus(`Loading · ${currentTarget}`);
    return;
  }

  if (!frame) return;

  frame.go(currentTarget);
  pendingTarget = null;
  setStatus(`Loading · ${currentTarget}`);
}

function ultravioletProxyUrl(target) {
  const encodedTarget = window.Ultraviolet.codec.xor.encode(target);
  return new URL(`./ultraviolet/service/${encodedTarget}`, relayBase).href;
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.type !== "antarctic:relay-navigate") return;
  navigateTarget(event.data.url);
});

function publishPageMetadata() {
  if (!frame || !currentTarget) return;

  try {
    const pageDocument = relayBackend === "ultraviolet"
      ? frameElement.contentDocument
      : frame.element.contentDocument;
    const proxiedWindow = frameElement.contentWindow;
    if (!pageDocument) return;

    // Scramjet exposes the client on the proxied document using this shared
    // symbol. The virtual document URL is the reliable source after in-page
    // navigation (for example, clicking a search result).
    const scramjetClient = pageDocument[Symbol.for("scramjet client global")];
    const ultravioletClient = proxiedWindow?.__uv;
    const targetUrl = relayBackend === "ultraviolet"
      ? ultravioletClient?.location?.href || ultravioletClient?.meta?.url?.href || currentTarget
      : scramjetClient?.url?.href || currentTarget;
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

async function initializeUltraviolet() {
  await loadScript("./ultraviolet/dist/uv.bundle.js");

  const { BareMuxConnection } = await import(
    new URL("./ultraviolet/baremux/index.mjs", relayBase).href
  );
  const bareMux = new BareMuxConnection(
    new URL("./ultraviolet/baremux/worker.js", relayBase).href
  );

  const registration = await navigator.serviceWorker.register("./ultraviolet/sw.js", {
    scope: new URL("./ultraviolet/", relayBase).pathname,
    type: "classic",
    updateViaCache: "none",
  });
  await waitForServiceWorkerActivation(registration);
  await bareMux.setTransport(
    new URL("./ultraviolet/epoxy-transport.mjs", relayBase).href,
    [getWispUrl()]
  );

  frameElement.addEventListener("load", () => {
    window.setTimeout(() => {
      publishPageMetadata();
      if (currentTarget) hideLoadingScreen();
    }, 150);
  });
  window.ultravioletRegistration = registration;
  window.ultravioletBareMux = bareMux;
  window.parent.postMessage({ type: "antarctic:relay-ready" }, "*");
  setStatus(`Relay ready · Ultraviolet · ${getWispUrl()}`);

  if (pendingTarget) {
    const initialTarget = pendingTarget;
    pendingTarget = null;
    navigateTarget(initialTarget);
  }
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

function waitForServiceWorkerActivation(registration) {
  const worker = registration.active || registration.waiting || registration.installing;
  if (!worker || worker.state === "activated") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("The Ultraviolet service worker did not activate."));
    }, 10000);

    worker.addEventListener("statechange", () => {
      if (worker.state !== "activated") return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function initializeRelay() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error("Scramjet requires HTTPS or localhost and service-worker support.");
  }

  if (relayBackend === "ultraviolet") {
    await initializeUltraviolet();
    return;
  }

  await loadScript("./package/dist/scramjet_bundled.js");
  await loadScript("./package/dist/controller.api.js");
  await loadScript("./package/dist/epoxy-transport.js");

  const transport = createTransport();
  const transportReady = transport.init();

  const registration = await navigator.serviceWorker.register("./sw.js", {
    scope: "./",
    type: "classic",
    updateViaCache: "imports",
  });
  await navigator.serviceWorker.ready;
  const serviceWorker = await waitForController(registration);
  await transportReady;

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
    window.setTimeout(() => {
      publishPageMetadata();
      if (currentTarget) hideLoadingScreen();
    }, 150);
  });
  window.scramjetController = controller;
  window.parent.postMessage({ type: "antarctic:relay-ready" }, "*");
  setStatus(`Relay ready · Scramjet · ${getWispUrl()}`);

  if (pendingTarget) {
    const initialTarget = pendingTarget;
    pendingTarget = null;
    navigateTarget(initialTarget);
  }
}

initializeRelay().catch((error) => {
  console.error(`${relayBackend} relay failed to initialize:`, error);
  setStatus(error.message, true);
});
