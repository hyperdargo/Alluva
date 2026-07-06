require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const pathModule = require('path');
const https = require('https');
const http = require('http');
const urlModule = require('url');

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
const TORRSERVER_URL = process.env.TORRSERVER_URL || 'https://torrserver.ankitgupta.com.np';

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
  2: { name: 'The Pirate Bay', baseUrl: `${PROWLARR_BASE}/2/api`, category: 'Movies, TV, Anime' },
  4: { name: 'Nyaa.si', baseUrl: `${PROWLARR_BASE}/4/api`, category: 'Anime' },
  5: { name: 'EZTV (Prowlarr)', baseUrl: `${PROWLARR_BASE}/5/api`, category: 'TV' },
  7: { name: 'Torrentsome (Prowlarr)', baseUrl: `${PROWLARR_BASE}/7/api`, category: 'Movies, TV, Anime' },
  8: { name: 'LimeTorrents (Prowlarr)', baseUrl: `${PROWLARR_BASE}/8/api`, category: 'Movies, TV, Anime' },
  9: { name: 'SkTorrent.org (Prowlarr)', baseUrl: `${PROWLARR_BASE}/9/api`, category: 'Movies, TV, Anime' },
  11: { name: 'YTS.gg (Direct)', baseUrl: '', category: 'Movies' }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'stream-vault', timestamp: new Date().toISOString() });
});

// ============= Helper Functions =============
function getTrackerParams() {
  const trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://tracker.coppersurfer.tk:6969/announce',
    'udp://tracker.openbittorrent.com:80/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://explodie.org:6969/announce'
  ];
  return trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
}

function parseSize(sizeStr) {
  let sizeBytes = 0;
  const sizeMatch = sizeStr.match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (sizeMatch) {
    const num = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    if (unit === 'GB') sizeBytes = num * 1024 * 1024 * 1024;
    else if (unit === 'MB') sizeBytes = num * 1024 * 1024;
    else if (unit === 'KB') sizeBytes = num * 1024;
  }
  return sizeBytes;
}

const MIRRORS = {
  '1337x': ['1337x.to', '1337x.tst', 'x1337x.ws', 'x1337x.eu', 'x1337x.cc'],
  'eztv': ['eztvx.to', 'eztv.wf', 'eztv.tf', 'eztv.yt', 'eztv1.xyz'],
  'nyaa': ['nyaa.si', 'nyaa.iss.ink', 'nyaa.land', 'nyaa.mom', 'nyaa.unblockninja.com'],
  'yts': ['yts.gg', 'yts.ninjaproxy1.com', 'yts.proxyninja.org', 'yts.proxyninja.net', 'yts.torrentbay.st', 'yts.torrentsbay.org']
};


async function fetchFromMirrors(mirrorKey, path, options, useFlareSolverr = false) {
  const domains = MIRRORS[mirrorKey] || [];
  let flareSolverrAttempts = 0;
  const maxFlareSolverrAttempts = 2; // only try 2 mirrors with FlareSolverr

  for (const domain of domains) {
    const url = `https://${domain}${path}`;
    try {
      console.log(`[${mirrorKey}] Trying mirror: ${url}`);
      const response = await fetch(url, options);
      let text = '';
      if (!response.ok) {
        if (useFlareSolverr && (response.status === 403 || response.status === 503) && flareSolverrAttempts < maxFlareSolverrAttempts) {
          console.log(`[${mirrorKey}] ${domain} blocked by Cloudflare (${response.status}). Trying FlareSolverr...`);
          flareSolverrAttempts++;
          const solvedHtml = await fetchWithFlareSolverr(url);
          if (solvedHtml) return { text: solvedHtml, url, domain, ok: true };
        }
        continue; // Try next mirror
      } else {
        text = await response.text();
        // Even if 200 OK, check if it's a Cloudflare challenge page
        if (useFlareSolverr && (text.includes('Just a moment...') || text.includes('cf-browser-verification') || text.includes('cloudflare-challenge')) && flareSolverrAttempts < maxFlareSolverrAttempts) {
          console.log(`[${mirrorKey}] ${domain} returned Cloudflare challenge (200 OK). Trying FlareSolverr...`);
          flareSolverrAttempts++;
          const solvedHtml = await fetchWithFlareSolverr(url);
          if (solvedHtml) return { text: solvedHtml, url, domain, ok: true };
          continue;
        }
      }
      return { text, url, domain, ok: true };
    } catch (e) {
      console.log(`[${mirrorKey}] Mirror ${domain} failed: ${e.message}`);
      continue; // Try next mirror
    }
  }
  return { ok: false, text: '' }; // All mirrors failed
}

// ============= FlareSolverr Integration =============
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191';

async function fetchWithFlareSolverr(targetUrl, timeoutMs = 45000) {
  try {
    console.log(`Sending request to FlareSolverr for: ${targetUrl}`);
    const response = await fetch(`${FLARESOLVERR_URL}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url: targetUrl,
        maxTimeout: timeoutMs
      })
    });
    const data = await response.json();
    if (data.status === 'ok' && data.solution && data.solution.response) {
      return data.solution.response; // Returns HTML text
    } else {
      throw new Error(`FlareSolverr failed: ${data.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('FlareSolverr error:', error.message);
    return null;
  }
}

// ============= YTS Direct Search =============
async function searchYTSGGDirect(query) {
  const items = [];

  try {
    const path = `/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=20`;
    const mirrorResult = await fetchFromMirrors('yts', path, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, true);

    if (!mirrorResult.ok) return items;

    let jsonText = mirrorResult.text;
    const preMatch = jsonText.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (preMatch) jsonText = preMatch[1];

    // Also remove HTML tags if any slipped through (FlareSolverr wrapper)
    jsonText = jsonText.replace(/<[^>]+>/g, '').trim();

    const data = JSON.parse(jsonText);
    if (!data.data || !data.data.movies) return items;

    const movies = data.data.movies;

    for (const movie of movies) {
      if (!movie.torrents) continue;

      for (const torrent of movie.torrents) {
        const magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}${getTrackerParams()}`;

        items.push({
          title: `${movie.title} (${movie.year}) - ${torrent.quality} ${torrent.type}`,
          magnet: magnet,
          torrentUrl: `https://${mirrorResult.domain}/movie/${movie.slug}`,
          size: torrent.size_bytes || 0,
          seeders: torrent.seeds || 0,
          leechers: torrent.peers || 0,
          pubDate: new Date(movie.date_uploaded || Date.now()).toISOString(),
          source: 'YTS',
          guid: torrent.hash
        });
      }
    }
  } catch (error) {
    console.error('Error searching YTS.gg:', error.message);
  }

  return items;
}

// ============= EZTVx.to Direct Search =============
async function searchEZTVxToDirect(query) {
  const items = [];

  try {
    const path = `/search/${encodeURIComponent(query)}`;
    const mirrorResult = await fetchFromMirrors('eztv', path, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, true);

    if (!mirrorResult.ok) return items;

    const html = mirrorResult.text;
    const workingDomain = mirrorResult.domain;

    // Parse EZTVx.to search results
    const itemRegex = /<tr[^>]*>[\s\S]*?<td[^>]*class="[^"]*forum_thread[^"]*"[^>]*>[\s\S]*?<a[^>]*href="\/torrent\/(\d+)\/[^"]*"[^>]*>([^<]*)<\/a>[\s\S]*?<td[^>]*class="[^"]*topic_moved[^"]*"[^>]*>([\d.]+[KMG]B?)<\/td>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>(\d+)<\/td>/gi;

    const matches = [];
    let match;
    while ((match = itemRegex.exec(html)) !== null && matches.length < 10) {
      matches.push(match);
    }

    const promises = matches.map(async (m) => {
      const torrentId = m[1];
      const title = m[2].trim();
      const sizeStr = m[3].trim();
      const seeders = parseInt(m[4]) || 0;
      const leechers = parseInt(m[5]) || 0;

      const sizeBytes = parseSize(sizeStr);
      const magnet = await getEZTVxToMagnet(torrentId, workingDomain);

      if (magnet) {
        return {
          title,
          magnet: magnet + getTrackerParams(),
          torrentUrl: `https://${workingDomain}/torrent/${torrentId}/`,
          size: sizeBytes,
          seeders,
          leechers,
          pubDate: new Date().toISOString(),
          source: 'EZTVx.to',
          guid: torrentId
        };
      }
      return null;
    });

    const results = await Promise.all(promises);
    results.forEach(r => {
      if (r) items.push(r);
    });
  } catch (error) {
    console.error('Error searching EZTVx.to:', error.message);
  }

  return items;
}

// Helper function to get magnet link from EZTVx.to torrent page
async function getEZTVxToMagnet(torrentId, domain = 'eztvx.to') {
  try {
    const url = `https://${domain}/torrent/${torrentId}/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    let html = '';
    if (!response.ok) {
      if (response.status === 403 || response.status === 503) {
        html = await fetchWithFlareSolverr(url);
        if (!html) return null;
      } else {
        return null;
      }
    } else {
      html = await response.text();
      if (html.includes('Just a moment...') || html.includes('cloudflare-challenge')) {
        html = await fetchWithFlareSolverr(url);
        if (!html) return null;
      }
    }

    const magnetRegex = /href="(magnet:\?xt=urn:btih:[^"]+)"/;
    const match = html.match(magnetRegex);

    return match ? match[1] : null;
  } catch (error) {
    console.error('Error getting EZTV magnet:', error.message);
    return null;
  }
}

// ============= 1337x Direct Search =============
async function search1337xDirect(query) {
  const items = [];

  try {
    let workingDomain = '1337x.to';

    const path = `/search/${encodeURIComponent(query)}/1/`;
    const mirrorResult = await fetchFromMirrors('1337x', path, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, true);

    if (mirrorResult.ok) {
      const html = mirrorResult.text;
      workingDomain = mirrorResult.domain;

      const altRegex = /<tr[^>]*>[\s\S]*?<a[^>]*href="\/torrent\/(\d+)\/[^"]*"[^>]*>([^<]*)<\/a>[\s\S]*?<td[^>]*>([\d.]+[KMG]B?)<\/td>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>(\d+)<\/td>/gi;
      const matches = [];
      let match;
      while ((match = altRegex.exec(html)) !== null && matches.length < 10) {
        matches.push(match);
      }

      const promises = matches.map(async (m) => {
        const torrentId = m[1];
        const title = m[2].trim();
        const sizeStr = m[3].trim();
        const seeders = parseInt(m[4]) || 0;
        const leechers = parseInt(m[5]) || 0;

        const sizeBytes = parseSize(sizeStr);
        const magnet = await get1337xMagnet(torrentId, workingDomain);

        if (magnet) {
          return {
            title,
            magnet: magnet + getTrackerParams(),
            torrentUrl: `https://${workingDomain}/torrent/${torrentId}/`,
            size: sizeBytes,
            seeders,
            leechers,
            pubDate: new Date().toISOString(),
            source: '1337x',
            guid: torrentId
          };
        }
        return null;
      });

      const results = await Promise.all(promises);
      results.forEach(r => {
        if (r) items.push(r);
      });
    }
  } catch (error) {
    console.error('Error searching 1337x:', error.message);
  }

  return items;
}

// Helper function to get magnet link from 1337x torrent page
async function get1337xMagnet(torrentId, domain = '1337x.to') {
  try {
    const url = `https://${domain}/torrent/${torrentId}/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    let html = '';
    if (!response.ok) {
      if (response.status === 403 || response.status === 503) {
        html = await fetchWithFlareSolverr(url);
        if (!html) return null;
      } else {
        return null;
      }
    } else {
      html = await response.text();
      if (html.includes('Just a moment...') || html.includes('cloudflare-challenge')) {
        html = await fetchWithFlareSolverr(url);
        if (!html) return null;
      }
    }
    const magnetRegex = /href="(magnet:\?xt=urn:btih:[^"]+)"/;
    const match = html.match(magnetRegex);

    return match ? match[1] : null;
  } catch (error) {
    console.error('Error getting 1337x magnet:', error.message);
    return null;
  }
}

// ============= Ext.to Direct Search =============
async function searchExtToDirect(query) {
  const items = [];

  try {
    const url = `https://ext.to/search/?q=${encodeURIComponent(query)}`;
    console.log('Fetching Ext.to via FlareSolverr (forced)...');
    let html = await fetchWithFlareSolverr(url);
    if (!html) {
      console.error('FlareSolverr could not fetch Ext.to');
      return items;
    }

    const itemRegex = /<div[^>]*class="[^"]*torrent-item[^"]*"[^>]*>[\s\S]*?<a[^>]*href="\/torrent\/(\d+)\/[^"]*"[^>]*>([^<]*)<\/a>[\s\S]*?<span[^>]*class="[^"]*seeders?[^"]*"[^>]*>(\d+)<\/span>[\s\S]*?<span[^>]*class="[^"]*leechers?[^"]*"[^>]*>(\d+)<\/span>[\s\S]*?<span[^>]*class="[^"]*size[^"]*"[^>]*>([\d.]+\s*(GB|MB|KB))<\/span>/gi;

    const matches = [];
    let match;
    while ((match = itemRegex.exec(html)) !== null && matches.length < 10) {
      matches.push(match);
    }

    const promises = matches.map(async (m) => {
      const torrentId = m[1];
      const title = m[2].trim();
      const seeders = parseInt(m[3]) || 0;
      const leechers = parseInt(m[4]) || 0;
      const sizeStr = m[5].trim();

      const sizeBytes = parseSize(sizeStr);
      const magnet = await getExtToMagnet(torrentId);

      if (magnet) {
        return {
          title,
          magnet: magnet + getTrackerParams(),
          torrentUrl: `https://ext.to/torrent/${torrentId}/`,
          size: sizeBytes,
          seeders,
          leechers,
          pubDate: new Date().toISOString(),
          source: 'Ext.to',
          guid: torrentId
        };
      }
      return null;
    });

    const results = await Promise.all(promises);
    results.forEach(r => {
      if (r) items.push(r);
    });

    if (items.length === 0) {
      const altRegex = /<tr[^>]*>[\s\S]*?<a[^>]*href="\/torrent\/(\d+)\/[^"]*"[^>]*>([^<]*)<\/a>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>([\d.]+\s*(GB|MB|KB))<\/td>/gi;

      const matches = [];
      let match;
      while ((match = altRegex.exec(html)) !== null && matches.length < 10) {
        matches.push(match);
      }

      const promises = matches.map(async (m) => {
        const torrentId = m[1];
        const title = m[2].trim();
        const seeders = parseInt(m[3]) || 0;
        const leechers = parseInt(m[4]) || 0;
        const sizeStr = m[5].trim();

        const sizeBytes = parseSize(sizeStr);
        const magnet = await getExtToMagnet(torrentId);

        if (magnet) {
          return {
            title,
            magnet: magnet + getTrackerParams(),
            torrentUrl: `https://ext.to/torrent/${torrentId}/`,
            size: sizeBytes,
            seeders,
            leechers,
            pubDate: new Date().toISOString(),
            source: 'Ext.to',
            guid: torrentId
          };
        }
        return null;
      });

      const results = await Promise.all(promises);
      results.forEach(r => {
        if (r) items.push(r);
      });
    }
  } catch (error) {
    console.error('Error searching Ext.to:', error.message);
  }

  return items;
}

// Helper function to get magnet link from Ext.to torrent page
async function getExtToMagnet(torrentId) {
  try {
    const url = `https://ext.to/torrent/${torrentId}/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    let html = '';
    if (!response.ok) {
      if (response.status === 403 || response.status === 503) {
        html = await fetchWithFlareSolverr(url);
        if (!html) return null;
      } else {
        return null;
      }
    } else {
      html = await response.text();
      if (html.includes('Just a moment...') || html.includes('cloudflare-challenge')) {
        html = await fetchWithFlareSolverr(url);
        if (!html) return null;
      }
    }

    const magnetRegex = /href="(magnet:\?xt=urn:btih:[^"]+)"/;
    const match = html.match(magnetRegex);

    if (match) return match[1];

    const downloadRegex = /<a[^>]*href="(magnet:\?xt=urn:btih:[^"]+)"[^>]*>Download/;
    const downloadMatch = html.match(downloadRegex);

    return downloadMatch ? downloadMatch[1] : null;
  } catch (error) {
    console.error('Error getting Ext.to magnet:', error.message);
    return null;
  }
}

// ============= Direct Nyaa RSS Parser =============
async function searchNyaaDirect(query) {
  try {
    const path = `/?page=rss&q=${encodeURIComponent(query)}`;
    const mirrorResult = await fetchFromMirrors('nyaa', path, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, true);

    if (!mirrorResult.ok) return [];

    const xml = mirrorResult.text;

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

      const magnet = infohash ? `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(title)}${getTrackerParams()}` : null;

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

// ============= Direct Pirate Bay API Parser =============
async function searchPirateBayDirect(query) {
  const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    let results;
    try {
      results = JSON.parse(text);
    } catch (err) {
      return []; // Return empty if apibay returns HTML/502 Error
    }

    if (!Array.isArray(results) || results.length === 0 || results[0].name === 'No results found') {
      return [];
    }

    return results.map(item => {
      const title = item.name;
      const infohash = item.info_hash;
      const seeders = parseInt(item.seeders) || 0;
      const leechers = parseInt(item.leechers) || 0;
      const size = parseInt(item.size) || 0;

      const magnet = `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(title)}${getTrackerParams()}`;

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

// ============= Global Prowlarr Search API =============
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
    const text = await response.text(); let results; try { results = JSON.parse(text); } catch (err) { return []; }
    if (!Array.isArray(results)) return [];

    return results.map(item => {
      let magnet = item.magnetUrl;
      if (!magnet && item.infoHash) {
        magnet = `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(item.title)}${getTrackerParams()}`;
      } else if (magnet && !magnet.includes('&tr=')) {
        magnet = `${magnet}${getTrackerParams()}`;
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

// ============= Search Torznab indexer =============
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

// ============= Parse Torznab XML response =============
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

    if (!magnet && infohash) {
      magnet = `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(title)}${getTrackerParams()}`;
    } else if (magnet && !magnet.includes('&tr=')) {
      magnet = `${magnet}${getTrackerParams()}`;
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

// ============= AniList Search =============
async function searchAniList(query, type = 'ANIME', page = 1, perPage = 20) {
  const hasSearch = query && query.trim().length > 0;

  const graphqlQuery = hasSearch ? `
    query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(search: $search, type: $type, sort: [POPULARITY_DESC, SCORE_DESC]) {
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

// ============= Get anime detail from AniList =============
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

// ============= Get airing schedule from AniList =============
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

// ============= TMDB Search =============
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

// ============= Get trending from TMDB =============
async function getTrendingTMDB(mediaType = 'movie', timeWindow = 'week') {
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    return [];
  }

  try {
    const fetchPage = async (page) => {
      const response = await fetch(
        `https://api.themoviedb.org/3/trending/${mediaType}/${timeWindow}?api_key=${TMDB_API_KEY}&language=en-US&page=${page}`
      );
      const data = await response.json();
      return data.results || [];
    };

    // Fetch 3 pages to get 60 items
    const [p1, p2, p3] = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
    return [...p1, ...p2, ...p3];
  } catch (error) {
    console.error('TMDB trending error:', error.message);
    return [];
  }
}

// ============= Get upcoming movies from TMDB =============
async function getUpcomingMoviesTMDB() {
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    return [];
  }

  try {
    const fetchPage = async (page) => {
      const response = await fetch(
        `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}&language=en-US&page=${page}`
      );
      const data = await response.json();
      return data.results || [];
    };
    const [p1, p2, p3] = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
    return [...p1, ...p2, ...p3];
  } catch (error) {
    console.error('TMDB upcoming movies error:', error.message);
    return [];
  }
}

// ============= Get top rated media from TMDB =============
async function getTopRatedTMDB(mediaType = 'movie') {
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    return [];
  }

  try {
    const fetchPage = async (page) => {
      const response = await fetch(
        `https://api.themoviedb.org/3/${mediaType}/top_rated?api_key=${TMDB_API_KEY}&language=en-US&page=${page}`
      );
      const data = await response.json();
      return data.results || [];
    };
    const [p1, p2, p3] = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
    return [...p1, ...p2, ...p3];
  } catch (error) {
    console.error(`TMDB top rated ${mediaType} error:`, error.message);
    return [];
  }
}

// ============= Get upcoming anime from AniList =============
async function getUpcomingAnime() {
  const graphqlQuery = `
    query {
      Page(page: 1, perPage: 50) {
        media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) {
          id
          title { romaji english native }
          coverImage { large medium }
          bannerImage
          description
          genres
          format
          status
          averageScore
          popularity
          startDate { year month day }
        }
      }
    }
  `;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery })
    });
    const data = await response.json();
    return data.data?.Page?.media || [];
  } catch (error) {
    console.error('AniList upcoming anime error:', error.message);
    return [];
  }
}

// ============= Get TMDB detail =============
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

// ============= SSE Streaming Torrent Search =============
app.get('/api/search/stream', async (req, res) => {
  const { q, indexers = '' } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!q || q.trim().length < 2) {
    res.write('data: {"done": true}\n\n');
    return res.end();
  }

  const indexerIds = indexers.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
  const activeScrapers = [];

  const addScraper = (promise, sourceName) => {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));
    const wrappedPromise = Promise.race([promise, timeoutPromise])
      .then(results => {
        if (results && results.length > 0) {
          res.write(`data: ${JSON.stringify({ source: sourceName, torrents: results })}\n\n`);
        }
      }).catch(err => {
        if (err.message !== 'Timeout') {
          console.error(`SSE Scraper Error (${sourceName}):`, err.message);
        }
      });
    activeScrapers.push(wrappedPromise);
  };

  for (const id of indexerIds) {
    if (id === 11) {
      addScraper(searchYTSGGDirect(q), 'YTS.gg (Direct)');
    } else if (id === 4) {
      addScraper(searchNyaaDirect(q), 'Nyaa.si');
    } else if (id === 2) {
      addScraper(searchPirateBayDirect(q), 'The Pirate Bay');
    } else if (id === 5) {
      addScraper(searchEZTVxToDirect(q), 'EZTVx.to');
    } else if (INDEXERS[id]) {
      addScraper(searchIndexer(id, q, ''), INDEXERS[id].name);
    }
  }
  Promise.allSettled(activeScrapers).then(() => {
    res.write('data: {"done": true}\n\n');
    res.end();
  });
});

// ============= Unified search endpoint =============
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

  // Scraper promise timeout wrapper to ensure slow/hung scrapers never block other results
  const withTimeout = (promise, name, timeoutMs = 3500) => {
    let timeoutId;
    const timeoutPromise = new Promise(resolve => {
      timeoutId = setTimeout(() => {
        console.warn(`⚠️ Scraper "${name}" timed out after ${timeoutMs}ms`);
        resolve([]);
      }, timeoutMs);
    });
    return Promise.race([
      promise.then(res => {
        clearTimeout(timeoutId);
        return Array.isArray(res) ? res : [];
      }).catch(err => {
        clearTimeout(timeoutId);
        console.error(`❌ Scraper "${name}" failed:`, err.message);
        return [];
      }),
      timeoutPromise
    ]);
  };

  // Torrent search (selected indexers)
  if (type === 'torrent' || type === 'all') {
    const queryPromises = [];

    for (const id of indexerIds) {
      if (id === 11) {
        queryPromises.push(withTimeout(searchYTSGGDirect(q), 'YTS.gg'));
      } else if (id === 4) {
        queryPromises.push(withTimeout(searchNyaaDirect(q), 'Nyaa.si'));
      } else if (id === 2) {
        queryPromises.push(withTimeout(searchPirateBayDirect(q), 'The Pirate Bay'));
      } else if (id === 5) {
        queryPromises.push(withTimeout(searchEZTVxToDirect(q), 'EZTVx.to'));
      } else if (INDEXERS[id]) {
        queryPromises.push(withTimeout(searchIndexer(id, q, ''), INDEXERS[id].name));
      }
    }

    promises.push(
      Promise.all(queryPromises)
        .then(results => ({
          type: 'torrents',
          data: results.flat().sort((a, b) => b.seeders - a.seeders)
        }))
        .catch(() => ({ type: 'torrents', data: [] }))
    );
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

// ============= Config route =============
app.get('/api/config', (req, res) => {
  res.json({
    torrserverUrl: TORRSERVER_URL,
    vlcEnabled: true
  });
});

// ============= Get configured indexers =============
app.get('/api/indexers', (req, res) => {
  res.json([
    { id: 1, name: '1337x', category: 'Movies/TV' },
    { id: 2, name: 'The Pirate Bay', category: 'General' },
    { id: 4, name: 'Nyaa.si', category: 'Anime' },
    { id: 11, name: 'YTS', category: 'Movies' },
    { id: 12, name: 'EZTV', category: 'TV Shows' },
    { id: 10, name: 'Ext.to (Cloudflare Blocked)', category: 'Movies/TV' }
  ]);
});

// ============= Trending endpoint =============
app.get('/api/trending', async (req, res) => {
  try {
    const [
      trendingAnime,
      trendingMovies,
      trendingTV,
      recentTorrents,
      upcomingMovies,
      topRatedMovies,
      topRatedTV,
      upcomingAnimeList
    ] = await Promise.all([
      searchAniList('', 'ANIME', 1, 50),
      getTrendingTMDB('movie', 'week'),
      getTrendingTMDB('tv', 'week'),
      searchIndexer(4, '', '').catch(() => []),
      getUpcomingMoviesTMDB(),
      getTopRatedTMDB('movie'),
      getTopRatedTMDB('tv'),
      getUpcomingAnime()
    ]);

    // Build featured slideshow items
    const featured = [];
    const addFeatured = (item, type) => {
      if (!item) return;
      let title = '';
      let backdrop = '';
      let poster = '';
      let rating = 0;
      let genres = [];
      let overview = '';

      if (type === 'anime') {
        title = item.title.english || item.title.romaji || item.title.native;
        backdrop = item.bannerImage || item.coverImage.large;
        poster = item.coverImage.large || item.coverImage.medium;
        rating = item.averageScore ? (item.averageScore / 10).toFixed(1) : 'N/A';
        genres = item.genres || [];
        overview = item.description || '';
      } else {
        title = type === 'movie' ? (item.title || item.original_title) : (item.name || item.original_name);
        backdrop = item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : '';
        poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '';
        rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        genres = item.genre_ids || [];
        overview = item.overview || '';
      }

      featured.push({
        id: item.id,
        title,
        backdrop,
        poster,
        rating,
        genres,
        overview,
        type
      });
    };

    // Take top items for the banner slideshow
    if (trendingMovies[0]) addFeatured(trendingMovies[0], 'movie');
    if (trendingTV[0]) addFeatured(trendingTV[0], 'tv');
    if (trendingAnime[0]) addFeatured(trendingAnime[0], 'anime');
    if (trendingMovies[1]) addFeatured(trendingMovies[1], 'movie');
    if (trendingTV[1]) addFeatured(trendingTV[1], 'tv');
    if (trendingAnime[1]) addFeatured(trendingAnime[1], 'anime');

    res.json({
      anime: trendingAnime,
      movies: trendingMovies,
      tv: trendingTV,
      torrents: recentTorrents,
      upcomingMovies: upcomingMovies,
      topRatedMovies: topRatedMovies,
      topRatedTV: topRatedTV,
      upcomingAnime: upcomingAnimeList,
      featured
    });
  } catch (error) {
    console.error('Trending error:', error);
    res.status(500).json({ error: 'Failed to fetch trending' });
  }
});

// ============= Anime detail endpoint =============
app.get('/api/anime/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });

  const anime = await getAnimeDetail(id);
  if (!anime) return res.status(404).json({ error: 'Not found' });

  res.json(anime);
});

// ============= Airing schedule endpoint =============
app.get('/api/schedule', async (req, res) => {
  const schedule = await getAiringSchedule();
  res.json(schedule);
});

// ============= TMDB Media detail endpoint =============
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

// ============= TMDB TV Season detail endpoint =============
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

// ============= TorrServer integration proxy endpoints =============
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

// ============= Catalog endpoints =============
const CATALOG_FILE = './catalog.json';

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

// ============= Local HTTP-to-HTTPS relay proxy for local players =============
app.get('/api/relay', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  console.log('[Relay] Proxying stream request to:', targetUrl);

  const parsedUrl = urlModule.parse(targetUrl);
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.path,
    method: 'GET',
    headers: {
      ...req.headers,
      host: parsedUrl.host
    },
    rejectUnauthorized: false // Ignore certificate validation errors
  };

  const client = parsedUrl.protocol === 'https:' ? https : http;

  const proxyReq = client.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[Relay] Proxy request error:', err.message);
    if (!res.headersSent) res.status(500).send('Relay connection error');
  });

  proxyReq.end();
});

// ============= Local player launcher endpoint =============
app.post('/api/play/local', async (req, res) => {
  const { player, url, path, args } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let launchUrl = url;

  // Wrap SSL HTTPS links in our local HTTP relay to bypass player cert trust blocks
  if (url.startsWith('https://')) {
    launchUrl = `http://127.0.0.1:${PORT}/api/relay?url=${encodeURIComponent(url)}`;
  }

  // Create a temporary M3U file on disk if streaming from TorrServer or routed through relay
  if (launchUrl.includes('/stream') || launchUrl.includes('/playlist') || launchUrl.includes('/api/relay')) {
    try {
      const tempDir = pathModule.join(__dirname, 'public', 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilename = `stream_${Date.now()}.m3u8`;
      const tempPath = pathModule.join(tempDir, tempFilename);

      let m3uContent = `#EXTM3U\n#EXTINF:-1,Stream Vault Playback\n${launchUrl}\n`;

      if (url.includes('/playlist')) {
        const fetchRes = await fetch(url).catch(() => null);
        if (fetchRes && fetchRes.ok) {
          const originalM3u = await fetchRes.text();
          // Rewrite all stream links in TorrServer's playlist to pass through our local relay
          m3uContent = originalM3u.replace(/(https?:\/\/[^\s]+)/g, (match) => {
            return `http://127.0.0.1:${PORT}/api/relay?url=${encodeURIComponent(match)}`;
          });
        }
      }

      fs.writeFileSync(tempPath, m3uContent);
      console.log(`[Local Player] Created temp M3U playlist file: ${tempPath}`);

      launchUrl = tempPath;

      // Automatically clean up after 2 minutes (120 seconds)
      setTimeout(() => {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            console.log(`[Local Player] Deleted temp M3U playlist file: ${tempPath}`);
          }
        } catch (err) {
          console.error('[Local Player] Temp file delete error:', err.message);
        }
      }, 120000);

    } catch (e) {
      console.error('[Local Player] Temp playlist write error:', e.message);
      launchUrl = url;
    }
  }

  let cmdArgs = [launchUrl];
  if (player === 'vlc' && launchUrl.includes('https:')) {
    cmdArgs.push('--no-gnutls-verify-trust');
  }
  if (args) {
    cmdArgs.push(...args.split(' ').filter(a => a.trim() !== ''));
  }

  let executable = '';
  if (player === 'mpv') {
    executable = path || 'mpv';
  } else if (player === 'vlc') {
    if (path) {
      executable = path;
    } else {
      const path64 = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';
      const path32 = 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe';
      if (fs.existsSync(path64)) {
        executable = path64;
      } else if (fs.existsSync(path32)) {
        executable = path32;
      } else {
        executable = 'vlc';
      }
    }
  } else {
    return res.status(400).json({ error: 'Unsupported player type' });
  }

  console.log(`[Local Player] Spawning ${player} executable: "${executable}" with args:`, cmdArgs);

  try {
    const child = spawn(executable, cmdArgs, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    child.on('error', (err) => {
      console.error(`[Local Player] Spawning error for ${player}:`, err.message);
    });
  } catch (err) {
    console.error(`[Local Player] Failed to spawn ${player}:`, err.message);
  }

  res.json({ ok: true });
});

// ============= WebTorrent Backend Client & Routes =============
let WebTorrentClient = null;

async function getWebTorrentClient() {
  if (WebTorrentClient) return WebTorrentClient;
  try {
    const { default: WebTorrent } = await import('webtorrent');
    WebTorrentClient = new WebTorrent();
    console.log('✅ WebTorrent backend client initialized successfully');
    return WebTorrentClient;
  } catch (err) {
    console.error('❌ Failed to initialize WebTorrent backend client:', err.message);
    throw err;
  }
}

app.post('/api/webtorrent/add', async (req, res) => {
  const { magnet } = req.body;
  if (!magnet) return res.status(400).json({ error: 'Missing magnet' });

  console.log('[WebTorrent] Add request received for magnet:', magnet);

  try {
    const client = await getWebTorrentClient();
    let torrent = await client.get(magnet);

    const respondWithMetadata = (t) => {
      const files = t.files.map((f, index) => ({
        id: index,
        name: f.name,
        path: f.path,
        size: f.length
      }));
      res.json({ hash: t.infoHash, files });
    };

    if (torrent) {
      if (torrent.ready) {
        respondWithMetadata(torrent);
      } else {
        torrent.on('ready', () => respondWithMetadata(torrent));
      }
    } else {
      console.log('Adding new torrent to WebTorrent client');
      torrent = client.add(magnet, (t) => {
        respondWithMetadata(t);
      });
      console.log('client.add returned:', typeof torrent, torrent ? Object.keys(torrent).filter(k => typeof torrent[k] === 'function').join(',') : 'null');

      if (torrent && typeof torrent.on === 'function') {
        torrent.on('error', (err) => {
          console.error('[WebTorrent Add] error:', err.message);
          if (!res.headersSent) {
            res.status(500).json({ error: err.message });
          }
        });
      } else {
        console.error('torrent.on is not a function. Torrent object:', torrent);
      }
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/webtorrent/stream', async (req, res) => {
  const { magnet, fileId } = req.query;
  if (!magnet) return res.status(400).send('Missing magnet');

  try {
    const client = await getWebTorrentClient();
    const torrent = await client.get(magnet);
    if (!torrent || !torrent.ready) {
      return res.status(400).send('Torrent not ready. Call /api/webtorrent/add first.');
    }

    const fileIdx = parseInt(fileId || 0, 10);
    const videoFile = torrent.files[fileIdx];
    if (!videoFile) {
      return res.status(404).send('File not found');
    }

    // Stream file
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, {
        'Content-Length': videoFile.length,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes'
      });
      videoFile.createReadStream().pipe(res);
      return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : videoFile.length - 1;
    const chunksize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${videoFile.length}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4'
    });

    videoFile.createReadStream({ start, end }).pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ============= Start server =============
app.listen(PORT, () => {
  console.log(`🚀 Stream Vault running at http://127.0.0.1:${PORT}`);
  console.log(`📡 API: http://127.0.0.1:${PORT}/api/health`);
  console.log(`🎬 TorrServer URL: ${TORRSERVER_URL}`);
  if (!TMDB_API_KEY || TMDB_API_KEY === 'your_tmdb_key_here') {
    console.log('⚠️  TMDB_API_KEY not configured - movie/TV search will be limited');
  }
  console.log('✅ 1337x support enabled');
  console.log('✅ Ext.to support enabled');
  console.log('✅ YTS.gg support enabled');
  console.log('✅ EZTVx.to support enabled');
});
