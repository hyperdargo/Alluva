/**
 * Stream Vault - Frontend Application Logic
 * Coordinates UI states, API integrations, torrent streaming, and preferences.
 */

// ==========================================================================
// Application State & Configuration
// ==========================================================================

const INDEXERS = {
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
    theme: 'system',
    player: 'torrserver',
    autoplay: false,
    selectedIndexers: [2, 4, 5, 11],
    vlcPath: '', // Custom VLC path
    vlcArgs: '', // Custom VLC arguments
    mpvPath: '', // Custom MPV path
    mpvArgs: '', // Custom MPV arguments
    enableAdultContent: false // 18+ content toggle
  },
  continueWatching: [],
  torrserverUrl: 'https://torrserver.ankitgupta.com.np',
  lastTorrentQuery: null,
  lastTorrentCategory: null,
  lastTorrentEpisode: null,
  lastTorrentSeason: null,
  vlcExtensionId: 'ihpiinojhnfhpdmmacgmpoonphhimkaj', // Open in VLC extension ID
  sortWebRipFirst: false,
  plyrInstance: null,
  currentPage: 1,
  isLoadingPage: false,
  currentCategory: null,
  currentFilters: {}
};

// ==========================================================================
// Dynamic Library Loaders\
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

    const res = await fetch('/api/play/local', {
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
  updateThemeUI();
  syncHeaderIndexerSelectUI();
}

function populateHeaderIndexerSelect() {
  const select = document.getElementById('indexerSelect');
  if (!select) return;

  select.innerHTML = '<option value="all">All Indexers</option>';
  Object.keys(INDEXERS).forEach(id => {
    const idx = INDEXERS[id];
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = idx.name;
    select.appendChild(opt);
  });

  syncHeaderIndexerSelectUI();

  select.onchange = (e) => {
    const val = e.target.value;
    if (val === 'all') {
      state.preferences.selectedIndexers = Object.keys(INDEXERS).map(id => parseInt(id));
      showToast('Selected all indexers for search', 'success');
    } else {
      state.preferences.selectedIndexers = [parseInt(val)];
      showToast(`Active search provider: ${INDEXERS[val].name}`, 'success');
    }
    savePreferences();

    const torrentSection = document.getElementById('torrentSearchSection');
    if (torrentSection && torrentSection.style.display !== 'none' && state.lastTorrentQuery) {
      triggerTorrentSearch(state.lastTorrentQuery, state.lastTorrentCategory, state.lastTorrentEpisode, state.lastTorrentSeason);
    }
  };
}

function syncHeaderIndexerSelectUI() {
  const select = document.getElementById('indexerSelect');
  if (!select) return;

  const selected = state.preferences.selectedIndexers || [];
  if (selected.length === 1) {
    select.value = selected[0];
  } else {
    select.value = 'all';
  }
}

function savePreferences() {
  localStorage.setItem('sv_preferences', JSON.stringify(state.preferences));
}

function saveContinueWatching() {
  localStorage.setItem('sv_continue_watching', JSON.stringify(state.continueWatching));
  renderContinueWatching();
}

function applyTheme(theme) {
  const root = document.documentElement;
  let targetTheme = theme;
  if (theme === 'system') {
    targetTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', targetTheme);
}

function updateThemeUI() {
  const select = document.getElementById('themeSetting');
  if (select) select.value = state.preferences.theme;
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.preferences.theme === 'system') {
    applyTheme('system');
  }
});

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

  // Close drawer on link click
  document.querySelectorAll('.drawer-link').forEach(link => {
    link.addEventListener('click', closeDrawer);
  });

  const detailBack = document.getElementById('detailBack');
  if (detailBack) {
    detailBack.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.hash = '#/' + (state.currentView || 'home');
      }
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
    const validViews = ['home', 'anime', 'movies', 'tv', 'schedule', 'catalog', 'settings'];
    if (validViews.includes(viewId)) {
      navigateTo(viewId);
    } else {
      navigateTo('home');
    }
  }
}

function navigateTo(viewId, extraData = null) {
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
          <button class="detail-action-btn hero-play-btn">▶ Watch Trailer</button>
          <button class="detail-action-btn secondary hero-details-btn">🔍 View Details</button>
        </div>
      </div>
    `;

    slide.querySelector('.hero-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      playFeaturedTrailer(item);
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
      setActiveSlide(index);
    });
    dotsDiv.appendChild(dot);
  });

  container.appendChild(dotsContainer);

  let currentSlide = 0;
  const slides = container.querySelectorAll('.hero-slide');
  const dots = container.querySelectorAll('.hero-dot');

  function setActiveSlide(index) {
    currentSlide = index;
    slides.forEach((slide, i) => {
      if (i === index) slide.classList.add('active');
      else slide.classList.remove('active');
    });
    dots.forEach((dot, i) => {
      if (i === index) dot.classList.add('active');
      else dot.classList.remove('active');
    });
  }

  heroInterval = setInterval(() => {
    currentSlide = (currentSlide + 1) % slides.length;
    setActiveSlide(currentSlide);
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
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&indexers=${selectedIndexers}&type=all&adult=${state.preferences.enableAdultContent}`);
    const data = await res.json();

    let hasAnime = data.anime && data.anime.length > 0;
    let hasMedia = data.media && data.media.length > 0;

    if (hasAnime && animeGrid) {
      animeGrid.innerHTML = '';
      data.anime.forEach(item => {
        animeGrid.appendChild(createMediaCard(item, 'anime'));
      });
      animeSection.style.display = 'block';
    }

    if (hasMedia && mediaGrid) {
      mediaGrid.innerHTML = '';
      data.media.forEach(item => {
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
    title = item.title ? (item.title.english || item.title.romaji || item.title.native) : 'Unknown Title';
    rating = item.averageScore ? (item.averageScore / 10).toFixed(1) : 'N/A';
    poster = item.coverImage ? (item.coverImage.large || item.coverImage.medium) : '';
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
      playStream(item.title, item.url, item);
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

  state.continueWatching.slice(0, 4).forEach(item => {
    const card = document.createElement('div');
    card.className = 'continue-card';

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

    card.querySelector('.continue-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.magnet) {
        playTorrent(item.title, item.magnet, item);
      } else {
        playStream(item.title, item.url, item);
      }
    });

    grid.appendChild(card);
  });
}

// ==========================================================================
// Views Implementations
// ==========================================================================

async function loadHomeView() {
  renderContinueWatching();

  const animeGrid = document.getElementById('trendingAnimeGrid');
  const moviesGrid = document.getElementById('popularMoviesGrid');
  const tvGrid = document.getElementById('trendingTVGrid');
  const upcomingMoviesGrid = document.getElementById('upcomingMoviesGrid');
  const topRatedMoviesGrid = document.getElementById('topRatedMoviesGrid');
  const topRatedTVGrid = document.getElementById('topRatedTVGrid');
  const upcomingAnimeGrid = document.getElementById('upcomingAnimeGrid');
  const torrentsGrid = document.getElementById('recentTorrentsGrid');

  const fillSkeletons = (el, count = 16) => {
    if (el) el.innerHTML = Array(count).fill('<div class="media-card poster-card skeleton"></div>').join('');
  };

  fillSkeletons(animeGrid);
  fillSkeletons(moviesGrid);
  fillSkeletons(tvGrid);
  fillSkeletons(upcomingMoviesGrid);
  fillSkeletons(topRatedMoviesGrid);
  fillSkeletons(topRatedTVGrid);
  fillSkeletons(upcomingAnimeGrid);
  fillSkeletons(torrentsGrid);

  try {
    const res = await fetch(`/api/trending?adult=${state.preferences.enableAdultContent}`);
    const data = await res.json();

    // Render Hero Banner
    if (data.featured) {
      renderHeroBanner(data.featured);
    }

    const populateGrid = (grid, items, type, emptyMsg) => {
      if (!grid) return;
      grid.innerHTML = '';
      if (items && items.length > 0) {
        items.slice(0, 16).forEach(item => {
          grid.appendChild(createMediaCard(item, type));
        });
      } else {
        grid.innerHTML = `<div class="empty-state"><p>${emptyMsg}</p></div>`;
      }
    };

    populateGrid(animeGrid, data.anime, 'anime', 'No trending anime found');
    populateGrid(moviesGrid, data.movies, 'movie', 'No popular movies found');
    populateGrid(tvGrid, data.tv, 'tv', 'No popular TV shows found');
    populateGrid(upcomingMoviesGrid, data.upcomingMovies, 'movie', 'No upcoming movies found');
    populateGrid(topRatedMoviesGrid, data.topRatedMovies, 'movie', 'No top rated movies found');
    populateGrid(topRatedTVGrid, data.topRatedTV, 'tv', 'No top rated TV shows found');
    populateGrid(upcomingAnimeGrid, data.upcomingAnime, 'anime', 'No upcoming anime found');

    if (torrentsGrid) {
      torrentsGrid.innerHTML = '';
      if (data.torrents && data.torrents.length > 0) {
        data.torrents.slice(0, 16).forEach(item => {
          const itemCard = document.createElement('div');
          itemCard.className = 'torrent-item';
          const qual = parseQuality(item.title);
          const ext = parseExtension(item.title);
          const sizeFormatted = formatBytes(item.size);

          itemCard.innerHTML = `
            <div class="torrent-info">
              <h4 class="torrent-title" title="${item.title}">${item.title}</h4>
              <div class="torrent-meta">
                <span class="torrent-quality">${qual}</span>
                ${ext ? `<span class="torrent-quality">${ext}</span>` : ''}
                <span class="torrent-size">${sizeFormatted}</span>
                <span class="torrent-seeders">⬆ ${item.seeders}</span>
                <span>${item.source}</span>
              </div>
            </div>
            <div class="torrent-actions">
              <button class="torrent-btn play-btn" title="Play in browser">▶</button>
              <button class="torrent-btn vlc-btn" title="Open in VLC">🎬</button>
              <button class="torrent-btn mpv-btn" title="Open in MPV">📺</button>
              <button class="torrent-btn magnet-btn" title="Copy Magnet">📋</button>
            </div>
          `;

          itemCard.querySelector('.play-btn').addEventListener('click', () => {
            playTorrent(item.title, item.magnet, { title: item.title, poster: '' });
          });

          itemCard.querySelector('.vlc-btn').addEventListener('click', () => {
            resolveTorrentAndPlay(item.magnet, 'vlc', item.title);
          });

          itemCard.querySelector('.mpv-btn').addEventListener('click', () => {
            resolveTorrentAndPlay(item.magnet, 'mpv', item.title);
          });

          itemCard.querySelector('.magnet-btn').addEventListener('click', () => {
            navigator.clipboard.writeText(item.magnet);
            showToast('Magnet link copied to clipboard!', 'success');
          });

          torrentsGrid.appendChild(itemCard);
        });
      } else {
        torrentsGrid.innerHTML = '<div class="empty-state"><p>No recent torrents found.</p></div>';
      }
    }

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

  const searchString = document.getElementById('searchInput').value.trim();
  const season = document.getElementById('animeSeasonFilter').value;
  const year = document.getElementById('animeYearFilter').value;
  const status = document.getElementById('animeStatusFilter').value;
  const genre = document.getElementById('animeGenreFilter').value;

  try {
    let url = '';

    if (searchString) {
      if (page > 1) { state.isLoadingPage = false; return; }
      const selectedIndexers = state.preferences.selectedIndexers.join(',');
      url = `/api/search?type=anime&indexers=${selectedIndexers}&q=${encodeURIComponent(searchString)}&adult=${state.preferences.enableAdultContent}`;
    } else {
      url = `/api/discover?type=anime&page=${page}&adult=${state.preferences.enableAdultContent}`;
      if (year) url += `&year=${year}`;
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
      } else {
        // API already filters year, so just filter status/season client side if needed
        if (season) filtered = filtered.filter(item => item.season === season);
        if (status) filtered = filtered.filter(item => item.status === status);
      }

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

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let url = '';

    // Search is handled client-side without infinite scroll currently
    if (searchString) {
      if (page > 1) { state.isLoadingPage = false; return; }
      url = `/api/search?type=movie&q=${encodeURIComponent(searchString)}&adult=${state.preferences.enableAdultContent}`;
    } else {
      url = `/api/discover?type=movie&page=${page}&adult=${state.preferences.enableAdultContent}`;
      if (year) url += `&year=${year}`;
      if (genre) url += `&genre=${genre}`;
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

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let url = '';

    if (searchString) {
      if (page > 1) { state.isLoadingPage = false; return; }
      url = `/api/search?type=tv&q=${encodeURIComponent(searchString)}&adult=${state.preferences.enableAdultContent}`;
    } else {
      url = `/api/discover?type=tv&page=${page}&adult=${state.preferences.enableAdultContent}`;
      if (year) url += `&year=${year}`;
      if (genre) url += `&genre=${genre}`;
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
  if (!select) return;
  const existingOptions = select.querySelectorAll('option:not(.adult-genre)');
  if (existingOptions.length > 1) return; // Already populated

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

  const adultOption = select.querySelector('.adult-genre');
  
  const sortedGenres = Array.from(foundIds)
    .map(id => ({ id, name: TMDB_GENRES[id] }))
    .filter(g => g.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  sortedGenres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    if (adultOption) {
      select.insertBefore(opt, adultOption);
    } else {
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
    const res = await fetch('/api/catalog');
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
            await fetch(`/api/catalog/${item.id}`, { method: 'DELETE' });
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
  const themeSetting = document.getElementById('themeSetting');
  themeSetting.value = state.preferences.theme;
  themeSetting.onchange = (e) => {
    state.preferences.theme = e.target.value;
    applyTheme(state.preferences.theme);
    savePreferences();
    showToast(`Theme updated to ${e.target.value}`, 'success');
  };

  const adultContentSetting = document.getElementById('adultContentSetting');
  if (adultContentSetting) {
    adultContentSetting.checked = state.preferences.enableAdultContent;
    adultContentSetting.onchange = (e) => {
      state.preferences.enableAdultContent = e.target.checked;
      savePreferences();
      showToast(e.target.checked ? '18+ content enabled' : '18+ content disabled', 'info');
      
      const adultGenres = document.querySelectorAll('.adult-genre');
      adultGenres.forEach(el => {
        el.style.display = state.preferences.enableAdultContent ? '' : 'none';
      });

      // Refresh home view if we are on it, or just let them navigate
      if (state.currentView === 'home') loadHomeView();
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
      const res = await fetch('/api/catalog');
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
          data.anime.slice(0, 4).forEach(item => items.push({ ...item, s_type: 'anime' }));
        }
        if (data.media) {
          data.media.slice(0, 4).forEach(item => {
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

async function openDetailsView(id, type) {
  setLoading(true);
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

    state.selectedMedia = { id, type, details, selectedSeason: 1 };
    renderDetails(content, details, type);

  } catch (err) {
    content.innerHTML = '<div class="error-state"><h3>Failed to load metadata</h3></div>';
  } finally {
    setLoading(false);
  }
}

function renderDetails(container, details, type) {
  let title = '', poster = '', banner = '', rating = 0, genres = [], description = '', subtitle = '';

  if (type === 'anime') {
    title = details.title.english || details.title.romaji || details.title.native;
    poster = details.coverImage.large || details.coverImage.medium;
    banner = details.bannerImage || details.coverImage.large;
    rating = details.averageScore ? (details.averageScore / 10).toFixed(1) : 'N/A';
    genres = details.genres || [];
    description = details.description || '';
    subtitle = `${details.format} • ${details.episodes || 'Unknown'} Episodes • ${details.status}`;
  } else {
    title = type === 'movie' ? (details.title || details.original_title) : (details.name || details.original_name);
    poster = getPosterUrl(details.poster_path);
    banner = getBannerUrl(details.backdrop_path);
    rating = details.vote_average ? details.vote_average.toFixed(1) : 'N/A';
    genres = details.genres ? details.genres.map(g => g.name) : [];
    description = details.overview || '';
    const date = details.release_date || details.first_air_date || '';
    subtitle = `${type.toUpperCase()} • ${date.split('-')[0]} • ${details.runtime || details.episode_run_time?.[0] || ''} min`;
  }

  const cleanDescription = description.replace(/<[^>]*>/g, '');

  container.innerHTML = `
    <div class="detail-banner" style="background-image: linear-gradient(to bottom, rgba(13,13,26,0.3), var(--color-bg-primary)), url('${banner}')"></div>
    <div class="detail-hero">
      <img class="detail-poster" src="${poster}" alt="${title}">
      <div class="detail-info">
        <div class="detail-title-row">
          <h1 class="detail-title">${title}</h1>
          <span class="detail-type-badge">${type}</span>
        </div>
        <div class="detail-meta">
          <span class="detail-rating">⭐ ${rating}</span>
          <span class="detail-meta-item">${subtitle}</span>
        </div>
        <div class="detail-genres">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>
        <p class="detail-synopsis">${cleanDescription}</p>
        <div class="detail-actions" id="detailHeaderActions"></div>
      </div>
    </div>
    <div class="detail-section">
      <h3 class="detail-section-title" id="episodeSectionTitle">Content Playback</h3>
      <div id="playbackControlsContainer"></div>
    </div>
    <div class="detail-section" id="torrentSearchSection" style="display: none;">
      <div style="display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-3);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <h3 class="detail-section-title" id="torrentSectionTitle" style="margin: 0;">Available Torrents</h3>
          <label style="font-size: 14px; display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--color-text-secondary); background: var(--color-bg-tertiary); padding: 4px 10px; border-radius: 20px;">
            <input type="checkbox" id="sortWebRipToggle" ${state.sortWebRipFirst ? 'checked' : ''}> ⭐ Prioritize WEBRip
          </label>
        </div>
        <div id="torrentProviderTabs" class="provider-tabs-container">
          <button class="provider-tab active" data-source="all">All Providers <span class="tab-count">0</span></button>
        </div>
      </div>
      <div class="torrents-list" id="torrentListGrid"></div>
    </div>
  `;

  const sortToggle = document.getElementById('sortWebRipToggle');
  if (sortToggle) {
    sortToggle.addEventListener('change', (e) => {
      state.sortWebRipFirst = e.target.checked;
      // Re-render currently displayed torrents list by triggering the active tab again
      const activeTab = document.querySelector('.provider-tab.active');
      if (activeTab) activeTab.click();
    });
  }

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
  catalogBtn.innerHTML = '➕ Add Stream Shortcut';
  catalogBtn.addEventListener('click', () => {
    openCatalogModal(type, details.id, title, poster);
  });
  headerActions.appendChild(catalogBtn);

  // HDHub4u Direct Download Button
  const ddlBtn = document.createElement('button');
  ddlBtn.className = 'detail-action-btn secondary';
  ddlBtn.innerHTML = '💾 Direct Download (HDHub4u)';
  ddlBtn.addEventListener('click', () => {
    const query = encodeURIComponent(title);
    window.open(`https://new2.hdhub4u.cl/?s=${query}`, '_blank');
  });
  headerActions.appendChild(ddlBtn);

  const playbackContainer = document.getElementById('playbackControlsContainer');

  if (type === 'movie') {
    document.getElementById('episodeSectionTitle').textContent = 'Stream Movie';
    const year = details.release_date ? details.release_date.split('-')[0] : '';
    const query = year ? `${title} ${year}` : title;

    playbackContainer.innerHTML = `
      <div style="display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); flex-wrap: wrap;">
        <button class="detail-action-btn" id="searchMovieTorrentsBtn">🔍 Re-search Torrents</button>
        <span style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">Searching movie torrent streams automatically...</span>
      </div>
    `;

    document.getElementById('searchMovieTorrentsBtn').addEventListener('click', () => {
      triggerTorrentSearch(query, 'movie');
    });

    setTimeout(() => triggerTorrentSearch(query, 'movie'), 150);

  } else if (type === 'anime') {
    document.getElementById('episodeSectionTitle').textContent = 'Episodes';
    const grid = document.createElement('div');
    grid.className = 'episodes-grid';
    const totalEpisodes = details.episodes || 1;
    for (let ep = 1; ep <= totalEpisodes; ep++) {
      const card = document.createElement('div');
      card.className = 'episode-card';
      card.innerHTML = `
        <div class="episode-number">${ep}</div>
        <div class="episode-info"><div class="episode-title">Episode ${ep}</div></div>
        <div class="episode-actions">
          <button class="episode-btn play-ep-btn">🔍</button>
        </div>
      `;
      card.addEventListener('click', () => {
        const query = `${details.title.romaji || details.title.english} ${ep}`;
        triggerTorrentSearch(query, 'anime', ep);
      });
      grid.appendChild(card);
    }
    playbackContainer.appendChild(grid);

  } else if (type === 'tv') {
    document.getElementById('episodeSectionTitle').textContent = 'TV Episodes';
    const seasons = details.seasons || [];
    const controlRow = document.createElement('div');
    controlRow.className = 'view-header';
    controlRow.style.margin = '0 0 var(--space-4) 0';

    const seasonSelect = document.createElement('select');
    seasonSelect.className = 'filter-select';
    seasons.forEach(s => {
      if (s.season_number === 0) return;
      const opt = document.createElement('option');
      opt.value = s.season_number;
      opt.textContent = s.name || `Season ${s.season_number}`;
      seasonSelect.appendChild(opt);
    });

    controlRow.innerHTML = `<span style="font-weight: 500;">Select Season:</span>`;
    controlRow.appendChild(seasonSelect);
    playbackContainer.appendChild(controlRow);

    const grid = document.createElement('div');
    grid.className = 'episodes-grid';
    playbackContainer.appendChild(grid);

    const renderTvEpisodes = async (seasonNum) => {
      grid.innerHTML = '<div class="spinner"></div>';
      try {
        const res = await fetch(`/api/media/tv/${details.id}/season/${seasonNum}`);
        const seasonData = await res.json();
        grid.innerHTML = '';
        if (seasonData.episodes) {
          seasonData.episodes.forEach(ep => {
            const card = document.createElement('div');
            card.className = 'episode-card';
            card.innerHTML = `
              <div class="episode-number">${ep.episode_number}</div>
              <div class="episode-info"><div class="episode-title">${ep.name || `Episode ${ep.episode_number}`}</div></div>
              <div class="episode-actions">
                <button class="episode-btn play-ep-btn">🔍</button>
              </div>
            `;
            card.addEventListener('click', () => {
              const pad = (n) => String(n).padStart(2, '0');
              const query = `${title} S${pad(seasonNum)}E${pad(ep.episode_number)}`;
              triggerTorrentSearch(query, 'tv', ep.episode_number, seasonNum);
            });
            grid.appendChild(card);
          });
        }
      } catch (e) {
        grid.innerHTML = '<p>Failed to retrieve episodes list.</p>';
      }
    };

    seasonSelect.addEventListener('change', (e) => {
      state.selectedMedia.selectedSeason = e.target.value;
      renderTvEpisodes(e.target.value);
    });

    if (seasons.length > 0) {
      const initialSeason = seasons[0].season_number === 0 ? (seasons[1]?.season_number || 0) : seasons[0].season_number;
      seasonSelect.value = initialSeason;
      state.selectedMedia.selectedSeason = initialSeason;
      renderTvEpisodes(initialSeason);
    }
  }
}

// ==========================================================================
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
    const stream = new EventSource(`/api/search/stream?q=${encodeURIComponent(query)}&indexers=${selectedIndexers}`);

    let torrentsList = [];
    let hasReceivedResults = false;

    stream.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.done) {
        stream.close();
        if (torrentsList.length === 0) {
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
        <button class="torrent-btn vlc-torrent-btn" title="Open in VLC">🎬</button>
        <button class="torrent-btn mpv-torrent-btn" title="Open in MPV">📺</button>
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

    item.querySelector('.vlc-torrent-btn').addEventListener('click', () => {
      const title = state.selectedMedia?.details?.title?.english || state.selectedMedia?.details?.title?.romaji || state.selectedMedia?.details?.name || 'Stream';
      resolveTorrentAndPlay(torrent.magnet, 'vlc', title);
    });

    item.querySelector('.mpv-torrent-btn').addEventListener('click', () => {
      const title = state.selectedMedia?.details?.title?.english || state.selectedMedia?.details?.title?.romaji || state.selectedMedia?.details?.name || 'Stream';
      resolveTorrentAndPlay(torrent.magnet, 'mpv', title);
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
      const res = await fetch('/api/catalog', {
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

// ==========================================================================
// Theme Toggler
// ==========================================================================

function initThemeToggler() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

    state.preferences.theme = nextTheme;
    applyTheme(nextTheme);
    savePreferences();
    updateThemeUI();

    showToast(`Switched to ${nextTheme} theme`, 'success');
  });
}

// ==========================================================================
// PLAYER FUNCTIONS
// ==========================================================================

function playStream(title, url, trackingInfo = {}) {
  if (trackingInfo.isYoutube) {
    openIframePlayer(title, url);
    return;
  }
  openVideoPlayer(title, url, trackingInfo);
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
  iframe.allow = 'autoplay; encrypted-media';
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
  if (!trackingInfo.title || !currentTime || !duration) return;
  if (trackingInfo.isYoutube) return;

  if (currentTime / duration > 0.95) {
    state.continueWatching = state.continueWatching.filter(
      item => !(item.id === trackingInfo.id && item.episodeNumber === trackingInfo.episodeNumber)
    );
    saveContinueWatching();
    return;
  }

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

document.addEventListener('DOMContentLoaded', () => {
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
  initNavigation();
  initSearch();
  initCatalogModal();
  initThemeToggler();

  // Filter listeners
  const bindFilter = (id, viewLoader) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', viewLoader);
  };

  bindFilter('animeSeasonFilter', loadAnimeView);
  bindFilter('animeYearFilter', loadAnimeView);
  bindFilter('animeStatusFilter', loadAnimeView);
  bindFilter('animeGenreFilter', loadAnimeView);
  
  bindFilter('movieYearFilter', loadMoviesView);
  bindFilter('movieGenreFilter', loadMoviesView);

  bindFilter('tvYearFilter', loadTVView);
  bindFilter('tvGenreFilter', loadTVView);
  bindFilter('scheduleTimezone', loadScheduleView);

  // Update UI elements dependent on 18+ toggle
  const adultGenres = document.querySelectorAll('.adult-genre');
  adultGenres.forEach(el => {
    el.style.display = state.preferences.enableAdultContent ? '' : 'none';
  });

  // Check VLC status
  setTimeout(checkVLCInstalled, 2000);

  // Set up routing
  window.addEventListener('hashchange', handleRouting);

  // Restore active playback if exists
  restoreActivePlayback();

  // Route initial URL
  handleRouting();
});

console.log('🚀 Stream Vault loaded successfully!');
