const relayBase = new URL("./", document.baseURI);
const relaySession = window.__ANTARCTIC_RELAY_SESSION;
const relayBackend = (new URLSearchParams(location.search).get("backend") || relaySession?.backend) === "ultraviolet"
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
let mediaBridgeCleanup = null;
let youtubePlayerState = 2;
const userGestureWindowMs = 3000;
const trustedInputTypes = new Set([
  "click",
  "keydown",
  "mousedown",
  "pointerdown",
  "submit",
  "touchstart",
]);
let lastTrustedInputAt = 0;
let redirectRestorePending = false;
const observedInputDocuments = new WeakSet();
const protectedLinkDocuments = new WeakSet();

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
  const target = new URLSearchParams(location.search).get("url") || relaySession?.target;
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

function getProxiedDocument() {
  try {
    const proxiedWindow = getProxiedWindow();
    return proxiedWindow?.document || (relayBackend === "ultraviolet"
      ? frameElement.contentDocument
      : frame?.element?.contentDocument);
  } catch {
    return null;
  }
}

function getProxiedWindow() {
  return relayBackend === "ultraviolet"
    ? frameElement.contentWindow
    : frame?.element?.contentWindow;
}

function recordTrustedInput(event) {
  if (!event.isTrusted || !trustedInputTypes.has(event.type)) return;
  lastTrustedInputAt = performance.now();
}

function hasRecentTrustedInput() {
  return lastTrustedInputAt > 0
    && performance.now() - lastTrustedInputAt <= userGestureWindowMs;
}

function observeProxiedUserInput(documentRoot) {
  if (!documentRoot || observedInputDocuments.has(documentRoot)) return;
  observedInputDocuments.add(documentRoot);

  for (const eventType of trustedInputTypes) {
    documentRoot.addEventListener(eventType, recordTrustedInput, true);
  }

  for (const nestedFrame of documentRoot.querySelectorAll("iframe, frame")) {
    try {
      observeProxiedUserInput(nestedFrame.contentDocument);
    } catch {
      // Cross-origin nested frames keep their own input boundary.
    }
  }
}

function encodeOpaqueLinkPayload(value) {
  const bytes = unescape(encodeURIComponent(value));
  return btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createOpaqueLinkPath(targetUrl) {
  const randomPart = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const payload = encodeOpaqueLinkPayload(JSON.stringify({
    backend: relayBackend,
    target: targetUrl,
  }));
  // Scramjet passes custom protocols through unchanged, so the browser's
  // link preview shows the Antarctic relay token instead of rewriting it back
  // into /assets/relay/.../<remote-url>.
  return `antarctic://relay/${randomPart}.${payload}`;
}

function protectProxiedLinks(documentRoot, baseTarget) {
  if (!documentRoot || protectedLinkDocuments.has(documentRoot)) return;
  protectedLinkDocuments.add(documentRoot);

  documentRoot.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const anchor = event.target?.closest?.('a');
    const target = anchor?.dataset.antarcticTarget;
    if (!target) return;

    event.preventDefault();
    navigateTarget(target, { userInitiated: true });
  }, true);

  const prepareLink = (anchor) => {
    if (!anchor || anchor.dataset.antarcticTarget) return;
    const originalHref = anchor.getAttribute('scramjet-attr-href') || anchor.getAttribute('href');
    if (!originalHref || /^(?:#|javascript:|mailto:|tel:|data:|antarctic:)/i.test(originalHref)) return;

    let targetUrl;
    try {
      targetUrl = new URL(originalHref, baseTarget).href;
    } catch {
      return;
    }
    if (!/^https?:$/i.test(new URL(targetUrl).protocol)) return;

    anchor.dataset.antarcticTarget = targetUrl;
    anchor.setAttribute('href', createOpaqueLinkPath(targetUrl));
  };

  documentRoot.addEventListener('pointerover', (event) => {
    prepareLink(event.target?.closest?.('a'));
  }, true);
  documentRoot.addEventListener('focusin', (event) => {
    prepareLink(event.target?.closest?.('a'));
  }, true);
  [...documentRoot.querySelectorAll('a[href]')].slice(0, 48).forEach(prepareLink);
}

function getMediaElement() {
  const documentRoot = getProxiedDocument();
  if (!documentRoot) return null;

  const directMedia = documentRoot.querySelector("video, audio");
  if (directMedia) return directMedia;

  for (const nestedFrame of documentRoot.querySelectorAll("iframe, frame")) {
    try {
      const nestedMedia = nestedFrame.contentDocument?.querySelector("video, audio");
      if (nestedMedia) return nestedMedia;
    } catch {
      // Keep looking when a nested media document is unavailable.
    }
  }

  return null;
}

function publishMediaState(media) {
  if (!media || !window.parent) return;

  window.parent.postMessage({
    type: "antarctic:relay-media-state",
    state: {
      currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0,
      duration: Number.isFinite(media.duration) ? media.duration : 0,
      paused: media.paused,
      volume: Number.isFinite(media.volume) ? media.volume : 1,
      muted: media.muted,
      ended: media.ended,
    },
  }, "*");
}

function publishYouTubeState(info = {}) {
  const currentTime = Number(info.currentTime);
  const duration = Number(info.duration);
  const playerState = Number(info.playerState);
  if (Number.isFinite(playerState)) youtubePlayerState = playerState;

  window.parent.postMessage({
    type: "antarctic:relay-media-state",
    state: {
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      duration: Number.isFinite(duration) ? duration : 0,
      paused: youtubePlayerState !== 1,
      volume: Number.isFinite(Number(info.volume)) ? Number(info.volume) / 100 : 1,
      muted: Number(info.volume) === 0,
      ended: youtubePlayerState === 0,
    },
  }, "*");
}

function sendYouTubeCommand(func, args = []) {
  const proxiedWindow = getProxiedWindow();
  if (!proxiedWindow) return;
  proxiedWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
}

function configureYouTubePlayer() {
  if (!/youtube\.com\/embed\//i.test(currentTarget || "")) return;
  sendYouTubeCommand("addEventListener", ["onReady"]);
  sendYouTubeCommand("addEventListener", ["onStateChange"]);
  sendYouTubeCommand("addEventListener", ["onPlaybackQualityChange"]);
  sendYouTubeCommand("addEventListener", ["onPlaybackRateChange"]);
  sendYouTubeCommand("mute");
  sendYouTubeCommand("playVideo");
  sendYouTubeCommand("getDuration");
}

function attachMediaBridge() {
  mediaBridgeCleanup?.();
  mediaBridgeCleanup = null;

  if (!/youtube\.com\/embed\//i.test(currentTarget || "")) return;

  const media = getMediaElement();
  if (!media) {
    window.setTimeout(attachMediaBridge, 500);
    return;
  }

  const events = ["durationchange", "ended", "loadedmetadata", "pause", "play", "timeupdate", "volumechange"];
  const publish = () => publishMediaState(media);
  const stateInterval = window.setInterval(publish, 250);
  events.forEach((eventName) => media.addEventListener(eventName, publish));
  publish();
  window.parent.postMessage({ type: "antarctic:relay-media-ready" }, "*");

  mediaBridgeCleanup = () => {
    window.clearInterval(stateInterval);
    events.forEach((eventName) => media.removeEventListener(eventName, publish));
  };
}

function handleMediaCommand(command, value) {
  const media = getMediaElement();
  if (!media) {
    if (command === "play") {
      sendYouTubeCommand("unMute");
      sendYouTubeCommand("playVideo");
    }
    if (command === "pause") sendYouTubeCommand("pauseVideo");
    if (command === "toggle") sendYouTubeCommand(youtubePlayerState === 1 ? "pauseVideo" : "playVideo");
    if (command === "seek" && Number.isFinite(Number(value))) sendYouTubeCommand("seekTo", [Number(value), true]);
    if (command === "volume" && Number.isFinite(Number(value))) sendYouTubeCommand("setVolume", [Math.round(Math.max(0, Math.min(1, Number(value))) * 100)]);
    window.setTimeout(() => handleMediaCommand(command, value), 750);
    return;
  }

  const play = () => media.play().catch(() => {});
  if (command === "play") play();
  if (command === "pause") media.pause();
  if (command === "toggle") {
    if (media.paused) play();
    else media.pause();
  }
  if (command === "seek" && Number.isFinite(Number(value))) {
    media.currentTime = Math.max(0, Math.min(Number(value), Number.isFinite(media.duration) ? media.duration : Number(value)));
  }
  if (command === "volume" && Number.isFinite(Number(value))) {
    media.volume = Math.max(0, Math.min(1, Number(value)));
    media.muted = media.volume === 0;
  }

  if (command === "play") {
    sendYouTubeCommand("unMute");
    sendYouTubeCommand("playVideo");
  }
  if (command === "pause") sendYouTubeCommand("pauseVideo");
  if (command === "seek" && Number.isFinite(Number(value))) sendYouTubeCommand("seekTo", [Number(value), true]);
  if (command === "volume" && Number.isFinite(Number(value))) sendYouTubeCommand("setVolume", [Math.round(Math.max(0, Math.min(1, Number(value))) * 100)]);
  if (command === "toggle") sendYouTubeCommand(media.paused ? "playVideo" : "pauseVideo");

  publishMediaState(media);
}

function publishSearchResults(attempt = 0) {
  if (!/(?:music\.youtube\.com\/search|youtube\.com\/results\?[^#]*search_query=)/i.test(currentTarget || "")) return;

  const proxiedDocument = getProxiedDocument();
  const results = new Map();
  proxiedDocument?.querySelectorAll('a[href*="/watch"]').forEach((anchor) => {
    try {
      const resultUrl = new URL(anchor.getAttribute("href"), currentTarget);
      const videoId = resultUrl.searchParams.get("v");
      if (!videoId || results.has(videoId)) return;

      const renderer = anchor.closest("ytmusic-responsive-list-item-renderer, ytmusic-video-renderer, ytd-video-renderer");
      const title = renderer?.querySelector("#video-title, .title, yt-formatted-string")?.textContent?.trim()
        || anchor.getAttribute("title")?.trim()
        || anchor.textContent?.trim();
      if (!title) return;

      results.set(videoId, {
        videoId,
        title: title.replace(/\s+/g, " ").slice(0, 120),
        sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        thumbnail: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
      });
    } catch {
      // Skip malformed or non-video result links.
    }
  });

  if (results.size === 0 && attempt < 8) {
    window.setTimeout(() => publishSearchResults(attempt + 1), 750);
    return;
  }

  window.parent.postMessage({
    type: "antarctic:relay-search-results",
    query: new URL(currentTarget).searchParams.get("q")
      || new URL(currentTarget).searchParams.get("search_query")
      || "",
    results: [...results.values()].slice(0, 12),
  }, "*");
}

function navigateTarget(target, { initial = false, userInitiated = false, restoring = false } = {}) {
  if (!isValidTarget(target)) return;
  if (!initial && currentTarget && !userInitiated && !restoring) return;

  let normalizedTarget;
  try {
    normalizedTarget = new URL(target).href;
  } catch {
    return;
  }

  currentTarget = normalizedTarget;
  pendingTarget = currentTarget;
  redirectRestorePending = restoring;
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
  if (event.source === getProxiedWindow()) {
    let playerMessage = event.data;
    if (typeof playerMessage === "string") {
      try {
        playerMessage = JSON.parse(playerMessage);
      } catch {
        playerMessage = null;
      }
    }
    if (playerMessage?.event === "onReady") {
      configureYouTubePlayer();
      window.parent.postMessage({ type: "antarctic:relay-media-ready" }, "*");
    }
    if (playerMessage?.event === "infoDelivery") {
      publishYouTubeState(playerMessage.info || {});
    }
    if (playerMessage?.event === "onStateChange" && Number.isFinite(Number(playerMessage.info))) {
      youtubePlayerState = Number(playerMessage.info);
      publishYouTubeState({ playerState: youtubePlayerState });
    }
    return;
  }
  if (event.source !== window.parent || event.origin !== location.origin) return;
  if (event.data?.type === "antarctic:relay-navigate") {
    const initial = event.data.initial === true;
    const userInitiated = event.data.userInitiated === true;
    if (!initial && !userInitiated) return;
    navigateTarget(event.data.url, { initial, userInitiated });
  }
  if (event.data?.type === "antarctic:relay-media-command") {
    if (event.data.userInitiated !== true) return;
    handleMediaCommand(event.data.command, event.data.value);
  }
  if (event.data?.type === "antarctic:relay-search") {
    publishSearchResults();
  }
});

function publishPageMetadata() {
  if (!currentTarget) return;

  try {
    const pageDocument = relayBackend === "ultraviolet"
      ? frameElement.contentDocument
      : frame.element.contentDocument;
    const proxiedWindow = frameElement.contentWindow;
    if (!pageDocument) return;
    observeProxiedUserInput(pageDocument);

    // Scramjet exposes the client on the proxied document using this shared
    // symbol. The virtual document URL is the reliable source after in-page
    // navigation (for example, clicking a search result).
    const scramjetClient = pageDocument[Symbol.for("scramjet client global")];
    const ultravioletClient = proxiedWindow?.__uv;
    const targetUrl = relayBackend === "ultraviolet"
      ? ultravioletClient?.location?.href || ultravioletClient?.meta?.url?.href || currentTarget
      : scramjetClient?.url?.href || currentTarget;
    if (!/^https?:\/\//i.test(targetUrl)) return;

    const targetChanged = targetUrl !== currentTarget;
    const userInitiated = hasRecentTrustedInput();
    if (targetChanged && !userInitiated && !redirectRestorePending) {
      redirectRestorePending = true;
      setStatus("Automatic redirect blocked · click or press a key to continue");
      navigateTarget(currentTarget, { restoring: true });
      return;
    }

    currentTarget = targetUrl;
    redirectRestorePending = false;
    protectProxiedLinks(pageDocument, targetUrl);

    const iconLink = pageDocument.querySelector('link[rel~="icon"], link[rel="shortcut icon"]');
    const iconHref = iconLink?.getAttribute("href");
    const resolvedIcon = iconHref ? new URL(iconHref, targetUrl).href : "";
    const favicon = /^(?:https?:\/\/|data:image\/)/i.test(resolvedIcon)
      ? resolvedIcon
      : new URL("/favicon.ico", targetUrl).href;

    window.parent.postMessage({
      type: "antarctic:page-metadata",
      url: targetUrl,
      userInitiated,
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

  const staleRegistrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(staleRegistrations
    .filter((candidate) => candidate.scope.includes("/assets/relay/")
      && !candidate.active?.scriptURL.includes("antarctic-uv-fix=2"))
    .map((candidate) => candidate.unregister()));

  const registration = await navigator.serviceWorker.register("./ultraviolet/sw.js?antarctic-uv-fix=2", {
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
      attachMediaBridge();
      configureYouTubePlayer();
      publishSearchResults();
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

  // A /relay/<id> shell must be controlled before its first proxied frame
  // navigation; otherwise the browser performs that navigation normally and
  // the relay path falls through to the static 404 handler.
  if (!relaySession && registration.active?.state === "activated") {
    return registration.active;
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
  await loadScript("./package/dist/epoxy-transport.js?antarctic-local-cert-fix=1");

  const transport = createTransport();
  const transportReady = transport.init();

  const registration = await navigator.serviceWorker.register("./sw.js", {
    scope: relaySession ? "/" : new URL("./", relayBase).pathname,
    type: "classic",
    updateViaCache: "imports",
  });
  await waitForServiceWorkerActivation(registration);
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
      attachMediaBridge();
      configureYouTubePlayer();
      publishSearchResults();
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
