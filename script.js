// =========================================================================
// 1. STATE INITIALIZATION & CONSTANTS
// =========================================================================
const DEFAULT_PROTOCOL = 'antarctic://';
const HOME_PAGE = 'antarctic://newtab';
const LAUNCHER_PAGE = 'antarctic://launcher';
const TAB_STORAGE_KEY = 'antarctic.tab-state.v1';

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
  try {
    localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabState));
  } catch (error) {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

// Central browser application session storage matrix
let tabState = loadPersistedTabState();

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
  const resolvedUrl = actualFilePath ? `${DEFAULT_PROTOCOL}${actualFilePath}` : url;
  const routeKey = resolvedUrl.replace(DEFAULT_PROTOCOL, '').trim().toLowerCase();
  const externalTarget = !actualFilePath && /^https?:\/\//i.test(String(url).trim())
    ? String(url).trim()
    : null;
  const viewport = document.getElementById('viewport-content');
  if (!viewport) return;

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

  if (externalTarget) {
    const relayUrl = `assets/relay/?embed=1&url=${encodeURIComponent(externalTarget)}`;
    viewport.innerHTML = `
      <div style="position: relative; width: 100%; height: 100%;" id="sandbox-wrapper">
        <iframe src="${relayUrl}" title="Antarctic proxy result" style="
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
    injectLauncherOverlayDeck(relayUrl);
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
function injectLauncherOverlayDeck(targetFile) {
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
  ntBtn.addEventListener('click', () => {
    window.open(targetFile, '_blank');
  });
}

// =========================================================================
// 5. SUB-PAGE ENGINE: DYNAMIC GAMES PORTAL INITIALIZER
// =========================================================================
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
      });

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
// 6. CORE RENDERING ENGINE (DOM SYNCHRONIZATION LAYER)
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
  const metadata = event.data;
  if (!metadata || metadata.type !== 'antarctic:page-metadata') return;

  const frame = document.getElementById('game-sandbox-frame');
  const activeTab = tabState.tabs.find(tab => tab.id === tabState.activeTabId);
  if (!frame || !activeTab || event.source !== frame.contentWindow) return;
  if (metadata.url && normalizeRemoteUrl(metadata.url) !== normalizeRemoteUrl(activeTab.url)) return;

  updateTabMetadata(activeTab, metadata);
});

// =========================================================================
// 9. INTERFACE EVENT LISTENERS SYSTEM DECK
// =========================================================================
menuBtn.addEventListener('click', function() {
  const currentState = menuBtn.getAttribute('data-state');
  if (currentState === 'closed') {
    menuIcon.innerHTML = closeSVG;
    menuBtn.setAttribute('data-state', 'open');
    sidebar.style.width = '260px';
    mainContent.style.marginLeft = '260px';
  } else {
    menuIcon.innerHTML = hamburgerSVG;
    menuBtn.setAttribute('data-state', 'closed');
    sidebar.style.width = '0';
    mainContent.style.marginLeft = '0';
  }
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
renderTabs();
