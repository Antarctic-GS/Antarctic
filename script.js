// =========================================================================
// 1. STATE INITIALIZATION & CONSTANTS
// =========================================================================
const DEFAULT_PROTOCOL = 'antarctic://';
const HOME_PAGE = 'antarctic://newtab';
const LAUNCHER_PAGE = 'antarctic://launcher';
const TAB_STORAGE_KEY = 'antarctic.tab-state.v1';
const SETTINGS_STORAGE_KEY = 'antarctic.settings.v1';
const ACCESS_GATE_STORAGE_KEY = 'antarctic.access-accepted.v1';
const SIDEBAR_STORAGE_KEY = 'antarctic.sidebar-state.v1';

function createNavigationEntry(values) {
  return {
    url: values.url,
    actualPath: typeof values.actualPath === 'string' ? values.actualPath : null,
    title: typeof values.title === 'string' && values.title ? values.title : 'New Tab',
    favicon: typeof values.favicon === 'string' && values.favicon ? values.favicon : 'N'
  };
}

function normalizeTabHistory(tab) {
  const fallbackEntry = createNavigationEntry(tab);
  const history = Array.isArray(tab.history)
    ? tab.history
      .filter(entry => entry && typeof entry.url === 'string' && entry.url)
      .map(createNavigationEntry)
    : [fallbackEntry];

  if (history.length === 0) history.push(fallbackEntry);

  const savedIndex = Number.isInteger(tab.historyIndex) ? tab.historyIndex : history.length - 1;
  const historyIndex = Math.max(0, Math.min(savedIndex, history.length - 1));

  return {
    ...tab,
    ...history[historyIndex],
    history,
    historyIndex
  };
}

function createDefaultTabState() {
  const initialTab = normalizeTabHistory({ id: 'tab-1', title: 'New Tab', favicon: 'N', url: HOME_PAGE });
  return {
    tabs: [initialTab],
    activeTabId: 'tab-1'
  };
}

function loadPersistedTabState() {
  try {
    const savedState = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY));
    if (!savedState || !Array.isArray(savedState.tabs)) return createDefaultTabState();

    const seenIds = new Set();
    const tabs = savedState.tabs
      .filter(tab => {
        if (!tab || typeof tab.id !== 'string' || !tab.id || seenIds.has(tab.id)) return false;
        if (typeof tab.url !== 'string' || !tab.url) return false;
        seenIds.add(tab.id);
        return true;
      })
      .map(tab => ({
        id: tab.id,
        title: typeof tab.title === 'string' && tab.title ? tab.title : 'New Tab',
        favicon: typeof tab.favicon === 'string' && tab.favicon ? tab.favicon : 'N',
        url: tab.url,
        actualPath: typeof tab.actualPath === 'string' ? tab.actualPath : null,
        history: tab.history,
        historyIndex: tab.historyIndex
      }))
      .map(normalizeTabHistory);

    if (tabs.length === 0) return createDefaultTabState();

    return {
      tabs,
      activeTabId: tabs.some(tab => tab.id === savedState.activeTabId)
        ? savedState.activeTabId
        : tabs[0].id
    };
  } catch (error) {
    return createDefaultTabState();
  }
}

function persistTabState() {
  if (!appSettings.restoreTabs) {
    localStorage.removeItem(TAB_STORAGE_KEY);
    return;
  }

  try {
    localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabState));
  } catch (error) {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function loadAppSettings() {
  try {
    const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
    return {
      reduceMotion: savedSettings?.reduceMotion === true,
      relayBackend: savedSettings?.relayBackend === 'ultraviolet' ? 'ultraviolet' : 'scramjet',
      restoreSidebarState: savedSettings?.restoreSidebarState !== false,
      restoreTabs: savedSettings?.restoreTabs !== false
    };
  } catch (error) {
    return {
      reduceMotion: false,
      relayBackend: 'scramjet',
      restoreSidebarState: true,
      restoreTabs: true
    };
  }
}

function loadPersistedSidebarState() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'open';
  } catch (error) {
    return false;
  }
}

function persistSidebarState(isOpen) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, isOpen ? 'open' : 'closed');
  } catch (error) {
    // Sidebar state can be unavailable in private or restricted browser contexts.
  }
}

function persistAppSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
  } catch (error) {
    // Settings can be unavailable in private or restricted browser contexts.
  }
}

function applyAppSettings() {
  document.documentElement.classList.toggle('antarctic-reduced-motion', appSettings.reduceMotion);
}

function initializeAccessGate() {
  const gate = document.getElementById('access-gate');
  const agreement = document.getElementById('access-gate-agreement');
  const continueButton = document.getElementById('access-gate-continue');
  const termsLink = document.getElementById('access-terms-link');
  const termsModal = document.getElementById('tos-modal');
  const termsModalContent = document.getElementById('tos-modal-content');
  const termsModalExit = document.getElementById('tos-modal-exit');
  const captchaWidget = document.getElementById('access-captcha');
  if (!gate || !agreement || !continueButton) return;

  const captchaChallenge = window.ANTARCTIC_CAPTCHA_CONFIG?.challenge;
  const captchaVerify = window.ANTARCTIC_CAPTCHA_CONFIG?.verify;
  if (captchaWidget && captchaChallenge) {
    captchaWidget.setAttribute('challenge', captchaChallenge);
  }
  if (captchaWidget && captchaVerify) {
    captchaWidget.setAttribute('verifyurl', captchaVerify);
  }

  const captchaIsVerified = () => {
    if (!captchaWidget || !captchaChallenge) return true;
    return captchaWidget.getState?.() === 'verified';
  };

  const updateContinueState = () => {
    continueButton.disabled = !(agreement.checked && captchaIsVerified());
  };

  captchaWidget?.addEventListener('statechange', () => {
    updateContinueState();
  });

  const closeTermsModal = () => {
    if (!termsModal) return;
    termsModal.hidden = true;
    termsModalContent.replaceChildren();
    termsLink?.focus();
  };

  termsModalExit?.addEventListener('click', closeTermsModal);
  termsLink?.addEventListener('click', event => {
    event.preventDefault();
    if (!termsModal || !termsModalContent) return;
    termsModal.hidden = false;
    termsModalContent.textContent = 'Loading Terms of Service…';
    termsModalExit?.focus();
    fetch('terms.html')
      .then(response => {
        if (!response.ok) throw new Error(`Terms document unavailable (${response.status})`);
        return response.text();
      })
      .then(htmlContent => {
        termsModalContent.innerHTML = htmlContent;
        formatTermsDocument(termsModalContent);
      })
      .catch(error => {
        termsModalContent.textContent = `Unable to load the Terms of Service: ${error.message}`;
      });
  });

  let accepted = false;
  try {
    accepted = localStorage.getItem(ACCESS_GATE_STORAGE_KEY) === 'accepted';
  } catch (error) {
    // Restricted storage keeps the checkpoint visible for the current session.
  }

  if (accepted) {
    gate.hidden = true;
    return;
  }

  agreement.addEventListener('change', () => {
    updateContinueState();
  });

  continueButton.addEventListener('click', () => {
    if (!agreement.checked || !captchaIsVerified()) return;
    try {
      localStorage.setItem(ACCESS_GATE_STORAGE_KEY, 'accepted');
    } catch (error) {
      // The gate can still be dismissed for this session when storage is blocked.
    }
    continueButton.disabled = true;
    gate.setAttribute('aria-hidden', 'true');
    gate.classList.add('is-exiting');
    window.setTimeout(() => {
      gate.hidden = true;
      gate.classList.remove('is-exiting');
      gate.removeAttribute('aria-hidden');
      document.querySelector('.url-input')?.focus();
    }, 460);
  });

  updateContinueState();
}

function formatTermsDocument(root) {
  const source = root.querySelector('.terms-markdown');
  if (!source || source.dataset.formatted === 'true') return;

  const lines = source.textContent.split(/\r?\n/);
  const fragment = document.createDocumentFragment();
  let list = null;
  let subsection = null;

  const closeList = () => {
    if (!list) return;
    fragment.appendChild(list);
    list = null;
  };

  const appendParagraph = (text, className = '') => {
    const paragraph = document.createElement('p');
    if (className) paragraph.className = className;
    if (subsection) {
      const label = document.createElement('strong');
      label.textContent = `${subsection} `;
      paragraph.append(label);
      subsection = null;
    }
    paragraph.append(document.createTextNode(text));
    fragment.appendChild(paragraph);
  };

  lines.forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      return;
    }

    const section = line.match(/^(\d+)\.\s+(.+)$/);
    if (section) {
      closeList();
      subsection = null;
      const heading = document.createElement('h2');
      heading.textContent = `${section[1]}. ${section[2]}`;
      fragment.appendChild(heading);
      return;
    }

    const numberedParagraph = line.match(/^(\d+\.\d+)$/);
    if (numberedParagraph) {
      closeList();
      subsection = numberedParagraph[1];
      return;
    }

    if (line.startsWith('* ')) {
      if (!list) list = document.createElement('ul');
      const item = document.createElement('li');
      item.textContent = line.slice(2);
      list.appendChild(item);
      return;
    }

    closeList();
    const className = /^IMPORTANT:|^BY USING|^IF YOU DO NOT|^TO THE MAXIMUM|^ANTARCTIC DISCLAIMS|^WE DO NOT|^NOTHING IN|^BY USING ANTARCTIC/.test(line)
      ? 'terms-notice'
      : /^Email: \[YOUR EMAIL\]$/.test(line)
        ? 'terms-caution'
        : /^\([a-z]\)\s/.test(line) ? 'terms-lettered' : '';
    appendParagraph(line, className);
  });

  closeList();
  source.replaceChildren(fragment);
  source.dataset.formatted = 'true';
}

// Central browser application session storage matrix
let appSettings = loadAppSettings();
let tabState = appSettings.restoreTabs ? loadPersistedTabState() : createDefaultTabState();
applyAppSettings();
let relayWarmupFrame = null;
let relayWarmupReady = false;
let pendingRelayTarget = null;

// =========================================================================
// 2. DOM ELEMENT SELECTORS
// =========================================================================
const menuBtn = document.getElementById('menubtn');
const menuIcon = document.getElementById('MenuButtonIcon');
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('main');
const btnNewTab = document.querySelector('.btn-new-tab');
const sidebarTop = document.querySelector('.sidebar-top');
const backButton = document.querySelector('.backbtn');
const forwardButton = document.querySelector('.forwardbtn');
const reloadButton = document.querySelector('.reloadbtn');

function applySidebarState(isOpen, shouldPersist = true) {
  if (!menuBtn || !sidebar || !mainContent) return;

  menuBtn.setAttribute('data-state', isOpen ? 'open' : 'closed');
  menuBtn.setAttribute('aria-expanded', String(isOpen));
  menuBtn.setAttribute('aria-label', isOpen ? 'Close sidebar' : 'Open sidebar');
  sidebar.style.width = isOpen ? '260px' : '0';
  mainContent.style.marginLeft = isOpen ? '260px' : '0';

  if (shouldPersist) persistSidebarState(isOpen);
}

applySidebarState(appSettings.restoreSidebarState && loadPersistedSidebarState(), false);

// Vector path symbols for interface transitions
const hamburgerSVG = `
  <line x1="3" y1="12" x2="21" y2="12"></line>
  <line x1="3" y1="6" x2="21" y2="6"></line>
  <line x1="3" y1="18" x2="21" y2="18"></line>
`;

const closeSVG = `
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
`;

function ensureTabHistory(tab) {
  if (!Array.isArray(tab.history) || tab.history.length === 0) {
    tab.history = [createNavigationEntry(tab)];
    tab.historyIndex = 0;
    return;
  }

  if (!Number.isInteger(tab.historyIndex)) {
    tab.historyIndex = tab.history.length - 1;
  }
}

function navigateTabTo(tab, values) {
  ensureTabHistory(tab);

  const nextEntry = createNavigationEntry({ ...tab, ...values });
  const currentEntry = tab.history[tab.historyIndex];
  const isSameDestination = currentEntry
    && currentEntry.url === nextEntry.url
    && currentEntry.actualPath === nextEntry.actualPath;

  if (isSameDestination) {
    tab.history[tab.historyIndex] = nextEntry;
  } else {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(nextEntry);
    tab.historyIndex = tab.history.length - 1;
  }

  Object.assign(tab, nextEntry);
}

function navigateHistory(offset) {
  const activeTab = tabState.tabs.find(tab => tab.id === tabState.activeTabId);
  if (!activeTab) return;

  ensureTabHistory(activeTab);
  const nextIndex = activeTab.historyIndex + offset;
  if (nextIndex < 0 || nextIndex >= activeTab.history.length) return;

  activeTab.historyIndex = nextIndex;
  Object.assign(activeTab, activeTab.history[nextIndex]);
  renderTabs();
}

function updateNavigationControls() {
  const activeTab = tabState.tabs.find(tab => tab.id === tabState.activeTabId);
  if (!activeTab) return;

  ensureTabHistory(activeTab);
  if (backButton) backButton.disabled = activeTab.historyIndex <= 0;
  if (forwardButton) forwardButton.disabled = activeTab.historyIndex >= activeTab.history.length - 1;
}

function setTabFavicon(faviconElement, favicon, fallbackText) {
  if (!faviconElement) return;

  faviconElement.replaceChildren();
  if (/^(?:https?:\/\/|data:image\/)/i.test(String(favicon || ''))) {
    const image = document.createElement('img');
    image.src = favicon;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.addEventListener('error', () => {
      faviconElement.textContent = fallbackText || 'N';
    }, { once: true });
    faviconElement.appendChild(image);
    return;
  }

  faviconElement.textContent = favicon || fallbackText || 'N';
}

function normalizeRemoteUrl(value) {
  try {
    return new URL(value).href;
  } catch (error) {
    return String(value || '');
  }
}

function updateTabMetadata(tab, metadata) {
  const title = typeof metadata.title === 'string' && metadata.title.trim()
    ? metadata.title.trim().slice(0, 80)
    : tab.title;
  const favicon = typeof metadata.favicon === 'string' && metadata.favicon.trim()
    ? metadata.favicon.trim()
    : tab.favicon;

  tab.title = title;
  tab.favicon = favicon;
  ensureTabHistory(tab);
  Object.assign(tab.history[tab.historyIndex], { title, favicon });

  const tabItem = sidebarTop.querySelector(`[data-id="${CSS.escape(tab.id)}"]`);
  if (tabItem) {
    tabItem.querySelector('.tab-title').textContent = title;
    setTabFavicon(tabItem.querySelector('.tab-favicon'), favicon, title.charAt(0).toUpperCase());
  }
  persistTabState();
}

function setRelayFrameMode(frame, isWarmup) {
  frame.id = isWarmup ? 'relay-warmup-frame' : 'game-sandbox-frame';
  frame.title = isWarmup ? 'Antarctic relay warmup' : 'Antarctic proxy result';
  frame.setAttribute('aria-hidden', String(isWarmup));
  frame.style.cssText = isWarmup
    ? 'position: fixed; width: 1px; height: 1px; right: 0; bottom: 0; border: 0; opacity: 0; pointer-events: none;'
    : 'width: 100%; height: 100%; border: none; background: transparent; margin: 0; padding: 0; display: block;';
}

function createRelayWarmupFrame() {
  if (appSettings.relayBackend === 'ultraviolet') return null;
  if (relayWarmupFrame) return relayWarmupFrame;

  relayWarmupFrame = document.createElement('iframe');
  relayWarmupFrame.src = buildRelayUrl({ prewarm: true });
  setRelayFrameMode(relayWarmupFrame, true);
  document.body.appendChild(relayWarmupFrame);
  return relayWarmupFrame;
}

function buildRelayUrl(options = {}) {
  const params = new URLSearchParams({
    embed: '1',
    backend: options.backend || appSettings.relayBackend
  });
  if (options.prewarm) params.set('prewarm', '1');
  if (options.url) params.set('url', options.url);
  return `assets/relay/?${params.toString()}`;
}

async function createRelaySessionUrl({ backend = appSettings.relayBackend, url }) {
  const response = await fetch('/api/relay/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend, url })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.path !== 'string') {
    throw new Error(payload.error || `Relay session failed (${response.status}).`);
  }
  return new URL(payload.path, document.baseURI).href;
}

function parkRelayWarmupFrame() {
  if (!relayWarmupFrame || relayWarmupFrame.parentNode === document.body) return;
  setRelayFrameMode(relayWarmupFrame, true);
  document.body.appendChild(relayWarmupFrame);
}

function sendRelayTarget(target) {
  pendingRelayTarget = target;
  if (!relayWarmupReady || !relayWarmupFrame?.contentWindow) return;

  relayWarmupFrame.contentWindow.postMessage({
    type: 'antarctic:relay-navigate',
    url: pendingRelayTarget,
    initial: true,
    userInitiated: false
  }, '*');
  pendingRelayTarget = null;
}

function mountRelayFrame(wrapper, relayUrl) {
  const frame = document.createElement('iframe');
  frame.src = relayUrl;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture';
  frame.setAttribute('allowfullscreen', '');
  setRelayFrameMode(frame, false);
  wrapper.appendChild(frame);
  return frame;
}

// =========================================================================
// 3. PAGE VIEW ROUTER & DYNAMIC SUB-PAGE INJECTION ENGINE (IFRAME RESOLVER)
// =========================================================================
/**
 * Resolves browser session URLs and injects matching sub-page content layouts.
 * Uses fetch() for landing menus to keep overlay bindings, and iframes for standalone apps.
 * @param {string} url - Inbound target network link descriptor string.
 * @param {string} [actualFilePath] - Optional underlying file system path.
 */
function updateViewportContent(url, actualFilePath = null) {
  const externalActualTarget = actualFilePath && /^https?:\/\//i.test(String(actualFilePath).trim())
    ? String(actualFilePath).trim()
    : null;
  const resolvedUrl = externalActualTarget
    ? LAUNCHER_PAGE
    : actualFilePath ? `${DEFAULT_PROTOCOL}${actualFilePath}` : url;
  const routeKey = resolvedUrl.replace(DEFAULT_PROTOCOL, '').trim().toLowerCase();
  const externalTarget = externalActualTarget || (!actualFilePath && /^https?:\/\//i.test(String(url).trim())
    ? String(url).trim()
    : null);
  const viewport = document.getElementById('viewport-content');
  if (!viewport) return;

  parkRelayWarmupFrame();

  // Remove any previously mounted game overlay panels from the screen
  const existingOverlay = document.getElementById('launcher-floating-pills');
  if (existingOverlay) existingOverlay.remove();

  // Handle empty landing state via fetch() text overlay injection
  if (routeKey === 'newtab' || routeKey === '') {
    fetch('home.html')
      .then(response => {
        if (!response.ok) throw new Error('Landing page configuration offline.');
        return response.text();
      })
      .then(htmlContent => {
        viewport.innerHTML = htmlContent;
      })
      .catch(err => {
        console.error(err);
        viewport.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
            <h1 style="font-size: 28px; margin-bottom: 12px; color: #f8fafc; font-family: 'Saira', sans-serif;">Welcome to Antarctic</h1>
            <p style="color: #64748b; font-size: 14px; font-family: 'Saira', sans-serif;">Select a deck module from the layout panel menu to begin simulation routines.</p>
          </div>
        `;
      });
    return;
  }

  // Handle core operational navigation dashboards (like the games overview gallery menu)
  if (routeKey === 'games') {
    fetch('games.html')
      .then(response => {
        if (!response.ok) throw new Error(`Target location offline (${response.status})`);
        return response.text();
      })
      .then(htmlContent => {
        viewport.innerHTML = htmlContent;
        initializeGamesPortalEngine(); // Mount search handlers and filter tools
      })
      .catch(err => {
        console.error(err);
        viewport.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: #ef4444; font-family: 'Saira', sans-serif;">
            <h2 style="font-size: 18px; margin-bottom: 8px;">Failed to process protocol node</h2>
            <p style="color: #64748b; font-size: 13px; font-family: monospace;">${err.message}</p>
          </div>
        `;
      });
    return;
  }

  if (routeKey === 'apps') {
    fetch('apps.html')
      .then(response => {
        if (!response.ok) throw new Error(`Target location offline (${response.status})`);
        return response.text();
      })
      .then(htmlContent => {
        viewport.innerHTML = htmlContent;
        initializeAppsPortalEngine();
      })
      .catch(err => {
        console.error(err);
        viewport.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: #ef4444; font-family: 'Saira', sans-serif;">
            <h2 style="font-size: 18px; margin-bottom: 8px;">Failed to process app directory</h2>
            <p style="color: #64748b; font-size: 13px; font-family: monospace;">${err.message}</p>
          </div>
        `;
      });
    return;
  }

  if (routeKey === 'music') {
    fetch('music.html')
      .then(response => {
        if (!response.ok) throw new Error(`Target location offline (${response.status})`);
        return response.text();
      })
      .then(htmlContent => {
        viewport.innerHTML = htmlContent;
        initializeMusicPortalEngine();
      })
      .catch(err => {
        console.error(err);
        viewport.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: #ef4444; font-family: 'Saira', sans-serif;">
            <h2 style="font-size: 18px; margin-bottom: 8px;">Failed to load music</h2>
            <p style="color: #64748b; font-size: 13px; font-family: monospace;">${err.message}</p>
          </div>
        `;
      });
    return;
  }

  if (routeKey === 'settings') {
    fetch('settings.html')
      .then(response => {
        if (!response.ok) throw new Error(`Target location offline (${response.status})`);
        return response.text();
      })
      .then(htmlContent => {
        viewport.innerHTML = htmlContent;
        initializeSettingsPortalEngine();
      })
      .catch(err => {
        console.error(err);
        viewport.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: #ef4444; font-family: 'Saira', sans-serif;">
            <h2 style="font-size: 18px; margin-bottom: 8px;">Failed to load settings</h2>
            <p style="color: #64748b; font-size: 13px; font-family: monospace;">${err.message}</p>
          </div>
        `;
      });
    return;
  }

  if (routeKey === 'terms') {
    fetch('terms.html')
      .then(response => {
        if (!response.ok) throw new Error(`Terms document unavailable (${response.status})`);
        return response.text();
      })
      .then(htmlContent => {
        viewport.innerHTML = htmlContent;
        formatTermsDocument(viewport);
      })
      .catch(err => {
        console.error(err);
        viewport.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: #ef4444; font-family: 'Saira', sans-serif;">
            <h2 style="font-size: 18px; margin-bottom: 8px;">Failed to load Terms of Service</h2>
            <p style="color: #64748b; font-size: 13px; font-family: monospace;">${err.message}</p>
          </div>
        `;
      });
    return;
  }

  if (externalTarget) {
    viewport.innerHTML = `
      <div style="position: relative; width: 100%; height: 100%;" id="sandbox-wrapper">
        <div class="relay-session-loading" style="display: grid; height: 100%; place-items: center; color: #94a3b8;">Opening relay session…</div>
      </div>
    `;
    const wrapper = document.getElementById('sandbox-wrapper');
    let visibleRelayUrl = null;
    createRelaySessionUrl({ url: externalTarget })
      .then(relayUrl => {
        if (!wrapper?.isConnected) return;
        visibleRelayUrl = relayUrl;
        wrapper.querySelector('.relay-session-loading')?.remove();
        mountRelayFrame(wrapper, relayUrl);
      })
      .catch(error => {
        if (wrapper) wrapper.innerHTML = `<div style="display:grid;height:100%;place-items:center;color:#fca5a5;">${error.message}</div>`;
      });
    injectLauncherOverlayDeck(externalTarget, async () => visibleRelayUrl || createRelaySessionUrl({ url: externalTarget }));
    return;
  }

  // CORE SOLUTION: Full-screen edge-to-edge frame styling optimization
  viewport.innerHTML = `
    <div style="position: relative; width: 100%; height: 100%;" id="sandbox-wrapper">
      <iframe src="${routeKey}" style="
        width: 100%; 
        height: 100%; 
        border: none; 
        background: transparent;
        margin: 0;
        padding: 0;
        display: block;
      " id="game-sandbox-frame"></iframe>
    </div>
  `;

  // Mount the interactive utility overlay bar near the bottom center edge
  injectLauncherOverlayDeck(routeKey);
}

// =========================================================================
// 4. FLOATING UTILITY CONTROLS DECK INJECTION (GAME TOOLS OVERLAY)
// =========================================================================
/**
 * Dynamically constructs and mounts a floating helper toolbar over running game sandboxes
 * @param {string} targetFile - Source system path for fallback tab actions
 */
function injectLauncherOverlayDeck(targetFile, openTarget = targetFile) {
  const mainWrapper = document.getElementById('sandbox-wrapper');
  if (!mainWrapper) return;

  const controlPanel = document.createElement('div');
  controlPanel.id = 'launcher-floating-pills';
  
  // Style the overlay pill container using glassmorphic properties matching your theme
  Object.assign(controlPanel.style, {
    position: 'absolute',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.65) 0%, rgba(3, 7, 18, 0.85) 100%)',
    backdropFilter: 'blur(12px)',
    webkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    padding: '4px 6px',
    borderRadius: '20px',
    zIndex: '99999',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
    opacity: '0.4',
    transition: 'opacity 0.2s ease, transform 0.2s ease'
  });

  // Inject child control pill nodes with image assets instead of label strings
  controlPanel.innerHTML = `
    <button class="overlay-pill-btn" id="overlay-toggle-fs" title="Fullscreen" style="
      background: transparent; border: none; outline: none; padding: 6px;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: filter 0.2s ease;
    ">
      <img src="assets/svg/fullscreen.svg" alt="Fullscreen" style="width: 16px; height: 16px; display: block; filter: invert(63%) sepia(13%) saturate(452%) hue-rotate(176deg) brightness(91%) contrast(89%); transition: filter 0.2s ease;">
    </button>
    <div style="width: 1px; height: 12px; background: rgba(255,255,255,0.1); flex-shrink:0;"></div>
    <button class="overlay-pill-btn" id="overlay-new-tab" title="Open in New Tab" style="
      background: transparent; border: none; outline: none; padding: 6px;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: filter 0.2s ease;
    ">
      <img src="assets/svg/oint.svg" alt="Open in New Tab" style="width: 16px; height: 16px; display: block; filter: invert(63%) sepia(13%) saturate(452%) hue-rotate(176deg) brightness(91%) contrast(89%); transition: filter 0.2s ease;">
    </button>
  `;

  // Hover animations to reveal full panel contrast smoothly
  controlPanel.addEventListener('mouseenter', () => { controlPanel.style.opacity = '1'; });
  controlPanel.addEventListener('mouseleave', () => { controlPanel.style.opacity = '0.4'; });

  mainWrapper.appendChild(controlPanel);

  // Bind actionable functional logic to toolbar loops
  const fsBtn = controlPanel.querySelector('#overlay-toggle-fs');
  const ntBtn = controlPanel.querySelector('#overlay-new-tab');
  const fsIcon = fsBtn.querySelector('img');
  const ntIcon = ntBtn.querySelector('img');
  const iframeTarget = document.getElementById('game-sandbox-frame');

  // Sync icon tint shifts on mouse hover states using filter drops
  fsBtn.addEventListener('mouseenter', () => { fsIcon.style.filter = 'invert(96%) sepia(6%) saturate(301%) hue-rotate(182deg) brightness(103%) contrast(93%)'; });
  fsBtn.addEventListener('mouseleave', () => { fsIcon.style.filter = 'invert(63%) sepia(13%) saturate(452%) hue-rotate(176deg) brightness(91%) contrast(89%)'; });
  fsBtn.addEventListener('click', () => {
    if (iframeTarget) {
      if (!document.fullscreenElement) {
        iframeTarget.requestFullscreen().catch(err => console.error(err));
      } else {
        document.exitFullscreen();
      }
    }
  });

  ntBtn.addEventListener('mouseenter', () => { ntIcon.style.filter = 'invert(96%) sepia(6%) saturate(301%) hue-rotate(182deg) brightness(103%) contrast(93%)'; });
  ntBtn.addEventListener('mouseleave', () => { ntIcon.style.filter = 'invert(63%) sepia(13%) saturate(452%) hue-rotate(176deg) brightness(91%) contrast(89%)'; });
  ntBtn.addEventListener('click', async () => {
    const openedWindow = window.open('about:blank', '_blank');
    if (!openedWindow) return;
    try {
      const target = typeof openTarget === 'function' ? await openTarget() : openTarget;
      openedWindow.location.href = target;
    } catch (error) {
      openedWindow.close();
      console.error('Unable to open relay session:', error);
    }
  });
}

// =========================================================================
// 5. SUB-PAGE ENGINE: DYNAMIC GAMES PORTAL INITIALIZER
// =========================================================================
function compareDirectoryNames(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

/**
 * Binds lookups and search event loops natively to elements injected inside games.html
 */
function initializeGamesPortalEngine() {
  const shelvesContainer = document.getElementById('shelvesContainer');
  const search = document.getElementById('portalSearch');
  const pills = document.querySelectorAll('.category-pill[data-category]');
  const filtersControl = document.getElementById('filtersControl');
  const filtersButton = document.getElementById('filtersButton');
  const filtersCount = document.getElementById('filtersCount');
  const secondaryFilters = document.querySelectorAll('.filter-option input');
  const clearFilters = document.getElementById('clearFilters');
  
  if (!shelvesContainer) return;

  let gamesData = [];
  let currentCategory = 'all';
  let searchQuery = '';
  const selectedTags = new Set();

  function updateFilterControls() {
    pills.forEach(pill => {
      pill.classList.toggle('active', pill.dataset.category === currentCategory);
    });

    if (filtersButton && filtersCount) {
      filtersButton.classList.toggle('active', selectedTags.size > 0);
      filtersCount.textContent = selectedTags.size;
      filtersCount.hidden = selectedTags.size === 0;
    }
  }

  fetch('config/games.json')
    .then(response => {
      if (!response.ok) throw new Error('Database file could not be read.');
      return response.json();
    })
    .then(data => {
      gamesData = data;
      buildGameDashboard();
    })
    .catch(err => {
      shelvesContainer.innerHTML = `<div class="status-msg" style="color: #ef4444;">Failed to sync index: ${err.message}</div>`;
    });

  function buildGameDashboard() {
    shelvesContainer.innerHTML = '';
    const uniqueShelves = [...new Set(gamesData.map(g => g.shelf))];

    uniqueShelves.forEach(shelfId => {
      const shelfGames = gamesData.filter(g => g.shelf === shelfId);
      
      const matchingGames = shelfGames.filter(game => {
        const matchesSearch = game.title.toLowerCase().includes(searchQuery);
        const requiredTags = currentCategory === 'all'
          ? [...selectedTags]
          : [currentCategory, ...selectedTags];
        const matchesCategory = requiredTags.every(tag => game.tags && game.tags.includes(tag));
        return matchesSearch && matchesCategory;
      }).sort((left, right) => compareDirectoryNames(left.title, right.title));

      if (matchingGames.length === 0) return;

      const shelfSection = document.createElement('div');
      shelfSection.className = 'shelf-container';

      const titleDisplay = shelfGames[0]?.shelfTitle || (shelfId.charAt(0).toUpperCase() + shelfId.slice(1));
      const shelfTitle = document.createElement('h3');
      shelfTitle.className = 'shelf-title';
      shelfTitle.textContent = titleDisplay;
      shelfSection.appendChild(shelfTitle);

      const arcadeGrid = document.createElement('div');
      arcadeGrid.className = 'arcade-grid';

      matchingGames.forEach(game => {
        const card = document.createElement('div');
        card.className = 'arcade-card';
        card.style.backgroundImage = `url('${game.thumbnail}')`;
        
        if (game.url) {
          card.dataset.gameUrl = game.url;
        }
        
        if (game.badge) {
          const badgeClass = game.badge.toLowerCase() === 'top' ? 'top-rated' : 'editor-pick';
          const badgeLabel = game.badge.toLowerCase() === 'top' ? '★ Top' : '❤ Pick';
          card.innerHTML += `<div class="card-tag ${badgeClass}">${badgeLabel}</div>`;
        }

        card.innerHTML += `
          <div class="card-details-overlay">
            <h4 class="card-title">${game.title}</h4>
          </div>
        `;

        card.addEventListener('click', () => {
          if (game.url) {
            const currentTab = tabState.tabs.find(t => t.id === tabState.activeTabId);
            if (currentTab) {
              navigateTabTo(currentTab, {
                url: LAUNCHER_PAGE,
                actualPath: game.url,
                title: game.title,
                favicon: game.title.charAt(0).toUpperCase()
              });
              renderTabs();
            }
          }
        });

        arcadeGrid.appendChild(card);
      });

      shelfSection.appendChild(arcadeGrid);
      shelvesContainer.appendChild(shelfSection);
    });

    if (shelvesContainer.innerHTML === '') {
      shelvesContainer.innerHTML = '<div class="status-msg">No simulation nodes match active criteria descriptors.</div>';
    }
  }

  if (search) {
    search.addEventListener('input', () => {
      searchQuery = search.value.toLowerCase().trim();
      buildGameDashboard();
    });
  }

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      currentCategory = pill.dataset.category;
      if (currentCategory === 'all') {
        selectedTags.clear();
        secondaryFilters.forEach(filter => { filter.checked = false; });
      }
      updateFilterControls();
      buildGameDashboard();
    });
  });

  secondaryFilters.forEach(filter => {
    filter.addEventListener('change', () => {
      if (filter.checked) {
        selectedTags.add(filter.value);
      } else {
        selectedTags.delete(filter.value);
      }
      updateFilterControls();
      buildGameDashboard();
    });
  });

  if (filtersButton && filtersControl) {
    filtersButton.addEventListener('click', () => {
      const isOpen = filtersControl.classList.toggle('open');
      filtersButton.setAttribute('aria-expanded', String(isOpen));
    });
  }

  if (clearFilters) {
    clearFilters.addEventListener('click', () => {
      currentCategory = 'all';
      selectedTags.clear();
      secondaryFilters.forEach(filter => { filter.checked = false; });
      updateFilterControls();
      buildGameDashboard();
    });
  }

  updateFilterControls();
}

// =========================================================================
// 6. SUB-PAGE ENGINE: APPS DIRECTORY INITIALIZER
// =========================================================================
function initializeAppsPortalEngine() {
  const appsContainer = document.getElementById('appsContainer');
  const search = document.getElementById('appsSearch');
  const categoryBar = document.getElementById('appsCategories');

  if (!appsContainer) return;

  let appsData = [];
  let currentCategory = 'all';
  let searchQuery = '';

  function renderApps() {
    appsContainer.innerHTML = '';

    const matchingApps = appsData.filter(app => {
      const haystack = `${app.name} ${app.description} ${app.category}`.toLowerCase();
      return (currentCategory === 'all' || app.category.toLowerCase() === currentCategory)
        && haystack.includes(searchQuery);
    });

    matchingApps.forEach(app => {
      const card = document.createElement('div');
      card.className = 'arcade-card app-arcade-card';
      card.dataset.appUrl = app.url;
      card.style.backgroundImage = app.thumbnail
        ? `url('${app.thumbnail}')`
        : `linear-gradient(135deg, ${app.accent || '#60a5fa'} 0%, #0f172a 100%)`;
      card.innerHTML = `
        <div class="card-tag app-card-tag">${app.category}</div>
        <div class="card-details-overlay">
          <h4 class="card-title">${app.name}</h4>
        </div>
      `;
      card.addEventListener('click', () => {
        const currentTab = tabState.tabs.find(t => t.id === tabState.activeTabId);
        if (!currentTab) return;

        navigateTabTo(currentTab, {
          url: LAUNCHER_PAGE,
          actualPath: app.url,
          title: app.name,
          favicon: app.name.charAt(0).toUpperCase()
        });
        renderTabs();
      });
      appsContainer.appendChild(card);
    });

    if (matchingApps.length === 0) {
      appsContainer.innerHTML = '<div class="apps-empty">No apps match that search.</div>';
    }
  }

  fetch('config/apps.json')
    .then(response => {
      if (!response.ok) throw new Error('App directory could not be read.');
      return response.json();
    })
    .then(data => {
      appsData = (Array.isArray(data) ? data : [])
        .sort((left, right) => compareDirectoryNames(left.name, right.name));
      renderApps();
    })
    .catch(err => {
      appsContainer.innerHTML = `<div class="apps-empty apps-error">Failed to sync app directory: ${err.message}</div>`;
    });

  search?.addEventListener('input', () => {
    searchQuery = search.value.toLowerCase().trim();
    renderApps();
  });

  categoryBar?.addEventListener('click', event => {
    const pill = event.target.closest('[data-app-category]');
    if (!pill) return;

    currentCategory = pill.dataset.appCategory;
    categoryBar.querySelectorAll('[data-app-category]').forEach(item => {
      item.classList.toggle('active', item === pill);
    });
    renderApps();
  });
}

// =========================================================================
// 7. SUB-PAGE ENGINE: MUSIC PORTAL INITIALIZER
// =========================================================================
function initializeMusicPortalEngine() {
  const frameHost = document.getElementById('music-relay-host');
  const searchFrameHost = document.getElementById('music-search-relay-host');
  const addForm = document.getElementById('music-add-form');
  const addInput = document.getElementById('music-add-input');
  const searchStatus = document.getElementById('music-search-status');
  const searchResults = document.getElementById('music-search-results');
  const browseSections = document.getElementById('music-browse-sections');
  const browseStatus = document.getElementById('music-browse-status');
  const queueList = document.getElementById('music-queue-list');
  const queueCount = document.getElementById('music-queue-count');
  const currentTitle = document.getElementById('music-now-playing-title');
  const currentSource = document.getElementById('music-now-playing-source');
  const dockArt = document.querySelector('.music-dock-art');
  const playerStatus = document.getElementById('music-player-status');
  const playButton = document.getElementById('music-play');
  const previousButton = document.getElementById('music-previous');
  const nextButton = document.getElementById('music-next');
  const progress = document.getElementById('music-progress');
  const currentTime = document.getElementById('music-current-time');
  const duration = document.getElementById('music-duration');
  const volume = document.getElementById('music-volume');
  const refresh = document.getElementById('music-refresh');
  const fullscreen = document.getElementById('music-fullscreen');
  const backendLabel = document.getElementById('music-backend-label');

  if (!frameHost) return;

  const MUSIC_STORAGE_KEY = 'antarctic.music-queue.v1';
  const previousMessageHandler = window.__antarcticMusicMessageHandler;
  if (previousMessageHandler) window.removeEventListener('message', previousMessageHandler);

  let queue = [];
  let currentIndex = -1;
  let musicFrame = null;
  let searchRelayFrame = null;
  let activeSearch = null;
  let browseLoaded = false;
  let autoPlayWhenReady = false;
  let musicFrameRequest = 0;
  let mediaState = { currentTime: 0, duration: 0, paused: true, volume: 1 };

  const browseConfigs = [
    { id: 'top-hits', title: 'Top songs', query: 'top songs official audio' },
    { id: 'pop', title: 'Pop', query: 'pop songs official audio' },
    { id: 'hip-hop', title: 'Hip-Hop', query: 'hip hop songs official audio' },
    { id: 'rnb', title: 'R&B', query: 'r&b songs official audio' }
  ];

  try {
    const savedQueue = JSON.parse(localStorage.getItem(MUSIC_STORAGE_KEY));
    if (Array.isArray(savedQueue)) {
      queue = savedQueue.filter(track => track && typeof track.videoId === 'string' && typeof track.title === 'string');
    }
  } catch (error) {
    queue = [];
  }

  const persistQueue = () => {
    try {
      localStorage.setItem(MUSIC_STORAGE_KEY, JSON.stringify(queue));
    } catch (error) {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  };

  const formatTime = value => {
    const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const embedUrlFor = videoId => `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1`;

  if (backendLabel) {
    backendLabel.textContent = `${appSettings.relayBackend === 'ultraviolet' ? 'Ultraviolet' : 'Scramjet'} relay`;
  }

  const sendMediaCommand = (command, value, userInitiated = false) => {
    musicFrame?.contentWindow?.postMessage({
      type: 'antarctic:relay-media-command',
      command,
      value,
      userInitiated
    }, '*');
  };

  const updateControls = () => {
    const hasTrack = currentIndex >= 0 && queue[currentIndex];
    const isPlaying = hasTrack && !mediaState.paused;
    if (currentTitle) currentTitle.textContent = hasTrack ? queue[currentIndex].title : 'Nothing playing';
    if (currentSource) currentSource.textContent = hasTrack ? 'YouTube Music · Antarctic relay' : 'Choose a song to begin';
    if (dockArt) {
      dockArt.style.backgroundImage = hasTrack && queue[currentIndex].thumbnail
        ? `url("${queue[currentIndex].thumbnail}")`
        : '';
      dockArt.style.backgroundSize = 'cover';
      dockArt.style.backgroundPosition = 'center';
    }
    if (currentTime) currentTime.textContent = formatTime(mediaState.currentTime);
    if (duration) duration.textContent = formatTime(mediaState.duration);
    if (progress) {
      progress.max = String(mediaState.duration || 0);
      progress.value = String(Math.min(mediaState.currentTime, mediaState.duration || mediaState.currentTime));
      progress.disabled = !hasTrack || !mediaState.duration;
    }
    if (volume) volume.value = String(mediaState.volume ?? 1);
    if (playButton) {
      playButton.textContent = isPlaying ? 'Ⅱ' : '▶';
      playButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      playButton.disabled = !hasTrack;
    }
    if (previousButton) previousButton.disabled = !hasTrack;
    if (nextButton) nextButton.disabled = !hasTrack;
    if (playerStatus) playerStatus.textContent = hasTrack
      ? (isPlaying ? 'Playing through Antarctic relay' : 'Ready to play')
      : 'Waiting for a track';
  };

  const renderQueue = () => {
    if (queueCount) queueCount.textContent = `${queue.length} ${queue.length === 1 ? 'track' : 'tracks'}`;
    if (!queueList) return;
    queueList.innerHTML = '';

    if (queue.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'music-empty-queue';
      empty.textContent = 'Your queue is empty. Search for a song above.';
      queueList.appendChild(empty);
      return;
    }

    queue.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = `music-queue-item${index === currentIndex ? ' active' : ''}`;
      item.dataset.trackIndex = String(index);
      item.tabIndex = 0;
      item.setAttribute('role', 'button');

      const number = document.createElement('span');
      number.className = 'music-queue-number';
      number.textContent = String(index + 1).padStart(2, '0');

      const copy = document.createElement('span');
      copy.className = 'music-queue-copy';
      const title = document.createElement('span');
      title.className = 'music-queue-title';
      title.textContent = track.title;
      const provider = document.createElement('span');
      provider.className = 'music-queue-provider';
      provider.textContent = 'YouTube';
      copy.append(title, provider);

      const remove = document.createElement('button');
      remove.className = 'music-queue-remove';
      remove.type = 'button';
      remove.dataset.removeTrack = String(index);
      remove.setAttribute('aria-label', `Remove ${track.title}`);
      remove.textContent = '×';
      item.append(number, copy, remove);
      queueList.appendChild(item);
    });
  };

  const createTrackCard = result => {
    const button = document.createElement('button');
    button.className = 'music-card';
    button.type = 'button';
    button.dataset.videoId = result.videoId;
    button.dataset.trackTitle = result.title;
    button.dataset.sourceUrl = result.sourceUrl;
    button.dataset.thumbnail = result.thumbnail || '';

    const art = document.createElement('span');
    art.className = 'music-card-art';
    if (result.thumbnail) {
      const image = document.createElement('img');
      image.src = result.thumbnail;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      art.appendChild(image);
    }

    const copy = document.createElement('span');
    copy.className = 'music-card-copy';
    const title = document.createElement('span');
    title.className = 'music-card-title';
    title.textContent = result.title;
    const subtitle = document.createElement('span');
    subtitle.className = 'music-card-subtitle';
    subtitle.textContent = 'YouTube Music';
    copy.append(title, subtitle);
    button.append(art, copy);
    return button;
  };

  const renderSearchResults = results => {
    if (!searchResults) return;
    searchResults.innerHTML = '';
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'music-empty-queue';
      empty.textContent = 'No songs found for that search.';
      searchResults.appendChild(empty);
      return;
    }
    results.forEach(result => searchResults.appendChild(createTrackCard(result)));
  };

  const renderShelf = (config, results) => {
    if (!browseSections) return;
    const shelf = browseSections.querySelector(`[data-music-shelf="${config.id}"]`);
    if (!shelf) return;
    const row = shelf.querySelector('.music-card-row');
    if (!row) return;
    row.innerHTML = '';
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'music-empty-queue';
      empty.textContent = 'No songs found for this shelf.';
      row.appendChild(empty);
      return;
    }
    results.forEach(result => row.appendChild(createTrackCard(result)));
  };

  const renderBrowsePlaceholders = () => {
    if (!browseSections) return;
    browseSections.innerHTML = '';
    browseConfigs.forEach(config => {
      const shelf = document.createElement('section');
      shelf.className = 'music-shelf';
      shelf.dataset.musicShelf = config.id;
      const heading = document.createElement('div');
      heading.className = 'music-shelf-heading';
      const title = document.createElement('h2');
      title.textContent = config.title;
      const status = document.createElement('span');
      status.textContent = 'Loading…';
      heading.append(title, status);
      const row = document.createElement('div');
      row.className = 'music-card-row';
      const loading = document.createElement('div');
      loading.className = 'music-empty-queue';
      loading.textContent = 'Finding songs…';
      row.appendChild(loading);
      shelf.append(heading, row);
      browseSections.appendChild(shelf);
    });
  };

  const mountMusicFrame = async (track, autoPlay = false, userInitiated = false) => {
    const requestId = ++musicFrameRequest;
    frameHost.innerHTML = '';
    musicFrame = null;
    autoPlayWhenReady = Boolean(track && autoPlay && userInitiated);
    if (!track) {
      musicFrame = null;
      mediaState = { currentTime: 0, duration: 0, paused: true, volume: 1 };
      updateControls();
      return;
    }

    // Music follows the same relay backend selected in Settings.
    const musicBackend = appSettings.relayBackend;
    if (backendLabel) backendLabel.textContent = `${musicBackend === 'ultraviolet' ? 'Ultraviolet' : 'Scramjet'} music relay`;
    try {
      const relayUrl = await createRelaySessionUrl({ backend: musicBackend, url: embedUrlFor(track.videoId) });
      if (requestId !== musicFrameRequest) return;
      musicFrame = mountRelayFrame(frameHost, relayUrl);
    } catch (error) {
      if (requestId === musicFrameRequest && playerStatus) playerStatus.textContent = error.message;
      return;
    }
    musicFrame.id = 'music-relay-frame';
    musicFrame.title = `YouTube player for ${track.title}`;
    musicFrame.addEventListener('load', () => {
      if (playerStatus) playerStatus.textContent = 'Player surface ready';
    }, { once: true });
    mediaState = { currentTime: 0, duration: 0, paused: true, volume: Number(volume?.value || 1) };
    updateControls();
  };

  const selectTrack = (index, event = null) => {
    if (!queue[index]) return;
    currentIndex = index;
    renderQueue();
    mountMusicFrame(queue[currentIndex], true, event?.isTrusted === true);
  };

  const advanceTrack = step => {
    if (queue.length === 0) return;
    selectTrack((currentIndex + step + queue.length) % queue.length);
  };

  const searchYouTubeMusic = (query, mode = 'search', config = null) => {
    const request = { query, mode, config };
    activeSearch = request;
    if (mode === 'search' && searchStatus) searchStatus.textContent = 'Searching Antarctic music index…';
    if (mode === 'browse' && browseStatus) browseStatus.textContent = `Loading ${config.title.toLowerCase()} through the relay…`;

    fetch(`/api/music/search?q=${encodeURIComponent(query)}`)
      .then(response => response.ok ? response.json() : response.json().catch(() => ({})).then(body => Promise.reject(new Error(body.error || `Search failed (${response.status}).`))))
      .then(payload => {
        if (activeSearch !== request) return;
        const results = Array.isArray(payload.results) ? payload.results : [];
        if (mode === 'browse') {
          renderShelf(config, results);
          const shelf = browseSections?.querySelector(`[data-music-shelf="${config.id}"]`);
          const shelfStatus = shelf?.querySelector('.music-shelf-heading span');
          if (shelfStatus) shelfStatus.textContent = `${results.length} picks`;
          window.__antarcticMusicBrowseNext?.();
        } else {
          renderSearchResults(results);
          if (searchStatus) searchStatus.textContent = `${results.length} results found.`;
        }
      })
      .catch(error => {
        if (activeSearch !== request) return;
        if (mode === 'browse') {
          renderShelf(config, []);
          if (browseStatus) browseStatus.textContent = error.message;
          window.__antarcticMusicBrowseNext?.();
        } else if (searchStatus) {
          searchStatus.textContent = error.message;
          renderSearchResults([]);
        }
      });
  };

  addForm?.addEventListener('submit', event => {
    event.preventDefault();
    const query = addInput?.value.trim();
    if (!query) return;
    if (searchResults) {
      searchResults.hidden = false;
      searchResults.innerHTML = '';
    }
    if (browseSections) browseSections.hidden = true;
    searchYouTubeMusic(query, 'search');
  });

  const handleTrackCardClick = event => {
    if (!event.isTrusted) return;
    const result = event.target.closest('[data-video-id]');
    if (!result) return;
    queue.push({
      videoId: result.dataset.videoId,
      title: result.dataset.trackTitle,
      sourceUrl: result.dataset.sourceUrl,
      thumbnail: result.dataset.thumbnail || ''
    });
    persistQueue();
    renderQueue();
    selectTrack(queue.length - 1, event);
    if (searchStatus) searchStatus.textContent = 'Added to queue.';
  };

  searchResults?.addEventListener('click', handleTrackCardClick);
  browseSections?.addEventListener('click', handleTrackCardClick);

  document.querySelectorAll('[data-music-view]').forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.musicView;
      document.querySelectorAll('[data-music-view]').forEach(item => item.classList.toggle('active', item === button));
      if (view === 'browse') {
        if (searchResults) searchResults.hidden = true;
        if (browseSections) browseSections.hidden = false;
        if (!browseLoaded || activeSearch?.mode !== 'browse') startBrowse();
      } else if (view === 'search') {
        if (searchResults) searchResults.hidden = false;
        if (browseSections) browseSections.hidden = true;
        addInput?.focus();
      } else if (view === 'queue') {
        queueList?.scrollIntoView({ behavior: appSettings.reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      }
    });
  });

  queueList?.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const removeButton = event.target.closest('[data-remove-track]');
    if (removeButton) {
      const index = Number(removeButton.dataset.removeTrack);
      queue.splice(index, 1);
      persistQueue();
      if (queue.length === 0) currentIndex = -1;
      else if (index < currentIndex) currentIndex -= 1;
      else if (index === currentIndex) currentIndex = Math.min(currentIndex, queue.length - 1);
      renderQueue();
      mountMusicFrame(queue[currentIndex]);
      return;
    }
    const item = event.target.closest('[data-track-index]');
    if (item) selectTrack(Number(item.dataset.trackIndex), event);
  });

  queueList?.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('[data-track-index]');
    if (!item || event.target.closest('[data-remove-track]')) return;
    event.preventDefault();
    selectTrack(Number(item.dataset.trackIndex), event);
  });

  playButton?.addEventListener('click', event => sendMediaCommand('toggle', undefined, event.isTrusted));
  previousButton?.addEventListener('click', event => {
    if (event.isTrusted) advanceTrack(-1);
  });
  nextButton?.addEventListener('click', event => {
    if (event.isTrusted) advanceTrack(1);
  });
  progress?.addEventListener('input', event => {
    if (event.isTrusted) sendMediaCommand('seek', Number(progress.value), true);
  });
  volume?.addEventListener('input', event => {
    if (event.isTrusted) sendMediaCommand('volume', Number(volume.value), true);
  });

  refresh?.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const track = queue[currentIndex];
    if (track) {
      const frameToRefresh = musicFrame;
      const musicBackend = appSettings.relayBackend;
      createRelaySessionUrl({ backend: musicBackend, url: embedUrlFor(track.videoId) })
        .then(relayUrl => {
          if (frameToRefresh && frameToRefresh === musicFrame) frameToRefresh.src = relayUrl;
        })
        .catch(error => {
          if (playerStatus) playerStatus.textContent = error.message;
        });
    }
  });

  fullscreen?.addEventListener('click', () => {
    const shell = document.querySelector('.music-page');
    shell?.requestFullscreen?.().catch(() => {});
  });

  function startBrowse() {
    if (!browseSections) return;
    browseLoaded = true;
    if (searchResults) searchResults.hidden = true;
    browseSections.hidden = false;
    renderBrowsePlaceholders();
    let shelfIndex = 0;
    const loadNextShelf = () => {
      const config = browseConfigs[shelfIndex];
      if (!config) {
        if (browseStatus) browseStatus.textContent = 'Fresh picks for your Antarctic session.';
        return;
      }
      activeSearch = { query: config.query, mode: 'browse', config, shelfIndex };
      searchYouTubeMusic(config.query, 'browse', config);
    };
    activeSearch = { loadNextShelf };
    window.__antarcticMusicBrowseNext = () => {
      shelfIndex += 1;
      loadNextShelf();
    };
    loadNextShelf();
  }

  const messageHandler = event => {
    if (event.source === musicFrame?.contentWindow && event.data?.type === 'antarctic:relay-media-ready') {
      if (playerStatus) playerStatus.textContent = 'Ready to play';
      if (autoPlayWhenReady) {
        const shouldAutoplay = autoPlayWhenReady;
        autoPlayWhenReady = false;
        sendMediaCommand('play', undefined, shouldAutoplay);
      }
      return;
    }
    if (event.source === musicFrame?.contentWindow && event.data?.type === 'antarctic:relay-media-error') {
      if (playerStatus) playerStatus.textContent = event.data.message || 'Playback was blocked.';
      return;
    }
    if (event.source === musicFrame?.contentWindow && event.data?.type === 'antarctic:relay-media-state') {
      mediaState = { ...mediaState, ...event.data.state };
      updateControls();
      if (mediaState.ended) advanceTrack(1);
      return;
    }
    if (event.source === searchRelayFrame?.contentWindow && event.data?.type === 'antarctic:relay-search-results') {
      const results = Array.isArray(event.data.results) ? event.data.results : [];
      if (!activeSearch || (event.data.query && event.data.query.toLowerCase() !== activeSearch.query.toLowerCase())) return;
      if (activeSearch.mode === 'browse') {
        renderShelf(activeSearch.config, results);
        const shelf = browseSections?.querySelector(`[data-music-shelf="${activeSearch.config.id}"]`);
        const shelfStatus = shelf?.querySelector('.music-shelf-heading span');
        if (shelfStatus) shelfStatus.textContent = `${results.length} picks`;
        window.__antarcticMusicBrowseNext?.();
      } else {
        renderSearchResults(results);
        if (searchStatus) searchStatus.textContent = `${results.length} results found.`;
      }
    }
  };
  window.__antarcticMusicMessageHandler = messageHandler;
  window.addEventListener('message', messageHandler);

  if (queue.length > 0) {
    currentIndex = 0;
    renderQueue();
    mountMusicFrame(queue[currentIndex]);
  } else {
    renderQueue();
    mountMusicFrame(null);
  }
  startBrowse();
}

// =========================================================================
// 8. SUB-PAGE ENGINE: SETTINGS PORTAL INITIALIZER
// =========================================================================
function initializeSettingsPortalEngine() {
  const categoryTabs = [...document.querySelectorAll('[data-settings-tab]')];
  const categoryPanels = [...document.querySelectorAll('[role="tabpanel"][id^="settings-panel-"]')];
  const reduceMotion = document.getElementById('settingsReduceMotion');
  const relayBackend = document.getElementById('settingsRelayBackend');
  const restoreSidebar = document.getElementById('settingsRestoreSidebar');
  const restoreTabs = document.getElementById('settingsRestoreTabs');
  const clearTabs = document.getElementById('settingsClearTabs');
  const clearData = document.getElementById('settingsClearData');
  const notice = document.getElementById('settingsNotice');
  const termsLink = document.getElementById('settingsTermsLink');

  const activateSettingsCategory = (category, moveFocus = false) => {
    categoryTabs.forEach(tab => {
      const isActive = tab.dataset.settingsTab === category;
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
      if (isActive && moveFocus) tab.focus();
    });

    categoryPanels.forEach(panel => {
      panel.hidden = panel.id !== `settings-panel-${category}`;
    });
  };

  categoryTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateSettingsCategory(tab.dataset.settingsTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = categoryTabs.length - 1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (index + 1) % categoryTabs.length;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (index - 1 + categoryTabs.length) % categoryTabs.length;
      }

      const nextTab = categoryTabs[nextIndex];
      activateSettingsCategory(nextTab.dataset.settingsTab, true);
    });
  });

  if (reduceMotion) {
    reduceMotion.checked = appSettings.reduceMotion;
    reduceMotion.addEventListener('change', () => {
      appSettings.reduceMotion = reduceMotion.checked;
      persistAppSettings();
      applyAppSettings();
      if (notice) notice.textContent = 'Motion preference saved.';
    });
  }

  if (relayBackend) {
    relayBackend.value = appSettings.relayBackend;
    relayBackend.addEventListener('change', () => {
      appSettings.relayBackend = relayBackend.value === 'ultraviolet' ? 'ultraviolet' : 'scramjet';
      persistAppSettings();
      if (notice) notice.textContent = `${appSettings.relayBackend === 'ultraviolet' ? 'Ultraviolet' : 'Scramjet'} relay selected. Reloading…`;
      window.setTimeout(() => window.location.reload(), 250);
    });
  }

  if (restoreSidebar) {
    restoreSidebar.checked = appSettings.restoreSidebarState;
    restoreSidebar.addEventListener('change', () => {
      appSettings.restoreSidebarState = restoreSidebar.checked;
      persistAppSettings();
      if (restoreSidebar.checked) {
        applySidebarState(loadPersistedSidebarState(), false);
      } else {
        applySidebarState(false, false);
      }
      if (notice) notice.textContent = 'Sidebar startup preference saved.';
    });
  }

  if (restoreTabs) {
    restoreTabs.checked = appSettings.restoreTabs;
    restoreTabs.addEventListener('change', () => {
      appSettings.restoreTabs = restoreTabs.checked;
      if (!restoreTabs.checked) localStorage.removeItem(TAB_STORAGE_KEY);
      persistAppSettings();
      if (notice) notice.textContent = `${restoreTabs.checked ? 'Saved tabs will' : 'Saved tabs will not'} be restored after reload.`;
    });
  }

  if (termsLink) {
    termsLink.addEventListener('click', () => navigateInline('terms'));
  }

  if (clearTabs) {
    clearTabs.addEventListener('click', () => {
      localStorage.removeItem(TAB_STORAGE_KEY);
      window.location.reload();
    });
  }

  if (clearData) {
    clearData.addEventListener('click', () => {
      const confirmed = window.confirm('Clear Antarctic cookies and local data? This will reset saved tabs, settings, and the access acknowledgment.');
      if (!confirmed) return;

      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (error) {
        // Restricted storage may prevent one or both stores from being cleared.
      }

      document.cookie.split(';').forEach(cookie => {
        const separator = cookie.indexOf('=');
        const name = (separator === -1 ? cookie : cookie.slice(0, separator)).trim();
        if (!name) return;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/`;
      });

      window.location.reload();
    });
  }
}

// =========================================================================
// 8. CORE RENDERING ENGINE (DOM SYNCHRONIZATION LAYER)
// =========================================================================
function renderTabs() {
  const activeTab = tabState.tabs.find(tab => tab.id === tabState.activeTabId);
  if (activeTab) ensureTabHistory(activeTab);
  persistTabState();

  const sectionLabel = sidebarTop.querySelector('.section-label');
  sidebarTop.innerHTML = '';
  sidebarTop.appendChild(sectionLabel);

  tabState.tabs.forEach(tab => {
    const isCurrent = tab.id === tabState.activeTabId;
    const tabItem = document.createElement('div');
    tabItem.className = `tab-item ${isCurrent ? 'active-tab' : ''}`;
    tabItem.dataset.id = tab.id;

    tabItem.style.display = 'flex';
    tabItem.style.alignItems = 'center';
    tabItem.style.justifyContent = 'space-between';
    tabItem.style.position = 'relative';

    if (isCurrent) {
      tabItem.style.background = 'rgba(255, 255, 255, 0.06)';
      tabItem.style.borderRadius = '0 12px 12px 0';
    } else {
      tabItem.style.background = 'transparent';
      tabItem.style.borderRadius = '12px';
    }

    tabItem.innerHTML = `
      <div style="display: flex; align-items: center; overflow: hidden; flex: 1; padding-right: 8px;">
        <div class="tab-favicon" style="flex-shrink: 0;"></div>
        <div class="tab-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px;">${tab.title}</div>
      </div>
      <span class="tab-close-btn" style="
        font-size: 18px; 
        font-weight: 400; 
        color: #64748b; 
        cursor: pointer; 
        padding: 0 4px; 
        line-height: 1; 
        margin-right: 4px;
        transition: color 0.2s ease;
        flex-shrink: 0;
        user-select: none;
      ">&times;</span>
    `;

    setTabFavicon(tabItem.querySelector('.tab-favicon'), tab.favicon, tab.title.charAt(0).toUpperCase());

    tabItem.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close-btn')) return;
      switchTab(tab.id);
    });

    const closeBtn = tabItem.querySelector('.tab-close-btn');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#e2e8f0'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#64748b'; });
    
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    sidebarTop.appendChild(tabItem);
  });

  const currentTab = tabState.tabs.find(t => t.id === tabState.activeTabId);
  if (currentTab) {
    const liveUrlInput = document.querySelector('.url-input');
    if (liveUrlInput) liveUrlInput.value = currentTab.url;

    updateNavigationControls();
    
    updateViewportContent(currentTab.url, currentTab.actualPath || null);
  }
}

// =========================================================================
// 7. OPERATION UTILITIES
// =========================================================================
function switchTab(targetTabId) {
  tabState.activeTabId = targetTabId;
  renderTabs();
}

function createNewTab(initialUrl = HOME_PAGE) {
  const generatedId = `tab-${Date.now()}`;
  let derivedTitle = 'New Tab';
  let initialLetter = 'N';

  if (initialUrl !== HOME_PAGE) {
    const plainString = initialUrl.replace(DEFAULT_PROTOCOL, '');
    const fileTitleName = plainString.includes('/') ? plainString.split('/').pop().replace('.html', '') : plainString;
    derivedTitle = fileTitleName.charAt(0).toUpperCase() + fileTitleName.slice(1);
    initialLetter = fileTitleName.charAt(0).toUpperCase();
  }

  const newTabObj = normalizeTabHistory({
    id: generatedId,
    title: derivedTitle,
    favicon: initialLetter,
    url: initialUrl,
    actualPath: null
  });
  tabState.tabs.push(newTabObj);
  tabState.activeTabId = generatedId;
  renderTabs();
}

function navigateInline(routeKey) {
  const targetedAppUrl = `${DEFAULT_PROTOCOL}${routeKey}`;
  const activeTab = tabState.tabs.find(t => t.id === tabState.activeTabId);
  if (activeTab) {
    const fileTitleName = routeKey.includes('/') ? routeKey.split('/').pop().replace('.html', '') : routeKey;
    navigateTabTo(activeTab, {
      url: targetedAppUrl,
      actualPath: null,
      title: fileTitleName.charAt(0).toUpperCase() + fileTitleName.slice(1),
      favicon: fileTitleName.charAt(0).toUpperCase()
    });
    renderTabs();
  }
}

function navigateLookup(value) {
  const lookupValue = value.trim();
  if (!lookupValue) return;

  let addressVal = lookupValue;
  if (/^antarctic:\/\//i.test(addressVal)) {
    addressVal = addressVal.toLowerCase();
  } else if (!/^https?:\/\//i.test(addressVal)) {
    const looksLikeDomain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#].*)?$/i.test(addressVal);
    addressVal = looksLikeDomain
      ? `https://${addressVal}`
      : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(addressVal)}`;
  }

  const activeNode = tabState.tabs.find(t => t.id === tabState.activeTabId);
  if (!activeNode) return;

  const route = addressVal.replace(DEFAULT_PROTOCOL, '');
  let nextTitle = 'New Tab';
  let nextFavicon = 'N';

  if (route !== 'newtab' && route !== '') {
    if (/^https?:\/\//i.test(addressVal)) {
      nextTitle = lookupValue.slice(0, 32);
      nextFavicon = lookupValue.charAt(0).toUpperCase() || 'W';
    } else {
      const fileTitleName = route.includes('/') ? route.split('/').pop().replace('.html', '') : route;
      nextTitle = fileTitleName.charAt(0).toUpperCase() + fileTitleName.slice(1);
      nextFavicon = fileTitleName.charAt(0).toUpperCase();
    }
  } else {
    nextTitle = 'New Tab';
    nextFavicon = 'N';
  }

  navigateTabTo(activeNode, {
    url: addressVal,
    actualPath: null,
    title: nextTitle,
    favicon: nextFavicon
  });
  renderTabs();
}

function closeTab(targetTabId) {
  const targetIndex = tabState.tabs.findIndex(t => t.id === targetTabId);
  if (targetIndex === -1) return;

  const wasActive = tabState.tabs[targetIndex].id === tabState.activeTabId;
  tabState.tabs.splice(targetIndex, 1);

  if (tabState.tabs.length === 0) {
    const freshId = `tab-${Date.now()}`;
    tabState.tabs.push(normalizeTabHistory({ id: freshId, title: 'New Tab', favicon: 'N', url: HOME_PAGE }));
    tabState.activeTabId = freshId;
  } else if (wasActive) {
    const safeLeftIndex = Math.max(0, targetIndex - 1);
    tabState.activeTabId = tabState.tabs[safeLeftIndex].id;
  }

  renderTabs();
}

// =========================================================================
// 8. CRITICAL BRIDGE: EXPOSE OBJECT METHODS TO GLOBAL WINDOW SCOPE
// =========================================================================
window.createNewTab = createNewTab;
window.switchTab = switchTab;
window.renderTabs = renderTabs;

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  const metadata = event.data;
  if (!metadata) return;

  if (metadata.type === 'antarctic:relay-ready') {
    if (event.source !== relayWarmupFrame?.contentWindow) return;
    relayWarmupReady = true;
    if (pendingRelayTarget) sendRelayTarget(pendingRelayTarget);
    return;
  }

  if (metadata.type !== 'antarctic:page-metadata') return;

  const frame = document.getElementById('game-sandbox-frame');
  const activeTab = tabState.tabs.find(tab => tab.id === tabState.activeTabId);
  if (!frame || frame.closest('.music-page') || !activeTab || event.source !== frame.contentWindow) return;

  const metadataTargetChanged = metadata.url
    && /^https?:\/\//i.test(metadata.url)
    && normalizeRemoteUrl(metadata.url) !== normalizeRemoteUrl(activeTab.url);
  if (metadataTargetChanged && metadata.userInitiated !== true) return;

  if (metadataTargetChanged) {
    navigateTabTo(activeTab, {
      url: metadata.url,
      actualPath: null,
      title: metadata.title || activeTab.title,
      favicon: metadata.favicon || activeTab.favicon
    });

    const liveUrlInput = document.querySelector('.url-input');
    if (liveUrlInput) liveUrlInput.value = activeTab.url;
    updateNavigationControls();
  }

  updateTabMetadata(activeTab, metadata);
});

// =========================================================================
// 9. INTERFACE EVENT LISTENERS SYSTEM DECK
// =========================================================================
menuBtn.addEventListener('click', function() {
  const currentState = menuBtn.getAttribute('data-state');
  applySidebarState(currentState !== 'open');
});

if (backButton) {
  backButton.addEventListener('click', () => { navigateHistory(-1); });
}

if (forwardButton) {
  forwardButton.addEventListener('click', () => { navigateHistory(1); });
}

if (reloadButton) {
  reloadButton.addEventListener('click', () => {
    const activeTab = tabState.tabs.find(tab => tab.id === tabState.activeTabId);
    if (activeTab) updateViewportContent(activeTab.url, activeTab.actualPath || null);
  });
}

if (btnNewTab) {
  btnNewTab.addEventListener('click', () => { createNewTab(HOME_PAGE); });
}

const viewportWrapper = document.getElementById('viewport-content');
if (viewportWrapper) {
  viewportWrapper.addEventListener('click', (e) => {
    const clickedPill = e.target.closest('.shortcut-pill');
    if (clickedPill && clickedPill.dataset.route) {
      navigateInline(clickedPill.dataset.route);
    }
  });

  viewportWrapper.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.portal-input')) {
      navigateLookup(e.target.value);
    }
  });
}

const bootUrlInput = document.querySelector('.url-input');
if (bootUrlInput) {
  bootUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const liveUrlInput = document.querySelector('.url-input');
      if (liveUrlInput.value.trim() === '') {
        navigateInline('newtab');
      } else {
        navigateLookup(liveUrlInput.value);
      }
      liveUrlInput.blur();
    }
  });
}

document.querySelectorAll('.grid-item').forEach(item => {
  item.addEventListener('click', () => {
    const appLabel = item.querySelector('.grid-label').textContent.toLowerCase();
    navigateInline(appLabel);
  });
});

// Boot execution handle
initializeAccessGate();
createRelayWarmupFrame();
renderTabs();
