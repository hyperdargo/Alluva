require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Configuration
const TORZNAB_API_KEY = process.env.TORZNAB_API_KEY || '4bf8dd57f1d043ae88fb5da57f789994';
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TORZNAB_BASE_URL = process.env.TORZNAB_BASE_URL || 'https://powerlerr.ankitgupta.com.np/4/api';

// Extract the base domain (origin) from TORZNAB_BASE_URL to dynamically build all indexer endpoints
const getProwlarrBaseUrl = () => {
  try {
    const url = new URL(TORZNAB_BASE_URL);
    return url.origin;
  } catch (e) {
    return 'https://powerlerr.ankitgupta.com.np';
  }
};
const PROWLARR_BASE = getProwlarrBaseUrl();

// Indexer configurations
const INDEXERS = {
  1: { name: '1337x', baseUrl: `${PROWLARR_BASE}/1/api` },
  2: { name: 'The Pirate Bay', baseUrl: `${PROWLARR_BASE}/2/api` },
  3: { name: 'YTS', baseUrl: `${PROWLARR_BASE}/3/api` },
  4: { name: 'Nyaa.si', baseUrl: `${PROWLARR_BASE}/4/api` },
  5: { name: 'EZTV', baseUrl: `${PROWLARR_BASE}/5/api` },
  7: { name: 'Torrentsome', baseUrl: `${PROWLARR_BASE}/7/api` },
  8: { name: 'LimeTorrents', baseUrl: `${PROWLARR_BASE}/8/api` },
  9: { name: 'SkTorrent', baseUrl: `${PROWLARR_BASE}/9/api` }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'stream-vault', timestamp: new Date().toISOString() });
});

// Direct Nyaa.si RSS Parser for fast rate-limit-free search
async function searchNyaaDirect(query) {
  const url = `https://nyaa.si/?page=rss&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url);
    const xml = await response.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const getTag = (tag) => {
        const regex = new RegExp(`<${tag}>(.*?)</${tag}>|<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`);
        const m = itemXml.match(regex);
        return m ? (m[2] || m[1] || '').trim() : '';
      };

      const title = getTag('title');
      const torrentUrl = getTag('link');
      const guid = getTag('guid');
      const pubDate = getTag('pubDate');
      const seeders = parseInt(getTag('nyaa:seeders')) || 0;
      const leechers = parseInt(getTag('nyaa:leechers')) || 0;
      const infohash = getTag('nyaa:infoHash');

      const sizeText = getTag('nyaa:size');
      let sizeBytes = 0;
      if (sizeText) {
        const parts = sizeText.split(' ');
        const num = parseFloat(parts[0]);
        const unit = parts[1] ? parts[1].toLowerCase() : '';
        if (unit.startsWith('kiB') || unit.startsWith('kb')) sizeBytes = num * 1024;
        else if (unit.startsWith('miB') || unit.startsWith('mb')) sizeBytes = num * 1024 * 1024;
        else if (unit.startsWith('giB') || unit.startsWith('gb')) sizeBytes = num * 1024 * 1024 * 1024;
        else if (unit.startsWith('tiB') || unit.startsWith('tb')) sizeBytes = num * 1024 * 1024 * 1024 * 1024;
        else sizeBytes = num;
      }

      const trackers = [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.coppersurfer.tk:6969/announce',
        'udp://tracker.openbittorrent.com:80/announce',
        'udp://open.demonii.com:1337/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://explodie.org:6969/announce'
      ];
      const trackerParams = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
      const magnet = infohash ? `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(title)}${trackerParams}` : null;

      if (title && magnet) {
        items.push({
          title,
          magnet,
          torrentUrl,
          size: sizeBytes,
          seeders,
          leechers,
          pubDate,
          source: 'Nyaa.si',
          guid
        });
      }
    }
    return items;
  } catch (error) {
    console.error('Error searching Nyaa Direct:', error.message);
    return [];
  }
}

// Direct Pirate Bay API Parser for fast rate-limit-free search
async function searchPirateBayDirect(query) {
  const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url);
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0 || results[0].name === 'No results found') {
      return [];
    }

    const trackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://tracker.coppersurfer.tk:6969/announce',
      'udp://tracker.openbittorrent.com:80/announce',
      'udp://open.demonii.com:1337/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://explodie.org:6969/announce'
    ];
    const trackerParams = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

    return results.map(item => {
      const title = item.name;
      const infohash = item.info_hash;
      const seeders = parseInt(item.seeders) || 0;
      const leechers = parseInt(item.leechers) || 0;
      const size = parseInt(item.size) || 0;

      const magnet = `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(title)}${trackerParams}`;

      return {
        title,
        magnet,
        torrentUrl: `https://thepiratebay.org/description.php?id=${item.id}`,
        size,
        seeders,
        leechers,
        pubDate: new Date(parseInt(item.added) * 1000).toISOString(),
        source: 'The Pirate Bay',
        guid: item.id
      };
    });
  } catch (error) {
    console.error('Error searching Pirate Bay Direct:', error.message);
    return [];
  }
}

// Global Prowlarr Search API (searches all active indexers in Prowlarr in a single call)
async function searchProwlarrGlobal(query, indexerIdsList = '') {
  const url = `${PROWLARR_BASE}/api/v1/search`;
  const params = new URLSearchParams({
    apikey: TORZNAB_API_KEY,
    query: query
  });
  if (indexerIdsList) {
    params.append('indexerIds', indexerIdsList);
  }

  try {
    const response = await fetch(`${url}?${params}`);
    const results = await response.json();
    if (!Array.isArray(results)) return [];

    const trackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://tracker.coppersurfer.tk:6969/announce',
      'udp://tracker.openbittorrent.com:80/announce',
      'udp://open.demonii.com:1337/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://explodie.org:6969/announce'
    ];
    const trackerParams = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

    return results.map(item => {
      let magnet = item.magnetUrl;
      if (!magnet && item.infoHash) {
        magnet = `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(item.title)}${trackerParams}`;
      } else if (magnet && !magnet.includes('&tr=')) {
        magnet = `${magnet}${trackerParams}`;
      }

      return {
        title: item.title,
        magnet: magnet && magnet.startsWith('magnet:') ? magnet : null,
        torrentUrl: item.downloadUrl,
        size: item.size || 0,
        seeders: item.seeders || 0,
        leechers: item.leechers || 0,
        pubDate: item.publishDate,
        source: item.indexer || 'Prowlarr',
        guid: item.guid
      };
    });
  } catch (error) {
    console.error('Prowlarr global search error:', error.message);
    return [];
  }
}

// Search Torznab indexer
async function searchIndexer(indexerId, query, category = '') {
  if (indexerId === 4) {
    return searchNyaaDirect(query);
  }

  const indexer = INDEXERS[indexerId];
  if (!indexer) return [];

  const params = new URLSearchParams({
    apikey: TORZNAB_API_KEY,
    q: query,
    t: 'search',
    cat: category
  });

  try {
    const response = await fetch(`${indexer.baseUrl}?${params}`, {
      headers: { 'Accept': 'application/xml' }
    });
    const xml = await response.text();
    return parseTorznabItems(xml, indexer.name);
  } catch (error) {
    console.error(`Error searching ${indexer.name}:`, error.message);
    return [];
  }
}

// Parse Torznab XML response
function parseTorznabItems(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag) => {
      const regex = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>|<${tag}>(.*?)</${tag}>`);
      const m = itemXml.match(regex);
      return m ? (m[1] || m[2] || '').trim() : '';
    };

    const getTorznabAttr = (name) => {
      const regex = new RegExp(`<torznab:attr\\s+name="${name}"\\s+value="([^"]*)"\\s*\\/?>`);
      const m = itemXml.match(regex);
      return m ? m[1].trim() : '';
    };

    const title = getTag('title');
    const link = getTag('link');
    const guid = getTag('guid');
    const pubDate = getTag('pubDate');
    const size = parseInt(getTag('size')) || 0;
    const seeders = parseInt(getTorznabAttr('seeders')) || 0;
    const leechers = parseInt(getTorznabAttr('peers')) || parseInt(getTorznabAttr('leechers')) || 0;

    const infohash = getTorznabAttr('infohash');
    let magnet = getTorznabAttr('magneturl');

    // Trackers to append for quick connections
    const trackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://tracker.coppersurfer.tk:6969/announce',
      'udp://tracker.openbittorrent.com:80/announce',
      'udp://open.demonii.com:1337/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://explodie.org:6969/announce'
    ];
    const trackerParams = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

    if (!magnet && infohash) {
      magnet = `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(title)}${trackerParams}`;
    } else if (magnet && !magnet.includes('&tr=')) {
      magnet = `${magnet}${trackerParams}`;
    }

    if (title && (magnet || link)) {
      items.push({
        title,
        magnet: magnet && magnet.startsWith('magnet:') ? magnet : null,
        torrentUrl: link,
        size,
        seeders,
        leechers,
        pubDate,
        source: sourceName,
        guid
      });
    }
  }
  return items;
}

// Search AniList GraphQL
async function searchAniList(query, type = 'ANIME', page = 1, perPage = 20) {
  const hasSearch = query && query.trim().length > 0;

  const graphqlQuery = hasSearch ? `
    query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(search: $search, type: $type, sort: [POPULARITY_DESC, SCORE_DESC]) {
          id
          title { romaji english native }
          coverImage { large medium }
          description
          genres
          format
          status
          episodes
          duration
          averageScore
          popularity
          startDate { year month day }
          endDate { year month day }
          nextAiringEpisode { airingAt timeUntilAiring episode }
          studios { nodes { name } }
        }
      }
    }
  ` : `
    query ($type: MediaType, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: $type, sort: [POPULARITY_DESC, SCORE_DESC]) {
          id
          title { romaji english native }
          coverImage { large medium }
          description
          genres
          format
          status
          episodes
          duration
          averageScore
          popularity
          startDate { year month day }
          endDate { year month day }
          nextAiringEpisode { airingAt timeUntilAiring episode }
          studios { nodes { name } }
        }
      }
    }
  `;

  const variables = hasSearch
    ? { search: query, type, page, perPage }
    : { type, page, perPage };

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: graphqlQuery,
        variables
      })
    });
    const data = await response.json();
    if (data.errors) {
      console.error('AniList GraphQL Errors:', data.errors);
      return [];
    }
    return data.data?.Page?.media || [];
  } catch (error) {
    console.error('AniList search error:', error.message);
    return [];
  }
}

// Get anime detail from AniList
async function getAnimeDetail(id) {
  const graphqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english native }
        coverImage { large medium }
        bannerImage
        description
        genres
        format
        status
        episodes
        duration
        averageScore
        popularity
        startDate { year month day }
        endDate { year month day }
        nextAiringEpisode { airingAt timeUntilAiring episode }
        studios { nodes { name } }
        trailer { id site thumbnail }
        relations { edges { node { id title { romaji } coverImage { large } type } relationType } }
        recommendations { nodes { mediaRecommendation { id title { romaji } coverImage { large } } rating } }
      }
    }
  `;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: { id } })
    });
    const data = await response.json();
    return data.data?.Media;
  } catch (error) {
    console.error('AniList detail error:', error.message);
    return null;
  }
}

// Get airing schedule from AniList
async function getAiringSchedule(page = 1, perPage = 50) {
  const graphqlQuery = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        airingSchedules(notYetAired: true, sort: TIME) {
          id
          airingAt
          timeUntilAiring
          episode
          media {
            id
            title { romaji english native }
            coverImage { large medium }
            format
            status
            genres
            nextAiringEpisode { airingAt timeUntilAiring episode }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: { page, perPage } })
    });
    const data = await response.json();
    return data.data?.Page?.airingSchedules || [];
  } catch (error) {
    console.error('AniList schedule error:', error.message);
    return [];
  }
}

// Search TMDB
async function searchTMDB(query, type = 'multi', page = 1) {
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    return [];
  }

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=${page}&language=en-US`
    );
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('TMDB search error:', error.message);
    return [];
  }
}

// Get trending from TMDB
async function getTrendingTMDB(mediaType = 'movie', timeWindow = 'week') {
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    return [];
  }

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/trending/${mediaType}/${timeWindow}?api_key=${TMDB_API_KEY}&language=en-US`
    );
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('TMDB trending error:', error.message);
    return [];
  }
}

// Get TMDB detail
async function getTMDBDetail(id, type) {
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=videos,credits`
    );
    return await response.json();
  } catch (error) {
    console.error('TMDB detail error:', error.message);
    return null;
  }
}

// Unified search endpoint
app.get('/api/search', async (req, res) => {
  const { q, indexers = '4', type = 'all' } = req.query;

  if (!q || q.trim().length < 2) {
    return res.json({ anime: [], media: [], torrents: [] });
  }

  const indexerIds = indexers.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
  const promises = [];

  // Anime search (AniList)
  if (type === 'all' || type === 'anime') {
    promises.push(searchAniList(q, 'ANIME').then(anime => ({ type: 'anime', data: anime })));
  }

  // Movie/TV search (TMDB)
  if (type === 'all' || type === 'movie' || type === 'tv') {
    promises.push(searchTMDB(q, 'multi').then(media => ({ type: 'media', data: media })));
  }

  // Torrent search (selected indexers)
  if (type === 'torrent') {
    const queryPromises = [];

    // Query Nyaa.si direct RSS if selected (indexer 4)
    if (indexerIds.includes(4)) {
      queryPromises.push(searchNyaaDirect(q));
    }

    // Query Pirate Bay direct API if selected (indexer 2)
    if (indexerIds.includes(2)) {
      queryPromises.push(searchPirateBayDirect(q));
    }

    // Query all other indexers in a single unified call to Prowlarr
    const prowlarrIndexers = indexerIds.filter(id => id !== 4 && id !== 2).join(',');
    if (prowlarrIndexers) {
      queryPromises.push(searchProwlarrGlobal(q, prowlarrIndexers));
    } else if (indexerIds.length > 0 && !indexerIds.includes(4) && !indexerIds.includes(2)) {
      // General search if Nyaa/TPB are excluded but indexers list is present
      queryPromises.push(searchProwlarrGlobal(q, indexerIds.join(',')));
    }

    promises.push(Promise.all(queryPromises).then(results => ({
      type: 'torrents',
      data: results.flat().sort((a, b) => b.seeders - a.seeders)
    })));
  }

  try {
    const results = await Promise.all(promises);
    const response = { anime: [], media: [], torrents: [] };

    results.forEach(r => {
      if (r.type === 'anime') response.anime = r.data;
      else if (r.type === 'media') response.media = r.data;
      else if (r.type === 'torrents') response.torrents = r.data;
    });

    res.json(response);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Config route to share environment configs with the frontend
app.get('/api/config', (req, res) => {
  res.json({
    torrserverUrl: TORRSERVER_URL
  });
});

// Get configured indexers from Prowlarr dynamically
app.get('/api/indexers', async (req, res) => {
  try {
    const response = await fetch(`${PROWLARR_BASE}/api/v1/indexer?apikey=${TORZNAB_API_KEY}`);
    const data = await response.json();
    if (!Array.isArray(data)) return res.json([]);

    // Map to simple structure for frontend: { id, name, category }
    const indexers = data.map(item => {
      let category = 'General';
      const name = item.name.toLowerCase();

      // Categorize indexers based on name or capabilities
      if (name.includes('yts') || name.includes('movie')) {
        category = 'Movies';
      } else if (name.includes('eztv') || name.includes('tv') || name.includes('show')) {
        category = 'TV Shows';
      } else if (name.includes('nyaa') || name.includes('anime')) {
        category = 'Anime';
      } else if (item.capabilities?.categories?.some(c => c.name.toLowerCase().includes('movie'))) {
        category = 'Movies';
      } else if (item.capabilities?.categories?.some(c => c.name.toLowerCase().includes('tv') || c.name.toLowerCase().includes('show'))) {
        category = 'TV Shows';
      } else if (item.capabilities?.categories?.some(c => c.name.toLowerCase().includes('anime'))) {
        category = 'Anime';
      }

      return {
        id: item.id,
        name: item.name,
        category: category
      };
    });

    // Add Nyaa.si Direct search as a virtual indexer (since we parse it direct)
    if (!indexers.some(idx => idx.id === 4)) {
      indexers.push({
        id: 4,
        name: 'Nyaa.si (Direct)',
        category: 'Anime'
      });
    }

    // Add The Pirate Bay Direct search as a virtual indexer (since we fetch it direct via apibay)
    if (!indexers.some(idx => idx.id === 2)) {
      indexers.push({
        id: 2,
        name: 'The Pirate Bay (Direct)',
        category: 'Movies/TV/General'
      });
    }

    res.json(indexers);
  } catch (error) {
    console.error('Error fetching Prowlarr indexers:', error.message);
    res.json([
      // Fallback indexers if Prowlarr is offline
      { id: 1, name: '1337x', category: 'Movies/TV' },
      { id: 2, name: 'The Pirate Bay', category: 'General' },
      { id: 3, name: 'YTS', category: 'Movies' },
      { id: 4, name: 'Nyaa.si (Direct)', category: 'Anime' },
      { id: 5, name: 'EZTV', category: 'TV Shows' },
      { id: 6, name: 'RARBG', category: 'Movies/TV' },
      { id: 7, name: 'Torrentsome', category: 'General' },
      { id: 8, name: 'LimeTorrents', category: 'General' },
      { id: 9, name: 'SkTorrent', category: 'General' }
    ]);
  }
});

// Trending endpoint for home page
app.get('/api/trending', async (req, res) => {
  try {
    const [trendingAnime, trendingMovies, trendingTV, recentTorrents] = await Promise.all([
      searchAniList('', 'ANIME', 1, 12),
      getTrendingTMDB('movie', 'week'),
      getTrendingTMDB('tv', 'week'),
      searchIndexer(4, '', '').catch(() => [])
    ]);

    res.json({
      anime: trendingAnime.slice(0, 12),
      movies: trendingMovies.slice(0, 12),
      tv: trendingTV.slice(0, 12),
      torrents: recentTorrents.slice(0, 12)
    });
  } catch (error) {
    console.error('Trending error:', error);
    res.status(500).json({ error: 'Failed to fetch trending' });
  }
});

// Anime detail endpoint
app.get('/api/anime/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });

  const anime = await getAnimeDetail(id);
  if (!anime) return res.status(404).json({ error: 'Not found' });

  res.json(anime);
});

// Airing schedule endpoint
app.get('/api/schedule', async (req, res) => {
  const schedule = await getAiringSchedule();
  res.json(schedule);
});

// TMDB Media detail endpoint (movie/tv)
app.get('/api/media/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const tmdbId = parseInt(id);
  if (!tmdbId || !['movie', 'tv'].includes(type)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const detail = await getTMDBDetail(tmdbId, type);
  if (!detail) return res.status(404).json({ error: 'Not found' });

  res.json(detail);
});

// TMDB TV Season detail endpoint proxy
app.get('/api/media/tv/:id/season/:seasonNum', async (req, res) => {
  const id = parseInt(req.params.id);
  const seasonNum = parseInt(req.params.seasonNum);
  if (!id || isNaN(seasonNum)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/tv/${id}/season/${seasonNum}?api_key=${TMDB_API_KEY}&language=en-US`
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('TMDB season error:', error.message);
    res.status(500).json({ error: 'Failed to fetch season details' });
  }
});

// TorrServer integration proxy endpoints
const TORRSERVER_URL = process.env.TORRSERVER_URL || 'http://localhost:8090';

app.post('/api/torrserver/add', async (req, res) => {
  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'Missing link' });

  try {
    const response = await fetch(`${TORRSERVER_URL}/torrents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', link })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('TorrServer add error:', error.message);
    res.status(500).json({ error: 'Failed to connect to TorrServer. Make sure it is running on port 8090.' });
  }
});

app.get('/api/torrserver/torrent/:hash', async (req, res) => {
  const { hash } = req.params;
  try {
    const response = await fetch(`${TORRSERVER_URL}/torrents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get', hash })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('TorrServer get error:', error.message);
    res.status(500).json({ error: 'Failed to connect to TorrServer' });
  }
});

app.delete('/api/torrserver/torrent/:hash', async (req, res) => {
  const { hash } = req.params;
  try {
    await fetch(`${TORRSERVER_URL}/torrents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'drop', hash })
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('TorrServer drop error:', error.message);
    res.status(500).json({ error: 'Failed to connect to TorrServer' });
  }
});

// Catalog endpoints (for user-added media)
const CATALOG_FILE = './catalog.json';
const fs = require('fs');

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveCatalog(catalog) {
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
}

app.get('/api/catalog', (req, res) => {
  res.json(loadCatalog());
});

app.post('/api/catalog', (req, res) => {
  const catalog = loadCatalog();
  const item = { ...req.body, id: Date.now(), addedAt: new Date().toISOString() };
  catalog.push(item);
  saveCatalog(catalog);
  res.json(item);
});

app.delete('/api/catalog/:id', (req, res) => {
  const catalog = loadCatalog().filter(item => item.id !== parseInt(req.params.id));
  saveCatalog(catalog);
  res.json({ ok: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Stream Vault running at http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/health`);
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    console.log('⚠️  TMDB_API_KEY not configured - movie/TV search will be limited');
  }
});