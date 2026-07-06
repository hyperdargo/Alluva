/**
 * Stream Vault - Frontend Application Logic
 * Coordinates UI states, API integrations, torrent streaming, and preferences.
 */

// ==========================================================================
// Application State & Configuration
// ==========================================================================

let INDEXERS = {
  1: { name: '1337x', category: 'Movies/TV' },
  2: { name: 'The Pirate Bay', category: 'General' },
  3: { name: 'YTS', category: 'Movies' },
  4: { name: 'Nyaa.si', category: 'Anime' },
  5: { name: 'EZTV', category: 'TV Shows' },
  6: { name: 'RARBG', category: 'Movies/TV' },
  7: { name: 'Torrentsome', category: 'General' },
  8: { name: 'LimeTorrents', category: 'General' },
  9: { name: 'SkTorrent', category: 'General' }
};

const state = {
  currentView: 'home',
  selectedMedia: null, // { id, type, details, selectedSeason }
  activeTorrentHash: null, // Track currently active TorrServer hash for cleanup
  webTorrentClient: null,
  hlsPlayer: null,
  searchDebounce: null,
  preferences: {
    theme: 'system',
    player: 'torrserver',
    autoplay: false,
    selectedIndexers: [1, 2, 3, 4, 5, 7, 8, 9] // Default: All Indexers
  },
  continueWatching: [],
  torrserverUrl: 'http://localhost:8090',
  lastTorrentQuery: null,
  lastTorrentCategory: null,
  lastTorrentEpisode: null,
  lastTorrentSeason: null
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

// ==========================================================================
// Utilities & UI Helpers
// ==========================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Select appropriate icon based on type
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  toast.innerHTML = `
    ${iconSvg}
    <div class="toast-message">${message}</div>
    <button class="toast-close" aria-label="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

  container.appendChild(toast);

  // Auto remove toast
  const timer = setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s reverse forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);

  toast.querySelector('.toast-close').addEventListener('click', () => {
    clearTimeout(timer);
    toast.remove();
  });
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
  
  // Try matching resolution numbers
  const match = title.match(/(\d{3,4})p/);
  if (match) return match[0];
  
  return 'SD';
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

  // Auto-migrate old preferences to select all active indexers by default
  const activeIds = Object.keys(INDEXERS).map(id => parseInt(id));
  if (!state.preferences.selectedIndexers || state.preferences.selectedIndexers.length === 0 || (state.preferences.selectedIndexers.length === 1 && state.preferences.selectedIndexers[0] === 4)) {
    state.preferences.selectedIndexers = activeIds.length > 0 ? activeIds : [1, 2, 3, 4, 5, 7, 8, 9];
  } else if (activeIds.length > 0) {
    // Filter out indexers that are no longer active in Prowlarr
    state.preferences.selectedIndexers = state.preferences.selectedIndexers.filter(id => activeIds.includes(id) || id === 4);
    if (state.preferences.selectedIndexers.length === 0) {
      state.preferences.selectedIndexers = activeIds;
    }
  }

  // Force migrate default player to TorrServer once
  if (localStorage.getItem('sv_player_migrated') !== 'torrserver_v2') {
    state.preferences.player = 'torrserver';
    localStorage.setItem('sv_player_migrated', 'torrserver_v2');
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

    // Re-trigger active torrent search if currently visible
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

// Listen to system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.preferences.theme === 'system') {
    applyTheme('system');
  }
});

// ==========================================================================
// Navigation & Routing
// ==========================================================================

function initNavigation() {
  const navItems = document.querySelectorAll('[data-view]');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.getAttribute('data-view');
      navigateTo(targetView);
    });
  });

  // Mobile sidebar toggle
  const toggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('sv_sidebar_collapsed', isCollapsed);
    });
    
    // Restore sidebar state
    const sidebarState = localStorage.getItem('sv_sidebar_collapsed');
    if (sidebarState === 'true') {
      sidebar.classList.add('collapsed');
    }
  }

  // Detail View Back button
  const detailBack = document.getElementById('detailBack');
  if (detailBack) {
    detailBack.addEventListener('click', () => {
      document.getElementById('detailView').style.display = 'none';
      document.getElementById('mainContent').style.overflow = '';
      navigateTo(state.currentView, false); // Reload view state
    });
  }
}

function navigateTo(viewId, updateHistory = true) {
  state.currentView = viewId;

  // Update sidebar active states
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('data-view') === viewId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Toggle View Section Elements
  document.querySelectorAll('.view').forEach(el => {
    if (el.id === `${viewId}View`) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Hide Details view just in case
  if (viewId !== 'detail') {
    document.getElementById('detailView').style.display = 'none';
  }

  // Hide Search Suggestions
  document.getElementById('searchSuggestions').classList.remove('active');

  // Load View Contents
  switch (viewId) {
    case 'home':
      loadHomeView();
      break;
    case 'anime':
      loadAnimeView();
      break;
    case 'movies':
      loadMoviesView();
      break;
    case 'tv':
      loadTVView();
      break;
    case 'schedule':
      loadScheduleView();
      break;
    case 'catalog':
      loadCatalogView();
      break;
    case 'settings':
      loadSettingsView();
      break;
  }
}

// ==========================================================================
// Card Rendering Functions (Re-usable)
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
    title = item.title.english || item.title.romaji || item.title.native;
    rating = item.averageScore ? (item.averageScore / 10).toFixed(1) : 'N/A';
    poster = item.coverImage.large || item.coverImage.medium;
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
          <span class="media-rating">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            ${rating}
          </span>
          <span class="media-type">${type}</span>
        </div>
      </div>
    </div>
  `;

  card.addEventListener('click', () => {
    if (type === 'catalog') {
      playStream(item.title, item.url, item);
    } else {
      openDetailsView(id, type);
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

  // Show up to 4 recent continue items
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
      <div class="media-actions">
        <button class="media-action-btn" aria-label="Resume playback">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </button>
      </div>
    `;

    card.addEventListener('click', () => {
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

// --- Home View ---
async function loadHomeView() {
  renderContinueWatching();

  const animeGrid = document.getElementById('trendingAnimeGrid');
  const moviesGrid = document.getElementById('popularMoviesGrid');
  const tvGrid = document.getElementById('trendingTVGrid');
  const torrentsGrid = document.getElementById('recentTorrentsGrid');

  // Fill grids with skeletons
  const fillSkeletons = (el, count = 6) => {
    el.innerHTML = Array(count).fill('<div class="media-card poster-card skeleton"></div>').join('');
  };

  fillSkeletons(animeGrid);
  fillSkeletons(moviesGrid);
  fillSkeletons(tvGrid);
  fillSkeletons(torrentsGrid);

  try {
    const res = await fetch('/api/trending');
    const data = await res.json();

    // Trending Anime
    animeGrid.innerHTML = '';
    if (data.anime && data.anime.length > 0) {
      data.anime.slice(0, 12).forEach(item => {
        animeGrid.appendChild(createMediaCard(item, 'anime'));
      });
    } else {
      animeGrid.innerHTML = '<div class="empty-state"><p>No trending anime found</p></div>';
    }

    // Popular Movies
    moviesGrid.innerHTML = '';
    if (data.movies && data.movies.length > 0) {
      data.movies.slice(0, 12).forEach(item => {
        moviesGrid.appendChild(createMediaCard(item, 'movie'));
      });
    } else {
      moviesGrid.innerHTML = '<div class="empty-state"><p>No popular movies found. Configure TMDB key in settings/environment.</p></div>';
    }

    // Popular TV
    tvGrid.innerHTML = '';
    if (data.tv && data.tv.length > 0) {
      data.tv.slice(0, 12).forEach(item => {
        tvGrid.appendChild(createMediaCard(item, 'tv'));
      });
    } else {
      tvGrid.innerHTML = '<div class="empty-state"><p>No popular TV shows found. Configure TMDB key in settings/environment.</p></div>';
    }

    // Recent Torrents
    torrentsGrid.innerHTML = '';
    if (data.torrents && data.torrents.length > 0) {
      data.torrents.slice(0, 12).forEach(item => {
        const itemCard = document.createElement('div');
        itemCard.className = 'torrent-item';
        const qual = parseQuality(item.title);
        const sizeFormatted = formatBytes(item.size);

        itemCard.innerHTML = `
          <div class="torrent-info">
            <h4 class="torrent-title" title="${item.title}">${item.title}</h4>
            <div class="torrent-meta">
              <span class="torrent-quality">${qual}</span>
              <span class="torrent-size">${sizeFormatted}</span>
              <span class="torrent-seeders">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="17 11 12 6 7 11"></polyline>
                  <polyline points="17 18 12 13 7 18"></polyline>
                </svg>
                ${item.seeders}
              </span>
              <span>${item.source}</span>
            </div>
          </div>
          <div class="torrent-actions">
            <button class="torrent-btn play-btn" title="Stream Play">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </button>
            <button class="torrent-btn magnet-btn" title="Copy Magnet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                <line x1="4" y1="22" x2="4" y2="15"></line>
              </svg>
            </button>
          </div>
        `;

        itemCard.querySelector('.play-btn').addEventListener('click', () => {
          playTorrent(item.title, item.magnet, { title: item.title, poster: '' });
        });

        itemCard.querySelector('.magnet-btn').addEventListener('click', () => {
          navigator.clipboard.writeText(item.magnet);
          showToast('Magnet link copied to clipboard!', 'success');
        });

        torrentsGrid.appendChild(itemCard);
      });
    } else {
      torrentsGrid.innerHTML = '<div class="empty-state"><p>No recent torrents found. Make sure Prowlarr/Torznab is running.</p></div>';
    }

  } catch (err) {
    console.error(err);
    showToast('Failed to fetch home feed', 'error');
  }
}

// --- Category View Filters Loader ---
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

// --- Anime View ---
async function loadAnimeView() {
  const grid = document.getElementById('animeGrid');
  grid.innerHTML = Array(12).fill('<div class="media-card poster-card skeleton"></div>').join('');

  populateYearFilters('animeYearFilter');

  const season = document.getElementById('animeSeasonFilter').value;
  const year = document.getElementById('animeYearFilter').value;
  const status = document.getElementById('animeStatusFilter').value;

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let data;
    if (searchString) {
      const res = await fetch(`/api/search?type=anime&indexers=4&q=${encodeURIComponent(searchString)}`);
      data = await res.json();
    } else {
      const res = await fetch('/api/trending');
      const trending = await res.json();
      data = { anime: trending.anime || [] };
    }
    
    grid.innerHTML = '';
    if (data.anime && data.anime.length > 0) {
      // Filter in memory for season/year/status if API doesn't filter perfectly
      let filtered = data.anime;
      if (season) filtered = filtered.filter(item => item.season === season);
      if (year) filtered = filtered.filter(item => item.startDate?.year == year);
      if (status) filtered = filtered.filter(item => item.status === status);

      if (filtered.length > 0) {
        filtered.forEach(item => {
          grid.appendChild(createMediaCard(item, 'anime'));
        });
      } else {
        grid.innerHTML = '<div class="empty-state"><h3>No matches found</h3><p>Try modifying your filters.</p></div>';
      }
    } else {
      grid.innerHTML = '<div class="empty-state"><h3>No results</h3><p>Could not fetch anime data.</p></div>';
    }
  } catch (err) {
    grid.innerHTML = '<div class="error-state"><h3>Error loading</h3><p>Failed to retrieve anime.</p></div>';
  }
}

// --- Movies View ---
async function loadMoviesView() {
  const grid = document.getElementById('moviesGrid');
  grid.innerHTML = Array(12).fill('<div class="media-card poster-card skeleton"></div>').join('');

  populateYearFilters('movieYearFilter');
  
  const year = document.getElementById('movieYearFilter').value;
  const genre = document.getElementById('movieGenreFilter').value;

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let url = '';
    if (searchString) {
      url = `/api/search?type=movie&q=${encodeURIComponent(searchString)}`;
    } else {
      url = '/api/trending'; // Fallback to popular trending
    }

    const res = await fetch(url);
    const data = await res.json();
    let items = searchString ? data.media : data.movies;

    grid.innerHTML = '';
    if (items && items.length > 0) {
      let filtered = items.filter(item => !item.media_type || item.media_type === 'movie');
      if (year) {
        filtered = filtered.filter(item => {
          const release = item.release_date || '';
          return release.startsWith(year);
        });
      }
      // Populate genres dynamically if empty
      populateGenres(items, 'movieGenreFilter');

      if (genre) {
        filtered = filtered.filter(item => item.genre_ids && item.genre_ids.includes(parseInt(genre)));
      }

      if (filtered.length > 0) {
        filtered.forEach(item => {
          grid.appendChild(createMediaCard(item, 'movie'));
        });
      } else {
        grid.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try resetting filters.</p></div>';
      }
    } else {
      grid.innerHTML = '<div class="empty-state"><h3>No Movies</h3><p>Configure your TMDB API Key in environment.</p></div>';
    }
  } catch (err) {
    grid.innerHTML = '<div class="error-state"><h3>Error loading</h3><p>Failed to connect to TMDB.</p></div>';
  }
}

// --- TV Shows View ---
async function loadTVView() {
  const grid = document.getElementById('tvGrid');
  grid.innerHTML = Array(12).fill('<div class="media-card poster-card skeleton"></div>').join('');

  populateYearFilters('tvYearFilter');

  const year = document.getElementById('tvYearFilter').value;
  const genre = document.getElementById('tvGenreFilter').value;

  try {
    const searchString = document.getElementById('searchInput').value.trim();
    let url = '';
    if (searchString) {
      url = `/api/search?type=tv&q=${encodeURIComponent(searchString)}`;
    } else {
      url = '/api/trending';
    }

    const res = await fetch(url);
    const data = await res.json();
    let items = searchString ? data.media : data.tv;

    grid.innerHTML = '';
    if (items && items.length > 0) {
      let filtered = items.filter(item => !item.media_type || item.media_type === 'tv');
      if (year) {
        filtered = filtered.filter(item => {
          const release = item.first_air_date || '';
          return release.startsWith(year);
        });
      }
      populateGenres(items, 'tvGenreFilter');

      if (genre) {
        filtered = filtered.filter(item => item.genre_ids && item.genre_ids.includes(parseInt(genre)));
      }

      if (filtered.length > 0) {
        filtered.forEach(item => {
          grid.appendChild(createMediaCard(item, 'tv'));
        });
      } else {
        grid.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try resetting filters.</p></div>';
      }
    } else {
      grid.innerHTML = '<div class="empty-state"><h3>No TV Shows</h3><p>Configure your TMDB API Key in environment.</p></div>';
    }
  } catch (err) {
    grid.innerHTML = '<div class="error-state"><h3>Error loading</h3><p>Failed to connect to TMDB.</p></div>';
  }
}

function populateGenres(items, selectId) {
  const select = document.getElementById(selectId);
  if (!select || select.children.length > 1) return;

  // Simple hardcoded mapping for popular TMDB genres to keep it fast
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

// --- Airing Schedule View ---
async function loadScheduleView() {
  const container = document.getElementById('scheduleContainer');
  container.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  try {
    const res = await fetch('/api/schedule');
    const schedule = await res.json();
    
    const timezone = document.getElementById('scheduleTimezone').value; // 'local', 'UTC', 'JST'
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
      // JST is UTC + 9
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
    
    // Format date header
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

// --- Catalog View ---
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
      
      // Override default catalog card behavior to add delete button
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

// --- Settings View ---
function loadSettingsView() {
  // Appearance Theme Setup
  const themeSetting = document.getElementById('themeSetting');
  themeSetting.value = state.preferences.theme;
  themeSetting.onchange = (e) => {
    state.preferences.theme = e.target.value;
    applyTheme(state.preferences.theme);
    savePreferences();
    showToast(`Theme updated to ${e.target.value}`, 'success');
  };

  // Playback Option
  const playerSetting = document.getElementById('playerSetting');
  playerSetting.value = state.preferences.player;
  playerSetting.onchange = (e) => {
    state.preferences.player = e.target.value;
    savePreferences();
    showToast(`Default player set to ${playerSetting.options[playerSetting.selectedIndex].text}`, 'success');
  };

  // Autoplay
  const autoplaySetting = document.getElementById('autoplaySetting');
  autoplaySetting.checked = state.preferences.autoplay;
  autoplaySetting.onchange = (e) => {
    state.preferences.autoplay = e.target.checked;
    savePreferences();
  };

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
        // Prevent clearing all indexers
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

  // Clear data
  document.getElementById('clearDataBtn').onclick = () => {
    if (confirm('Clear all settings, preferences, and Continue Watching history? This cannot be undone.')) {
      localStorage.removeItem('sv_preferences');
      localStorage.removeItem('sv_continue_watching');
      showToast('Cache cleared! Reloading...', 'info');
      setTimeout(() => location.reload(), 1500);
    }
  };

  // Export Data
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
      downloadAnchor.setAttribute("href",     dataStr);
      downloadAnchor.setAttribute("download", "stream-vault-data.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Export successful!', 'success');
    } catch (err) {
      showToast('Export failed.', 'error');
    }
  };
}

// ==========================================================================
// Search suggestions & input listeners
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
        // Search AniList and TMDB
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&indexers=4&type=all`);
        const data = await res.json();

        suggestions.innerHTML = '';
        const items = [];

        // Mix anime and movies/shows
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

            let title = '';
            let poster = '';
            let meta = '';

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
              openDetailsView(item.id, item.s_type);
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

  // Press Enter to trigger standard views search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      suggestions.classList.remove('active');
      const q = searchInput.value.trim();
      if (q.length >= 2) {
        if (state.currentView === 'home') {
          // If on home, let's navigate to anime view and search it
          navigateTo('anime');
        } else {
          navigateTo(state.currentView, false); // Reload active view with input query
        }
      }
    }
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      suggestions.classList.remove('active');
    }
  });
}

// ==========================================================================
// Details View Builder (Anime, Movie, TV)
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
  let title = '';
  let poster = '';
  let banner = '';
  let rating = 0;
  let genres = [];
  let description = '';
  let subtitle = '';

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

  // Sanitize description
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
          <span class="detail-rating">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            ${rating}
          </span>
          <span class="detail-meta-item">${subtitle}</span>
        </div>
        <div class="detail-genres">
          ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
        </div>
        <p class="detail-synopsis">${cleanDescription}</p>
        <div class="detail-actions" id="detailHeaderActions"></div>
      </div>
    </div>

    <!-- Episodes Grid or Search Torrents for Movie -->
    <div class="detail-section">
      <h3 class="detail-section-title" id="episodeSectionTitle">Content Playback</h3>
      <div id="playbackControlsContainer"></div>
    </div>

    <!-- Torrent Search results container -->
    <div class="detail-section" id="torrentSearchSection" style="display: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-3);">
        <h3 class="detail-section-title" id="torrentSectionTitle" style="margin: 0;">Available Torrents</h3>
        <div style="display: flex; align-items: center; gap: var(--space-2);">
          <span style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">Provider:</span>
          <select id="torrentSourceFilter" class="filter-select" style="margin: 0; padding: var(--space-1) var(--space-3); height: auto; font-size: var(--font-size-sm); width: auto;">
            <option value="all">All Providers</option>
          </select>
        </div>
      </div>
      <div class="torrents-list" id="torrentListGrid"></div>
    </div>
  `;

  // Dynamic Trailing details (Add Trailer / Add to Catalog shortcuts)
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
    trailerBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="23 7 16 12 23 17 23 7"></polygon>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
      </svg>
      Watch Trailer
    `;
    trailerBtn.addEventListener('click', () => {
      playStream(`${title} - Trailer`, `https://www.youtube.com/embed/${youtubeKey}?autoplay=1`, { isYoutube: true });
    });
    headerActions.appendChild(trailerBtn);
  }

  // Quick Catalog Add
  const catalogBtn = document.createElement('button');
  catalogBtn.className = 'detail-action-btn secondary';
  catalogBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
    Add Stream Shortcut
  `;
  catalogBtn.addEventListener('click', () => {
    openCatalogModal(type, details.id, title, poster);
  });
  headerActions.appendChild(catalogBtn);

  // Render Playback Contents
  const playbackContainer = document.getElementById('playbackControlsContainer');

  if (type === 'movie') {
    document.getElementById('episodeSectionTitle').textContent = 'Stream Movie';
    const year = details.release_date ? details.release_date.split('-')[0] : '';
    const query = year ? `${title} ${year}` : title;

    playbackContainer.innerHTML = `
      <div style="display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); flex-wrap: wrap;">
        <button class="detail-action-btn" id="searchMovieTorrentsBtn">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          Re-search Torrents
        </button>
        <span style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">
          Searching movie torrent streams automatically...
        </span>
      </div>
    `;

    document.getElementById('searchMovieTorrentsBtn').addEventListener('click', () => {
      triggerTorrentSearch(query, 'movie');
    });

    // Auto-trigger search immediately
    setTimeout(() => {
      triggerTorrentSearch(query, 'movie');
    }, 150);

  } else if (type === 'anime') {
    document.getElementById('episodeSectionTitle').textContent = 'Episodes';
    const grid = document.createElement('div');
    grid.className = 'episodes-grid';
    
    // AniList episodes count
    const totalEpisodes = details.episodes || 1;
    for (let ep = 1; ep <= totalEpisodes; ep++) {
      const card = document.createElement('div');
      card.className = 'episode-card';
      card.innerHTML = `
        <div class="episode-number">${ep}</div>
        <div class="episode-info">
          <div class="episode-title">Episode ${ep}</div>
        </div>
        <div class="episode-actions">
          <button class="episode-btn play-ep-btn" title="Search stream torrents">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
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
    
    // TMDB seasons renderer
    const seasons = details.seasons || [];
    const controlRow = document.createElement('div');
    controlRow.className = 'view-header';
    controlRow.style.margin = '0 0 var(--space-4) 0';

    const seasonSelect = document.createElement('select');
    seasonSelect.className = 'filter-select';
    seasons.forEach(s => {
      if (s.season_number === 0) return; // Skip specials usually
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
              <div class="episode-info">
                <div class="episode-title">${ep.name || `Episode ${ep.episode_number}`}</div>
              </div>
              <div class="episode-actions">
                <button class="episode-btn play-ep-btn" title="Search stream torrents">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </button>
              </div>
            `;

            card.addEventListener('click', () => {
              // TV Episode query: Name S01E01
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

    // Initial render season 1
    if (seasons.length > 0) {
      const initialSeason = seasons[0].season_number === 0 ? (seasons[1]?.season_number || 0) : seasons[0].season_number;
      seasonSelect.value = initialSeason;
      state.selectedMedia.selectedSeason = initialSeason;
      renderTvEpisodes(initialSeason);
    }
  }
}

// ==========================================================================
// Torrent Searching & Matching List Renderer
// ==========================================================================

async function triggerTorrentSearch(query, categoryType, episodeNum = null, seasonNum = null) {
  const torrentSection = document.getElementById('torrentSearchSection');
  const torrentTitle = document.getElementById('torrentSectionTitle');
  const grid = document.getElementById('torrentListGrid');

  torrentSection.style.display = 'block';
  torrentTitle.scrollIntoView({ behavior: 'smooth' });

  let displayTitle = `Torrents for "${query}"`;
  if (episodeNum) {
    displayTitle = `Episode ${episodeNum} Torrent Streams`;
  }
  torrentTitle.textContent = displayTitle;
  grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div><p style="margin-left: 12px;">Searching selected indexers...</p></div>';

  try {
    const selectedIndexers = state.preferences.selectedIndexers.join(',');
    let res = await fetch(`/api/search?q=${encodeURIComponent(query)}&indexers=${selectedIndexers}&type=torrent`);
    let data = await res.json();

    // Smart Fallback: If 0 results and the query has a year (e.g. "Name 2026"), search without the year
    const yearMatch = query.match(/\s+\d{4}$/);
    if ((!data.torrents || data.torrents.length === 0) && yearMatch) {
      const fallbackQuery = query.replace(/\s+\d{4}$/, '').trim();
      const spinnerMsg = grid.querySelector('p');
      if (spinnerMsg) {
        spinnerMsg.textContent = `No results with year. Retrying "${fallbackQuery}"...`;
      }
      res = await fetch(`/api/search?q=${encodeURIComponent(fallbackQuery)}&indexers=${selectedIndexers}&type=torrent`);
      data = await res.json();
    }

    grid.innerHTML = '';
    if (data.torrents && data.torrents.length > 0) {
      const torrentsList = data.torrents;
      
      // Populate unique sources in the filter dropdown
      const filterSelect = document.getElementById('torrentSourceFilter');
      if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">All Providers</option>';
        const uniqueSources = [...new Set(torrentsList.map(t => t.source))].sort();
        uniqueSources.forEach(src => {
          const opt = document.createElement('option');
          opt.value = src;
          opt.textContent = src;
          filterSelect.appendChild(opt);
        });

        // Set up filter onchange handler
        filterSelect.onchange = (e) => {
          const selectedSource = e.target.value;
          renderFilteredTorrents(torrentsList, selectedSource, categoryType, episodeNum, seasonNum);
        };
      }

      // Initial render (All)
      renderFilteredTorrents(torrentsList, 'all', categoryType, episodeNum, seasonNum);
    } else {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>No Torrent Results</h3>
          <p>Try searching for a different episode or check settings to enable other torrent indexers.</p>
        </div>
      `;
    }
  } catch (err) {
    grid.innerHTML = '<p class="error-state">Torrent search failed. Check backend server logs.</p>';
  }
}

// Render torrent items, supporting source filtering
function renderFilteredTorrents(torrentsList, selectedSource, categoryType, episodeNum, seasonNum) {
  const grid = document.getElementById('torrentListGrid');
  grid.innerHTML = '';

  const filtered = selectedSource === 'all' 
    ? torrentsList 
    : torrentsList.filter(t => t.source === selectedSource);

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No Torrents from "${selectedSource}"</h3>
        <p>Try choosing a different provider.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(torrent => {
    const item = document.createElement('div');
    item.className = 'torrent-item';
    
    const sizeFormatted = formatBytes(torrent.size);
    const quality = parseQuality(torrent.title);

    item.innerHTML = `
      <div class="torrent-info">
        <h4 class="torrent-title" title="${torrent.title}">${torrent.title}</h4>
        <div class="torrent-meta">
          <span class="torrent-quality">${quality}</span>
          <span class="torrent-size">${sizeFormatted}</span>
          <span class="torrent-seeders">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="17 11 12 6 7 11"></polyline>
              <polyline points="17 18 12 13 7 18"></polyline>
            </svg>
            ${torrent.seeders}
          </span>
          <span>${torrent.source}</span>
        </div>
      </div>
      <div class="torrent-actions">
        <button class="torrent-btn play-torrent-btn" title="Stream Video">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </button>
        <button class="torrent-btn magnet-torrent-btn" title="Copy Magnet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
            <line x1="4" y1="22" x2="4" y2="15"></line>
          </svg>
        </button>
      </div>
    `;

    // Click play button
    item.querySelector('.play-torrent-btn').addEventListener('click', () => {
      const mediaTrackingInfo = {
        title: state.selectedMedia.details.title?.english || state.selectedMedia.details.title?.romaji || state.selectedMedia.details.name || state.selectedMedia.details.title || 'Video Stream',
        poster: state.selectedMedia.details.coverImage?.large || state.selectedMedia.details.poster_path || '',
        type: categoryType,
        episodeNumber: episodeNum,
        seasonNumber: seasonNum,
        id: state.selectedMedia.id
      };
      playTorrent(torrent.title, torrent.magnet, mediaTrackingInfo);
    });

    // Click magnet button
    item.querySelector('.magnet-torrent-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(torrent.magnet);
      showToast('Magnet link copied to clipboard!', 'success');
    });

    grid.appendChild(item);
  });
}

// ==========================================================================
// Player Modal & Torrent Streaming Engines (WebTorrent & TorrServer)
// ==========================================================================

function playStream(title, url, trackingInfo = {}) {
  // If it's a Youtube trailer, we load it in an iframe
  if (trackingInfo.isYoutube) {
    openIframePlayer(title, url);
    return;
  }

  // Direct video URL play in modal
  openVideoPlayer(title, url, trackingInfo);
}

async function playTorrent(title, magnet, trackingInfo = {}) {
  const playerMode = state.preferences.player;

  if (playerMode === 'copy') {
    navigator.clipboard.writeText(magnet);
    showToast('Magnet link copied to clipboard!', 'success');
    return;
  }

  if (playerMode === 'vlc') {
    window.location.href = `vlc://${magnet}`;
    showToast('Opening stream in VLC...', 'info');
    return;
  }

  if (playerMode === 'webtorrent') {
    setLoading(true);
    showToast('Starting WebTorrent download client. Connecting to peers...', 'info');
    
    try {
      const WebTorrent = await initWebTorrent();
      
      // Cleanup existing client
      if (state.webTorrentClient) {
        state.webTorrentClient.destroy();
      }
      
      state.webTorrentClient = new WebTorrent();
      state.webTorrentClient.add(magnet, (torrent) => {
        // Find largest video file
        const videoFile = torrent.files.find(f => {
          const name = f.name.toLowerCase();
          return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') || name.endsWith('.avi');
        });

        if (!videoFile) {
          showToast('No playable video found inside the torrent files.', 'error');
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
      console.error(err);
      showToast('Failed to initialize WebTorrent. Try VLC or TorrServer mode.', 'error');
      setLoading(false);
    }
  }

  if (playerMode === 'torrserver') {
    setLoading(true);
    showToast('Uploading torrent magnet to TorrServer proxy...', 'info');

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

      // Poll TorrServer until metadata loads and files are populated (up to 15 seconds)
      let files = torrentInfo.file_stats || [];
      let retries = 15;

      while (retries > 0 && files.length === 0) {
        const getRes = await fetch(`/api/torrserver/torrent/${torrentInfo.hash}`);
        const getInfo = await getRes.json();
        files = getInfo.file_stats || [];
        if (files.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          retries--;
        }
      }

      const videoFile = files
        .filter(f => {
          const name = f.path.toLowerCase();
          return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mkv') || name.endsWith('.avi') || name.endsWith('.m3u8');
        })
        .sort((a, b) => b.size - a.size)[0];

      if (!videoFile) {
        showToast('No video files found in TorrServer torrent.', 'error');
        setLoading(false);
        return;
      }

      // Stream play URL on TorrServer directly
      const playUrl = `${state.torrserverUrl}/stream?hash=${torrentInfo.hash}&id=${videoFile.id}`;
      setLoading(false);
      
      openVideoPlayer(torrentInfo.title || title, playUrl, {
        ...trackingInfo,
        magnet: magnet,
        isTorrServer: true,
        hash: torrentInfo.hash
      });

    } catch (err) {
      console.error(err);
      showToast(`TorrServer stream initialization failed. Make sure TorrServer is reachable at ${state.torrserverUrl}.`, 'error');
      setLoading(false);
    }
  }
}

// --- Direct/HTTP/TorrServer Native Video Player ---
function openVideoPlayer(title, url, trackingInfo = {}) {
  const modal = document.getElementById('playerModal');
  const video = document.getElementById('videoPlayer');
  const titleEl = document.getElementById('playerTitle');
  const actionsEl = document.getElementById('playerActions');

  titleEl.textContent = title;
  modal.style.display = 'flex';
  actionsEl.innerHTML = '';

  // Setup control buttons in overlay
  if (trackingInfo.magnet) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'player-action-btn';
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
        <line x1="4" y1="22" x2="4" y2="15"></line>
      </svg>
      Copy Magnet
    `;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(trackingInfo.magnet);
      showToast('Magnet copied to clipboard', 'success');
    });
    actionsEl.appendChild(copyBtn);

    const vlcBtn = document.createElement('button');
    vlcBtn.className = 'player-action-btn';
    vlcBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      Open in VLC
    `;
    vlcBtn.addEventListener('click', () => {
      window.location.href = `vlc://${trackingInfo.magnet}`;
    });
    actionsEl.appendChild(vlcBtn);
  }

  // Setup video source (detect HLS .m3u8)
  if (url.includes('.m3u8')) {
    initHls().then(Hls => {
      if (Hls.isSupported()) {
        state.hlsPlayer = new Hls();
        state.hlsPlayer.loadSource(url);
        state.hlsPlayer.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      }
    });
  } else {
    video.src = url;
  }

  video.load();

  // Resume playback state if continuing
  const existingRecord = state.continueWatching.find(item => item.id === trackingInfo.id && item.episodeNumber === trackingInfo.episodeNumber);
  if (existingRecord && existingRecord.currentTime) {
    video.currentTime = existingRecord.currentTime;
    showToast(`Resumed from ${Math.floor(existingRecord.currentTime / 60)}m ${Math.floor(existingRecord.currentTime % 60)}s`, 'info');
  }

  video.play().catch(() => {});

  // Progress Tracking: timeupdate listener
  let lastSavedTime = 0;
  const progressSaver = () => {
    const curr = video.currentTime;
    if (Math.abs(curr - lastSavedTime) > 10) { // save every 10 seconds
      lastSavedTime = curr;
      updateContinueWatching(curr, video.duration, trackingInfo);
    }
  };

  video.addEventListener('timeupdate', progressSaver);

  // Cleanup on Close
  const closeBtn = document.getElementById('playerClose');
  const closePlayer = () => {
    // Save progress on close
    updateContinueWatching(video.currentTime, video.duration, trackingInfo);
    
    video.removeEventListener('timeupdate', progressSaver);
    video.pause();
    video.src = '';
    
    if (state.hlsPlayer) {
      state.hlsPlayer.destroy();
      state.hlsPlayer = null;
    }

    // Cleanup TorrServer Drop cache
    if (trackingInfo.isTorrServer && trackingInfo.hash) {
      fetch(`/api/torrserver/torrent/${trackingInfo.hash}`, { method: 'DELETE' });
    }

    modal.style.display = 'none';
  };

  closeBtn.onclick = closePlayer;
}

// --- WebTorrent stream renderer ---
function openWebTorrentPlayer(title, file, magnet, trackingInfo = {}) {
  const modal = document.getElementById('playerModal');
  const video = document.getElementById('videoPlayer');
  const titleEl = document.getElementById('playerTitle');
  const actionsEl = document.getElementById('playerActions');

  titleEl.textContent = title;
  modal.style.display = 'flex';
  actionsEl.innerHTML = '';

  // Render to player
  file.renderTo(video, { autoplay: true }, (err) => {
    if (err) {
      showToast('Render failed. MKV format requires VLC player support.', 'warning');
    }
  });

  // Controls overlay
  const copyBtn = document.createElement('button');
  copyBtn.className = 'player-action-btn';
  copyBtn.innerHTML = 'Copy Magnet';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(magnet);
    showToast('Magnet copied!', 'success');
  };
  actionsEl.appendChild(copyBtn);

  const vlcBtn = document.createElement('button');
  vlcBtn.className = 'player-action-btn';
  vlcBtn.innerHTML = 'Open in VLC';
  vlcBtn.onclick = () => {
    window.location.href = `vlc://${magnet}`;
  };
  actionsEl.appendChild(vlcBtn);

  // Resume progress
  const existingRecord = state.continueWatching.find(item => item.id === trackingInfo.id && item.episodeNumber === trackingInfo.episodeNumber);
  if (existingRecord && existingRecord.currentTime) {
    // Wait for metadata loaded
    video.onloadedmetadata = () => {
      video.currentTime = existingRecord.currentTime;
    };
  }

  // Timeupdate progress tracker
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
    video.removeEventListener('timeupdate', progressSaver);
    video.pause();
    video.src = '';
    
    // Destroy WebTorrent Client to release memory
    if (state.webTorrentClient) {
      state.webTorrentClient.destroy();
      state.webTorrentClient = null;
    }
    
    modal.style.display = 'none';
  };
}

// --- Youtube Trailer Iframe Modal Player ---
function openIframePlayer(title, url) {
  const modal = document.getElementById('playerModal');
  const container = document.querySelector('.player-container');
  const titleEl = document.getElementById('playerTitle');
  const closeBtn = document.getElementById('playerClose');

  titleEl.textContent = title;
  modal.style.display = 'flex';
  
  // Replace <video> with iframe temporarily
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

// --- Continue Watching state updates ---
function updateContinueWatching(currentTime, duration, trackingInfo) {
  if (!trackingInfo.title || !currentTime || !duration) return;

  // Don't track trailers
  if (trackingInfo.isYoutube) return;

  // If completed (>95%), remove from continue watching
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
    episodeNumber: trackingInfo.episodeNumber,
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
    state.continueWatching.unshift(watchRecord); // add to front
  }

  // Sort by recent
  state.continueWatching.sort((a, b) => b.timestamp - a.timestamp);

  saveContinueWatching();
}

// ==========================================================================
// Catalog Addition & Management Modal
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

  // Header Add Catalog trigger button
  const topAddBtn = document.getElementById('catalogAddBtn');
  if (topAddBtn) {
    topAddBtn.onclick = () => {
      openCatalogModal('direct', '', '', '');
    };
  }
}

// ==========================================================================
// Theme Toggler Helper
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
// Bootstrap / App Entrypoint
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Fetch configurations and active indexers
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
      console.log('Loaded active indexers from Prowlarr:', INDEXERS);
    }
    populateHeaderIndexerSelect();
    // Load preferences after indexers are loaded
    loadPreferences();
  });

  // Bind Sidebar, filters, and modal clicks
  initNavigation();
  initSearch();
  initCatalogModal();
  initThemeToggler();

  // Add listeners to filters so they auto-update grid on change
  const bindFilter = (id, viewLoader) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', viewLoader);
  };

  bindFilter('animeSeasonFilter', loadAnimeView);
  bindFilter('animeYearFilter', loadAnimeView);
  bindFilter('animeStatusFilter', loadAnimeView);

  bindFilter('movieYearFilter', loadMoviesView);
  bindFilter('movieGenreFilter', loadMoviesView);

  bindFilter('tvYearFilter', loadTVView);
  bindFilter('tvGenreFilter', loadTVView);

  bindFilter('scheduleTimezone', loadScheduleView);

  // Initialize Home View
  navigateTo('home');
});
