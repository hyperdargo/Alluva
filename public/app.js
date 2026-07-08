/**
 * Stream Vault - Frontend Application Logic
 * Coordinates UI states, API integrations, torrent streaming, and preferences.
 */

// ==========================================================================
// Application State & Configuration
// ==========================================================================

let INDEXERS = {
  2: { name: 'The Pirate Bay', category: 'Movies, TV, Anime' },
  4: { name: 'Nyaa.si', category: 'Anime' },
  5: { name: 'EZTV', category: 'TV Shows' },
  7: { name: 'Torrentsome', category: 'Movies, TV, Anime' },
  8: { name: 'LimeTorrents', category: 'Movies, TV, Anime' },
  9: { name: 'SkTorrent.org', category: 'Movies, TV, Anime' },
  11: { name: 'YTS.gg', category: 'Movies' }
};

const state = {
  currentView: 'home',
  selectedMedia: null,
  activeTorrentHash: null,
  webTorrentClient: null,
  hlsPlayer: null,
  searchDebounce: null,
  preferences: {
    theme: 'dark',
    accent: 'blue',
    player: 'torrserver',
    autoplay: false,
    enableAdultContent: false,
    selectedIndexers: [2, 4, 5, 11],
    vlcPath: '', // Custom VLC path
    vlcArgs: '', // Custom VLC arguments
    mpvPath: '', // Custom MPV path
    mpvArgs: '' // Custom MPV arguments
  },
  continueWatching: [],
  animeEpisodeNames: null,
  torrserverUrl: 'https://torrserver.ankitgupta.com.np',
  lastTorrentQuery: null,
  lastTorrentCategory: null,
  lastTorrentEpisode: null,
  lastTorrentSeason: null,
  auth: { token: localStorage.getItem('sv_token'), username: localStorage.getItem('sv_username'), isAdmin: localStorage.getItem('sv_isAdmin') === 'true' },
  vlcExtensionId: 'ihpiinojhnfhpdmmacgmpoonphhimkaj', // Open in VLC extension ID
  sortWebRipFirst: false,
  plyrInstance: null,
  pillPreset: null,
  currentPage: 1,
  isLoadingPage: false,
  currentCategory: null,
  currentFilters: {}
};

// ==========================================================================
// Dynamic Library Loaders
// ==========================================================================

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initWebTorrent() {
  if (window.WebTorrent) return window.WebTorrent;
  await loadScript('https://cdn.jsdelivr.net/npm/webtorrent@1.9.7/webtorrent.min.js');
  return window.WebTorrent;
}

async function initHls() {
  if (window.Hls) return window.Hls;
  await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.4.0/dist/hls.min.js');
  return window.Hls;
}

async function openInLocalPlayer(player, url, title = 'Stream') {
  showToast(`Launching ${player.toUpperCase()}...`, 'info');
  try {
    const path = player === 'vlc' 
      ? (state.preferences.vlcPath || '') 
      : (state.preferences.mpvPath || '');
    const args = player === 'vlc' 
      ? (state.preferences.vlcArgs || '') 
      : (state.preferences.mpvArgs || '');

    const res = await fetchWithAuth('/api/play/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player, url, path, args })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✅ Launched ${player.toUpperCase()}!`, 'success');
    } else {
      throw new Error(data.error || 'Failed to launch player');
    }
  } catch (err) {
    console.error(`Local launch for ${player} failed, trying custom protocol fallback...`, err);
    if (player === 'vlc') {
      openInVLC(url, title);
    } else {
      // Fallback to mpv:// protocol
      try {
        window.location.href = `mpv://${url}`;
      } catch (e) {
        showToast('Failed to open MPV. Please make sure it is installed.', 'error');
      }
    }
  }
}

// ==========================================================================
// VLC Native Integration
// ==========================================================================

function detectVLCNativeClient() {
  return new Promise((resolve) => {
    // Check if Open in VLC extension is installed
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage(
          state.vlcExtensionId,
          { action: 'ping' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.log('VLC extension not found:', chrome.runtime.lastError);
              resolve(false);
            } else {
              resolve(true);
            }
          }
        );
      } catch (e) {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
}

function openInVLC(magnet, title = 'Stream', options = {}) {
  console.log('Opening in VLC:', magnet);

  // Try native messaging first (Open in VLC extension)
  if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      const message = {
        action: 'open',
        url: magnet,
        title: title || 'Stream Vault',
        args: state.preferences.vlcArgs || ''
      };

      chrome.runtime.sendMessage(
        state.vlcExtensionId,
        message,
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('VLC extension error:', chrome.runtime.lastError);
            // Fallback to vlc:// protocol
            fallbackOpenInVLC(magnet);
          } else if (response && response.success) {
            showToast('✅ Opening in VLC...', 'success');
          } else {
            // Fallback to vlc:// protocol
            fallbackOpenInVLC(magnet);
          }
        }
      );
      return;
    } catch (e) {
      console.error('VLC native messaging error:', e);
      fallbackOpenInVLC(magnet);
    }
  } else {
    // Fallback to vlc:// protocol
    fallbackOpenInVLC(magnet);
  }
}

function fallbackOpenInVLC(magnet) {
  // Try vlc:// protocol
  try {
    const vlcUrl = `vlc://${magnet}`;
    window.location.href = vlcUrl;
    showToast('Opening VLC (fallback)...', 'info');
  } catch (e) {
    showToast('Failed to open VLC. Please install the Open in VLC extension.', 'error');
    // Copy magnet as fallback
    navigator.clipboard.writeText(magnet);
    showToast('Magnet copied to clipboard!', 'success');
  }
}

// Check if VLC extension is installed
async function checkVLCInstalled() {
  const installed = await detectVLCNativeClient();
  const vlcStatus = document.getElementById('vlcStatus');
  if (vlcStatus) {
    if (installed) {
      vlcStatus.textContent = '✅ VLC Native Client Connected';
      vlcStatus.style.color = '#4caf50';
    } else {
      vlcStatus.textContent = '⚠️ VLC Native Client Not Found - Using vlc:// protocol fallback';
      vlcStatus.style.color = '#ff9800';
    }
  }
  return installed;
}

// ==========================================================================
// Authentication Logic
// ==========================================================================
async function fetchWithAuth(url, options = {}) {
  const headers = options.headers || {};
  if (state.auth.token) {
    headers['Authorization'] = `Bearer ${state.auth.token}`;
  }
  return fetch(url, { ...options, headers });
}


let isSignUpMode = false;
function initAuthModal() {
  updateAuthUI();
  
  const modal = document.getElementById('authModalOverlay');
  const closeBtn = document.getElementById('authModalClose');
  const toggleBtn = document.getElementById('authToggleBtn');
  const form = document.getElementById('authForm');
  const title = document.getElementById('authModalTitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const errorDiv = document.getElementById('authError');

  if (!modal) return;

  closeBtn.onclick = () => modal.style.display = 'none';

  toggleBtn.onclick = () => {
    isSignUpMode = !isSignUpMode;
    title.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
    submitBtn.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
    toggleBtn.textContent = isSignUpMode ? 'Already have an account? Sign In' : "Don't have an account? Sign Up";
    errorDiv.style.display = 'none';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorDiv.style.display = 'none';
    const username = document.getElementById('authUsername').value;
    const password = document.getElementById('authPassword').value;
    
    setLoading(true);
    try {
      const endpoint = isSignUpMode ? '/api/auth/signup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      
      state.auth.token = data.token;
      state.auth.username = data.user.username;
      state.auth.isAdmin = data.user.isAdmin === true;
      localStorage.setItem('sv_token', data.token);
      localStorage.setItem('sv_username', data.user.username);
      localStorage.setItem('sv_isAdmin', state.auth.isAdmin);
      
      modal.style.display = 'none';
      updateAuthUI();
      
      // Load user data
      await loadUserData();
      window.location.reload();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
    } finally {
      setLoading(false);
    }
  };
}

async function loadUserData() {
  if (!state.auth.token) return;
  try {
    const res = await fetchWithAuth('/api/user/data');
    if (res.ok) {
      const data = await res.json();
      state.continueWatching = data.continueWatching || [];
      // we can optionally trigger a sync of local history to cloud here
    }
  } catch (e) {
    console.error('Failed to load user data', e);
  }
}

// ==========================================================================
// Utilities & UI Helpers
// ==========================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = '';
  if (type === 'success') icon = '✅';
  else if (type === 'error') icon = '❌';
  else if (type === 'warning') icon = '⚠️';
  else icon = 'ℹ️';

  toast.innerHTML = `
    <span style="margin-right: 8px;">${icon}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4000);
}

function setLoading(isLoading) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.display = isLoading ? 'flex' : 'none';
  }
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function parseQuality(title) {
  title = title.toLowerCase();
  if (title.includes('2160p') || title.includes('4k') || title.includes('uhd')) return '4K';
  if (title.includes('1080p') || title.includes('fhd')) return '1080p';
  if (title.includes('720p') || title.includes('hd')) return '720p';
  if (title.includes('480p') || title.includes('sd')) return '480p';
  const match = title.match(/(\d{3,4})p/);
  if (match) return match[0];
  return 'SD';
}

function parseExtension(title) {
  title = title.toLowerCase();
  if (title.includes('.mp4') || title.includes(' mp4')) return 'MP4';
  if (title.includes('.mkv') || title.includes(' mkv')) return 'MKV';
  if (title.includes('.avi') || title.includes(' avi')) return 'AVI';
  if (title.includes('.webm')) return 'WEBM';
  return ''; 
}

function parseSourceType(title) {
  title = title.toLowerCase();
  if (title.includes('web-dl') || title.includes('webdl')) return 'WEB-DL';
  if (title.includes('webrip') || title.includes(' web ')) return 'WEBRip';
  if (title.includes('remux')) return 'Remux';
  if (title.includes('bluray') || title.includes('blu-ray') || title.includes('bdrip') || title.includes('brrip')) return 'BluRay';
  if (title.includes('hdts') || title.includes(' telesync ') || title.includes(' ts ')) return 'HDTS';
  if (title.includes('camrip') || title.includes(' cam ')) return 'CAM';
  return '';
}

function getPosterUrl(path, size = 'w500') {
  if (!path) return 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=500&auto=format&fit=crop';
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function getBannerUrl(path) {
  if (!path) return 'https://images.unsplash.com/photo-1574375927938-d5a98e8edd85?q=80&w=1200&auto=format&fit=crop';
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/original${path}`;
}

// ==========================================================================
// Preferences & Theme Management
// ==========================================================================

function loadPreferences() {
  const savedPrefs = localStorage.getItem('sv_preferences');
  if (savedPrefs) {
    try {
      state.preferences = { ...state.preferences, ...JSON.parse(savedPrefs) };
    } catch (e) {
      console.error('Error parsing preferences:', e);
    }
  }

  const activeIds = Object.keys(INDEXERS).map(id => parseInt(id));
  if (!state.preferences.selectedIndexers || state.preferences.selectedIndexers.length === 0) {
    state.preferences.selectedIndexers = [2, 4, 5, 11]; // Direct scrapers by default. Prowlarr as second option.
  }

  if (localStorage.getItem('sv_player_migrated') !== 'torrserver_v3') {
    state.preferences.player = 'torrserver';
    localStorage.setItem('sv_player_migrated', 'torrserver_v3');
    savePreferences();
  }

  const savedWatching = localStorage.getItem('sv_continue_watching');
  if (savedWatching) {
    try {
      state.continueWatching = JSON.parse(savedWatching);
    } catch (e) {
      console.error('Error parsing continue watching:', e);
    }
  }

  applyTheme(state.preferences.theme);
  applyAccent(state.preferences.accent);
  syncHeaderIndexerSelectUI();
}

function populateHeaderIndexerSelect() {
  const selects = [
    document.getElementById('indexerSelect'),
    document.getElementById('drawerIndexerSelect')
  ].filter(Boolean);

  if (selects.length === 0) return;

  const onChange = (val) => {
    if (val === 'all') {
      state.preferences.selectedIndexers = Object.keys(INDEXERS).map(id => parseInt(id));
      showToast('Selected all indexers for search', 'success');
    } else {
      state.preferences.selectedIndexers = [parseInt(val)];
      showToast(`Active search provider: ${INDEXERS[val].name}`, 'success');
    }
    savePreferences();
    selects.forEach(s => { if (s.value !== val) s.value = val; });

    const torrentSection = document.getElementById('torrentSearchSection');
    if (torrentSection && torrentSection.style.display !== 'none' && state.lastTorrentQuery) {
      triggerTorrentSearch(state.lastTorrentQuery, state.lastTorrentCategory, state.lastTorrentEpisode, state.lastTorrentSeason);
    }
  };

  selects.forEach(select => {
    select.innerHTML = '<option value="all">All Indexers</option>';
    Object.keys(INDEXERS).forEach(id => {
      const idx = INDEXERS[id];
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = idx.name;
      select.appendChild(opt);
    });
    select.onchange = (e) => onChange(e.target.value);
  });

  syncHeaderIndexerSelectUI();
}

function syncHeaderIndexerSelectUI() {
  const selected = state.preferences.selectedIndexers || [];
  const val = selected.length === 1 ? selected[0] : 'all';
  ['indexerSelect', 'drawerIndexerSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
}

function savePreferences() {
  localStorage.setItem('sv_preferences', JSON.stringify(state.preferences));
}

function saveContinueWatching() {
  localStorage.setItem('sv_continue_watching', JSON.stringify(state.continueWatching));
  if (state.auth.token) {
    fetchWithAuth('/api/user/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ continueWatching: state.continueWatching })
    }).catch(e => console.error('Failed to sync history', e));
  }
  renderContinueWatching();
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', 'dark');
}

function applyAccent(accent) {
  const root = document.documentElement;
  if (accent === 'purple') {
    root.style.setProperty('--color-accent-primary', '#8b5cf6');
    root.style.setProperty('--color-accent-primary-hover', '#a78bfa');
    root.style.setProperty('--color-accent-primary-light', 'rgba(139, 92, 246, 0.2)');
    root.style.setProperty('--color-border-focus', '#8b5cf6');
    root.style.setProperty('--shadow-glow', '0 0 24px rgba(139, 92, 246, 0.15)');
  } else {
    root.style.setProperty('--color-accent-primary', '#3b82f6');
    root.style.setProperty('--color-accent-primary-hover', '#60a5fa');
    root.style.setProperty('--color-accent-primary-light', 'rgba(59, 130, 246, 0.2)');
    root.style.setProperty('--color-border-focus', '#3b82f6');
    root.style.setProperty('--shadow-glow', '0 0 24px rgba(59, 130, 246, 0.15)');
  }
}



// ==========================================================================
// Navigation & Routing
// ==========================================================================

function initNavigation() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const sideDrawer = document.getElementById('sideDrawer');
  const sideDrawerOverlay = document.getElementById('sideDrawerOverlay');

  const toggleDrawer = () => {
    if (!sideDrawer) return;
    sideDrawer.classList.toggle('open');
    if (sideDrawerOverlay) sideDrawerOverlay.classList.toggle('open');
  };

  const closeDrawer = () => {
    if (!sideDrawer) return;
    sideDrawer.classList.remove('open');
    if (sideDrawerOverlay) sideDrawerOverlay.classList.remove('open');
  };

  if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleDrawer);
  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
  if (sideDrawerOverlay) sideDrawerOverlay.addEventListener('click', closeDrawer);

  document.querySelectorAll('.drawer-link').forEach(link => {
    link.addEventListener('click', closeDrawer);
  });

  // Drawer collapsible sections
  document.querySelectorAll('.drawer-collapse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) {
        target.classList.toggle('open');
        btn.classList.toggle('open');
      }
    });
  });

  const detailBack = document.getElementById('detailBack');
  if (detailBack) {
    detailBack.addEventListener('click', () => {
      const prev = state.previousView || 'home';
      navigateTo(prev);
    });
  }
}

function handleRouting() {
  const hash = window.location.hash || '#/home';
  console.log('Routing to hash:', hash);

  // Close search suggestions overlay
  const suggestions = document.getElementById('searchSuggestions');
  if (suggestions) suggestions.classList.remove('active');

  if (hash.startsWith('#/detail/')) {
    // Format: #/detail/:type/:id
    const parts = hash.split('/');
    const type = parts[2];
    const id = parts[3];
    if (type && id) {
      openDetailsView(id, type);
    }
  } else if (hash.startsWith('#/search')) {
    // Format: #/search?q=query
    const queryIdx = hash.indexOf('?q=');
    if (queryIdx !== -1) {
      const query = decodeURIComponent(hash.substring(queryIdx + 3));
      navigateTo('search', query);
    } else {
      navigateTo('home');
    }
  } else {
    // Standard views: #/home, #/anime, #/movies, #/tv, etc.
    const viewId = hash.replace('#/', '');
    const validViews = ['home', 'anime', 'movies', 'tv', 'schedule', 'catalog', 'settings', 'suggestions'];
    if (validViews.includes(viewId)) {
      navigateTo(viewId);
    } else {
      navigateTo('home');
    }
  }
}

function navigateTo(viewId, extraData = null) {
  state.previousView = state.currentView || 'home';
  state.currentView = viewId;

  // Sync nav active classes
  document.querySelectorAll('.nav-item, .drawer-link').forEach(el => {
    if (el.getAttribute('data-view') === viewId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Switch active view container
  document.querySelectorAll('.view').forEach(el => {
    if (el.id === `${viewId}View`) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  if (viewId !== 'detail') {
    const detailView = document.getElementById('detailView');
    if (detailView) {
      detailView.style.display = 'none';
      document.getElementById('mainContent').style.overflow = '';
    }
    // Stop any playing video
    const playerContainer = document.getElementById('theaterPlayerContainer');
    if (playerContainer) playerContainer.innerHTML = '';
    const playerModal = document.getElementById('playerModal');
    if (playerModal) playerModal.style.display = 'none';
    if (state.webTorrentClient) {
      state.webTorrentClient.destroy();
      state.webTorrentClient = null;
    }
    const trailerIframe = document.getElementById('trailerIframe');
    if (trailerIframe) trailerIframe.remove();
  }

  const suggestions = document.getElementById('searchSuggestions');
  if (suggestions) suggestions.classList.remove('active');

  // Trigger content loading
  switch (viewId) {
    case 'home': loadHomeView(); break;
    case 'anime': loadAnimeView(); break;
    case 'movies': loadMoviesView(); break;
    case 'tv': loadTVView(); break;
    case 'schedule': loadScheduleView(); break;
    case 'catalog': loadCatalogView(); break;
    case 'settings': loadSettingsView(); break;
    case 'search': loadSearchView(extraData); break;
    case 'suggestions': loadSuggestionsView(); break;
  }
}

// ==========================================================================
// Hero Banner slideshow rendering
// ==========================================================================
let heroInterval = null;

function renderHeroBanner(featuredList) {
  const container = document.getElementById('heroBannerContainer');
  if (!container) return;

  if (heroInterval) clearInterval(heroInterval);
  container.innerHTML = '';

  featuredList = filterAdult(featuredList);
  if (!featuredList || featuredList.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'hero-controls';
  
  const dotsDiv = document.createElement('div');
  dotsDiv.className = 'hero-dots';
  dotsContainer.appendChild(dotsDiv);

  // Arrow buttons
  const leftArrow = document.createElement('button');
  leftArrow.className = 'hero-arrow hero-arrow-left';
  leftArrow.setAttribute('aria-label', 'Previous slide');
  leftArrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>';

  const rightArrow = document.createElement('button');
  rightArrow.className = 'hero-arrow hero-arrow-right';
  rightArrow.setAttribute('aria-label', 'Next slide');
  rightArrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  container.appendChild(leftArrow);
  container.appendChild(rightArrow);

  featuredList.forEach((item, index) => {
    const slide = document.createElement('div');
    slide.className = `hero-slide ${index === 0 ? 'active' : ''}`;
    slide.dataset.index = index;

    const cleanDesc = item.overview ? item.overview.replace(/<[^>]*>/g, '') : 'No description available.';

    slide.innerHTML = `
      <div class="hero-backdrop" style="background-image: url('${item.backdrop || item.poster}')"></div>
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <div class="hero-badge-row">
          <span class="detail-type-badge">${item.type}</span>
          <span style="font-weight: 500; font-size: var(--font-size-sm); color: #fff;">⭐ ${item.rating}</span>
        </div>
        <h2 class="hero-title">${item.title}</h2>
        <p class="hero-synopsis">${cleanDesc}</p>
        <div class="hero-actions">
          <button class="detail-action-btn hero-play-btn">▶ Play</button>
          <button class="detail-action-btn secondary hero-details-btn">🔍 View Details</button>
        </div>
      </div>
    `;

    slide.querySelector('.hero-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.hash = `#/detail/${item.type}/${item.id}`;
    });

    slide.querySelector('.hero-details-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.hash = `#/detail/${item.type}/${item.id}`;
    });

    container.appendChild(slide);

    const dot = document.createElement('span');
    dot.className = `hero-dot ${index === 0 ? 'active' : ''}`;
    dot.dataset.index = index;
    dot.addEventListener('click', () => {
      goToSlide(index);
    });
    dotsDiv.appendChild(dot);
  });

  container.appendChild(dotsContainer);

  let currentSlide = 0;
  const slides = container.querySelectorAll('.hero-slide');
  const dots = container.querySelectorAll('.hero-dot');

  function goToSlide(index) {
    if (index < 0) index = slides.length - 1;
    if (index >= slides.length) index = 0;
    currentSlide = index;
    slides.forEach((slide, i) => {
      if (i === index) slide.classList.add('active');
      else slide.classList.remove('active');
    });
    dots.forEach((dot, i) => {
      if (i === index) dot.classList.add('active');
      else dot.classList.remove('active');
    });
    clearInterval(heroInterval);
    heroInterval = setInterval(() => {
      currentSlide = (currentSlide + 1) % slides.length;
      goToSlide(currentSlide);
    }, 4000);
  }

  leftArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    goToSlide(currentSlide - 1);
  });
  rightArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    goToSlide(currentSlide + 1);
  });

  // Swipe support
  let startX = 0;
  let isDragging = false;
  const onSwipeStart = (x) => { startX = x; isDragging = true; };
  const onSwipeEnd = (x) => {
    if (!isDragging) return;
    isDragging = false;
    const diff = startX - x;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goToSlide(currentSlide + 1);
      else goToSlide(currentSlide - 1);
    }
  };
  container.addEventListener('mousedown', (e) => onSwipeStart(e.clientX));
  container.addEventListener('mousemove', (e) => { if (isDragging) e.preventDefault(); });
  container.addEventListener('mouseup', (e) => onSwipeEnd(e.clientX));
  container.addEventListener('mouseleave', () => { isDragging = false; });
  container.addEventListener('touchstart', (e) => onSwipeStart(e.touches[0].clientX), { passive: true });
  container.addEventListener('touchend', (e) => onSwipeEnd(e.changedTouches[0].clientX), { passive: true });

  heroInterval = setInterval(() => {
    currentSlide = (currentSlide + 1) % slides.length;
    goToSlide(currentSlide);
  }, 4000);
}

async function playFeaturedTrailer(featuredItem) {
  setLoading(true);
  try {
    let trailerUrl = '';
    let title = featuredItem.title;
    if (featuredItem.type === 'anime') {
      const res = await fetch(`/api/anime/${featuredItem.id}`);
      const details = await res.json();
      if (details.trailer?.site === 'youtube') {
        trailerUrl = `https://www.youtube.com/embed/${details.trailer.id}?autoplay=1`;
      }
    } else {
      const res = await fetch(`/api/media/${featuredItem.type}/${featuredItem.id}`);
      const details = await res.json();
      const trailer = details.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        trailerUrl = `https://www.youtube.com/embed/${trailer.key}?autoplay=1`;
      }
    }

    if (trailerUrl) {
      playStream(`${title} - Trailer`, trailerUrl, { isYoutube: true });
    } else {
      showToast('No trailer available for this item.', 'warning');
    }
  } catch (err) {
    showToast('Failed to load trailer.', 'error');
  } finally {
    setLoading(false);
  }
}

// ==========================================================================
// Dedicated Search View
// ==========================================================================
async function loadSearchView(query) {
  const title = document.getElementById('searchViewTitle');
  if (title) title.textContent = `Search Results for "${query}"`;

  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = query;

  const animeSection = document.getElementById('searchAnimeSection');
  const mediaSection = document.getElementById('searchMediaSection');
  const noResults = document.getElementById('searchNoResults');
  
  const animeGrid = document.getElementById('searchAnimeGrid');
  const mediaGrid = document.getElementById('searchMediaGrid');

  if (animeSection) animeSection.style.display = 'none';
  if (mediaSection) mediaSection.style.display = 'none';
  if (noResults) noResults.style.display = 'none';

  setLoading(true);
  try {
    const selectedIndexers = state.preferences.selectedIndexers.join(',');
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&indexers=${selectedIndexers}&type=all`);
    const data = await res.json();

    let animeResults = filterAdult(data.anime || []);
    // Always merge TMDB fallback anime results for broader matches
    if (data.anime_fallback && data.anime_fallback.length > 0) {
      const seen = new Set(animeResults.map(a => (a.id?.toString() || '') + (a.title?.romaji || a.title?.english || a.title?.native || '')));
      data.anime_fallback.forEach(item => {
        const key = (item.id?.toString() || '') + (item.title || item.name || '');
        if (!seen.has(key)) {
          animeResults.push(item);
          seen.add(key);
        }
      });
    }
    let mediaResults = filterAdult(data.media || []);
    mediaResults = mediaResults.filter(item => !(item.original_language === 'ja' && Array.isArray(item.genre_ids) && item.genre_ids.includes(16)));
    let hasAnime = animeResults.length > 0;
    let hasMedia = mediaResults.length > 0;

    if (hasAnime && animeGrid) {
      animeGrid.innerHTML = '';
      animeResults.forEach(item => {
        animeGrid.appendChild(createMediaCard(item, 'anime'));
      });
      animeSection.style.display = 'block';
    }

    if (hasMedia && mediaGrid) {
      mediaGrid.innerHTML = '';
      mediaResults.forEach(item => {
        const isMovie = item.media_type === 'movie' || !item.first_air_date;
        mediaGrid.appendChild(createMediaCard(item, isMovie ? 'movie' : 'tv'));
      });
      mediaSection.style.display = 'block';
    }

    if (!hasAnime && !hasMedia && noResults) {
      noResults.style.display = 'block';
    }
  } catch (err) {
    showToast('Failed to load search results', 'error');
  } finally {
    setLoading(false);
  }
}

// ==========================================================================
// Card Rendering Functions
// ==========================================================================

function createMediaCard(item, type) {
  const card = document.createElement('div');
  card.className = 'media-card poster-card';

  let title = '';
  let rating = 0;
  let poster = '';
  let id = '';

  if (type === 'anime') {
    id = item.id;
    // Handle both AniList and TMDB fallback items
    if (item.title && typeof item.title === 'object') {
      title = item.title.english || item.title.romaji || item.title.native;
    } else {
      title = item.title || item.name || item.original_title || item.original_name || 'Unknown';
    }
    rating = item.averageScore ? (item.averageScore / 10).toFixed(1) : (item.vote_average ? item.vote_average.toFixed(1) : 'N/A');
    poster = item.coverImage?.large || item.coverImage?.medium || getPosterUrl(item.poster_path);
  } else if (type === 'movie' || type === 'tv') {
    id = item.id;
    title = type === 'movie' ? (item.title || item.original_title) : (item.name || item.original_name);
    rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
    poster = getPosterUrl(item.poster_path);
  } else if (type === 'catalog') {
    id = item.id;
    title = item.title;
    rating = 'HTTP';
    poster = getPosterUrl(item.poster);
  }

  card.innerHTML = `
    <img class="media-poster" src="${poster}" alt="${title}" loading="lazy">
    <div class="media-overlay">
      <div class="media-overlay-content">
        <h4 class="media-title" title="${title}">${title}</h4>
        <div class="media-meta">
          <span class="media-rating">⭐ ${rating}</span>
          <span class="media-type">${type}</span>
        </div>
      </div>
    </div>
  `;

  card.addEventListener('click', () => {
    if (type === 'catalog') {
      if (item.type && item.type !== 'direct' && item.mediaId) {
        window.location.hash = `#/detail/${item.type}/${item.mediaId}`;
      } else {
        playStream(item.title, item.url, item);
      }
    } else {
      window.location.hash = `#/detail/${type}/${id}`;
    }
  });

  return card;
}

function renderContinueWatching() {
  const section = document.getElementById('continueWatchingSection');
  const grid = document.getElementById('continueWatchingGrid');
  if (!section || !grid) return;

  if (state.continueWatching.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  grid.innerHTML = '';

  state.continueWatching.slice(0, 5).forEach(item => {
    const card = document.createElement('div');
    card.className = 'continue-card';
    card.style.cursor = 'pointer';

    const progressPercent = item.duration ? ((item.currentTime / item.duration) * 100).toFixed(0) : 0;

    let episodeLabel = '';
    if (item.type === 'anime' || item.type === 'tv') {
      episodeLabel = `Season ${item.seasonNumber || 1} Ep ${item.episodeNumber}`;
    } else {
      episodeLabel = 'Movie';
    }

    card.innerHTML = `
      <img class="continue-poster" src="${getPosterUrl(item.poster)}" alt="${item.title}">
      <div class="continue-info">
        <h4 class="continue-title" title="${item.title}">${item.title}</h4>
        <div class="continue-progress">${episodeLabel} - ${progressPercent}% watched</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progressPercent}%"></div>
        </div>
      </div>
      <button class="media-action-btn continue-play-btn" title="Resume playback">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
    `;

    card.addEventListener('click', () => {
      openDetailsView(item.id, item.type);
    });

    card.querySelector('.continue-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailsView(item.id, item.type, item);
    });

    grid.appendChild(card);
  });
}

async function renderMyList() {
  const section = document.getElementById('myListSection');
  const grid = document.getElementById('myListGrid');
  if (!section || !grid) return;

  try {
    const endpoint = state.auth.token ? '/api/user/catalog' : '/api/catalog';
    const res = await fetchWithAuth(endpoint);
    if (res.ok) {
      const catalog = await res.json();
      if (catalog.length === 0) {
        section.style.display = 'none';
        return;
      }
      section.style.display = 'block';
      grid.innerHTML = '';
      catalog.slice(0, 10).forEach(item => {
        const card = createMediaCard(item, 'catalog');
        grid.appendChild(card);
      });
    } else {
      section.style.display = 'none';
    }
  } catch (err) {
    section.style.display = 'none';
  }
}

// ==========================================================================
// Views Implementations
// ==========================================================================

async function loadHomeView() {
  renderContinueWatching();
  renderMyList();

  const grids = {
    anime: document.getElementById('sectionAnimeGrid'),
    bollyMovies: document.getElementById('sectionBollyMoviesGrid'),
    hollyMovies: document.getElementById('sectionHollyMoviesGrid'),
    hollyTV: document.getElementById('sectionHollyTVGrid'),
    torrents: document.getElementById('recentTorrentsGrid')
  };

  const fillSkeletons = (el, count = 16) => {
    if (el) el.innerHTML = Array(count).fill('<div class="media-card poster-card skeleton"></div>').join('');
  };

  Object.values(grids).forEach(g => { if (g && g !== grids.torrents) fillSkeletons(g); });
  if (grids.torrents) fillSkeletons(grids.torrents, 8);

  try {
    const res = await fetch('/api/trending');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();

    const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error('Home section error:', e.message, e.stack); return fallback; } };

    if (data.featured) {
      try { renderHeroBanner(data.featured); } catch (e) { console.error('Hero error:', e); }
    }

    const gridRows = getGridCount(3);
    const populateGrid = (grid, items, type, emptyMsg) => {
      if (!grid) return;
      grid.innerHTML = '';
      if (items && items.length > 0) {
        items.slice(0, gridRows).forEach(item => grid.appendChild(createMediaCard(item, type)));
      } else {
        grid.innerHTML = `<div class="empty-state"><p>${emptyMsg}</p></div>`;
      }
    };

    const sortByDate = (items) => (items || []).slice().sort((a, b) => {
      const da = a.release_date || a.first_air_date || a.startDate?.year || '';
      const db = b.release_date || b.first_air_date || b.startDate?.year || '';
      return db.toString().localeCompare(da.toString());
    });

    const dedup = (items) => {
      const seen = new Set();
      return (items || []).filter(item => {
        const key = item.id?.toString() + '_' + (item.media_type || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const noAnime = (items) => (items || []).filter(item => !(item.original_language === 'ja' && Array.isArray(item.genre_ids) && item.genre_ids.includes(16)));

    safe(() => populateGrid(grids.anime, sortByDate(filterAdult(data.airingAnime)), 'anime', 'No anime found'));
    safe(() => populateGrid(grids.bollyMovies, sortByDate(filterAdult(data.hindiMovies)), 'movie', 'No Bollywood movies found'));
    safe(() => populateGrid(grids.hollyMovies, dedup(noAnime(filterAdult(data.movies))), 'movie', 'No movies found'));
    safe(() => populateGrid(grids.hollyTV, dedup(noAnime(filterAdult(data.tv))), 'tv', 'No TV shows found'));

    safe(() => {
      if (grids.torrents) {
        grids.torrents.innerHTML = '';
        if (data.torrents && data.torrents.length > 0) {
          data.torrents.slice(0, gridRows).forEach(item => {
            const card = document.createElement('div');
            card.className = 'torrent-item';
            const q = parseQuality(item.title);
            const e = parseExtension(item.title);
            card.innerHTML = `
              <div class="torrent-info">
                <h4 class="torrent-title" title="${item.title}">${item.title}</h4>
                <div class="torrent-meta">
                  <span class="torrent-quality">${q}</span>${e ? `<span class="torrent-quality">${e}</span>` : ''}
                  <span class="torrent-size">${formatBytes(item.size)}</span>
                  <span class="torrent-seeders">⬆ ${item.seeders}</span>
                  <span>${item.source}</span>
                </div>
              </div>
              <div class="torrent-actions">
                <button class="torrent-btn play-btn" title="Play">▶</button>
                <button class="torrent-btn vlc-btn" title="VLC">🎬</button>
                <button class="torrent-btn mpv-btn" title="MPV">📺</button>
                <button class="torrent-btn magnet-btn" title="Magnet">📋</button>
              </div>`;
            card.querySelector('.play-btn').addEventListener('click', () => playTorrent(item.title, item.magnet, { title: item.title, poster: '' }));
            card.querySelector('.vlc-btn').addEventListener('click', () => resolveTorrentAndPlay(item.magnet, 'vlc', item.title));
            card.querySelector('.mpv-btn').addEventListener('click', () => resolveTorrentAndPlay(item.magnet, 'mpv', item.title));
            card.querySelector('.magnet-btn').addEventListener('click', () => { navigator.clipboard.writeText(item.magnet); showToast('Copied!', 'success'); });
            grids.torrents.appendChild(card);
          });
        } else {
          grids.torrents.innerHTML = '<div class="empty-state"><p>No recent torrents found.</p></div>';
        }
      }
    });

    // Wire per-section filter pills
    safe(() => {
      const sectionConfig = {
        filterAnime: {
          trending: { items: data.anime, type: 'anime', grid: 'sectionAnimeGrid' },
          airing: { items: data.airingAnime, type: 'anime', grid: 'sectionAnimeGrid' },
          upcoming: { items: data.upcomingAnime, type: 'anime', grid: 'sectionAnimeGrid' }
        },
        filterBollyMovies: {
          latest: { items: data.hindiMovies, type: 'movie', grid: 'sectionBollyMoviesGrid' },
          upcoming: { items: data.upcomingHindiMovies, type: 'movie', grid: 'sectionBollyMoviesGrid' }
        },
        filterHollyMovies: {
          trending: { items: data.movies, type: 'movie', grid: 'sectionHollyMoviesGrid' },
          top: { items: data.topRatedMovies, type: 'movie', grid: 'sectionHollyMoviesGrid' },
          upcoming: { items: data.upcomingMovies, type: 'movie', grid: 'sectionHollyMoviesGrid' }
        },
        filterHollyTV: {
          trending: { items: data.tv, type: 'tv', grid: 'sectionHollyTVGrid' },
          top: { items: data.topRatedTV, type: 'tv', grid: 'sectionHollyTVGrid' }
        }
      };

      Object.entries(sectionConfig).forEach(([filterId, types]) => {
        const pills = document.querySelectorAll(`#${filterId} .filter-pill`);
        pills.forEach(btn => {
          btn.addEventListener('click', () => {
            pills.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const cfg = types[btn.dataset.type];
            if (cfg) {
              const g = document.getElementById(cfg.grid);
              if (g) {
                g.innerHTML = '';
                let items = filterAdult(cfg.items);
                if (cfg.type === 'movie' || cfg.type === 'tv') {
                  items = noAnime(items);
                  items = dedup(items);
                }
                // Only sort by date for sections where date order makes sense
                if (btn.dataset.type === 'upcoming' || btn.dataset.type === 'airing' || btn.dataset.type === 'latest') {
                  items = sortByDate(items);
                }
                if (items.length > 0) {
                  items.slice(0, gridRows).forEach(item => g.appendChild(createMediaCard(item, cfg.type)));
                } else {
                  g.innerHTML = '<div class="empty-state"><p>No results</p></div>';
                }
              }
            }
          });
        });
      });

      // Section pill passthrough: View All links carry active pill state
      document.querySelectorAll('.section-link').forEach(link => {
        link.addEventListener('click', (e) => {
          const section = link.closest('.content-section');
          if (!section) return;
          const activePill = section.querySelector('.filter-pill.active');
          if (!activePill) return;
          const pillType = activePill.dataset.type;
          const targetView = link.dataset.view;
          const sectionId = section.id || '';
          const language = sectionId.includes('Bolly') ? 'hi' : '';
          if (pillType && targetView) {
            state.pillPreset = { view: targetView, type: pillType, language };
          }
        });
      });
    });

  } catch (err) {
    console.error(err);
    showToast('Failed to fetch home feed', 'error');
  }
}

function populateYearFilters(selectId) {
  const select = document.getElementById(selectId);
  if (!select || select.children.length > 1) return;

  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1990; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    select.appendChild(opt);
  }
}

async function loadAnimeView(page = 1) {
  const grid = document.getElementById('animeGrid');
  if (page === 1) {
    grid.innerHTML = Array(20).fill('<div class="media-card poster-card skeleton"></div>').join('');
    state.currentPage = 1;
    state.currentCategory = 'anime';
  } else {
    const skeletonHTML = Array(10).fill('<div class="media-card poster-card skeleton"></div>').join('');
    grid.insertAdjacentHTML('beforeend', skeletonHTML);
    state.currentPage = page;
  }
  
  state.isLoadingPage = true;
  populateYearFilters('animeYearFilter');

  // Apply pill preset if coming from section View All
  if (page === 1 && state.pillPreset && state.pillPreset.view === 'anime') {
    const statusMap = { trending: '', airing: 'RELEASING', upcoming: 'NOT_YET_RELEASED' };
    const presetStatus = statusMap[state.pillPreset.type] || '';
    document.getElementById('animeStatusFilter').value = presetStatus;
    state.pillPreset = null;
  }

  const genre = document.getElementById('animeGenreFilter')?.value || '';
  const season = document.getElementById('animeSeasonFilter').value;
  const year = document.getElementById('animeYearFilter').value;
  const status = document.getElementById('animeStatusFilter').value;

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let url = '';
    
    if (searchString) {
      if (page > 1) { state.isLoadingPage = false; return; }
      const selectedIndexers = state.preferences.selectedIndexers.join(',');
      url = `/api/search?type=anime&indexers=${selectedIndexers}&q=${encodeURIComponent(searchString)}`;
    } else {
      url = `/api/discover?type=anime&page=${page}`;
      if (year) url += `&year=${year}`;
      if (season) url += `&season=${season}`;
      if (status) url += `&status=${status}`;
      if (genre) url += `&genre=${encodeURIComponent(genre)}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    let items = searchString ? data.anime : data.media;

    if (page === 1) {
      grid.innerHTML = '';
    } else {
      const skeletons = grid.querySelectorAll('.skeleton');
      skeletons.forEach(s => s.remove());
    }

    if (items && items.length > 0) {
      let filtered = items;
      if (searchString) {
        if (season) filtered = filtered.filter(item => item.season === season);
        if (year) filtered = filtered.filter(item => item.startDate?.year == year);
        if (status) filtered = filtered.filter(item => item.status === status);
      }

      filtered = filterAdult(filtered);
      filtered.forEach(item => {
        grid.appendChild(createMediaCard(item, 'anime'));
      });
      
      if (!searchString && items.length > 0) {
        observeLastItem(grid, 'anime');
      }
      
      if (filtered.length === 0 && page === 1) {
        grid.innerHTML = '<div class="empty-state"><h3>No matches found</h3><p>Try modifying your filters.</p></div>';
      }
    } else if (page === 1) {
      grid.innerHTML = '<div class="empty-state"><h3>No results</h3><p>Could not fetch anime data.</p></div>';
    }
  } catch (err) {
    if (page === 1) grid.innerHTML = '<div class="error-state"><h3>Error loading</h3><p>Failed to retrieve anime.</p></div>';
  }
  state.isLoadingPage = false;
}

function observeLastItem(grid, type) {
  const observer = new IntersectionObserver((entries, obs) => {
    const last = entries[0];
    if (last.isIntersecting && !state.isLoadingPage) {
      obs.disconnect();
      const nextPage = state.currentPage + 1;
      
      if (type === 'movies') loadMoviesView(nextPage);
      else if (type === 'tv') loadTVView(nextPage);
      else if (type === 'anime') loadAnimeView(nextPage);
    }
  }, { rootMargin: '200px' });
  
  const lastElement = grid.lastElementChild;
  if (lastElement) {
    observer.observe(lastElement);
  }
}

async function loadMoviesView(page = 1) {
  const grid = document.getElementById('moviesGrid');
  if (page === 1) {
    grid.innerHTML = Array(20).fill('<div class="media-card poster-card skeleton"></div>').join('');
    state.currentPage = 1;
    state.currentCategory = 'movies';
  } else {
    const skeletonHTML = Array(10).fill('<div class="media-card poster-card skeleton"></div>').join('');
    grid.insertAdjacentHTML('beforeend', skeletonHTML);
    state.currentPage = page;
  }
  
  state.isLoadingPage = true;
  populateYearFilters('movieYearFilter');

  const year = document.getElementById('movieYearFilter').value;
  const genre = document.getElementById('movieGenreFilter').value;
  // Apply pill preset for Bollywood → Hindi
  if (page === 1 && state.pillPreset && state.pillPreset.view === 'movies') {
    if (state.pillPreset.language) {
      document.getElementById('movieLanguageFilter').value = state.pillPreset.language;
    }
    state.pillPreset = null;
  }

  const language = document.getElementById('movieLanguageFilter')?.value || '';

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let url = '';
    
    if (searchString) {
      if (page > 1) { state.isLoadingPage = false; return; }
      url = `/api/search?type=movie&q=${encodeURIComponent(searchString)}`;
      if (language) url += `&language=${language}`;
    } else {
      url = `/api/discover?type=movie&page=${page}`;
      if (year) url += `&year=${year}`;
      if (genre) url += `&genre=${genre}`;
      if (language) url += `&language=${language}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    let items = searchString ? data.media : data.media;

    if (page === 1) {
      grid.innerHTML = '';
    } else {
      const skeletons = grid.querySelectorAll('.skeleton');
      skeletons.forEach(s => s.remove());
    }

    if (items && items.length > 0) {
      let filtered = items;
      if (searchString) {
        filtered = filtered.filter(item => !item.media_type || item.media_type === 'movie');
        if (year) filtered = filtered.filter(item => (item.release_date || '').startsWith(year));
        if (genre) filtered = filtered.filter(item => item.genre_ids && item.genre_ids.includes(parseInt(genre)));
      }

      if (page === 1 && !searchString) {
        populateGenres(items, 'movieGenreFilter');
      }

      filtered = filterAdult(filtered).filter(item => !(item.original_language === 'ja' && Array.isArray(item.genre_ids) && item.genre_ids.includes(16)));
      filtered.forEach(item => {
        grid.appendChild(createMediaCard(item, 'movie'));
      });
      
      if (!searchString && items.length > 0) {
        observeLastItem(grid, 'movies');
      }
      
      if (filtered.length === 0 && page === 1) {
        grid.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try resetting filters.</p></div>';
      }
    } else if (page === 1) {
      grid.innerHTML = '<div class="empty-state"><h3>No Movies</h3><p>Configure your TMDB API Key in environment.</p></div>';
    }
  } catch (err) {
    if (page === 1) grid.innerHTML = '<div class="error-state"><h3>Error loading</h3><p>Failed to connect to TMDB.</p></div>';
  }
  state.isLoadingPage = false;
}

async function loadTVView(page = 1) {
  const grid = document.getElementById('tvGrid');
  if (page === 1) {
    grid.innerHTML = Array(20).fill('<div class="media-card poster-card skeleton"></div>').join('');
    state.currentPage = 1;
    state.currentCategory = 'tv';
  } else {
    const skeletonHTML = Array(10).fill('<div class="media-card poster-card skeleton"></div>').join('');
    grid.insertAdjacentHTML('beforeend', skeletonHTML);
    state.currentPage = page;
  }
  
  state.isLoadingPage = true;
  populateYearFilters('tvYearFilter');

  const year = document.getElementById('tvYearFilter').value;
  const genre = document.getElementById('tvGenreFilter').value;
  if (page === 1 && state.pillPreset && state.pillPreset.view === 'tv') {
    if (state.pillPreset.language) {
      document.getElementById('tvLanguageFilter').value = state.pillPreset.language;
    }
    state.pillPreset = null;
  }

  const language = document.getElementById('tvLanguageFilter')?.value || '';

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let url = '';
    
    if (searchString) {
      if (page > 1) { state.isLoadingPage = false; return; }
      url = `/api/search?type=tv&q=${encodeURIComponent(searchString)}`;
      if (language) url += `&language=${language}`;
    } else {
      url = `/api/discover?type=tv&page=${page}`;
      if (year) url += `&year=${year}`;
      if (genre) url += `&genre=${genre}`;
      if (language) url += `&language=${language}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    let items = searchString ? data.media : data.media;

    if (page === 1) {
      grid.innerHTML = '';
    } else {
      const skeletons = grid.querySelectorAll('.skeleton');
      skeletons.forEach(s => s.remove());
    }

    if (items && items.length > 0) {
      let filtered = items;
      if (searchString) {
        filtered = filtered.filter(item => !item.media_type || item.media_type === 'tv');
        if (year) filtered = filtered.filter(item => (item.first_air_date || '').startsWith(year));
        if (genre) filtered = filtered.filter(item => item.genre_ids && item.genre_ids.includes(parseInt(genre)));
      }

      if (page === 1 && !searchString) {
        populateGenres(items, 'tvGenreFilter');
      }

      filtered = filterAdult(filtered).filter(item => !(item.original_language === 'ja' && Array.isArray(item.genre_ids) && item.genre_ids.includes(16)));
      filtered.forEach(item => {
        grid.appendChild(createMediaCard(item, 'tv'));
      });
      
      if (!searchString && items.length > 0) {
        observeLastItem(grid, 'tv');
      }
      
      if (filtered.length === 0 && page === 1) {
        grid.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try resetting filters.</p></div>';
      }
    } else if (page === 1) {
      grid.innerHTML = '<div class="empty-state"><h3>No TV Shows</h3><p>Configure your TMDB API Key in environment.</p></div>';
    }
  } catch (err) {
    if (page === 1) grid.innerHTML = '<div class="error-state"><h3>Error loading</h3><p>Failed to connect to TMDB.</p></div>';
  }
  state.isLoadingPage = false;
}

function populateGenres(items, selectId) {
  const select = document.getElementById(selectId);
  if (!select || select.children.length > 1) return;

  const TMDB_GENRES = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
    99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
    27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
    10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
    10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
    10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
  };

  const foundIds = new Set();
  items.forEach(item => {
    if (item.genre_ids) {
      item.genre_ids.forEach(id => foundIds.add(id));
    }
  });

  foundIds.forEach(id => {
    if (TMDB_GENRES[id]) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = TMDB_GENRES[id];
      select.appendChild(opt);
    }
  });
}

async function loadScheduleView() {
  const container = document.getElementById('scheduleContainer');
  container.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  try {
    const res = await fetch('/api/schedule');
    const schedule = await res.json();

    const timezone = document.getElementById('scheduleTimezone').value;
    renderScheduleCalendar(schedule, timezone);
  } catch (err) {
    container.innerHTML = '<div class="error-state"><h3>Failed to load schedule</h3><p>Could not reach AniList.</p></div>';
  }
}

function renderScheduleCalendar(schedule, timezone) {
  const container = document.getElementById('scheduleContainer');
  container.innerHTML = '';

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayGroups = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  schedule.forEach(item => {
    const airingTime = item.airingAt * 1000;
    const date = new Date(airingTime);
    let day = date.getDay();
    let hours = date.getHours();

    if (timezone === 'UTC') {
      day = date.getUTCDay();
      hours = date.getUTCHours();
    } else if (timezone === 'JST') {
      const jstDate = new Date(airingTime + (9 * 60 * 60 * 1000));
      day = jstDate.getUTCDay();
      hours = jstDate.getUTCHours();
    }

    dayGroups[day].push({ ...item, displayHours: hours, dateObj: date });
  });

  const today = new Date().getDay();

  daysOfWeek.forEach((dayName, idx) => {
    const dayCol = document.createElement('div');
    dayCol.className = `schedule-day ${idx === today ? 'today' : ''}`;

    const nextDate = new Date();
    const currentDay = nextDate.getDay();
    const distance = idx - currentDay;
    nextDate.setDate(nextDate.getDate() + distance);
    const formattedDate = nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    dayCol.innerHTML = `
      <div class="schedule-day-header">
        <div class="schedule-day-name">${dayName}</div>
        <div class="schedule-day-date">${formattedDate}</div>
      </div>
      <div class="schedule-items" id="schedule-items-${idx}"></div>
    `;

    const itemsContainer = dayCol.querySelector(`.schedule-items`);
    const dayItems = dayGroups[idx].sort((a, b) => a.airingAt - b.airingAt);

    if (dayItems.length === 0) {
      itemsContainer.innerHTML = '<p class="empty-schedule">No airing anime</p>';
    } else {
      dayItems.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'schedule-item';

        const pad = (num) => String(num).padStart(2, '0');
        let timeStr = '';
        if (timezone === 'local') {
          timeStr = `${pad(item.dateObj.getHours())}:${pad(item.dateObj.getMinutes())}`;
        } else {
          timeStr = `${pad(item.displayHours)}:00`;
        }

        const title = item.media.title.english || item.media.title.romaji || item.media.title.native;

        itemDiv.innerHTML = `
          <div class="schedule-time">${timeStr}</div>
          <div class="schedule-info">
            <h5 class="schedule-title" title="${title}">${title}</h5>
            <div class="schedule-meta">
              <span class="schedule-episode">EP ${item.episode}</span>
            </div>
          </div>
        `;

        itemDiv.addEventListener('click', () => {
          openDetailsView(item.media.id, 'anime');
        });

        itemsContainer.appendChild(itemDiv);
      });
    }

    container.appendChild(dayCol);
  });
}

async function loadCatalogView() {
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  try {
    const endpoint = state.auth.token ? '/api/user/catalog' : '/api/catalog';
    const res = await fetchWithAuth(endpoint);
    const catalog = await res.json();

    grid.innerHTML = '';
    if (catalog.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="16"></line>
            <line x1="8" y1="12" x2="16" y2="12"></line>
          </svg>
          <h3>Your Catalog is Empty</h3>
          <p>Add custom streams, magnets, or direct URLs by clicking the "+" button in the top bar.</p>
        </div>
      `;
      return;
    }

    catalog.forEach(item => {
      const card = createMediaCard(item, 'catalog');

      const actions = document.createElement('div');
      actions.className = 'media-actions';
      actions.innerHTML = `
        <button class="media-action-btn delete-btn" title="Remove from catalog">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;

      actions.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Remove "${item.title}" from your catalog?`)) {
          setLoading(true);
          try {
            const endpoint = state.auth.token ? `/api/user/catalog/${item.id}` : `/api/catalog/${item.id}`;
            await fetchWithAuth(endpoint, { method: 'DELETE' });
            showToast('Item removed from catalog', 'success');
            loadCatalogView();
          } catch (err) {
            showToast('Failed to remove item', 'error');
          } finally {
            setLoading(false);
          }
        }
      });

      card.appendChild(actions);
      grid.appendChild(card);
    });

  } catch (err) {
    grid.innerHTML = '<div class="error-state"><h3>Failed to load catalog</h3><p>Could not connect to service.</p></div>';
  }
}

function loadSettingsView() {
  const accentSetting = document.getElementById('accentSetting');
  if (accentSetting) {
    accentSetting.value = state.preferences.accent || 'blue';
    accentSetting.onchange = (e) => {
      state.preferences.accent = e.target.value;
      applyAccent(state.preferences.accent);
      savePreferences();
      showToast(`Accent color set to ${e.target.value}`, 'success');
    };
  }

  const playerSetting = document.getElementById('playerSetting');
  playerSetting.value = state.preferences.player;
  playerSetting.onchange = (e) => {
    state.preferences.player = e.target.value;
    savePreferences();
    showToast(`Default player set to ${playerSetting.options[playerSetting.selectedIndex].text}`, 'success');
  };

  const autoplaySetting = document.getElementById('autoplaySetting');
  autoplaySetting.checked = state.preferences.autoplay;
  autoplaySetting.onchange = (e) => {
    state.preferences.autoplay = e.target.checked;
    savePreferences();
  };

  const adultSetting = document.getElementById('adultContentSetting');
  if (adultSetting) {
    adultSetting.checked = state.preferences.enableAdultContent || false;
    adultSetting.onchange = (e) => {
      state.preferences.enableAdultContent = e.target.checked;
      savePreferences();
      showToast(e.target.checked ? '18+ content enabled' : '18+ content hidden', 'success');
    };
  }

  // VLC Settings
  const vlcPathSetting = document.getElementById('vlcPathSetting');
  if (vlcPathSetting) {
    vlcPathSetting.value = state.preferences.vlcPath || '';
    vlcPathSetting.onchange = (e) => {
      state.preferences.vlcPath = e.target.value;
      savePreferences();
      showToast('VLC path saved!', 'success');
    };
  }

  const vlcArgsSetting = document.getElementById('vlcArgsSetting');
  if (vlcArgsSetting) {
    vlcArgsSetting.value = state.preferences.vlcArgs || '';
    vlcArgsSetting.onchange = (e) => {
      state.preferences.vlcArgs = e.target.value;
      savePreferences();
      showToast('VLC arguments saved!', 'success');
    };
  }

  // MPV Settings
  const mpvPathSetting = document.getElementById('mpvPathSetting');
  if (mpvPathSetting) {
    mpvPathSetting.value = state.preferences.mpvPath || '';
    mpvPathSetting.onchange = (e) => {
      state.preferences.mpvPath = e.target.value;
      savePreferences();
      showToast('MPV path saved!', 'success');
    };
  }

  const mpvArgsSetting = document.getElementById('mpvArgsSetting');
  if (mpvArgsSetting) {
    mpvArgsSetting.value = state.preferences.mpvArgs || '';
    mpvArgsSetting.onchange = (e) => {
      state.preferences.mpvArgs = e.target.value;
      savePreferences();
      showToast('MPV arguments saved!', 'success');
    };
  }

  // Check VLC connection
  const checkVlcBtn = document.getElementById('checkVlcBtn');
  if (checkVlcBtn) {
    checkVlcBtn.onclick = async () => {
      const installed = await checkVLCInstalled();
      if (installed) {
        showToast('✅ VLC Native Client connected!', 'success');
      } else {
        showToast('⚠️ VLC Native Client not found. Using vlc:// protocol fallback.', 'warning');
      }
    };
  }

  // Torrent Indexers checkboxes
  const indexerContainer = document.getElementById('indexerCheckboxes');
  indexerContainer.innerHTML = '';
  Object.keys(INDEXERS).forEach(id => {
    const idx = INDEXERS[id];
    const item = document.createElement('div');
    item.className = 'indexer-checkbox';

    const isChecked = state.preferences.selectedIndexers.includes(parseInt(id));

    item.innerHTML = `
      <input type="checkbox" id="indexer-${id}" value="${id}" ${isChecked ? 'checked' : ''}>
      <label for="indexer-${id}">${idx.name} (${idx.category})</label>
    `;

    item.querySelector('input').onchange = (e) => {
      const val = parseInt(e.target.value);
      if (e.target.checked) {
        if (!state.preferences.selectedIndexers.includes(val)) {
          state.preferences.selectedIndexers.push(val);
        }
      } else {
        if (state.preferences.selectedIndexers.length === 1) {
          e.target.checked = true;
          showToast('You must select at least one search indexer.', 'warning');
          return;
        }
        state.preferences.selectedIndexers = state.preferences.selectedIndexers.filter(i => i !== val);
      }
      savePreferences();
      syncHeaderIndexerSelectUI();
    };

    indexerContainer.appendChild(item);
  });

  document.getElementById('clearDataBtn').onclick = () => {
    if (confirm('Clear all settings, preferences, and Continue Watching history? This cannot be undone.')) {
      localStorage.removeItem('sv_preferences');
      localStorage.removeItem('sv_continue_watching');
      showToast('Cache cleared! Reloading...', 'info');
      setTimeout(() => location.reload(), 1500);
    }
  };

  document.getElementById('exportDataBtn').onclick = async () => {
    try {
      const endpoint = state.auth.token ? '/api/user/catalog' : '/api/catalog';
      const res = await fetchWithAuth(endpoint);
      const catalog = await res.json();
      const exportObj = {
        preferences: state.preferences,
        catalog: catalog,
        continueWatching: state.continueWatching
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", "stream-vault-data.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Export successful!', 'success');
    } catch (err) {
      showToast('Export failed.', 'error');
    }
  };

  // Check VLC status on settings load
  setTimeout(checkVLCInstalled, 1000);
}

// ==========================================================================
// Search Functionality
// ==========================================================================

function initSearch() {
  const searchInput = document.getElementById('searchInput');
  const suggestions = document.getElementById('searchSuggestions');
  if (!searchInput || !suggestions) return;

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(state.searchDebounce);

    if (q.length < 2) {
      suggestions.classList.remove('active');
      return;
    }

    state.searchDebounce = setTimeout(async () => {
      try {
        const selectedIndexers = state.preferences.selectedIndexers.join(',');
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&indexers=${selectedIndexers}&type=all`);
        const data = await res.json();
        suggestions.innerHTML = '';
        const items = [];

        if (data.anime) {
          filterAdult(data.anime).slice(0, 4).forEach(item => items.push({ ...item, s_type: 'anime' }));
        }
        if (data.media) {
          filterAdult(data.media).slice(0, 4).forEach(item => {
            const isMovie = item.media_type === 'movie' || !item.first_air_date;
            items.push({ ...item, s_type: isMovie ? 'movie' : 'tv' });
          });
        }

        if (items.length === 0) {
          suggestions.innerHTML = '<div class="suggestion-item">No results found</div>';
        } else {
          items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            let title = '', poster = '', meta = '';

            if (item.s_type === 'anime') {
              title = item.title.english || item.title.romaji || item.title.native;
              poster = item.coverImage.large || item.coverImage.medium;
              meta = `${item.format || 'ANIME'} • ${item.startDate?.year || ''}`;
            } else {
              title = item.s_type === 'movie' ? (item.title || item.original_title) : (item.name || item.original_name);
              poster = getPosterUrl(item.poster_path);
              const date = item.release_date || item.first_air_date || '';
              meta = `${item.s_type.toUpperCase()} • ${date.split('-')[0] || ''}`;
            }

            div.innerHTML = `
              <img src="${poster}" alt="${title}">
              <div class="suggestion-info">
                <div class="suggestion-title">${title}</div>
                <div class="suggestion-meta">${meta}</div>
              </div>
            `;

            div.addEventListener('click', () => {
              suggestions.classList.remove('active');
              searchInput.value = '';
              window.location.hash = `#/detail/${item.s_type}/${item.id}`;
            });

            suggestions.appendChild(div);
          });
        }
        suggestions.classList.add('active');
      } catch (err) {
        console.error(err);
      }
    }, 300);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      suggestions.classList.remove('active');
      const q = searchInput.value.trim();
      if (q.length >= 2) {
        window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      suggestions.classList.remove('active');
    }
  });
}

// ==========================================================================
// Detail View Functions
// ==========================================================================

async function openDetailsView(id, type, autoPlayParams = null) {
  setLoading(true);
  state.previousView = state.currentView || 'home';
  state._routing = true;
  window.location.hash = `#/detail/${type}/${id}`;
  state._routing = false;
  const detailView = document.getElementById('detailView');
  const content = document.getElementById('detailContent');
  detailView.style.display = 'block';
  document.getElementById('mainContent').style.overflow = 'hidden';
  content.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  try {
    let details = null;
    if (type === 'anime') {
      const res = await fetch(`/api/anime/${id}`);
      details = await res.json();
    } else {
      const res = await fetch(`/api/media/${type}/${id}`);
      details = await res.json();
    }

    if (!details) {
      content.innerHTML = '<div class="error-state"><h3>Detail not found</h3></div>';
      return;
    }

    state.selectedMedia = { 
      id, 
      type, 
      details, 
      selectedSeason: autoPlayParams?.seasonNumber || 1,
      selectedEpisode: autoPlayParams?.episodeNumber || 1
    };
    renderDetails(content, details, type);

    if (autoPlayParams?.url) {
      setTimeout(() => {
        playStream(autoPlayParams.title, autoPlayParams.url, autoPlayParams);
      }, 500);
    }

  } catch (err) {
    content.innerHTML = '<div class="error-state"><h3>Failed to load metadata</h3></div>';
  } finally {
    setLoading(false);
  }
}


async function launchDirectPlayer(server, type, seasonNum = 1, epNum = 1) {
  const details = state.selectedMedia.details;
  const imdbId = details.external_ids?.imdb_id || null;
  
  let targetId = details.id;
  let targetIdType = imdbId ? 'imdb' : 'tmdb';

  let container = document.getElementById('player');
  if (!container) container = document.getElementById('theaterPlayerContainer');

  const isAnime = type === 'anime' || (details.original_language === 'ja' && details.genres?.some(g => g.name === 'Animation'));

  if (isAnime) {
    try {
      if (container) {
          container.innerHTML = '<div class="spinner-container" style="height: 100%; display: flex; align-items: center; justify-content: center;"><div class="spinner"></div><p style="margin-left: 12px; color: #fff;">Loading Anime servers...</p></div>';
      }
      
      let titleQuery = details.title?.english || details.title?.romaji || details.name || details.title;
      if (type !== 'anime' && seasonNum > 1) {
          titleQuery += ` Season ${seasonNum}`;
      }
      const res = await fetch(`/api/stream/anime/servers?title=${encodeURIComponent(titleQuery)}&episode=${epNum}&tmdbId=${details.id}`);
      const data = await res.json();
      
      if (!data.servers || data.servers.length === 0) {
          throw new Error("No servers found");
      }
      
      const serversContainer = document.getElementById('serverBtnGroup');
      if (serversContainer) {
          serversContainer.innerHTML = '';
          serversContainer.className = 'aniwave-server-container';
          serversContainer.style.display = 'flex';
          
          const subs = data.servers.filter(s => s.type === 'sub');
          const dubs = data.servers.filter(s => s.type === 'dub');
          
          if (subs.length > 0) {
              const row = document.createElement('div');
              row.className = 'aniwave-server-row';
              
              const label = document.createElement('div');
              label.className = 'aniwave-server-label';
              label.innerHTML = '<span style="font-size:14px">cc</span> SUB';
              row.appendChild(label);
              
              const list = document.createElement('div');
              list.className = 'aniwave-server-list';
              
              subs.forEach(s => {
                  const btn = document.createElement('button');
                  btn.className = 'aniwave-server-btn';
                  btn.innerHTML = `<span style="font-size:10px">▶</span> ${s.name}`;
                  btn.onclick = async (e) => {
                      e.preventDefault();
                      document.querySelectorAll('.aniwave-server-btn').forEach(el => el.classList.remove('active'));
                      btn.classList.add('active');
                      await loadAnimeEmbed(s.id, container, details, type, seasonNum, epNum);
                  };
                  list.appendChild(btn);
              });
              row.appendChild(list);
              serversContainer.appendChild(row);
          }
          
          if (dubs.length > 0) {
              const row = document.createElement('div');
              row.className = 'aniwave-server-row';
              
              const label = document.createElement('div');
              label.className = 'aniwave-server-label';
              label.innerHTML = '<span style="font-size:14px">mic</span> DUB';
              row.appendChild(label);
              
              const list = document.createElement('div');
              list.className = 'aniwave-server-list';
              
              dubs.forEach(s => {
                  const btn = document.createElement('button');
                  btn.className = 'aniwave-server-btn';
                  btn.innerHTML = `<span style="font-size:10px">▶</span> ${s.name}`;
                  btn.onclick = async (e) => {
                      e.preventDefault();
                      document.querySelectorAll('.aniwave-server-btn').forEach(el => el.classList.remove('active'));
                      btn.classList.add('active');
                      await loadAnimeEmbed(s.id, container, details, type, seasonNum, epNum);
                  };
                  list.appendChild(btn);
              });
              row.appendChild(list);
              serversContainer.appendChild(row);
          }
          
          // Auto-click first server
          const firstBtn = serversContainer.querySelector('.aniwave-server-btn');
          if (firstBtn) firstBtn.click();
      }
    } catch (e) {
      console.error('Failed to map anime:', e);
      showToast('Failed to load Anime servers.', 'error');
      if (container) {
          container.innerHTML = '<div class="error-state" style="color: #fff; text-align: center; margin-top: 20px;"><h3>Failed to load servers</h3></div>';
      }
    }
    return;
  }

  // Fallback for Movies/TV Shows (Not Anime)
  let url = '';
  if (server === 'vidsrc') {
    const id = targetIdType === 'imdb' ? imdbId : targetId; 
    if (type === 'movie') url = `https://vidsrc.me/embed/movie?${targetIdType}=${id}`;
    else url = `https://vidsrc.me/embed/tv?${targetIdType}=${id}&season=${seasonNum}&episode=${epNum}`;
  } else if (server === 'vidsrccc') {
    if (type === 'movie') url = `https://vidsrc.cc/v2/embed/movie/${targetId}`;
    else url = `https://vidsrc.cc/v2/embed/tv/${targetId}/${seasonNum}/${epNum}`;
  } else if (server === 'vidsrcnet') {
    const id = targetIdType === 'imdb' ? imdbId : targetId; 
    if (type === 'movie') url = `https://vidsrc.net/embed/movie/${id}`;
    else url = `https://vidsrc.net/embed/tv/${id}/${seasonNum}/${epNum}`;
  } else if (server === 'smashy') {
    if (type === 'movie') url = `https://embed.smashystream.com/playere.php?tmdb=${targetId}`;
    else url = `https://embed.smashystream.com/playere.php?tmdb=${targetId}&season=${seasonNum}&episode=${epNum}`;
  } else if (server === 'multiembed') {
    const id = imdbId || targetId;
    const multiType = imdbId ? 'video_id' : 'tmdb';
    if (type === 'movie') url = `https://multiembed.mov/?${multiType}=${id}`;
    else url = `https://multiembed.mov/?${multiType}=${id}&s=${seasonNum}&e=${epNum}`;
  } else if (server === 'vidlink') {
    const id = imdbId || targetId;
    if (type === 'movie') url = `https://vidlink.pro/embed/movie/${id}`;
    else url = `https://vidlink.pro/embed/tv/${id}/${seasonNum}/${epNum}`;
  } else if (server === 'embedsu') {
    if (type === 'movie') url = `https://embed.su/embed/movie/${targetId}`;
    else url = `https://embed.su/embed/tv/${targetId}/${seasonNum}/${epNum}`;
  } else if (server === 'vidsrcin') {
    const id = targetIdType === 'imdb' ? imdbId : targetId; 
    if (type === 'movie') url = `https://vidsrc.in/embed/movie?${targetIdType}=${id}`;
    else url = `https://vidsrc.in/embed/tv?${targetIdType}=${id}&season=${seasonNum}&episode=${epNum}`;
  } else if (server === 'vidsrcnet_dub') {
    const id = targetIdType === 'imdb' ? imdbId : targetId; 
    if (type === 'movie') url = `https://vidsrc.net/embed/movie/${id}?dub=1`;
    else url = `https://vidsrc.net/embed/tv/${id}/${seasonNum}/${epNum}?dub=1`;
  } else if (server === 'embedsu_dub') {
    if (type === 'movie') url = `https://embed.su/embed/movie/${targetId}/dub`;
    else url = `https://embed.su/embed/tv/${targetId}/${seasonNum}/${epNum}/dub`;
  } else if (server === 'vidlink_dub') {
    const id = targetIdType === 'imdb' ? imdbId : targetId;
    if (type === 'movie') url = `https://vidlink.pro/movie/${id}?type=dub`;
    else url = `https://vidlink.pro/tv/${id}/${seasonNum}/${epNum}?type=dub`;
  } else if (server === 'multiembed_dub') {
    const id = imdbId || targetId;
    const multiType = imdbId ? 'video_id' : 'tmdb';
    if (type === 'movie') url = `https://multiembed.mov/?${multiType}=${id}&type=dub`;
    else url = `https://multiembed.mov/?${multiType}=${id}&s=${seasonNum}&e=${epNum}&type=dub`;
  } else if (server === '2embed') {
    const id = imdbId || targetId;
    if (type === 'movie') url = `https://www.2embed.cc/embed/${id}`;
    else url = `https://www.2embed.cc/embed/${id}&s=${seasonNum}&e=${epNum}`;
  } else if (server === 'autoembed') {
    const id = imdbId || targetId;
    if (type === 'movie') url = `https://autoembed.cc/embed/movie/${id}`;
    else url = `https://autoembed.cc/embed/tv/${id}/${seasonNum}/${epNum}`;
  } else if (server === 'moviesapi') {
    if (type === 'movie') url = `https://moviesapi.club/movie/${targetId}`;
    else url = `https://moviesapi.club/tv/${targetId}/${seasonNum}/${epNum}`;
  } else if (server === '2embed_dub') {
    const id = imdbId || targetId;
    if (type === 'movie') url = `https://www.2embed.cc/embed/${id}?dub=1`;
    else url = `https://www.2embed.cc/embed/${id}&s=${seasonNum}&e=${epNum}&dub=1`;
  } else if (server === 'autoembed_dub') {
    const id = imdbId || targetId;
    if (type === 'movie') url = `https://autoembed.cc/embed/movie/${id}?dub=1`;
    else url = `https://autoembed.cc/embed/tv/${id}/${seasonNum}/${epNum}?dub=1`;
  }

  if (!url) {
    showToast('Could not generate a direct stream URL for this title.', 'error');
    return;
  }
  
  if (container) {
    container.innerHTML = `<iframe src="${url}" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen></iframe>`;
  } else {
    const title = type === 'movie' 
      ? (details.title || details.original_title || details.title?.english || details.title?.romaji)
      : (details.name || details.original_name || details.title?.english || details.title?.romaji) + ` S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`;
    openIframePlayer(title, url);
  }

  const title = type === 'movie' 
    ? (details.title || details.original_title || details.title?.english || details.title?.romaji)
    : (details.name || details.original_name || details.title?.english || details.title?.romaji);

  updateContinueWatching(1, 100, {
    id: details.id,
    title: title,
    poster: details.poster_path || details.coverImage?.large || '',
    type: type,
    episodeNumber: epNum,
    seasonNumber: seasonNum,
    url: url
  });
}

async function loadAnimeEmbed(serverId, container, details, type, seasonNum, epNum) {
    try {
        if (container) {
            container.innerHTML = '<div class="spinner-container" style="height: 100%; display: flex; align-items: center; justify-content: center;"><div class="spinner"></div><p style="margin-left: 12px; color: #fff;">Loading Player...</p></div>';
        }
        
        const res = await fetch(`/api/stream/anime/embed?id=${serverId}`);
        const data = await res.json();
        
        if (data.url && container) {
            container.innerHTML = `<iframe src="${data.url}" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen></iframe>`;
            
            const title = details.title?.english || details.title?.romaji || details.name;
            updateContinueWatching(1, 100, {
                id: details.id,
                title: title,
                poster: details.poster_path || details.coverImage?.large || '',
                type: type,
                episodeNumber: epNum,
                seasonNumber: seasonNum,
                url: data.url
            });
        } else {
            throw new Error("No URL returned");
        }
    } catch(e) {
        console.error(e);
        showToast('Failed to load anime player.', 'error');
        if (container) {
            container.innerHTML = '<div class="error-state" style="color: #fff; text-align: center; margin-top: 20px;"><h3>Failed to load player</h3></div>';
        }
    }
}

async function renderDetails(container, details, type) {
  let title = '', poster = '', banner = '', rating = 0, genres = [], description = '', subtitle = '';

  if (type === 'anime') {
    title = details.title.english || details.title.romaji || details.title.native;
    poster = details.coverImage.large || details.coverImage.medium;
    banner = details.bannerImage || details.coverImage.large;
    rating = details.averageScore ? (details.averageScore / 10).toFixed(1) : 'N/A';
    genres = details.genres || [];
    description = details.description || '';
    const animeReleased = details.status === 'FINISHED' || details.status === 'RELEASING';
    subtitle = `${details.format} • ${details.episodes || 'Unknown'} Episodes • ${details.status}`;
    if (!animeReleased) subtitle += ` <span class="badge-coming-soon">⏳ Coming Soon</span>`;
  } else {
    title = type === 'movie' ? (details.title || details.original_title) : (details.name || details.original_name);
    poster = getPosterUrl(details.poster_path);
    banner = getBannerUrl(details.backdrop_path);
    rating = details.vote_average ? details.vote_average.toFixed(1) : 'N/A';
    genres = details.genres ? details.genres.map(g => g.name) : [];
    description = details.overview || '';
    const date = details.release_date || details.first_air_date || '';
    const isReleased = details.status === 'Released' || details.status === 'Ended' || details.status === 'Returning Series';
    const isFuture = date && new Date(date) > new Date();
    const notReleased = !isReleased || isFuture;
    subtitle = `${type.toUpperCase()} • ${date.split('-')[0]} • ${details.runtime || details.episode_run_time?.[0] || ''} min`;
    if (notReleased) subtitle += ` <span class="badge-coming-soon">⏳ Coming Soon</span>`;
  }

  const cleanDescription = description.replace(/<[^>]*>/g, '');

  container.innerHTML = `
    <div class="theater-layout ${type === 'movie' ? 'no-left' : ''}">
      ${type !== 'movie' ? `
      <div class="theater-left" id="theaterLeft">
        <div class="theater-left-header" id="theaterSeasonHeader"></div>
        <div class="theater-left-body" id="theaterEpisodesGrid"></div>
      </div>
      ` : ''}
      
      <div class="theater-middle">
        <h1 style="margin: 0; font-size: 22px; letter-spacing: -0.3px;">${title}</h1>
        <span id="episodeSubtitle" style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: var(--space-3); display: block;"></span>
        <div class="theater-player-container" id="theaterPlayerContainer" style="background-image: linear-gradient(to bottom, rgba(8,8,15,0.6), rgba(8,8,15,0.9)), url('${banner}'); background-size: cover; background-position: center;">
          <div class="player-placeholder">
            <p>Select a server to start watching.</p>
          </div>
        </div>
        
        <div class="server-btn-group" id="serverBtnGroup" style="display: none;">
          <!-- Populated dynamically -->
        </div>

        <div class="stream-tabs">
          <button class="stream-tab active" id="tabDirectBtn">Direct Play</button>
          <button class="stream-tab" id="tabTorrentBtn">Torrent Streams</button>
        </div>
        
        <div id="torrentTabContent" style="display: none;">
          <div style="display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); flex-wrap: wrap;">
            <span style="font-size: var(--font-size-sm); color: var(--color-text-secondary);" id="torrentHintText">Select an episode to search for torrents.</span>
          </div>
          <div class="detail-section" id="torrentSearchSection" style="display: none;">
            <div style="display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-3);">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: var(--space-2);">
                  <h3 class="detail-section-title" id="torrentSectionTitle" style="margin: 0; font-size: 16px;">Available Torrents</h3>
                  <button id="refreshTorrentsBtn" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; height: 30px;" title="Refresh Torrents">🔄</button>
                </div>
                <div style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap;">
                  ${type === 'anime' ? `
                    <select id="animeAudioToggle" class="filter-select" style="height: 32px; font-size: 13px; padding: 0 24px 0 8px;">
                      <option value="any">Any (Sub/Dub)</option>
                      <option value="sub">Subbed</option>
                      <option value="dub" selected>Dubbed</option>
                    </select>
                  ` : ''}
                  <label style="font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--color-text-secondary); background: var(--color-bg-tertiary); padding: 4px 10px; border-radius: 20px;">
                    <input type="checkbox" id="sortWebRipToggle" ${state.sortWebRipFirst ? 'checked' : ''}> WEBRip
                  </label>
                </div>
              </div>
              <div id="torrentProviderTabs" class="provider-tabs-container">
                <button class="provider-tab active" data-source="all">All Providers <span class="tab-count">0</span></button>
              </div>
            </div>
            <div class="torrents-list" id="torrentListGrid"></div>
          </div>
        </div>
        
        <div id="directTabContent" style="display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2);">
          <div class="ad-notice" id="directHintText">
            Direct Play servers may contain ads. 
            <a href="https://chromewebstore.google.com/detail/adguard-adblocker/bgnkhhnnamicmpeenaelnjfhikgbkllg" target="_blank">Install AdGuard (Chrome/Brave)</a>
          </div>
          <div class="ad-notice">
            Volume too low? 
            <a href="https://chromewebstore.google.com/detail/volume-master/jghecgabfgfdldnmbfkhmffcabddioke" target="_blank">Install Volume Master</a> to boost audio up to 600%.
          </div>
        </div>

        <div class="detail-info-card">
          <img src="${poster}" class="poster" alt="${title}">
          <div class="body">
            <div class="detail-meta" style="margin-bottom: var(--space-3);">
              <span class="detail-rating">⭐ ${rating}</span>
              <span class="detail-meta-item">${subtitle}</span>
            </div>
            <div class="detail-genres" style="margin-bottom: var(--space-3);">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>
            <p class="detail-synopsis">${cleanDescription}</p>
            <div class="detail-actions" id="detailHeaderActions" style="margin-top: var(--space-3);"></div>
          </div>
        </div>
      </div>
      
      <div class="theater-right">
        <div class="theater-right-header">Recommendations</div>
        <div class="theater-right-body" id="theaterRecommendations"></div>
      </div>
    </div>
  `;

  // Torrent logic toggle
  const sortToggle = document.getElementById('sortWebRipToggle');
  if (sortToggle) {
    sortToggle.addEventListener('change', (e) => {
      state.sortWebRipFirst = e.target.checked;
      const activeTab = document.querySelector('.provider-tab.active');
      if (activeTab) activeTab.click();
    });
  }

  const refreshBtn = document.getElementById('refreshTorrentsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const isTv = type === 'tv';
      const sNum = isTv ? state.selectedMedia.selectedSeason : null;
      const epNum = type === 'movie' ? null : state.selectedMedia.selectedEpisode;
      
      // Anime filter is read inside triggerTorrentSearch
      triggerTorrentSearch(title, type, epNum, sNum);
    });
  }

  // Header Actions
  const headerActions = document.getElementById('detailHeaderActions');
  let youtubeKey = '';
  if (type === 'anime' && details.trailer?.site === 'youtube') {
    youtubeKey = details.trailer.id;
  } else if (details.videos?.results) {
    const trailer = details.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    if (trailer) youtubeKey = trailer.key;
  }
  if (youtubeKey) {
    const trailerBtn = document.createElement('button');
    trailerBtn.className = 'detail-action-btn secondary';
    trailerBtn.innerHTML = '▶ Watch Trailer';
    trailerBtn.addEventListener('click', () => {
      playStream(`${title} - Trailer`, `https://www.youtube.com/embed/${youtubeKey}?autoplay=1`, { isYoutube: true });
    });
    headerActions.appendChild(trailerBtn);
  }

  const catalogBtn = document.createElement('button');
  catalogBtn.className = 'detail-action-btn secondary';
  catalogBtn.innerHTML = '➕ Add to My List';
  catalogBtn.addEventListener('click', async () => {
    setLoading(true);
    try {
      const endpoint = state.auth.token ? '/api/user/catalog' : '/api/catalog';
      await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: title, 
          poster: poster, 
          url: '', 
          type: type, 
          mediaId: details.id
        })
      });
      showToast(`Added "${title}" to your List!`, 'success');
    } catch (err) {
      showToast('Failed to add item to list.', 'error');
    } finally {
      setLoading(false);
    }
  });
  headerActions.appendChild(catalogBtn);

  const watchRecord = state.continueWatching.find(item => item.id == details.id && item.type == type);
  if (watchRecord) {
    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'detail-action-btn';
    resumeBtn.style.background = 'var(--color-primary)';
    resumeBtn.style.color = '#fff';
    resumeBtn.style.border = 'none';
    let progressTxt = '';
    if (watchRecord.duration) {
      progressTxt = ` (${((watchRecord.currentTime / watchRecord.duration) * 100).toFixed(0)}%)`;
    }
    resumeBtn.innerHTML = `▶ Resume Playing${progressTxt}`;
      resumeBtn.addEventListener('click', () => {
      if (watchRecord.url) {
        playStream(watchRecord.title, watchRecord.url, watchRecord);
      } else if (watchRecord.magnet) {
        playTorrent(watchRecord.title, watchRecord.magnet, watchRecord);
      }
    });
    // Insert at the very beginning
    headerActions.insertBefore(resumeBtn, headerActions.firstChild);
  }

  // Tab Switching Logic
  state.activeStreamTab = 'direct';
  
  document.getElementById('tabTorrentBtn').addEventListener('click', () => {
    state.activeStreamTab = 'torrent';
    document.getElementById('tabTorrentBtn').classList.add('active');
    document.getElementById('tabDirectBtn').classList.remove('active');
    document.getElementById('torrentTabContent').style.display = 'block';
    document.getElementById('directTabContent').style.display = 'none';
    document.getElementById('serverBtnGroup').style.display = 'none';
    const searchSec = document.getElementById('torrentSearchSection');
    if (searchSec) searchSec.style.display = 'block';
  });

  document.getElementById('tabDirectBtn').addEventListener('click', () => {
    state.activeStreamTab = 'direct';
    document.getElementById('tabDirectBtn').classList.add('active');
    document.getElementById('tabTorrentBtn').classList.remove('active');
    document.getElementById('torrentTabContent').style.display = 'none';
    document.getElementById('directTabContent').style.display = 'flex';
    document.getElementById('serverBtnGroup').style.display = 'flex';
    const searchSec = document.getElementById('torrentSearchSection');
    if (searchSec) searchSec.style.display = 'none';
  });

  // Setup Server Buttons with Sub/Dub for Movies/TV
  const serverGroup = document.getElementById('serverBtnGroup');
  const isAnime = type === 'anime' || (details.original_language === 'ja' && details.genres?.some(g => g.name === 'Animation'));
  
  if (type === 'movie' || type === 'tv') {
    // Render Sub/Dub server rows for Movies/TV (aniwave-style)
    serverGroup.className = 'aniwave-server-container';
    serverGroup.style.display = 'flex';
    serverGroup.innerHTML = '';

    const subServers = [
      { name: 'VidSrc', id: 'vidsrc' },
      { name: 'Smashy', id: 'smashy' },
      { name: 'VidLink', id: 'vidlink' },
      { name: '2Embed', id: '2embed' },
      { name: 'Multi', id: 'multiembed' }
    ];

    const createServerRow = (servers, label, icon, lang) => {
      const row = document.createElement('div');
      row.className = 'aniwave-server-row';
      const labelDiv = document.createElement('div');
      labelDiv.className = 'aniwave-server-label';
      labelDiv.innerHTML = `<span style="font-size:14px">${icon}</span> ${label}`;
      row.appendChild(labelDiv);
      const list = document.createElement('div');
      list.className = 'aniwave-server-list';
      servers.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'aniwave-server-btn';
        btn.innerHTML = `<span style="font-size:10px">▶</span> ${s.name}`;
        btn.dataset.server = s.id;
        btn.onclick = () => {
          document.querySelectorAll('.aniwave-server-btn').forEach(el => el.classList.remove('active'));
          btn.classList.add('active');
          if (type === 'tv') {
            launchDirectPlayer(s.id, 'tv', state.selectedMedia.selectedSeason || 1, state.selectedMedia.selectedEpisode || 1);
          } else {
            launchDirectPlayer(s.id, 'movie');
          }
        };
        list.appendChild(btn);
      });
      row.appendChild(list);
      serverGroup.appendChild(row);
    };

    createServerRow(subServers, 'Servers', '▶', 'sub');

    // Auto-click first SUB server
    const firstBtn = serverGroup.querySelector('.aniwave-server-btn');
    if (firstBtn) firstBtn.click();
  } else {
    serverGroup.innerHTML = '<div style="color:var(--color-text-secondary); font-size:14px; padding:10px;">Select an episode to load Anime servers</div>';
    serverGroup.style.display = 'flex';
  }

  // Render Left Column (Episodes)
  if (type === 'movie') {
    document.getElementById('episodeSubtitle').textContent = 'Movie';
    // For movies, update hints and add play button
    document.getElementById('torrentHintText').innerHTML = `
      <button class="detail-action-btn" id="searchMovieTorrentsBtn">🔍 Re-search Torrents</button>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-left: 8px;">Searching movie torrent streams automatically...</span>
    `;
    document.getElementById('searchMovieTorrentsBtn').addEventListener('click', () => {
      triggerTorrentSearch(title, 'movie');
    });

    // Auto play movie on load (first SUB server already auto-clicked above)
    setTimeout(() => {
      triggerTorrentSearch(title, 'movie');
    }, 150);

  } else if (type === 'anime') {
    document.getElementById('theaterLeft').style.display = 'flex';
    document.getElementById('theaterLeft').className = 'theater-left aniwave-ep-container';
    document.getElementById('theaterLeft').style.padding = '0';
    document.getElementById('theaterLeft').style.border = 'none';

    const header = document.getElementById('theaterSeasonHeader');
    header.className = 'aniwave-ep-header';
    header.style.marginBottom = '0';
    
    const grid = document.getElementById('theaterEpisodesGrid');
    grid.className = 'aniwave-ep-grid';
    const totalEpisodes = details.episodes || 1;
    
    const chunkSize = 100;
    const numChunks = Math.ceil(totalEpisodes / chunkSize);
    
    if (numChunks > 1) {
      const select = document.createElement('select');
      select.className = 'aniwave-ep-dropdown';
      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize + 1;
        const end = Math.min((i + 1) * chunkSize, totalEpisodes);
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `${String(start).padStart(3, '0')}-${String(end).padStart(3, '0')}`;
        select.appendChild(opt);
      }
      select.addEventListener('change', (e) => {
        renderAnimeEpisodes(parseInt(e.target.value));
      });
      header.innerHTML = '<span style="font-weight:bold; font-size:14px; color:var(--color-text-secondary);">Episodes</span>';
      header.appendChild(select);
    } else {
      header.innerHTML = '<span style="font-weight:bold; font-size:14px; color:var(--color-text-secondary);">Episodes</span>';
    }

    const renderAnimeEpisodes = (chunkIndex) => {
      grid.innerHTML = '';
      const start = chunkIndex * chunkSize + 1;
      const end = Math.min((chunkIndex + 1) * chunkSize, totalEpisodes);
      
      for (let ep = start; ep <= end; ep++) {
        const btn = document.createElement('div');
        btn.className = 'aniwave-ep-btn';
        if (state.selectedMedia.selectedEpisode === ep) btn.classList.add('active');
        btn.textContent = ep;
        const epBtnName = state.animeEpisodeNames?.[ep];
        if (epBtnName) btn.title = `Episode ${ep} - ${epBtnName}`;
        const wRec = state.continueWatching.find(w => w.id == details.id && w.type == 'anime' && w.episodeNumber == ep);
        if (wRec) {
          const dot = document.createElement('span');
          dot.className = 'watched-dot';
          if (wRec.duration && (wRec.currentTime / wRec.duration) > 0.95) dot.classList.add('full');
          btn.appendChild(dot);
        }
        
        btn.addEventListener('click', () => {
          document.querySelectorAll('.aniwave-ep-btn').forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
          state.selectedMedia.selectedEpisode = ep;
          const epName = state.animeEpisodeNames?.[ep];
          document.getElementById('episodeSubtitle').textContent = epName ? `Episode ${ep} - ${epName}` : `Episode ${ep}`;
          
          if (state.activeStreamTab === 'direct') {
            const activeServer = document.querySelector('.aniwave-server-btn.active')?.dataset?.server || 'vidsrc';
            launchDirectPlayer(activeServer, 'anime', 1, ep);
          } else {
            const animeQuery = `${details.title.romaji || details.title.english} ${ep}`;
            triggerTorrentSearch(animeQuery, 'anime', ep);
          }
        });
        grid.appendChild(btn);
      }
    };
    renderAnimeEpisodes(0);
    document.getElementById('episodeSubtitle').textContent = `Episode ${state.selectedMedia.selectedEpisode || 1}`;

    if (details.tmdbId || details.idMal) {
      const params = new URLSearchParams();
      if (details.tmdbId) params.set('tmdbId', details.tmdbId);
      if (details.idMal) params.set('malId', details.idMal);
      fetch(`/api/episodes/flat?${params}`)
        .then(r => r.json())
        .then(({ episodes }) => {
          if (episodes && episodes.length > 0) {
            const nameMap = {};
            episodes.forEach(ep => { nameMap[ep.episode_number] = ep.name; });
            state.animeEpisodeNames = nameMap;
            const cur = state.selectedMedia.selectedEpisode;
            if (cur && nameMap[cur]) {
              document.getElementById('episodeSubtitle').textContent = `Episode ${cur} - ${nameMap[cur]}`;
            }
            document.querySelectorAll('.aniwave-ep-btn').forEach(btn => {
              const epNum = parseInt(btn.textContent);
              if (nameMap[epNum]) btn.title = `Episode ${epNum} - ${nameMap[epNum]}`;
            });
          }
        })
        .catch(() => {});
    }
  } else if (type === 'tv') {
    document.getElementById('theaterLeft').style.display = 'flex';
    document.getElementById('theaterLeft').className = 'theater-left aniwave-ep-container';
    document.getElementById('theaterLeft').style.padding = '0';
    document.getElementById('theaterLeft').style.border = 'none';

    const header = document.getElementById('theaterSeasonHeader');
    header.className = 'aniwave-ep-header';
    header.style.marginBottom = '0';

    const seasons = details.seasons || [];
    const seasonSelect = document.createElement('select');
    seasonSelect.className = 'aniwave-ep-dropdown';
    seasons.forEach(s => {
      if (s.season_number === 0) return;
      const opt = document.createElement('option');
      opt.value = s.season_number;
      opt.textContent = s.name || `Season ${s.season_number}`;
      seasonSelect.appendChild(opt);
    });
    header.innerHTML = '<span style="font-weight:bold; font-size:14px; color:var(--color-text-secondary);">Season</span>';
    header.appendChild(seasonSelect);

    const grid = document.getElementById('theaterEpisodesGrid');
    grid.className = 'aniwave-ep-grid';

    const renderTvEpisodes = async (seasonNum) => {
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px;"><div class="spinner"></div></div>';
      try {
        const res = await fetch(`/api/media/tv/${details.id}/season/${seasonNum}`);
        const seasonData = await res.json();
        grid.innerHTML = '';
        if (seasonData.episodes) {
          const firstEp = seasonData.episodes[0];
          if (firstEp && state.selectedMedia.selectedEpisode === firstEp.episode_number) {
            document.getElementById('episodeSubtitle').textContent = firstEp.name ? `Episode ${firstEp.episode_number} - ${firstEp.name}` : `Episode ${firstEp.episode_number}`;
          }
          seasonData.episodes.forEach(ep => {
            const btn = document.createElement('div');
            btn.className = 'aniwave-ep-btn';
            if (state.selectedMedia.selectedEpisode === ep.episode_number) btn.classList.add('active');
            const isUpcoming = ep.air_date && new Date(ep.air_date) > new Date();
            btn.textContent = ep.episode_number;
            btn.title = isUpcoming ? `Episode ${ep.episode_number} - Coming ${ep.air_date}` : (ep.name || `Episode ${ep.episode_number}`);
            if (isUpcoming) btn.classList.add('upcoming');
            const wRec = state.continueWatching.find(w => w.id == details.id && w.type == 'tv' && w.episodeNumber == ep.episode_number && w.seasonNumber == seasonNum);
            if (wRec) {
              const dot = document.createElement('span');
              dot.className = 'watched-dot';
              if (wRec.duration && (wRec.currentTime / wRec.duration) > 0.95) dot.classList.add('full');
              btn.appendChild(dot);
            }

            btn.addEventListener('click', () => {
              if (isUpcoming) {
                showToast(`Episode ${ep.episode_number} airs on ${ep.air_date}`, 'info');
                return;
              }
              document.querySelectorAll('.aniwave-ep-btn').forEach(c => c.classList.remove('active'));
              btn.classList.add('active');
              state.selectedMedia.selectedEpisode = ep.episode_number;
              document.getElementById('episodeSubtitle').textContent = ep.name ? `Episode ${ep.episode_number} - ${ep.name}` : `Episode ${ep.episode_number}`;

              if (state.activeStreamTab === 'direct') {
                const activeServer = document.querySelector('.aniwave-server-btn.active')?.dataset?.server || 'vidsrc';
                launchDirectPlayer(activeServer, 'tv', seasonNum, ep.episode_number);
              } else {
                const pad = (n) => String(n).padStart(2, '0');
                const tvQuery = `${title} S${pad(seasonNum)}E${pad(ep.episode_number)}`;
                triggerTorrentSearch(tvQuery, 'tv', ep.episode_number, seasonNum);
              }
            });
            grid.appendChild(btn);
          });
        }
      } catch (e) {
        grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--color-text-muted);">Failed to load episodes.</p>';
      }
    };

    seasonSelect.addEventListener('change', (e) => {
      state.selectedMedia.selectedSeason = parseInt(e.target.value);
      renderTvEpisodes(parseInt(e.target.value));
    });

    if (seasons.length > 0) {
      const initialSeason = seasons[0].season_number === 0 ? (seasons[1]?.season_number || 0) : seasons[0].season_number;
      seasonSelect.value = initialSeason;
      state.selectedMedia.selectedSeason = initialSeason;
      renderTvEpisodes(initialSeason);
    }

  }

  // Render Right Column (Genre-based Recommendations)
  const recsContainer = document.getElementById('theaterRecommendations');
  recsContainer.innerHTML = '<div class="spinner" style="margin:20px auto;"></div>';

  const renderRecCard = (item, rType) => {
    const card = document.createElement('div');
    card.className = 'rec-card';
    let rTitle, rPoster, rMeta;
    if (rType === 'anime') {
      rTitle = item.title?.english || item.title?.romaji || 'Unknown';
      rPoster = item.coverImage?.large || item.coverImage?.medium || '';
      rMeta = item.averageScore ? (item.averageScore / 10).toFixed(1) : '';
    } else {
      rTitle = item.title || item.name || 'Unknown';
      rPoster = getPosterUrl(item.poster_path);
      rMeta = (item.vote_average || 0).toFixed(1);
    }
    card.innerHTML = `<img src="${rPoster}" class="rec-poster" alt="${rTitle}"><div class="rec-info"><div class="rec-title">${rTitle}</div><div class="rec-meta">⭐ ${rMeta}</div></div>`;
    card.onclick = () => window.location.hash = `#/detail/${rType}/${item.id}`;
    return card;
  };

  // Try API recommendations first
  let recsList = [];
  if (type === 'anime' && details.recommendations?.nodes) {
    recsList = details.recommendations.nodes.filter(n => n.mediaRecommendation).map(n => ({ ...n.mediaRecommendation }));
  } else if (details.recommendations?.results) {
    recsList = details.recommendations.results;
  }
  recsList = filterAdult(recsList).filter(r => r.id != details.id);

  if (recsList.length >= 4) {
    recsContainer.innerHTML = '';
    recsList.slice(0, 10).forEach(rec => {
      let rt = type === 'anime' ? 'anime' : (rec.media_type || type);
      recsContainer.appendChild(renderRecCard(rec, rt));
    });
  } else if (details.genres?.length) {
    const firstGenre = details.genres.find(g => g.id)?.id || details.genres[0]?.name || details.genres[0];
    if (firstGenre) {
      try {
        const dt = type === 'anime' ? 'tv' : type;
        const param = typeof firstGenre === 'number' ? `&genre=${firstGenre}` : `&genreName=${encodeURIComponent(firstGenre)}`;
        const res = await fetch(`/api/discover?type=${dt}&page=1${param}`);
        const data = await res.json();
        const similar = filterAdult(data.media || []).filter(r => r.id != details.id).slice(0, 10);
        recsContainer.innerHTML = '';
        similar.forEach(item => recsContainer.appendChild(renderRecCard(item, item.media_type || type)));
      } catch (e) { recsContainer.innerHTML = ''; }
    } else { recsContainer.innerHTML = ''; }
  } else { recsContainer.innerHTML = ''; }

  if (recsContainer.children.length === 0) {
    recsContainer.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--color-text-muted);text-align:center;">Loading recommendations...</div>';
    // Last resort: recent popular items
    (async () => {
      try {
        const res = await fetch(`/api/discover?type=${type === 'anime' ? 'tv' : type}&page=1`);
        const data = await res.json();
        const popular = filterAdult(data.media || []).filter(r => r.id != details.id).slice(0, 10);
        if (popular.length > 0) {
          recsContainer.innerHTML = '';
          popular.forEach(item => recsContainer.appendChild(renderRecCard(item, item.media_type || type)));
        } else {
          recsContainer.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--color-text-muted);text-align:center;">No recommendations found.</div>';
        }
      } catch (e) { recsContainer.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--color-text-muted);text-align:center;">No recommendations found.</div>'; }
    })();
  }

  // Below info card: same-series content (rec-card style)
  let belowItems = [], belowHeader = '';

  if (type === 'tv' && details.seasons) {
    const seasons = details.seasons.filter(s => s.season_number > 0 && s.season_number !== state.selectedMedia?.selectedSeason);
    if (seasons.length > 0) {
      belowHeader = 'Other Seasons';
      belowItems = seasons.map(s => ({
        id: s.season_number,
        title: s.name || `Season ${s.season_number}`,
        poster: s.poster_path ? `https://image.tmdb.org/t/p/w185${s.poster_path}` : poster,
        onclick: () => {
          const sel = document.querySelector('.aniwave-ep-dropdown');
          if (sel) { sel.value = s.season_number; sel.dispatchEvent(new Event('change')); }
        }
      }));
    }
  }

  if (belowItems.length === 0 && type === 'anime') {
    const relSource = details.relations?.edges || details.relations?.nodes || [];
    const relItems = relSource.filter(r => r.node).slice(0, 6);
    if (relItems.length > 0) {
      belowHeader = 'Related Anime';
      belowItems = relItems.map(r => ({
        id: r.node.id,
        title: r.node.title?.english || r.node.title?.romaji || 'Unknown',
        poster: r.node.coverImage?.large || r.node.coverImage?.medium || '',
        onclick: () => { window.location.hash = `#/detail/anime/${r.node.id}`; }
      }));
    }
  }

  if (belowItems.length === 0 && type === 'movie' && details.belongs_to_collection) {
    (async () => {
      try {
        const res = await fetch(`/api/media/movie/${details.id}`);
        const full = await res.json();
        if (full.belongs_to_collection?.parts) {
          const otherParts = filterAdult(full.belongs_to_collection.parts).filter(p => p.id !== details.id);
          if (otherParts.length > 0) {
            const items = otherParts.map(p => ({
              id: p.id,
              title: p.title || 'Unknown',
              poster: getPosterUrl(p.poster_path),
              onclick: () => { window.location.hash = `#/detail/movie/${p.id}`; }
            }));
            renderBelowCards('In This Series', items);
          }
        }
      } catch (e) {}
    })();
  }

  if (belowItems.length > 0) {
    renderBelowCards(belowHeader, belowItems);
  }

  function renderBelowCards(header, items) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:var(--space-3);border-top:1px solid rgba(255,255,255,0.05);padding-top:var(--space-3);';
    wrap.innerHTML = `<div class="related-seasons-header">${header}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:var(--space-3);margin-top:var(--space-2);"></div>`;
    const grid = wrap.querySelector('div:last-child');
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'rec-card';
      card.style.cssText = 'flex-direction:column;text-align:center;';
      card.innerHTML = `<img src="${item.poster}" class="rec-poster" alt="${item.title}" style="width:100%;height:auto;aspect-ratio:2/3;"><div class="rec-info"><div class="rec-title" style="font-size:13px;">${item.title}</div></div>`;
      card.onclick = item.onclick;
      grid.appendChild(card);
    });
    document.querySelector('.detail-info-card').after(wrap);
  }

  // Mobile: move episode grid above info card (inside .theater-middle)
  const theaterLeft = document.getElementById('theaterLeft');
  const infoCard = document.querySelector('.detail-info-card');
  if (theaterLeft && infoCard) {
    const isMobile = window.matchMedia('(max-width: 900px)');
    const moveLeft = () => {
      if (isMobile.matches && theaterLeft.parentElement !== infoCard.parentElement) {
        infoCard.parentElement.insertBefore(theaterLeft, infoCard);
      } else if (!isMobile.matches && theaterLeft.parentElement !== document.querySelector('.theater-layout')) {
        document.querySelector('.theater-layout')?.insertBefore(theaterLeft, document.querySelector('.theater-middle'));
      }
    };
    moveLeft();
    isMobile.addEventListener('change', moveLeft);
  }
}

// Torrent Searching
// ==========================================================================

function cleanAndFilterTorrents(torrents, categoryType, episodeNum, seasonNum) {
  if (!torrents || torrents.length === 0) return [];

  const details = state.selectedMedia?.details || {};
  let targetTitle = "";
  let releaseYear = null;

  if (state.selectedMedia?.type === 'anime') {
    targetTitle = details.title?.english || details.title?.romaji || details.title?.native || "";
    if (details.startDate?.year) {
      releaseYear = parseInt(details.startDate.year);
    }
  } else {
    targetTitle = state.selectedMedia?.type === 'movie' 
      ? (details.title || details.original_title) 
      : (details.name || details.original_name);
    const dateStr = details.release_date || details.first_air_date || "";
    if (dateStr) {
      releaseYear = parseInt(dateStr.split('-')[0]);
    }
  }

  if (!targetTitle) return torrents;

  const cleanTarget = targetTitle.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return torrents.filter(torrent => {
    const title = torrent.title.toLowerCase();

    // 1. Extract title portion of the torrent name (everything before season, episode, or year)
    let titlePart = torrent.title.toLowerCase()
      .split(/\bs\d+e\d+/i)[0]
      .split(/\bseason\s*\d+/i)[0]
      .split(/\bep\s*\d+/i)[0]
      .split(/\b(19\d\d|20\d\d)\b/)[0]
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!titlePart) titlePart = torrent.title.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // 2. Keyword check: The title portion must contain target title keywords as a word boundary
    const boundaryRegex = new RegExp(`\\b${cleanTarget}\\b`, 'i');
    if (!boundaryRegex.test(titlePart)) return false;

    // For very short titles (like "From" or "Obsession"), we enforce strict similarity on title portion
    const targetWordsCount = cleanTarget.split(/\s+/).length;
    const torrentWordsCount = titlePart.split(/\s+/).length;
    if (targetWordsCount === 1) {
      if (torrentWordsCount > 2 && titlePart !== cleanTarget) {
        return false;
      }
    } else if (targetWordsCount === 2) {
      if (torrentWordsCount > 4 && !titlePart.startsWith(cleanTarget)) {
        return false;
      }
    }

    // 2. Movie specific filters
    if (categoryType === 'movie') {
      // Filter out TV show patterns (S01E01, S1E1, Season 1, etc.)
      if (/\bs\d+e\d+/i.test(title) || /\bseason\s*\d+/i.test(title) || /\bep\s*\d+/i.test(title)) {
        return false;
      }
      
      // If we have a release year, filter out torrents that have a year and it does not match within +/- 1 year
      if (releaseYear) {
        const yearMatches = title.match(/\b(19\d\d|20\d\d)\b/g);
        if (yearMatches) {
          const hasValidYear = yearMatches.some(yr => {
            const y = parseInt(yr);
            return Math.abs(y - releaseYear) <= 1;
          });
          if (!hasValidYear) return false;
        }
      }
    }

    // 3. TV / Anime specific filters
    if (categoryType === 'tv' || categoryType === 'anime') {
      if (episodeNum !== null) {
        const epStr = String(episodeNum);
        const epPad = epStr.padStart(2, '0');
        
        // Match patterns like E04, E4, Ep 4, - 04, etc.
        const epPatterns = [
          new RegExp(`\\be${epPad}\\b`, 'i'),
          new RegExp(`\\be${epStr}\\b`, 'i'),
          new RegExp(`\\bep\\.?\\s*${epPad}\\b`, 'i'),
          new RegExp(`\\bep\\.?\\s*${epStr}\\b`, 'i'),
          new RegExp(`\\bepisode\\s*${epStr}\\b`, 'i'),
          new RegExp(`\\bepisode\\s*${epPad}\\b`, 'i'),
          new RegExp(`[^\\d]0*${epStr}[^\\d]`),
          new RegExp(`\\b${epPad}\\b`),
          new RegExp(`\\b${epStr}\\b`)
        ];
        
        const matchesEpisode = epPatterns.some(pattern => pattern.test(torrent.title));
        if (!matchesEpisode) return false;
      }
      
      if (seasonNum !== null) {
        const sStr = String(seasonNum);
        const sPad = sStr.padStart(2, '0');
        const sPatterns = [
          new RegExp(`\\bs${sPad}\\b`, 'i'),
          new RegExp(`\\bs${sStr}\\b`, 'i'),
          new RegExp(`\\bseason\\s*${sPad}\\b`, 'i'),
          new RegExp(`\\bseason\\s*${sStr}\\b`, 'i')
        ];
        const anySeasonMatches = torrent.title.match(/\bs(\d+)\b/i) || torrent.title.match(/\bseason\s*(\d+)\b/i);
        if (anySeasonMatches) {
          const detectedSeason = parseInt(anySeasonMatches[1]);
          if (detectedSeason !== seasonNum) return false;
        }
      }
    }

    return true;
  });
}

function getRelevanceScore(torrent, targetTitle, releaseYear) {
  let score = parseInt(torrent.seeders) || 0;
  const title = torrent.title.toLowerCase();
  const cleanTarget = targetTitle.toLowerCase().trim();

  // Bonus for starting with the target title
  if (title.startsWith(cleanTarget)) {
    score += 2000;
  } else if (title.includes(cleanTarget)) {
    score += 1000;
  }

  // Bonus for exact year match
  if (releaseYear && title.includes(String(releaseYear))) {
    score += 500;
  }

  // Penalty for long titles (likely unrelated packs or compilations)
  score -= (title.length - cleanTarget.length) * 2;

  return score;
}

async function triggerTorrentSearch(query, categoryType, episodeNum = null, seasonNum = null) {
  const torrentSection = document.getElementById('torrentSearchSection');
  const torrentTitle = document.getElementById('torrentSectionTitle');
  const grid = document.getElementById('torrentListGrid');

  torrentSection.style.display = 'block';
  torrentTitle.scrollIntoView({ behavior: 'smooth' });

  let displayTitle = `Torrents for "${query}"`;
  if (episodeNum) displayTitle = `Episode ${episodeNum} Torrent Streams`;
  torrentTitle.textContent = displayTitle;
  grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div><p style="margin-left: 12px;">Searching selected indexers...</p></div>';

  try {
    let indexersToUse = [...state.preferences.selectedIndexers];
    
    // Context-aware indexer filtering based on media type
    if (categoryType === 'anime') {
      // For anime, use Nyaa (4) and general indexers, but remove movie/tv specific ones
      indexersToUse = indexersToUse.filter(id => !['3', '5', '10', '11', '12'].includes(id));
      // Ensure Nyaa is included for Anime if "all" was selected or if they have it checked
      if (!indexersToUse.includes('4')) indexersToUse.push('4');
    } else if (categoryType === 'movie') {
      // Remove Nyaa (4) and TV-specific (5, 12)
      indexersToUse = indexersToUse.filter(id => !['4', '5', '12'].includes(id));
    } else if (categoryType === 'tv') {
      // Remove Nyaa (4) and Movie-specific (3, 11)
      indexersToUse = indexersToUse.filter(id => !['4', '3', '11'].includes(id));
    }

    const selectedIndexers = indexersToUse.join(',');
    
    let finalQuery = query;
    let isHindiSearch = false;
    if (categoryType === 'anime') {
      const audioSelect = document.getElementById('animeAudioToggle');
      if (audioSelect) {
        if (audioSelect.value === 'sub') finalQuery += ' Sub';
        if (audioSelect.value === 'dub') finalQuery += ' Dub';
      }
    } else if (categoryType === 'movie' || categoryType === 'tv') {
      const originalLang = state.selectedMedia?.details?.original_language;
      // Auto-append Hindi for English or South Indian movies if not explicitly searched
      if (!query.toLowerCase().includes('hindi') && (originalLang === 'en' || originalLang === 'te' || originalLang === 'ta' || originalLang === 'ml')) {
          finalQuery += ' Hindi';
          isHindiSearch = true;
      }
    }

    const stream = new EventSource(`/api/search/stream?q=${encodeURIComponent(finalQuery)}&indexers=${selectedIndexers}`);
    
    let torrentsList = [];
    let hasReceivedResults = false;

    stream.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.done) {
        stream.close();
        if (torrentsList.length === 0) {
          const audioSelect = document.getElementById('animeAudioToggle');
          if (categoryType === 'anime' && audioSelect && audioSelect.value === 'dub') {
            audioSelect.value = 'sub';
            grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div><p style="margin-left: 12px;">No Dubbed torrents found. Falling back to Subbed search...</p></div>';
            setTimeout(() => {
              triggerTorrentSearch(query, categoryType, episodeNum, seasonNum);
            }, 500);
            return;
          }
          
          if (isHindiSearch) {
             grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div><p style="margin-left: 12px;">No Hindi dubbed torrents found. Falling back to original language...</p></div>';
             setTimeout(() => {
               // Re-trigger search without appending Hindi
               triggerTorrentSearch(query, categoryType, episodeNum, seasonNum);
             }, 500);
             return;
          }

          grid.innerHTML = `<div class="empty-state"><h3>No Torrent Results</h3><p>Try searching for a different query or check settings to enable other torrent indexers.</p></div>`;
        }
        return;
      }

      if (data.torrents && data.torrents.length > 0) {
        if (!hasReceivedResults) {
          grid.innerHTML = ''; // Remove spinner on first result
          hasReceivedResults = true;
        }

        torrentsList = torrentsList.concat(data.torrents);
        torrentsList = cleanAndFilterTorrents(torrentsList, categoryType, episodeNum, seasonNum);

        if (torrentsList.length > 0) {
          // Sort torrents using our relevance score function
          const details = state.selectedMedia?.details || {};
          let targetTitle = "";
          let releaseYear = null;

          if (state.selectedMedia?.type === 'anime') {
            targetTitle = details.title?.english || details.title?.romaji || '';
            if (details.startDate?.year) releaseYear = parseInt(details.startDate.year);
          } else {
            targetTitle = state.selectedMedia?.type === 'movie' 
              ? (details.title || details.original_title || '') 
              : (details.name || details.original_name || '');
            const dateStr = details.release_date || details.first_air_date || '';
            if (dateStr) releaseYear = parseInt(dateStr.split('-')[0]);
          }

          torrentsList.sort((a, b) => getRelevanceScore(b, targetTitle, releaseYear) - getRelevanceScore(a, targetTitle, releaseYear));

          const tabsContainer = document.getElementById('torrentProviderTabs');
          let activeFilter = 'all';
          if (tabsContainer) {
            const currentActive = tabsContainer.querySelector('.active');
            activeFilter = currentActive ? currentActive.dataset.source : 'all';
            
            // Rebuild tabs
            tabsContainer.innerHTML = '';
            
            // All Providers tab
            const allBtn = document.createElement('button');
            allBtn.className = `provider-tab ${activeFilter === 'all' ? 'active' : ''}`;
            allBtn.dataset.source = 'all';
            allBtn.innerHTML = `All Providers <span class="tab-count">${torrentsList.length}</span>`;
            allBtn.onclick = () => {
              document.querySelectorAll('.provider-tab').forEach(b => b.classList.remove('active'));
              allBtn.classList.add('active');
              renderFilteredTorrents(torrentsList, 'all', categoryType, episodeNum, seasonNum);
            };
            tabsContainer.appendChild(allBtn);

            // Individual Provider tabs
            const uniqueSources = [...new Set(torrentsList.map(t => t.source))].sort();
            uniqueSources.forEach(src => {
              const srcTorrents = torrentsList.filter(t => t.source === src);
              const tab = document.createElement('button');
              tab.className = `provider-tab ${activeFilter === src ? 'active' : ''}`;
              tab.dataset.source = src;
              tab.innerHTML = `${src} <span class="tab-count">${srcTorrents.length}</span>`;
              tab.onclick = () => {
                document.querySelectorAll('.provider-tab').forEach(b => b.classList.remove('active'));
                tab.classList.add('active');
                renderFilteredTorrents(torrentsList, src, categoryType, episodeNum, seasonNum);
              };
              tabsContainer.appendChild(tab);
            });
          }

          renderFilteredTorrents(torrentsList, activeFilter, categoryType, episodeNum, seasonNum);
        }
      }
    };

    stream.onerror = (err) => {
      console.error("SSE Error:", err);
      stream.close();
      if (torrentsList.length === 0) {
        grid.innerHTML = '<p class="error-state">Torrent search stream failed. Check backend logs.</p>';
      }
    };

  } catch (err) {
    grid.innerHTML = '<p class="error-state">Torrent search failed. Check backend server logs.</p>';
  }
}

function renderFilteredTorrents(torrentsList, selectedSource, categoryType, episodeNum, seasonNum) {
  const grid = document.getElementById('torrentListGrid');
  grid.innerHTML = '';

  const filtered = (selectedSource === 'all' ? torrentsList : torrentsList.filter(t => t.source === selectedSource))
    .sort((a, b) => {
      if (state.sortWebRipFirst) {
        const typeA = parseSourceType(a.title);
        const typeB = parseSourceType(b.title);
        const aIsWeb = (typeA === 'WEBRip' || typeA === 'WEB-DL');
        const bIsWeb = (typeB === 'WEBRip' || typeB === 'WEB-DL');
        if (aIsWeb && !bIsWeb) return -1;
        if (!aIsWeb && bIsWeb) return 1;
      }
      return (b.seeders || 0) - (a.seeders || 0);
    });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><h3>No Torrents from "${selectedSource}"</h3><p>Try choosing a different provider.</p></div>`;
    return;
  }

  filtered.forEach(torrent => {
    const item = document.createElement('div');
    item.className = 'torrent-item';
    const sizeFormatted = formatBytes(torrent.size);
    const quality = parseQuality(torrent.title);
    const extension = parseExtension(torrent.title);
    const sourceType = parseSourceType(torrent.title);

    item.innerHTML = `
      <div class="torrent-info">
        <h4 class="torrent-title" title="${torrent.title}">${torrent.title}</h4>
        <div class="torrent-meta">
          <span class="torrent-quality">${quality}</span>
          ${sourceType ? `<span class="torrent-quality" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">${sourceType}</span>` : ''}
          ${extension ? `<span class="torrent-quality">${extension}</span>` : ''}
          <span class="torrent-size">${sizeFormatted}</span>
          <span class="torrent-seeders">⬆ ${torrent.seeders}</span>
          <span>${torrent.source}</span>
        </div>
      </div>
      <div class="torrent-actions">
        <button class="torrent-btn play-torrent-btn" title="Play in browser">▶</button>
        <a href="${torrent.magnet}" class="torrent-btn" style="text-decoration:none;" title="Download Torrent">⏬</a>
        <button class="torrent-btn magnet-torrent-btn" title="Copy Magnet">📋</button>
      </div>
    `;



    item.querySelector('.play-torrent-btn').addEventListener('click', () => {
      const mediaTrackingInfo = {
        title: state.selectedMedia?.details?.title?.english || state.selectedMedia?.details?.title?.romaji || state.selectedMedia?.details?.name || state.selectedMedia?.details?.title || 'Video Stream',
        poster: state.selectedMedia?.details?.coverImage?.large || state.selectedMedia?.details?.poster_path || '',
        type: categoryType,
        episodeNumber: episodeNum,
        seasonNumber: seasonNum,
        id: state.selectedMedia?.id,
        imdbId: state.selectedMedia?.details?.imdb_id || state.selectedMedia?.details?.external_ids?.imdb_id
      };
      playTorrent(torrent.title, torrent.magnet, mediaTrackingInfo);
    });

    item.querySelector('.magnet-torrent-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(torrent.magnet);
      showToast('Magnet link copied to clipboard!', 'success');
    });

    grid.appendChild(item);
  });
}

// ==========================================================================
// Catalog Modal
// ==========================================================================

function openCatalogModal(type = 'anime', mediaId = '', defaultTitle = '', defaultPoster = '') {
  const modal = document.getElementById('catalogModal');
  modal.style.display = 'flex';

  document.getElementById('catalogItemType').value = type;
  document.getElementById('catalogItemId').value = mediaId;
  document.getElementById('catalogTitle').value = defaultTitle;
  document.getElementById('catalogPoster').value = defaultPoster;
  document.getElementById('catalogUrl').value = '';
  document.getElementById('catalogType').value = ['anime', 'movie', 'tv', 'direct'].includes(type) ? type : 'direct';
}

function initCatalogModal() {
  const modal = document.getElementById('catalogModal');
  const form = document.getElementById('catalogForm');
  const closeBtn = document.getElementById('catalogModalClose');
  const cancelBtn = document.getElementById('catalogCancel');

  const closeModal = () => {
    modal.style.display = 'none';
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  form.onsubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const title = document.getElementById('catalogTitle').value;
    const poster = document.getElementById('catalogPoster').value;
    const url = document.getElementById('catalogUrl').value;
    const type = document.getElementById('catalogType').value;

    try {
      const endpoint = state.auth.token ? '/api/user/catalog' : '/api/catalog';
      const res = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, poster, url, type })
      });
      const data = await res.json();

      showToast(`Added "${title}" to your Catalog!`, 'success');
      closeModal();

      if (state.currentView === 'catalog') {
        loadCatalogView();
      }
    } catch (err) {
      showToast('Failed to add item to catalog.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const topAddBtn = document.getElementById('catalogAddBtn');
  if (topAddBtn) {
    topAddBtn.onclick = () => {
      openCatalogModal('direct', '', '', '');
    };
  }
}

function getResponsiveCount(basePerRow = 6) {
  const w = window.innerWidth;
  if (w < 480) return basePerRow * 1;      // 1 row on phones
  if (w < 768) return basePerRow * 2;      // 2 rows on small tablets
  return basePerRow * 3;                   // 3 rows on desktop
}

function getGridItemsPerRow() {
  const w = window.innerWidth;
  if (w < 480) return 2;
  if (w < 640) return 3;
  if (w < 1024) return 4;
  if (w < 1400) return 5;
  return 6;
}

function getGridCount(rows = 3) {
  return getGridItemsPerRow() * rows;
}

function filterAdult(items) {
  if (state.preferences.enableAdultContent) return items;
  return (items || []).filter(item => {
    // 1. TMDB adult flag (loose check for boolean, number, or string)
    if (item.adult == true || item.adult === 1 || item.adult === 'true') return false;
    // 2. AniList adult flag
    if (item.isAdult === true) return false;
    // 3. Genre name check (Hentai, Adult 18+, Erotica)
    if (item.genres && Array.isArray(item.genres) && item.genres.some(g => {
      if (!g) return false;
      const name = (typeof g === 'string' ? g : (g.name || '')).toLowerCase();
      return name === 'hentai' || name === 'adult 18+' || name === 'erotica' || name === 'pornography';
    })) return false;
    // 4. Genre ID 99999 sentinel
    if (item.genre_ids && Array.isArray(item.genre_ids) && item.genre_ids.includes(99999)) return false;
    // 5. Drama + Romance + History combo
    if (item.genre_ids && Array.isArray(item.genre_ids) && item.genre_ids.length >= 3) {
      if (item.genre_ids.includes(18) && item.genre_ids.includes(10749) && item.genre_ids.includes(36)) return false;
    }
    // 6. Title + overview keyword scan for things that slipped through
    let titleStr = item.title || item.name || item.original_title || item.original_name || '';
    if (typeof titleStr === 'object') titleStr = titleStr.english || titleStr.romaji || titleStr.native || '';
    titleStr = titleStr.toLowerCase();
    const overview = (item.overview || item.description || '').toLowerCase();
    const adultKeywords = ['hentai', 'sex tape', 'hardcore', 'xxx', 'adult film', 'porn', 'sweet agony'];
    if (adultKeywords.some(k => titleStr.includes(k) || overview.includes(k))) return false;
    return true;
  });
}

// ==========================================================================
// SUGGESTION DRAWER
// ==========================================================================

function initSuggestionDrawer() {
  renderSuggestionAuth();
}

function renderSuggestionAuth() {}

async function loadSuggestionChannel(channel) {
  const container = document.getElementById('suggestionChannelContent');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:16px;color:#64748b;font-size:13px;">Loading...</div>';
  try {
    const res = await fetch(`/api/suggestions?channel=${channel}`);
    const items = await res.json();
    container.innerHTML = '';
    
    if (channel === 'suggestion' && state.auth.token) {
      const formDiv = document.createElement('div');
      formDiv.style.cssText = 'margin-bottom:10px;display:flex;flex-direction:column;gap:6px;';
      formDiv.innerHTML = `
        <input type="text" id="suggestionTitle" placeholder="Short title (optional)" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:7px 10px;border-radius:6px;font-size:12px;">
        <textarea id="suggestionContent" placeholder="Describe your suggestion..." style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:7px 10px;border-radius:6px;font-size:12px;min-height:50px;resize:vertical;"></textarea>
        <button class="drawer-guide-btn" id="suggestionSubmitBtn" style="width:100%;justify-content:center;">Submit Suggestion</button>
        <div id="suggestionDuplicateMsg" style="display:none;color:#f59e0b;font-size:11px;"></div>
      `;
      container.appendChild(formDiv);
      
      document.getElementById('suggestionSubmitBtn').addEventListener('click', async () => {
        const title = document.getElementById('suggestionTitle').value.trim();
        const content = document.getElementById('suggestionContent').value.trim();
        if (!content) return showToast('Please enter a suggestion', 'warning');
        const dupMsg = document.getElementById('suggestionDuplicateMsg');
        dupMsg.style.display = 'none';
        try {
          const r = await fetch('/api/suggestions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
            body: JSON.stringify({ channel: 'suggestion', title, content })
          });
          const data = await r.json();
          if (data.duplicate) {
            dupMsg.textContent = `⚠️ ${data.message}`;
            dupMsg.style.display = 'block';
          } else {
            document.getElementById('suggestionTitle').value = '';
            document.getElementById('suggestionContent').value = '';
            showToast('Suggestion submitted!', 'success');
            loadSuggestionChannel('suggestion');
          }
        } catch { showToast('Failed to submit', 'error'); }
      });
      
      const searchDiv = document.createElement('div');
      searchDiv.style.cssText = 'margin-bottom:8px;';
      searchDiv.innerHTML = `
        <div style="display:flex;gap:4px;">
          <input type="text" id="suggestionSearchInput" placeholder="Search suggestions..." style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;">
          <button id="suggestionSearchBtn" style="background:rgba(124,58,237,0.3);border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;">🔍</button>
        </div>
      `;
      container.appendChild(searchDiv);
      
      document.getElementById('suggestionSearchBtn').addEventListener('click', () => {
        const q = document.getElementById('suggestionSearchInput').value.trim();
        loadSuggestionChannelWithSearch('suggestion', q);
      });
      document.getElementById('suggestionSearchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('suggestionSearchBtn').click();
      });
    }
    
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:16px;color:#64748b;font-size:13px;';
      empty.textContent = channel === 'notice' ? 'No notices yet.' : channel === 'suggestion' ? 'No suggestions yet. Be the first!' : 'No status updates yet.';
      container.appendChild(empty);
    } else {
      items.forEach(item => {
        const card = document.createElement('div');
        card.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px;margin-bottom:8px;font-size:12px;';
        
        const authorLine = document.createElement('div');
        authorLine.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        const canDelete = state.auth.isAdmin || (state.auth.username && state.auth.username === item.author && channel !== 'notice');
        const canEdit = state.auth.username && (state.auth.username === item.author || state.auth.isAdmin);
        const actionsHtml = (state.auth.isAdmin || canDelete) ? `
          <div style="display:flex;gap:4px;">
            ${canEdit ? `<button class="drawer-edit-btn" data-id="${item.id}" data-content="${escHtml(item.content)}" data-title="${escHtml(item.title || '')}" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:11px;padding:2px;">✏️</button>` : ''}
            <button class="drawer-delete-btn" data-id="${item.id}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:11px;padding:2px;">🗑️</button>
          </div>
        ` : '';
        authorLine.innerHTML = `<span style="color:#64748b;font-size:11px;">👤 ${item.author || 'Unknown'}</span>
          <span style="display:flex;align-items:center;gap:8px;color:#64748b;font-size:10px;">${new Date(item.createdAt).toLocaleDateString()}${actionsHtml}</span>`;
        card.appendChild(authorLine);
        
        if (item.title) {
          const titleEl = document.createElement('div');
          titleEl.style.cssText = 'font-weight:600;color:#e2e8f0;margin-bottom:4px;';
          titleEl.textContent = item.title;
          card.appendChild(titleEl);
        }
        
        const contentEl = document.createElement('div');
        contentEl.style.cssText = 'color:#94a3b8;margin-bottom:6px;line-height:1.4;';
        contentEl.textContent = item.content;
        card.appendChild(contentEl);
        
        if (item.tags && item.tags.length > 0) {
          const tagsDiv = document.createElement('div');
          tagsDiv.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
          item.tags.forEach(tag => {
            const tagEl = document.createElement('span');
        const tagColors = { 'under-review': '#f59e0b', 'accepted': '#22c55e', 'rejected': '#ef4444', 'pending': '#3b82f6', 'implementing': '#a855f7' };
            tagEl.style.cssText = `background:${tagColors[tag] || '#64748b'}22;color:${tagColors[tag] || '#94a3b8'};padding:2px 8px;border-radius:4px;font-size:10px;border:1px solid ${tagColors[tag] || '#64748b'}44;`;
            tagEl.textContent = tag;
            tagsDiv.appendChild(tagEl);
          });
          card.appendChild(tagsDiv);
        }
        
        // Admin controls
        if (state.auth.isAdmin && channel !== 'notice') {
          const adminDiv = document.createElement('div');
          adminDiv.style.cssText = 'margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;';
          ['under-review', 'accepted', 'rejected', 'pending', 'implementing'].forEach(tag => {
            const btn = document.createElement('button');
            btn.textContent = tag;
            btn.style.cssText = `font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:${item.tags.includes(tag) ? 'rgba(124,58,237,0.3)' : 'transparent'};color:#fff;cursor:pointer;`;
            btn.addEventListener('click', async () => {
              await fetch(`/api/suggestions/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
                body: JSON.stringify({ tags: [tag] })
              });
              loadSuggestionChannel(channel);
            });
            adminDiv.appendChild(btn);
          });
          card.appendChild(adminDiv);
        }
        
        container.appendChild(card);
      });
      
      // Wire drawer delete buttons
      container.querySelectorAll('.drawer-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this item?')) return;
          const id = btn.dataset.id;
          const r = await fetch(`/api/suggestions/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${state.auth.token}` }
          });
          if (r.ok) { showToast('Deleted', 'success'); loadSuggestionChannel(channel); }
          else { const err = await r.json(); showToast(err.error || 'Delete failed', 'error'); }
        });
      });
      
      // Wire drawer edit buttons
      container.querySelectorAll('.drawer-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const card = btn.closest('div[style*="background:rgba(255,255,255,0.04)"]');
          if (!card) return;
          const contentEl = card.querySelector('div[style*="color:#94a3b8;margin-bottom:6px"]');
          const titleEl = card.querySelector('div[style*="font-weight:600"]');
          const currentContent = btn.dataset.content;
          const currentTitle = btn.dataset.title;
          const editDiv = document.createElement('div');
          editDiv.innerHTML = `
            <input type="text" id="drawerEditTitle_${btn.dataset.id}" value="${escHtml(currentTitle)}" style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:4px;box-sizing:border-box;" placeholder="Title (optional)">
            <textarea id="drawerEditContent_${btn.dataset.id}" style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;min-height:50px;resize:vertical;box-sizing:border-box;">${escHtml(currentContent)}</textarea>
            <div style="display:flex;gap:6px;margin-top:4px;">
              <button class="drawer-save-edit-btn" data-id="${btn.dataset.id}" style="font-size:11px;padding:4px 12px;background:rgba(124,58,237,0.3);border:none;color:#fff;border-radius:6px;cursor:pointer;">Save</button>
              <button class="drawer-cancel-edit-btn" style="font-size:11px;padding:4px 12px;background:rgba(255,255,255,0.06);border:none;color:#fff;border-radius:6px;cursor:pointer;">Cancel</button>
            </div>`;
          if (contentEl) { contentEl.style.display = 'none'; contentEl.after(editDiv); }
        });
      });
      
      // Wire drawer save/cancel (uses event delegation)
      container.addEventListener('click', async (e) => {
        if (e.target.classList.contains('drawer-save-edit-btn')) {
          const id = e.target.dataset.id;
          const newTitle = document.getElementById(`drawerEditTitle_${id}`)?.value?.trim() || '';
          const newContent = document.getElementById(`drawerEditContent_${id}`)?.value?.trim();
          if (!newContent) return showToast('Content cannot be empty', 'warning');
          await fetch(`/api/suggestions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
            body: JSON.stringify({ title: newTitle, content: newContent })
          });
          showToast('Updated!', 'success');
          loadSuggestionChannel(channel);
        }
        if (e.target.classList.contains('drawer-cancel-edit-btn')) {
          const card = e.target.closest('div[style*="background:rgba(255,255,255,0.04)"]');
          if (card) {
            const contentEl = card.querySelector('div[style*="color:#94a3b8;margin-bottom:6px"]');
            if (contentEl) contentEl.style.display = '';
            const editDiv = e.target.closest('div[style*="margin-top"]');
            if (editDiv) editDiv.remove();
          }
        }
      });
    }
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:13px;">Failed to load.</div>';
  }
}

// ==========================================================================
// SUGGESTIONS FULL PAGE VIEW
// ==========================================================================

function loadSuggestionsView() {
  const container = document.getElementById('suggestionsViewContent');
  if (!container) return;
  const channel = document.querySelector('.suggestion-global-tabs .suggestion-tab.active')?.dataset.channel || 'notice';
  renderSuggestionFullPage(container, channel);
  
  document.querySelectorAll('.suggestion-global-tabs .suggestion-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.suggestion-global-tabs .suggestion-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderSuggestionFullPage(container, tab.dataset.channel);
    };
  });
}

async function renderSuggestionFullPage(container, channel) {
  container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;font-size:14px;">Loading...</div>';
  try {
    const tagFilter = document.querySelector('.suggestion-tag-filter.active')?.dataset?.tag || '';
    const tagFilterBar = document.getElementById('suggestionTagFilters');
    if (tagFilterBar) tagFilterBar.style.display = channel === 'status' ? 'flex' : 'none';
    
    const fetchChannel = channel === 'status' ? 'suggestion' : channel;
    const res = await fetch(`/api/suggestions?channel=${fetchChannel}`);
    let items = await res.json();
    if (channel === 'status' && tagFilter) {
      items = items.filter(item => (item.tags || []).includes(tagFilter));
    }
    const isLoggedIn = state.auth.token && state.auth.username;
    const isAdmin = state.auth.isAdmin;
    
    let html = '';
    
    // New suggestion form (channel=suggestion + logged in)
    if (channel === 'notice' && isAdmin) {
      html += `
        <div class="suggestion-form-card">
          <h3 style="margin:0 0 8px;font-size:15px;color:#fff;">Post a Notice</h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <input type="text" id="fullNoticeTitle" placeholder="Notice title" class="suggestion-input">
            <textarea id="fullNoticeContent" placeholder="Write notice content..." class="suggestion-textarea" style="min-height:80px;"></textarea>
            <button class="btn btn-primary" id="fullNoticeSubmit" style="align-self:flex-end;">Post Notice</button>
          </div>
        </div>`;
    }
    
    if (channel === 'suggestion') {
      if (isLoggedIn) {
        html += `
          <div class="suggestion-form-card">
            <h3 style="margin:0 0 8px;font-size:15px;color:#fff;">Submit a Suggestion</h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <input type="text" id="fullSuggestionTitle" placeholder="Short title (optional)" class="suggestion-input">
              <textarea id="fullSuggestionContent" placeholder="Describe your suggestion in detail..." class="suggestion-textarea" style="min-height:100px;"></textarea>
              <div id="fullDuplicateMsg" style="display:none;color:#f59e0b;font-size:13px;"></div>
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-secondary" id="fullSuggestClear">Clear</button>
                <button class="btn btn-primary" id="fullSuggestionSubmit">Submit Suggestion</button>
              </div>
            </div>
          </div>`;
      } else {
        html += `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;text-align:center;margin-bottom:16px;">
          <p style="color:#94a3b8;margin:0 0 12px;">Sign in to submit suggestions.</p>
          <button class="btn btn-primary" onclick="document.getElementById('authModalOverlay').style.display='flex'">Sign In</button>
        </div>`;
      }
      
      // Search
      html += `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input type="text" id="fullSuggestionSearch" placeholder="Search suggestions..." class="suggestion-input" style="flex:1;">
          <button class="btn btn-secondary" id="fullSuggestionSearchBtn">🔍 Search</button>
        </div>`;
    }
    
    if (items.length === 0) {
      html += `<div style="text-align:center;padding:40px;color:#64748b;font-size:14px;">${
        channel === 'notice' ? 'No notices yet.' : channel === 'suggestion' ? 'No suggestions yet. Be the first!' : 'No status updates yet.'
      }</div>`;
    } else {
      items.forEach(item => {
        const tagColors = { 'under-review': '#f59e0b', 'accepted': '#22c55e', 'rejected': '#ef4444', 'pending': '#3b82f6', 'implementing': '#a855f7' };
        const tagsHtml = (item.tags || []).map(tag =>
          `<span style="background:${tagColors[tag] || '#64748b'}22;color:${tagColors[tag] || '#94a3b8'};padding:2px 10px;border-radius:4px;font-size:11px;border:1px solid ${tagColors[tag] || '#64748b'}44;">${tag}</span>`
        ).join('');
        
        html += `
          <div class="suggestion-card" data-id="${item.id}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
              <div style="flex:1;">
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap;">
                  <span style="color:#64748b;font-size:12px;">👤 ${item.author}</span>
                  <span style="color:#64748b;font-size:11px;">${new Date(item.createdAt).toLocaleDateString()}</span>
                  ${tagsHtml}
                </div>
                ${item.title ? `<h4 style="margin:0 0 4px;font-size:15px;color:#e2e8f0;">${escHtml(item.title)}</h4>` : ''}
                <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escHtml(item.content)}</p>
              </div>
              ${isLoggedIn && (item.author === state.auth.username || isAdmin) ? `<div style="display:flex;gap:4px;flex-shrink:0;">
                ${(item.author === state.auth.username || isAdmin) ? `<button class="edit-suggestion-btn" data-id="${item.id}" data-content="${escHtml(item.content)}" data-title="${escHtml(item.title || '')}" data-channel="${item.channel}" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:13px;padding:4px;" title="Edit">✏️</button>` : ''}
                <button class="delete-suggestion-btn" data-id="${item.id}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:13px;padding:4px;" title="Delete">🗑️</button>
              </div>` : ''}
            </div>
            ${isAdmin && (channel === 'suggestion' || channel === 'status') ? `
              <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;">
                ${['under-review', 'accepted', 'rejected', 'pending', 'implementing'].map(tag =>
                  `<button class="admin-tag-btn ${(item.tags || []).includes(tag) ? 'active' : ''}" data-id="${item.id}" data-tag="${tag}">${tag}</button>`
                ).join('')}
              </div>
              <div style="margin-top:8px;">
                <textarea class="admin-reply-input" data-id="${item.id}" placeholder="Admin reply..." style="width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#fff;padding:8px;border-radius:6px;font-size:13px;min-height:40px;resize:vertical;">${item.adminReply ? escHtml(item.adminReply) : ''}</textarea>
                <button class="admin-reply-btn" data-id="${item.id}" style="margin-top:4px;background:rgba(124,58,237,0.3);border:none;color:#fff;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;">${item.adminReply ? 'Update Reply' : 'Reply'}</button>
              </div>
            ` : ''}
            ${item.adminReply ? `<div style="margin-top:8px;background:rgba(124,58,237,0.06);border-left:2px solid var(--color-accent-primary);padding:8px 12px;border-radius:4px;font-size:13px;color:#cbd5e1;"><strong style="color:#fff;">Admin:</strong> ${escHtml(item.adminReply)}</div>` : ''}
          </div>`;
      });
    }
    
    container.innerHTML = html;
    
    // Wire events
    if (channel === 'notice' && isAdmin) {
      document.getElementById('fullNoticeSubmit')?.addEventListener('click', async () => {
        const title = document.getElementById('fullNoticeTitle').value.trim();
        const content = document.getElementById('fullNoticeContent').value.trim();
        if (!content) return showToast('Please write a notice', 'warning');
        await submitSuggestion('notice', title, content);
        renderSuggestionFullPage(container, channel);
      });
    }
    
    if (channel === 'suggestion') {
      document.getElementById('fullSuggestionSubmit')?.addEventListener('click', async () => {
        const title = document.getElementById('fullSuggestionTitle').value.trim();
        const content = document.getElementById('fullSuggestionContent').value.trim();
        if (!content) return showToast('Please write a suggestion', 'warning');
        const dupMsg = document.getElementById('fullDuplicateMsg');
        dupMsg.style.display = 'none';
        const r = await fetch('/api/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
          body: JSON.stringify({ channel: 'suggestion', title, content })
        });
        const data = await r.json();
        if (data.duplicate) {
          dupMsg.textContent = `⚠️ ${data.message}`;
          dupMsg.style.display = 'block';
        } else {
          showToast('Suggestion submitted!', 'success');
          renderSuggestionFullPage(container, channel);
        }
      });
      document.getElementById('fullSuggestClear')?.addEventListener('click', () => {
        document.getElementById('fullSuggestionTitle').value = '';
        document.getElementById('fullSuggestionContent').value = '';
      });
      document.getElementById('fullSuggestionSearchBtn')?.addEventListener('click', async () => {
        const q = document.getElementById('fullSuggestionSearch').value.trim();
        if (!q) return renderSuggestionFullPage(container, channel);
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Searching...</div>';
        const r = await fetch(`/api/suggestions?channel=suggestion&search=${encodeURIComponent(q)}`);
        const results = await r.json();
        if (results.length === 0) showToast('No matching suggestions', 'info');
        renderSuggestionFullPage(container, channel);
      });
    }
    
    // Admin tag buttons
    document.querySelectorAll('.admin-tag-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const tag = btn.dataset.tag;
        await fetch(`/api/suggestions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
          body: JSON.stringify({ tags: [tag] })
        });
        renderSuggestionFullPage(container, channel);
      });
    });
    
    // Admin reply buttons
    document.querySelectorAll('.admin-reply-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const textarea = document.querySelector(`.admin-reply-input[data-id="${id}"]`);
        const reply = textarea?.value?.trim() || '';
        const body = { tags: [] };
        // Also save reply via tag update mechanism - actually we need a separate endpoint for reply
        // For now, use the suggestions update with a reply field
        await fetch(`/api/suggestions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
          body: JSON.stringify({ adminReply: reply })
        });
        showToast('Reply saved', 'success');
        renderSuggestionFullPage(container, channel);
      });
    });
    
    // Edit suggestion button
    document.querySelectorAll('.edit-suggestion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.suggestion-card');
        if (!card) return;
        const contentEl = card.querySelector('p');
        const titleEl = card.querySelector('h4');
        const currentContent = btn.dataset.content;
        const currentTitle = btn.dataset.title;
        // Replace with edit form
        const editHtml = `
          <div style="margin-top:8px;">
            <input type="text" id="editTitle_${btn.dataset.id}" value="${escHtml(currentTitle)}" class="suggestion-input" placeholder="Title (optional)" style="margin-bottom:6px;">
            <textarea id="editContent_${btn.dataset.id}" class="suggestion-textarea" style="min-height:80px;">${escHtml(currentContent)}</textarea>
            <div style="display:flex;gap:8px;margin-top:6px;">
              <button class="btn btn-secondary save-edit-btn" data-id="${btn.dataset.id}" style="padding:6px 16px;font-size:13px;">Save</button>
              <button class="btn btn-secondary cancel-edit-btn" style="padding:6px 16px;font-size:13px;background:rgba(255,255,255,0.06);">Cancel</button>
            </div>
          </div>`;
        // Replace content area
        const contentArea = card.querySelector('div[style*="flex:1"]');
        if (contentArea) {
          const oldContent = contentArea.innerHTML;
          contentArea.dataset.oldContent = oldContent;
          contentArea.innerHTML = editHtml;
        }
      });
    });
    
    // Save edit
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('save-edit-btn')) {
        const id = e.target.dataset.id;
        const newTitle = document.getElementById(`editTitle_${id}`)?.value?.trim() || '';
        const newContent = document.getElementById(`editContent_${id}`)?.value?.trim();
        if (!newContent) return showToast('Content cannot be empty', 'warning');
        await fetch(`/api/suggestions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
          body: JSON.stringify({ title: newTitle, content: newContent })
        });
        showToast('Updated!', 'success');
        renderSuggestionFullPage(container, channel);
      }
      if (e.target.classList.contains('cancel-edit-btn')) {
        const card = e.target.closest('.suggestion-card');
        if (card) {
          const contentArea = card.querySelector('div[style*="flex:1"]');
          if (contentArea && contentArea.dataset.oldContent) {
            contentArea.innerHTML = contentArea.dataset.oldContent;
            delete contentArea.dataset.oldContent;
          }
        }
      }
    });
    
    // Wire delete buttons
    document.querySelectorAll('.delete-suggestion-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this item?')) return;
        const id = btn.dataset.id;
        const res = await fetch(`/api/suggestions/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.auth.token}` }
        });
        if (res.ok) {
          showToast('Deleted', 'success');
          renderSuggestionFullPage(container, channel);
        } else {
          const err = await res.json();
          showToast(err.error || 'Delete failed', 'error');
        }
      });
    });
    
    // Wire tag filter buttons
    document.querySelectorAll('.suggestion-tag-filter').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.suggestion-tag-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderSuggestionFullPage(container, channel);
      };
    });
    
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">Failed to load. ${e.message}</div>`;
  }
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function submitSuggestion(channel, title, content) {
  try {
    await fetch('/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.auth.token}` },
      body: JSON.stringify({ channel, title, content })
    });
  } catch { showToast('Failed to submit', 'error'); }
}

async function loadSuggestionChannelWithSearch(channel, search) {
  const container = document.getElementById('suggestionChannelContent');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:16px;color:#64748b;font-size:13px;">Searching...</div>';
  try {
    const res = await fetch(`/api/suggestions?channel=${channel}&search=${encodeURIComponent(search)}`);
    const items = await res.json();
    const activeTab = document.querySelector('.suggestion-tab.active');
    if (activeTab) loadSuggestionChannel(activeTab.dataset.channel);
    if (items.length === 0) showToast('No matching suggestions found', 'info');
  } catch { showToast('Search failed', 'error'); }
}

function updateAuthUI() {
  const isLoggedIn = state.auth.token && state.auth.username;
  const setBtn = (id, label, onClick) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = label;
    el.onclick = onClick;
  };
  if (isLoggedIn) {
    const displayName = state.auth.username + (state.auth.isAdmin ? ' 👑' : '');
    setBtn('authBtn', displayName, () => {
      if (confirm('Sign out?')) {
        state.auth.token = null; state.auth.username = null; state.auth.isAdmin = false;
        localStorage.removeItem('sv_token'); localStorage.removeItem('sv_username'); localStorage.removeItem('sv_isAdmin');
        window.location.reload();
      }
    });
    setBtn('drawerAuthBtn', `👤 ${displayName} (Sign Out)`, () => {
      if (confirm('Sign out?')) {
        state.auth.token = null; state.auth.username = null; state.auth.isAdmin = false;
        localStorage.removeItem('sv_token'); localStorage.removeItem('sv_username'); localStorage.removeItem('sv_isAdmin');
        window.location.reload();
      }
    });
  } else {
    setBtn('authBtn', 'Sign In', () => document.getElementById('authModalOverlay').style.display = 'flex');
    setBtn('drawerAuthBtn', 'Sign In', () => {
      closeDrawer();
      document.getElementById('authModalOverlay').style.display = 'flex';
    });
  }
  renderSuggestionAuth();
}

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================

function playStream(title, url, trackingInfo = {}) {
  const container = document.getElementById('theaterPlayerContainer');
  if (container) {
    if (trackingInfo.isYoutube) {
      container.innerHTML = `<iframe src="${url}" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen></iframe>`;
      return;
    }
    
    const isEmbed = /embed|vidsrc|multiembed|vidlink|smashy|moviesapi|autoembed/i.test(url) && !/\.(mp4|webm|m3u8|mkv|avi)(\?|$)/i.test(url);
    
    if (isEmbed) {
      container.innerHTML = `<iframe src="${url}" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen></iframe>`;
      return;
    }
    
    container.innerHTML = `<video id="inlineVideoPlayer" crossorigin="anonymous" playsinline controls style="width:100%; height:100%;"></video>`;
    const videoEl = document.getElementById('inlineVideoPlayer');
    const plyrInstance = new Plyr(videoEl, {
      captions: { active: true, update: true, language: 'auto' },
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen']
    });
    
    if (trackingInfo.imdbId) {
      const fetchSubtitles = async () => {
        try {
          let apiUrl = `https://opensubtitles-v3.strem.io/subtitles/movie/${trackingInfo.imdbId}.json`;
          if (trackingInfo.type === 'anime' || trackingInfo.seasonNumber) {
            const s = trackingInfo.seasonNumber || 1;
            const e = trackingInfo.episodeNumber || 1;
            apiUrl = `https://opensubtitles-v3.strem.io/subtitles/series/${trackingInfo.imdbId}:${s}:${e}.json`;
          }
          const res = await fetch(apiUrl);
          const data = await res.json();
          if (data.subtitles && data.subtitles.length > 0) {
            const engSubs = data.subtitles.filter(sub => sub.lang === 'eng');
            engSubs.forEach((sub, index) => {
              const track = document.createElement('track');
              track.kind = 'captions';
              track.label = `English ${index + 1}`;
              track.srclang = 'en';
              track.src = sub.url;
              if (index === 0) track.default = true;
              videoEl.appendChild(track);
            });
          }
        } catch (err) {}
      };
      fetchSubtitles();
    }
    
    videoEl.src = url;
    videoEl.addEventListener('loadedmetadata', () => {
      if (trackingInfo.currentTime) {
        videoEl.currentTime = trackingInfo.currentTime;
      }
      videoEl.play().catch(e => console.log('Inline play prevented:', e));
    }, { once: true });
    
    let lastSaved = 0;
    videoEl.addEventListener('timeupdate', () => {
      const ct = videoEl.currentTime;
      if (ct > 0 && Math.abs(ct - lastSaved) > 10) {
        lastSaved = ct;
        updateContinueWatching(ct, videoEl.duration, trackingInfo);
      }
    });

    videoEl.addEventListener('ended', () => {
      if (!state.preferences.autoplay) return;
      const type = state.selectedMedia?.type;
      if (type !== 'tv' && type !== 'anime') return;
      const active = document.querySelector('.aniwave-ep-btn.active');
      const next = active?.nextElementSibling;
      if (next && next.classList.contains('aniwave-ep-btn') && !next.classList.contains('upcoming')) {
        next.click();
      }
    });

    let audioCtx, gainNode, sourceNode;
    let boostLevel = 1;
    const boostBtn = document.createElement('button');
    boostBtn.textContent = '🔊 1x';
    boostBtn.style.cssText = 'position:absolute; bottom:12px; right:12px; z-index:5; background:rgba(0,0,0,0.7); border:1px solid rgba(255,255,255,0.15); color:#fff; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit;';
    boostBtn.title = 'Boost volume up to 4x';
    boostBtn.addEventListener('click', () => {
      boostLevel = boostLevel >= 4 ? 1 : boostLevel + 1;
      boostBtn.textContent = `🔊 ${boostLevel}x`;
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioCtx.createGain();
        sourceNode = audioCtx.createMediaElementSource(videoEl);
        sourceNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      gainNode.gain.value = boostLevel;
    });
    container.style.position = 'relative';
    container.appendChild(boostBtn);
    
  } else {
    if (trackingInfo.isYoutube) {
      openIframePlayer(title, url);
      return;
    }
    openVideoPlayer(title, url, trackingInfo);
  }
}

async function resolveWebTorrentAndPlay(magnet, playerType, title, trackingInfo = {}) {
  setLoading(true);
  showToast('Connecting to local WebTorrent swarm to resolve metadata...', 'info');

  try {
    const addRes = await fetch('/api/webtorrent/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet })
    });
    const torrentInfo = await addRes.json();

    if (!torrentInfo || torrentInfo.error) {
      throw new Error(torrentInfo.error || 'Failed to add WebTorrent');
    }

    let videoFile = null;
    const files = torrentInfo.files || [];
    if (files.length > 0) {
      videoFile = files
        .filter(f => {
          const name = f.path.toLowerCase();
          return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') || name.endsWith('.avi');
        })
        .sort((a, b) => b.size - a.size)[0];
    }

    if (!videoFile) {
      throw new Error('No video files found in torrent');
    }

    const streamUrl = `https://torrserver.ankitgupta.com.np/api/webtorrent/stream?magnet=${encodeURIComponent(magnet)}&fileId=${videoFile.id}`;
    setLoading(false);

    // Dispatch event to allow browser extension companion to capture it
    document.dispatchEvent(new CustomEvent('stream-vault-play', {
      detail: {
        title: title,
        url: streamUrl,
        magnet: magnet,
        hash: torrentInfo.hash || '',
        fileId: videoFile.id
      }
    }));

    if (playerType === 'vlc' || playerType === 'mpv') {
      openInLocalPlayer(playerType, streamUrl, title);
    } else {
      openVideoPlayer(title, streamUrl, {
        ...trackingInfo,
        magnet: magnet,
        isWebTorrentLocal: true,
        fileId: videoFile.id
      });
    }
  } catch (err) {
    console.error(err);
    showToast(`WebTorrent resolution failed: ${err.message}`, 'error');
    setLoading(false);
  }
}

async function resolveTorrentAndPlay(magnet, playerType, title, trackingInfo = {}) {
  setLoading(true);
  showToast('Connecting to TorrServer to resolve stream...', 'info');

  try {
    const addRes = await fetch('/api/torrserver/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: magnet })
    });
    const torrentInfo = await addRes.json();

    if (!torrentInfo || torrentInfo.error || !torrentInfo.hash) {
      throw new Error(torrentInfo.error || 'Failed to add torrent');
    }

    state.activeTorrentHash = torrentInfo.hash;

    // Instant-launch playlist for external players (VLC/MPV) when playing general torrents (no specific episode)
    const isTVOrAnimeEpisode = (trackingInfo && trackingInfo.episodeNumber !== undefined && trackingInfo.episodeNumber !== null);
    if ((playerType === 'vlc' || playerType === 'mpv') && !isTVOrAnimeEpisode) {
      const playlistUrl = `${state.torrserverUrl}/playlist?hash=${torrentInfo.hash}`;
      console.log(`Instant-launching ${playerType} with TorrServer playlist:`, playlistUrl);
      setLoading(false);
      openInLocalPlayer(playerType, playlistUrl, title);
      return;
    }

    let videoFile = null;
    let files = torrentInfo.file_stats || [];

    if (files.length > 0) {
      videoFile = files
        .filter(f => {
          const name = f.path.toLowerCase();
          return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') || name.endsWith('.avi');
        })
        .sort((a, b) => b.size - a.size)[0];
    }

    let retries = 30;
    while (retries > 0 && !videoFile) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const getRes = await fetch(`/api/torrserver/torrent/${torrentInfo.hash}`);
        const getInfo = await getRes.json();
        files = getInfo.file_stats || [];
        videoFile = files
          .filter(f => {
            const name = f.path.toLowerCase();
            return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') || name.endsWith('.avi');
          })
          .sort((a, b) => b.size - a.size)[0];
        if (videoFile) {
          console.log('Found video file:', videoFile.path);
          break;
        }
      } catch (e) {
        console.log('Polling for video file...', e.message);
      }
      retries--;
    }

    if (!videoFile) {
      showToast('No video files found in torrent.', 'error');
      setLoading(false);
      return;
    }

    let streamUrl = `${state.torrserverUrl}/stream?link=${torrentInfo.hash}&index=${videoFile.id}&play`;
    let isHlsTranscode = false;

    // Automatically transcode for browser play if container/codec is unsupported
    if (playerType === 'torrserver') {
      const pathLower = videoFile.path.toLowerCase();
      const isUnsupportedContainer = pathLower.endsWith('.mkv') || pathLower.endsWith('.avi') || pathLower.endsWith('.ts');
      const isUnsupportedCodec = pathLower.includes('eac3') || pathLower.includes('ddp') || pathLower.includes('ac3') || pathLower.includes('dts') || pathLower.includes('truehd') || pathLower.includes('h265') || pathLower.includes('hevc') || pathLower.includes('x265') || pathLower.includes('10bit');
      if (isUnsupportedContainer || isUnsupportedCodec) {
        streamUrl = `${state.torrserverUrl}/stream/video.m3u8?link=${torrentInfo.hash}&index=${videoFile.id}&play`;
        isHlsTranscode = true;
        console.log('Automatically using TorrServer GStreamer transcoding:', streamUrl);
      }
    }

    console.log(`Resolved stream URL for ${playerType}:`, streamUrl);
    setLoading(false);

    // Dispatch event to allow browser extension companion to capture it
    document.dispatchEvent(new CustomEvent('stream-vault-play', {
      detail: {
        title: torrentInfo.title || title,
        url: streamUrl,
        magnet: magnet,
        hash: torrentInfo.hash,
        fileId: videoFile.id
      }
    }));

    if (playerType === 'vlc' || playerType === 'mpv') {
      openInLocalPlayer(playerType, streamUrl, title);
    } else {
      openVideoPlayer(torrentInfo.title || title, streamUrl, {
        ...trackingInfo,
        magnet: magnet,
        isTorrServer: true,
        hash: torrentInfo.hash,
        fileId: videoFile.id,
        isHls: isHlsTranscode
      });
    }
  } catch (err) {
    console.warn('TorrServer resolution failed, falling back to local WebTorrent...', err);
    showToast('TorrServer unavailable. Falling back to local WebTorrent engine...', 'warning');
    resolveWebTorrentAndPlay(magnet, playerType, title, trackingInfo);
  }
}

async function playTorrent(title, magnet, trackingInfo = {}) {
  const playerMode = state.preferences.player;

  if (playerMode === 'copy') {
    navigator.clipboard.writeText(magnet);
    showToast('Magnet link copied to clipboard!', 'success');
    return;
  }

  if (playerMode === 'vlc') {
    resolveTorrentAndPlay(magnet, 'vlc', title, trackingInfo);
    return;
  }

  if (playerMode === 'vlc_webtorrent') {
    const streamUrl = `https://torrserver.ankitgupta.com.np/api/webtorrent/stream?magnet=${encodeURIComponent(magnet)}`;
    openInLocalPlayer('vlc', streamUrl, title);
    return;
  }

  if (playerMode === 'mpv') {
    resolveTorrentAndPlay(magnet, 'mpv', title, trackingInfo);
    return;
  }

  if (playerMode === 'mpv_webtorrent') {
    const streamUrl = `https://torrserver.ankitgupta.com.np/api/webtorrent/stream?magnet=${encodeURIComponent(magnet)}`;
    openInLocalPlayer('mpv', streamUrl, title);
    return;
  }

  if (playerMode === 'webtorrent') {
    setLoading(true);
    showToast('Starting WebTorrent download...', 'info');
    try {
      const WebTorrent = await initWebTorrent();
      if (state.webTorrentClient) state.webTorrentClient.destroy();
      state.webTorrentClient = new WebTorrent();
      state.webTorrentClient.add(magnet, (torrent) => {
        const videoFile = torrent.files.find(f => {
          const name = f.name.toLowerCase();
          return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') || name.endsWith('.avi');
        });
        if (!videoFile) {
          showToast('No playable video found.', 'error');
          setLoading(false);
          return;
        }
        setLoading(false);
        openWebTorrentPlayer(torrent.name, videoFile, magnet, trackingInfo);
      });
      state.webTorrentClient.on('error', (err) => {
        showToast(err.message, 'error');
        setLoading(false);
      });
    } catch (err) {
      showToast('Failed to initialize WebTorrent.', 'error');
      setLoading(false);
    }
  }

  if (playerMode === 'torrserver') {
    resolveTorrentAndPlay(magnet, 'torrserver', title, trackingInfo);
    return;
  }
}

// ==========================================================================
// VIDEO PLAYER
// ==========================================================================

function openVideoPlayer(title, url, trackingInfo = {}) {
  const modal = document.getElementById('playerModal');
  const video = document.getElementById('videoPlayer');
  const titleEl = document.getElementById('playerTitle');

  modal.style.display = 'block';
  modal.style.position = '';
  modal.style.top = '';
  modal.style.left = '';
  modal.style.right = '';
  modal.style.bottom = '';
  modal.style.zIndex = '';
  modal.style.background = '';
  modal.style.alignItems = '';
  modal.style.justifyContent = '';

  titleEl.textContent = title || 'Video Player';

  // Clear old subtitle tracks
  Array.from(video.getElementsByTagName('track')).forEach(t => t.remove());

  // Automatically fetch English subtitles from Stremio API if imdbId is provided
  if (trackingInfo.imdbId) {
    const fetchSubtitles = async () => {
      try {
        let apiUrl = `https://opensubtitles-v3.strem.io/subtitles/movie/${trackingInfo.imdbId}.json`;
        if (trackingInfo.type === 'anime' || trackingInfo.seasonNumber) {
          const s = trackingInfo.seasonNumber || 1;
          const e = trackingInfo.episodeNumber || 1;
          apiUrl = `https://opensubtitles-v3.strem.io/subtitles/series/${trackingInfo.imdbId}:${s}:${e}.json`;
        }
        
        const res = await fetch(apiUrl);
        const data = await res.json();
        
        if (data && data.subtitles && data.subtitles.length > 0) {
          // Filter for English subtitles
          const engSubs = data.subtitles.filter(sub => sub.lang === 'eng');
          if (engSubs.length > 0) {
            const bestSub = engSubs[0];
            const track = document.createElement('track');
            track.className = 'custom-subtitle-track';
            track.kind = 'subtitles';
            track.label = 'English (Auto)';
            track.srclang = 'en';
            track.src = bestSub.url;
            track.default = true;
            
            video.appendChild(track);
            
            if (video.textTracks && video.textTracks.length > 0) {
              video.textTracks[video.textTracks.length - 1].mode = 'showing';
            }
            if (state.plyrInstance) {
              setTimeout(() => {
                state.plyrInstance.captions.currentTrack = 0;
                state.plyrInstance.captions.active = true;
              }, 200);
            }
            showToast('Auto-loaded English subtitles', 'info');
          }
        }
      } catch (err) {
        console.error('Failed to auto-fetch subtitles:', err);
      }
    };
    fetchSubtitles();
  }

  // Smooth scroll to the player
  modal.scrollIntoView({ behavior: 'smooth', block: 'start' });

  video.removeAttribute('src');
  video.load();

  // Save active playback state for reload recovery
  saveActivePlaybackState(title, url, trackingInfo);

  // Setup decoding error handler for browser
  const handleError = (e) => {
    console.error('Video element error:', video.error);
    let errorMsg = 'An error occurred during video playback.';
    if (video.error) {
      switch (video.error.code) {
        case 1: errorMsg = 'Playback aborted by user.'; break;
        case 2: errorMsg = 'Network error. The stream download was interrupted.'; break;
        case 3: errorMsg = 'Video decoding failed. The format may be unsupported by your browser.'; break;
        case 4: errorMsg = 'The video format or codec is not supported by your browser.'; break;
      }
    }
    
    if (trackingInfo.magnet) {
      showToast(`${errorMsg} Try transcoded playback or external player.`, 'error');
      
      const errorOverlay = document.createElement('div');
      errorOverlay.id = 'playerErrorOverlay';
      errorOverlay.style.cssText = 'position: absolute; inset: 0; background: rgba(20,20,40,0.95); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; z-index: 10; color: #fff;';
      errorOverlay.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <h3 style="margin-bottom: 8px; font-family: var(--font-family-display);">Unsupported Media Format</h3>
        <p style="color: var(--color-text-secondary); max-width: 400px; margin-bottom: 24px; font-size: 14px;">This video container (like MKV) or audio/video codec (like EAC3/DDP5.1) is not natively supported by your browser.</p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
          <button class="btn btn-primary" id="errorTranscodeBtn" style="background: #10b981; color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 500;">🔄 Try Transcoded Playback (TorrServer)</button>
          <button class="btn btn-primary" id="errorOpenVlcBtn" style="background: #4a90d9; color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 500;">🎬 Open in VLC Player</button>
          <button class="btn btn-primary" id="errorOpenMpvBtn" style="background: #55a630; color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 500;">🎬 Open in MPV Player</button>
          <button class="btn btn-secondary" id="errorCopyMagnetBtn" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 16px; border-radius: 8px; font-weight: 500;">📋 Copy Magnet Link</button>
        </div>
      `;
      
      const playerContainer = document.querySelector('.player-container');
      const existingOverlay = document.getElementById('playerErrorOverlay');
      if (existingOverlay) existingOverlay.remove();
      if (playerContainer) playerContainer.appendChild(errorOverlay);
      
      errorOverlay.querySelector('#errorTranscodeBtn').addEventListener('click', () => {
        tryTranscodedPlayback();
      });
      errorOverlay.querySelector('#errorOpenVlcBtn').addEventListener('click', () => {
        openInLocalPlayer('vlc', url, title);
      });
      errorOverlay.querySelector('#errorOpenMpvBtn').addEventListener('click', () => {
        openInLocalPlayer('mpv', url, title);
      });
      errorOverlay.querySelector('#errorCopyMagnetBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(trackingInfo.magnet);
        showToast('Magnet link copied!', 'success');
      });
    } else {
      showToast(errorMsg, 'error');
    }
  };

  const tryTranscodedPlayback = () => {
    const errorOverlay = document.getElementById('playerErrorOverlay');
    if (errorOverlay) errorOverlay.remove();
    
    const transcodeUrl = `${state.torrserverUrl}/stream/video.m3u8?link=${trackingInfo.hash}&index=${trackingInfo.fileId || 0}&play`;
    console.log('Attempting transcoded playback:', transcodeUrl);
    showToast('Initializing TorrServer transcoding...', 'info');
    
    initHls().then(Hls => {
      if (Hls.isSupported()) {
        if (state.hlsPlayer) {
          state.hlsPlayer.destroy();
          state.hlsPlayer = null;
        }

        state.hlsPlayer = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 600
        });

        state.hlsPlayer.loadSource(transcodeUrl);
        state.hlsPlayer.attachMedia(video);

        state.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, function () {
          console.log('HLS Transcoded parsed, playing...');
          video.play().catch(err => console.error('Play error:', err));
          showToast('Playing transcoded stream!', 'success');
        });

        state.hlsPlayer.on(Hls.Events.ERROR, function (event, data) {
          console.error('HLS Transcoded error:', data);
          if (data.fatal) {
            showToast('Transcoding failed. Make sure your TorrServer GStreamer settings are configured.', 'error');
            handleError(new Event('error'));
          }
        });
      } else {
        showToast('HLS is not supported in this browser.', 'error');
      }
    });
  };

  video.removeEventListener('error', handleError);
  video.addEventListener('error', handleError);

  const isHls = url.includes('.m3u8') || (trackingInfo.isHls && !trackingInfo.isTorrServer);

  console.log('Playing URL:', url);
  console.log('Is HLS:', isHls);

  if (isHls) {
    initHls().then(Hls => {
      if (Hls.isSupported()) {
        if (state.hlsPlayer) {
          state.hlsPlayer.destroy();
          state.hlsPlayer = null;
        }

        state.hlsPlayer = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10
        });

        state.hlsPlayer.loadSource(url);
        state.hlsPlayer.attachMedia(video);

        state.hlsPlayer.on(Hls.Events.ERROR, function (event, data) {
          console.error('HLS Error:', data);
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                showToast('Network error, trying to recover...', 'warning');
                state.hlsPlayer.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                showToast('Media error, trying to recover...', 'warning');
                state.hlsPlayer.recoverMediaError();
                break;
              default:
                showToast('HLS Error: ' + data.details, 'error');
                break;
            }
          }
        });

        state.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, function () {
          console.log('HLS Manifest parsed, playing...');
          video.play().catch(err => console.error('Play error:', err));
        });

        state.hlsPlayer.on(Hls.Events.FRAG_LOADED, function () {
          if (video.paused) {
            video.play().catch(err => console.error('Play error:', err));
          }
        });

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('loadedmetadata', () => {
          video.play().catch(err => console.error('Play error:', err));
        });
      } else {
        showToast('HLS not supported. Please use a modern browser.', 'error');
      }
    });
  } else {
    video.src = url;
    video.load();
    video.play().catch(err => console.error('Play error:', err));
  }

  const existingRecord = state.continueWatching.find(
    item => item.id === trackingInfo.id && item.episodeNumber === trackingInfo.episodeNumber
  );

  if (existingRecord && existingRecord.currentTime) {
    const setTime = () => {
      video.currentTime = existingRecord.currentTime;
      console.log('Resuming at:', existingRecord.currentTime);
    };
    video.addEventListener('loadedmetadata', setTime);
    setTimeout(setTime, 1000);
  }

  let lastSavedTime = 0;
  const progressSaver = () => {
    const curr = video.currentTime;
    if (curr > 0 && Math.abs(curr - lastSavedTime) > 10) {
      lastSavedTime = curr;
      updateContinueWatching(curr, video.duration, trackingInfo);

      // Save currentTime in localStorage playback state too
      const activePlayback = JSON.parse(localStorage.getItem('sv_active_playback') || '{}');
      if (activePlayback.trackingInfo) {
        activePlayback.trackingInfo.currentTime = curr;
        localStorage.setItem('sv_active_playback', JSON.stringify(activePlayback));
      }
    }
  };
  video.addEventListener('timeupdate', progressSaver);

  video.addEventListener('ended', () => {
    if (!state.preferences.autoplay) return;
    const mType = state.selectedMedia?.type;
    if (mType !== 'tv' && mType !== 'anime') return;
    const active = document.querySelector('.aniwave-ep-btn.active');
    const next = active?.nextElementSibling;
    if (next && next.classList.contains('aniwave-ep-btn') && !next.classList.contains('upcoming')) {
      setTimeout(() => next.click(), 500);
    }
  });

  const closeBtn = document.getElementById('playerClose');
  const closePlayer = () => {
    console.log('Closing player...');

    if (video.currentTime > 0) {
      updateContinueWatching(video.currentTime, video.duration, trackingInfo);
    }

    clearActivePlaybackState();
    const errorOverlay = document.getElementById('playerErrorOverlay');
    if (errorOverlay) errorOverlay.remove();
    video.removeEventListener('error', handleError);

    video.removeEventListener('timeupdate', progressSaver);
    video.pause();
    video.removeAttribute('src');
    video.load();

    if (state.hlsPlayer) {
      state.hlsPlayer.destroy();
      state.hlsPlayer = null;
    }

    // Removed: fetch('/api/torrserver/torrent/...') DELETE
    // TorrServer will automatically garbage collect idle streams.
    // This allows users to close the web player while VLC continues playing.

    modal.style.display = 'none';
  };

  closeBtn.onclick = closePlayer;

  const escHandler = (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closePlayer();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.removeEventListener('keydown', escHandler);
  document.addEventListener('keydown', escHandler);
}

// ==========================================================================
// WebTorrent Player
// ==========================================================================

function openWebTorrentPlayer(title, file, magnet, trackingInfo = {}) {
  const modal = document.getElementById('playerModal');
  const video = document.getElementById('videoPlayer');
  const titleEl = document.getElementById('playerTitle');
  const actionsEl = document.getElementById('playerActions');

  modal.style.display = 'flex';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.right = '0';
  modal.style.bottom = '0';
  modal.style.zIndex = '1000';
  modal.style.background = 'rgba(0,0,0,0.95)';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';

  // Save active playback state for reload recovery
  saveActivePlaybackState(title, '', { ...trackingInfo, magnet });

  titleEl.textContent = title || 'Video Player';
  actionsEl.innerHTML = '';

  // Add VLC button
  const vlcBtn = document.createElement('button');
  vlcBtn.className = 'player-action-btn vlc-btn';
  vlcBtn.innerHTML = '🎬 Open in VLC';
  vlcBtn.style.cssText = 'background: #4a90d9; border: none; color: #fff; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin: 4px;';
  vlcBtn.addEventListener('click', () => {
    openInVLC(magnet, title);
  });
  actionsEl.appendChild(vlcBtn);

  const copyBtn = document.createElement('button');
  copyBtn.style.cssText = 'background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin: 4px;';
  copyBtn.textContent = '📋 Copy Magnet';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(magnet);
    showToast('Magnet copied!', 'success');
  };
  actionsEl.appendChild(copyBtn);

  file.renderTo(video, { autoplay: true }, (err) => {
    if (err) {
      showToast('Render failed. MKV format requires VLC player support.', 'warning');
    }
  });

  const existingRecord = state.continueWatching.find(item => item.id === trackingInfo.id && item.episodeNumber === trackingInfo.episodeNumber);
  if (existingRecord && existingRecord.currentTime) {
    video.onloadedmetadata = () => {
      video.currentTime = existingRecord.currentTime;
    };
  }

  let lastSavedTime = 0;
  const progressSaver = () => {
    if (Math.abs(video.currentTime - lastSavedTime) > 10) {
      lastSavedTime = video.currentTime;
      updateContinueWatching(video.currentTime, video.duration, { ...trackingInfo, magnet });
    }
  };
  video.addEventListener('timeupdate', progressSaver);

  const closeBtn = document.getElementById('playerClose');
  closeBtn.onclick = () => {
    updateContinueWatching(video.currentTime, video.duration, { ...trackingInfo, magnet });
    clearActivePlaybackState();
    video.removeEventListener('timeupdate', progressSaver);
    video.pause();
    video.src = '';
    if (state.webTorrentClient) {
      state.webTorrentClient.destroy();
      state.webTorrentClient = null;
    }
    modal.style.display = 'none';
  };
}

// ==========================================================================
// Iframe Player (YouTube)
// ==========================================================================

function openIframePlayer(title, url) {
  const modal = document.getElementById('playerModal');
  const container = document.querySelector('.player-container');
  const titleEl = document.getElementById('playerTitle');
  const closeBtn = document.getElementById('playerClose');

  modal.style.display = 'flex';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.right = '0';
  modal.style.bottom = '0';
  modal.style.zIndex = '1000';
  modal.style.background = 'rgba(0,0,0,0.95)';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';

  titleEl.textContent = title || 'Trailer';

  const originalVideo = document.getElementById('videoPlayer');
  originalVideo.style.display = 'none';

  const iframe = document.createElement('iframe');
  iframe.id = 'trailerIframe';
  iframe.src = url;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.allow = 'autoplay; encrypted-media; fullscreen';
  iframe.allowFullscreen = true;

  container.appendChild(iframe);

  closeBtn.onclick = () => {
    iframe.remove();
    originalVideo.style.display = 'block';
    modal.style.display = 'none';
  };
}

// ==========================================================================
// Continue Watching
// ==========================================================================

function updateContinueWatching(currentTime, duration, trackingInfo) {
  if (!trackingInfo.title) return;
  if (trackingInfo.isYoutube) return;

  const progress = duration ? (currentTime / duration) : 0;
  if (progress > 0.95) {
    state.continueWatching = state.continueWatching.filter(
      item => !(item.id === trackingInfo.id && item.episodeNumber === trackingInfo.episodeNumber)
    );
    saveContinueWatching();
    return;
  }

  // Keep only the latest episode per show
  state.continueWatching = state.continueWatching.filter(
    item => !(item.id === trackingInfo.id && item.type === trackingInfo.type && item.episodeNumber !== trackingInfo.episodeNumber)
  );

  const existingIdx = state.continueWatching.findIndex(
    item => item.id === trackingInfo.id && item.episodeNumber === trackingInfo.episodeNumber
  );

  const watchRecord = {
    id: trackingInfo.id,
    title: trackingInfo.title,
    poster: trackingInfo.poster,
    type: trackingInfo.type,
    episodeNumber: trackingInfo.episodeNumber || 1,
    seasonNumber: trackingInfo.seasonNumber || 1,
    currentTime: currentTime,
    duration: duration,
    magnet: trackingInfo.magnet || null,
    url: trackingInfo.url || null,
    timestamp: Date.now()
  };

  if (existingIdx > -1) {
    state.continueWatching[existingIdx] = watchRecord;
  } else {
    state.continueWatching.unshift(watchRecord);
  }

  state.continueWatching.sort((a, b) => b.timestamp - a.timestamp);
  saveContinueWatching();
}

// ==========================================================================
// Playback State Persistence (Restore play on reload)
// ==========================================================================
function saveActivePlaybackState(title, url, trackingInfo) {
  localStorage.setItem('sv_active_playback', JSON.stringify({
    title,
    url,
    trackingInfo,
    timestamp: Date.now()
  }));
}

function clearActivePlaybackState() {
  localStorage.removeItem('sv_active_playback');
}

function restoreActivePlayback() {
  const activePlayback = localStorage.getItem('sv_active_playback');
  if (activePlayback) {
    try {
      const { title, url, trackingInfo, timestamp } = JSON.parse(activePlayback);
      // Only restore if it was within the last 2 hours
      if (Date.now() - timestamp < 2 * 60 * 60 * 1000) {
        console.log('Restoring active playback:', title);
        setTimeout(() => {
          showToast(`Resuming playback: ${title}`, 'success');
          if (trackingInfo.magnet) {
            playTorrent(title, trackingInfo.magnet, trackingInfo);
          } else {
            playStream(title, url, trackingInfo);
          }
        }, 500);
      } else {
        clearActivePlaybackState();
      }
    } catch (e) {
      console.error('Failed to restore active playback:', e);
      clearActivePlaybackState();
    }
  }
}

// ==========================================================================
// Bootstrap
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Fetch config and indexers
  Promise.all([
    fetch('/api/config').then(res => res.json()).catch(() => ({})),
    fetch('/api/indexers').then(res => res.json()).catch(() => [])
  ]).then(([config, indexers]) => {
    if (config.torrserverUrl) {
      state.torrserverUrl = config.torrserverUrl;
    }
    if (Array.isArray(indexers) && indexers.length > 0) {
      INDEXERS = {};
      indexers.forEach(idx => {
        INDEXERS[idx.id] = { name: idx.name, category: idx.category };
      });
      console.log('Loaded indexers:', INDEXERS);
    }
    populateHeaderIndexerSelect();
    loadPreferences();
  });

  // Initialize Plyr
  const videoEl = document.getElementById('videoPlayer');
  if (videoEl && typeof Plyr !== 'undefined') {
    state.plyrInstance = new Plyr(videoEl, {
      captions: { active: true, update: true, language: 'auto' },
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen']
    });
  }

  // Initialize
  initAuthModal();
  await loadUserData();
  initNavigation();
  initSearch();
  initCatalogModal();


  // Drawer collapsible suggestion system
  initSuggestionDrawer();

  // Filter listeners
  const bindFilter = (id, viewLoader) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', viewLoader);
  };

  bindFilter('movieLanguageFilter', loadMoviesView);
  bindFilter('tvLanguageFilter', loadTVView);
  bindFilter('animeGenreFilter', loadAnimeView);
  bindFilter('animeSeasonFilter', loadAnimeView);
  bindFilter('animeYearFilter', loadAnimeView);
  bindFilter('animeStatusFilter', loadAnimeView);
  bindFilter('movieYearFilter', loadMoviesView);
  bindFilter('movieGenreFilter', loadMoviesView);
  bindFilter('tvYearFilter', loadTVView);
  bindFilter('tvGenreFilter', loadTVView);
  bindFilter('scheduleTimezone', loadScheduleView);

  document.getElementById('animeFilterApply')?.addEventListener('click', () => loadAnimeView());
  document.getElementById('movieFilterApply')?.addEventListener('click', () => loadMoviesView());
  document.getElementById('tvFilterApply')?.addEventListener('click', () => loadTVView());

  // Check VLC status
  setTimeout(checkVLCInstalled, 2000);

  // Set up routing
  window.addEventListener('hashchange', () => { if (!state._routing) handleRouting(); });

  // Restore active playback if exists
  restoreActivePlayback();

  // Route initial URL
  handleRouting();

  // Hide splash screen
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 600);
  }
});

console.log('🚀 Stream Vault loaded successfully!');
