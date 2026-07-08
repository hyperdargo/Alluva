const express = require('express');
const router = express.Router();
const cheerio = require('cheerio');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 7 * 24 * 60 * 60 }); // 7 days

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191';

async function fetchWithFlareSolverr(targetUrl, timeoutMs = 45000) {
  try {
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
      return data.solution.response;
    }
  } catch (error) {
    console.error('FlareSolverr error:', error.message);
  }
  return null;
}

async function fetchHtml(url) {
    // Try standard fetch first
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        return res.data;
    } catch (e) {
        if (e.response && (e.response.status === 403 || e.response.status === 503 || e.response.status === 522)) {
            console.log(`[Scraper] Cloudflare detected on ${url}, using Flaresolverr...`);
            const html = await fetchWithFlareSolverr(url);
            if (html) return html;
        }
        console.error(`[Scraper] Failed to fetch ${url}`);
        return null;
    }
}

async function resolveAnime(title, episode) {
    // 1. Search
    const searchUrl = `https://hianime.to/ajax/search?keyword=${encodeURIComponent(title)}`;
    const searchHtml = await fetchHtml(searchUrl);
    if (!searchHtml) return null;
    
    // Attempt to extract the first result
    const match = searchHtml.match(new RegExp('href="/(anime/[^"]+)"'));
    if (!match) return null;
    
    const animePath = match[1];
    
    // 2. Get anime page
    const animeUrl = `https://hianime.to/${animePath}`;
    const animeHtml = await fetchHtml(animeUrl);
    if (!animeHtml) return null;
    
    const $ = cheerio.load(animeHtml);
    const animeId = $('#syncData').attr('data-anime-id') || $('div[data-id]').attr('data-id');
    if (!animeId) return null;
    
    // 3. Episode list
    const epListUrl = `https://hianime.to/ajax/v2/episode/list/${animeId}`;
    const epListHtml = await fetchHtml(epListUrl);
    if (!epListHtml) return null;
    
    // Parse JSON or HTML from epListHtml
    let epHtml = epListHtml;
    try {
        const parsed = JSON.parse(epListHtml);
        epHtml = parsed.html || epListHtml;
    } catch(e) {}
    
    const $ep = cheerio.load(epHtml);
    const epId = $ep(`a[data-number="${episode}"]`).attr('data-id');
    if (!epId) return null;
    
    // 4. Stream servers
    const serversUrl = `https://hianime.to/ajax/v2/episode/sources?id=${epId}`;
    const serversHtml = await fetchHtml(serversUrl);
    if (!serversHtml) return null;
    
    let servHtml = serversHtml;
    try {
        const parsed = JSON.parse(serversHtml);
        servHtml = parsed.html || serversHtml;
    } catch(e) {}
    
    const $serv = cheerio.load(servHtml);
    // Prefer Vidcloud/Vidstream (sub or dub depending on what's available)
    let serverId = $serv('.server-item').first().attr('data-id');
    if (!serverId) return null;
    
    // 5. Get source
    const sourcesUrl = `https://hianime.to/ajax/v2/episode/sources?id=${serverId}`;
    const sourcesRes = await fetchHtml(sourcesUrl);
    if (!sourcesRes) return null;
    
    try {
        const data = JSON.parse(sourcesRes);
        if (data.link) {
            // Decrypt logic or proxy embed?
            // HiAnime returns an embed link, which usually requires Rapid-Cloud decryption.
            // For now, we will return the embed link as HLS, but normally we'd decrypt it.
            // Actually, we'll try to extract from the embed link.
            const embedHtml = await fetchHtml(data.link);
            if (embedHtml) {
                const m3u8Match = embedHtml.match(/"file":"([^"]+\\.m3u8)"/);
                if (m3u8Match) {
                    return {
                        hls: m3u8Match[1],
                        subtitles: [] // Extract subs similarly if needed
                    };
                }
            }
        }
    } catch(e) {}
    
    return null;
}

async function resolveMovieTv(title, year, season, episode) {
    const searchUrl = `https://sflix.to/search/${encodeURIComponent(title)}`;
    const searchHtml = await fetchHtml(searchUrl);
    if (!searchHtml) return null;
    
    const $ = cheerio.load(searchHtml);
    const firstResult = $('.film-poster a').first().attr('href');
    if (!firstResult) return null;
    
    const contentUrl = `https://sflix.to${firstResult}`;
    const contentHtml = await fetchHtml(contentUrl);
    if (!contentHtml) return null;
    
    const $content = cheerio.load(contentHtml);
    const mediaId = $content('[data-id]').first().attr('data-id');
    if (!mediaId) return null;
    
    let targetEpId = mediaId;
    if (season && episode) {
        // Handle TV Shows
        const episodesUrl = `https://sflix.to/ajax/v2/episode/servers?episodeId=${mediaId}`;
        const episodesHtml = await fetchHtml(episodesUrl);
        // ... (This is a simplified stub, actual extraction is complex due to obfuscation)
    } else {
        // Movie
        const serversUrl = `https://sflix.to/ajax/movie/episodes/${mediaId}`;
        const serversHtml = await fetchHtml(serversUrl);
        if (!serversHtml) return null;
        
        let sHtml = serversHtml;
        try {
            sHtml = JSON.parse(serversHtml).html || serversHtml;
        } catch(e) {}
        
        const $serv = cheerio.load(sHtml);
        const serverId = $serv('.nav-item a').first().attr('data-id');
        
        if (serverId) {
            const sourcesUrl = `https://sflix.to/ajax/get_link/${serverId}`;
            const sourcesRes = await fetchHtml(sourcesUrl);
            try {
                const data = JSON.parse(sourcesRes);
                if (data.link) {
                    return {
                        hls: data.link, // Usually an embed link like vidplay.online/embed/xxx
                        subtitles: []
                    };
                }
            } catch(e) {}
        }
    }
    
    return null;
}

async function getExternalSubs(title, year, lang) {
  try {
      const res = await axios.get(`https://jwx.com/api/subtitles`, {
        params: { query: `${title} ${year || ''}`, lang }
      });
      if (res.data && res.data.url) {
        return {
          file: res.data.url,
          label: `${lang.toUpperCase()} (external)`,
          kind: "captions"
        };
      }
  } catch(e) {
      // Ignore errors for optional subs
  }
  return null;
}

router.get('/', async (req, res) => {
    const { type, title, year, season, episode, lang } = req.query;
    if (!type || !title) return res.status(400).json({ error: 'Missing type or title' });
    
    const cacheKey = `${type}:${title}:${year}:${season}:${episode}:${lang}`;
    if (cache.has(cacheKey)) {
        return res.json(cache.get(cacheKey));
    }
    
    let result = null;
    if (type === 'anime') {
        result = await resolveAnime(title, episode);
    } else {
        result = await resolveMovieTv(title, year, season, episode);
    }
    
    // Fallback Mock Data if Scrapers fail or return iframe links instead of raw m3u8
    if (!result || !result.hls || !result.hls.includes('.m3u8')) {
        console.log('[Scraper] Failed to resolve native HLS. Using mock HLS for JW Player demo.');
        result = {
            hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
            subtitles: []
        };
    }
    
    // Proxy the HLS url to bypass referer (except for known public test streams)
    let finalHls = result.hls;
    if (!finalHls.includes('test-streams.mux.dev')) {
        finalHls = `${req.protocol}://${req.get('host')}/stream-proxy?url=${encodeURIComponent(result.hls)}&referer=${encodeURIComponent('https://sflix.to/')}`;
    }
    
    const responseData = {
        hls: finalHls,
        subtitles: result.subtitles || [],
        title: title,
        poster: ''
    };
    
    // Inject external sub if requested
    if (lang) {
        const extSub = await getExternalSubs(title, year, lang);
        if (extSub) {
            responseData.subtitles.push(extSub);
        } else {
            // Mock external sub for demo
            responseData.subtitles.push({
                file: "https://cc.zorores.com/20/2e/202eaab6dff289a5976399077449654e/eng-2.vtt",
                label: `${lang.toUpperCase()} (external mock)`,
                kind: "captions"
            });
        }
    }
    
    cache.set(cacheKey, responseData);
    res.json(responseData);
});

// --- ANIKOTO SCRAPER HELPERS ---
const ANIKOTO_BASE = 'https://anikoto.cz';
const ANIKOTO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://anikoto.cz/'
};

async function anikotoSearch(title) {
    try {
        const res = await axios.get(`${ANIKOTO_BASE}/search?keyword=${encodeURIComponent(title)}`, {
            headers: { 'User-Agent': ANIKOTO_HEADERS['User-Agent'] },
            timeout: 10000
        });
        const $ = cheerio.load(res.data);
        const results = [];
        const seen = new Set();
        // The title is in a.name.d-title, the watch link is in the poster anchor
        $('a.name.d-title').each((i, el) => {
            const name = $(el).text().trim();
            const href = $(el).attr('href') || '';
            if (href.includes('/watch/') && !seen.has(href)) {
                seen.add(href);
                results.push({ title: name, url: href });
            }
        });
        return results;
    } catch(e) {
        console.error('[Anikoto] Search failed:', e.message);
        return [];
    }
}

async function anikotoGetAnimeId(watchUrl) {
    try {
        const fullUrl = watchUrl.startsWith('http') ? watchUrl : `${ANIKOTO_BASE}${watchUrl}`;
        const res = await axios.get(fullUrl, {
            headers: { 'User-Agent': ANIKOTO_HEADERS['User-Agent'] },
            timeout: 10000
        });
        const $ = cheerio.load(res.data);
        // The anime ID is in a data-id attribute on the page
        const dataId = $('[data-id]').first().attr('data-id');
        return dataId;
    } catch(e) {
        console.error('[Anikoto] Get anime ID failed:', e.message);
        return null;
    }
}

async function anikotoGetEpisodes(animeId) {
    try {
        const res = await axios.get(`${ANIKOTO_BASE}/ajax/episode/list/${animeId}`, {
            headers: ANIKOTO_HEADERS,
            timeout: 10000
        });
        if (res.data.status !== 200) return [];
        const $ = cheerio.load(res.data.result);
        const episodes = [];
        $('a[data-id]').each((i, el) => {
            episodes.push({
                id: $(el).attr('data-id'),
                num: parseInt($(el).attr('data-num'), 10),
                slug: $(el).attr('data-slug'),
                mal: $(el).attr('data-mal'),
                timestamp: $(el).attr('data-timestamp'),
                hasSub: $(el).attr('data-sub') === '1',
                hasDub: $(el).attr('data-dub') === '1',
                dataIds: $(el).attr('data-ids')
            });
        });
        return episodes;
    } catch(e) {
        console.error('[Anikoto] Get episodes failed:', e.message);
        return [];
    }
}

async function anikotoGetServers(dataIds) {
    try {
        const res = await axios.get(`${ANIKOTO_BASE}/ajax/server/list?servers=${encodeURIComponent(dataIds)}`, {
            headers: ANIKOTO_HEADERS,
            timeout: 10000
        });
        if (res.data.status !== 200) return [];
        const $ = cheerio.load(res.data.result);
        const servers = [];
        $('li[data-link-id]').each((i, el) => {
            const parentType = $(el).closest('[data-type]').attr('data-type') || 'sub';
            servers.push({
                name: $(el).text().trim(),
                linkId: $(el).attr('data-link-id'),
                svId: $(el).attr('data-sv-id'),
                type: parentType === 'dub' ? 'dub' : 'sub'
            });
        });
        // Sort: Vidstream first, Vidplay second, VidCloud third, HD fourth
        const ORDER = { 'vidstream': 1, 'vidplay': 2, 'vidcloud': 3, 'hd': 4 };
        servers.sort((a, b) => {
            const aKey = Object.keys(ORDER).find(k => a.name.toLowerCase().includes(k)) || '';
            const bKey = Object.keys(ORDER).find(k => b.name.toLowerCase().includes(k)) || '';
            return (ORDER[aKey] || 99) - (ORDER[bKey] || 99);
        });
        return servers;
    } catch(e) {
        console.error('[Anikoto] Get servers failed:', e.message);
        return [];
    }
}

async function anikotoGetEmbedUrl(linkId) {
    try {
        const res = await axios.get(`${ANIKOTO_BASE}/ajax/server?get=${encodeURIComponent(linkId)}`, {
            headers: ANIKOTO_HEADERS,
            timeout: 10000
        });
        if (res.data.status === 200 && res.data.result?.url) {
            return res.data.result.url;
        }
        return null;
    } catch(e) {
        console.error('[Anikoto] Get embed URL failed:', e.message);
        return null;
    }
}

function bestTitleMatch(searchResults, targetTitle) {
    const target = targetTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    // Exact match first
    for (const r of searchResults) {
        if (r.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim() === target) return r;
    }
    // Starts-with match
    for (const r of searchResults) {
        const t = r.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (t.startsWith(target) || target.startsWith(t)) return r;
    }
    // Contains match
    for (const r of searchResults) {
        if (r.title.toLowerCase().includes(target) || target.includes(r.title.toLowerCase())) return r;
    }
    return searchResults[0] || null;
}

// --- ANIME ENDPOINTS ---
router.get('/anime/servers', async (req, res) => {
    const { title, episode, tmdbId } = req.query;
    if (!title || !episode) return res.status(400).json({ error: 'Missing title or episode' });
    
    const cacheKey = `anime_servers_v4:${title}:${episode}`;
    if (!req.query.bypass && cache.has(cacheKey)) return res.json(cache.get(cacheKey));
    
    try {
        const epNum = parseInt(episode, 10);
        let servers = [];
        
        // --- PRIMARY: Anikoto scraping ---
        console.log(`[Anikoto] Searching for: "${title}" ep ${epNum}`);
        const searchResults = await anikotoSearch(title);
        
        if (searchResults.length > 0) {
            const match = bestTitleMatch(searchResults, title);
            console.log(`[Anikoto] Best match: "${match.title}" -> ${match.url}`);
            
            // Get the anime ID from the watch page
            const animeId = await anikotoGetAnimeId(match.url);
            console.log(`[Anikoto] Anime ID: ${animeId}`);
            
            if (animeId) {
                const episodes = await anikotoGetEpisodes(animeId);
                console.log(`[Anikoto] Found ${episodes.length} episodes`);
                
                // Find the right episode
                const targetEp = episodes.find(ep => ep.num === epNum);
                
                if (targetEp && targetEp.dataIds) {
                    console.log(`[Anikoto] Found ep ${epNum}, fetching servers...`);
                    const anikotoServers = await anikotoGetServers(targetEp.dataIds);
                    console.log(`[Anikoto] Found ${anikotoServers.length} servers`);
                    
                    // Resolve embed URLs for each server
                    for (const srv of anikotoServers) {
                        const embedUrl = await anikotoGetEmbedUrl(srv.linkId);
                        if (embedUrl) {
                            servers.push({
                                id: Buffer.from(embedUrl).toString('base64'),
                                name: srv.name,
                                type: srv.type,
                                source: 'anikoto'
                            });
                        }
                    }
                } else {
                    console.log(`[Anikoto] Episode ${epNum} not found in list`);
                }
            }
        } else {
            console.log(`[Anikoto] No search results for: "${title}"`);
        }
        
        // --- FALLBACK: TMDB-based embed providers ---
        if (servers.length === 0) {
            console.log('[Fallback] Using TMDB-based embed providers');
            const TMDB_API_KEY = process.env.TMDB_API_KEY;
            let actualTmdbId = tmdbId;
            let s = 1, e = epNum;
            
            if (TMDB_API_KEY && TMDB_API_KEY !== 'your_tmdb_key_here') {
                try {
                    const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
                    const searchRes = await axios.get(searchUrl);
                    if (searchRes.data.results?.length > 0) {
                        actualTmdbId = searchRes.data.results[0].id;
                    }
                    const detailsRes = await axios.get(`https://api.themoviedb.org/3/tv/${actualTmdbId}?api_key=${TMDB_API_KEY}`);
                    const details = detailsRes.data;
                    const seasons = details.seasons.filter(season => season.season_number > 0).sort((a,b) => a.season_number - b.season_number);
                    
                    let totalCount = 0;
                    for (const season of seasons) {
                        if (totalCount + season.episode_count >= epNum) {
                            const seasonRes = await axios.get(`https://api.themoviedb.org/3/tv/${actualTmdbId}/season/${season.season_number}?api_key=${TMDB_API_KEY}`);
                            const seasonData = seasonRes.data;
                            let matched = seasonData.episodes.find(ep => ep.episode_number === epNum);
                            if (matched) { s = season.season_number; e = matched.episode_number; break; }
                            const index = epNum - totalCount - 1;
                            if (index >= 0 && index < seasonData.episodes.length) { s = season.season_number; e = seasonData.episodes[index].episode_number; break; }
                        }
                        totalCount += season.episode_count;
                    }
                } catch (tmdbErr) {
                    console.error('[TMDB Fallback] Error:', tmdbErr.message);
                }
            }
            
            const pushServer = (name, url, type) => {
                servers.push({ id: Buffer.from(url).toString('base64'), name, type, source: 'fallback' });
            };
            pushServer('Vidplay', `https://vidsrc.to/embed/tv/${actualTmdbId}/${s}/${e}`, 'sub');
            pushServer('MyCloud', `https://embed.su/embed/tv/${actualTmdbId}/${s}/${e}`, 'sub');
            pushServer('Filemoon', `https://vidlink.pro/tv/${actualTmdbId}/${s}/${e}`, 'sub');
            pushServer('Vidplay', `https://vidlink.pro/tv/${actualTmdbId}/${s}/${e}?type=dub`, 'dub');
            pushServer('MyCloud', `https://multiembed.mov/?tmdb=${actualTmdbId}&s=${s}&e=${e}&type=dub`, 'dub');
        }
        
        const result = { servers };
        cache.set(cacheKey, result);
        res.json(result);
    } catch(err) {
        console.error('Anime servers error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/anime/embed', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing server id' });
    
    try {
        const url = Buffer.from(id, 'base64').toString('utf-8');
        res.json({ url });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

