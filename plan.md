# Stream Vault - Comprehensive Project Plan

## Executive Summary

**Goal**: Build a self-hosted, Jellyfin-inspired personal media hub that discovers anime/movies/shows via torrent indexers (Nyaa.si, 1337x, TPB, YTS, EZTV, LimeTorrents, Torrentsome, SkTorrent) and metadata APIs (AniList, TMDB), with direct in-browser playback and session-only cache behavior.

**Current State**: Backend APIs fully functional (verified 75+ results each). Frontend renders but shows empty state on initial load. Only 1 of 8 torrent indexers integrated. TMDB API key not configured.

---

## 🎯 User's Specific Architecture Requirements

### Torrent Engine → Cache → Media Player Pipeline
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Torrent Engine │────▶│   Cache Layer    │────▶│  Media Player   │
│                 │     │                  │     │                 │
│ • TorrServer    │     │ • Ephemeral      │     │ • In-browser    │
│ • WebTorrent    │     │   (session-only) │     │   HTML5 <video> │
│ • Prowlarr      │     │ • Auto-cleanup   │     │ • VLC protocol  │
│   (8 indexers)  │     │   on close       │     │   handler       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Data Sources
| Content Type | Metadata API | Torrent Source |
|--------------|--------------|----------------|
| **Anime** | AniList (GraphQL) | Nyaa.si (Prowlarr ID 4) + others |
| **Movies** | TMDB (REST) | YTS (Prowlarr ID 3), 1337x, TPB |
| **TV Shows** | TMDB (REST) | EZTV (Prowlarr ID 5), 1337x, TPB |

### TorrServer Integration (Alternative Engine)
**TorrServer** (https://github.com/YouROK/TorrServer) - A standalone torrent streaming server that:
- Runs as separate service (Go-based, cross-platform)
- Provides HTTP API for torrent streaming
- Supports magnet links, .torrent files, infohash
- Streams via HLS/DASH for browser playback
- Has built-in transcoding (FFmpeg)
- Can be embedded or run standalone on port 8090

**Integration Options**:
1. **Embedded**: Run TorrServer as child process from Node.js
2. **External**: User runs TorrServer separately, our app calls its API
3. **Hybrid**: Our app manages TorrServer lifecycle via API

**TorrServer API Endpoints**:
- `GET /api/torrents` - List active torrents
- `POST /api/torrents` - Add magnet/torrent
- `GET /api/torrents/{id}/stream` - HLS stream URL
- `GET /api/torrents/{id}/files` - File list in torrent
- `DELETE /api/torrents/{id}` - Remove torrent

---

## Phase 1: Critical Fixes (Immediate - Blocks User Perception)

### 1.1 Fix Empty Initial UI State
**Problem**: User sees "0 anime + 0 media + 0 torrent results" on first visit. Search works but requires user action.

**Solution**: Add `/api/trending` endpoint that populates home sections on page load.
- **Trending Anime**: AniList current season + high score (GraphQL: `season: CURRENT, sort: SCORE_DESC`)
- **Popular Movies**: TMDB `/trending/movie/week` 
- **Recent Torrents**: Nyaa empty search with date sort (or recent uploads)
- **Continue Watching**: Already works via sessionStorage, just needs render on load

**Files**: `server.js` (new endpoint), `public/app.js` (call on load), `public/index.html` (section containers exist)

### 1.2 Configure TMDB API Key
**Problem**: TMDB returns empty/mock data without API key.

**Solution**: 
1. Get key from https://www.themoviedb.org/settings/api
2. Add to environment: `TMDB_API_KEY=your_key_here`
3. Verify `/api/search?q=test` returns real movie/TV data

---

## Phase 2: Core Jellyfin Experience (High Priority)

### 2.1 Multi-Indexer Torrent Search
**User provided 8 indexers via Prowlarr** (all same API key: `4bf8dd57f1d043ae88fb5da57f789994`):

| Indexer | ID | Base URL |
|---------|-----|----------|
| 1337x | 1 | `https://powerlerr.ankitgupta.com.np/1/api` |
| The Pirate Bay | 2 | `https://powerlerr.ankitgupta.com.np/2/api` |
| YTS | 3 | `https://powerlerr.ankitgupta.com.np/3/api` |
| **Nyaa.si** | **4** | **`https://powerlerr.ankitgupta.com.np/4/api`** ✅ Done |
| EZTV | 5 | `https://powerlerr.ankitgupta.com.np/5/api` |
| Torrentsome | 7 | `https://powerlerr.ankitgupta.com.np/7/api` |
| LimeTorrents | 8 | `https://powerlerr.ankitgupta.com.np/8/api` |
| SkTorrent | 9 | `https://powerlerr.ankitgupta.com.np/9/api` |

**Implementation**:
- Add indexer selector in UI (dropdown in search bar or settings)
- Backend: `searchAllIndexers(query, selectedIds[])` → parallel requests → merge/dedupe results
- Frontend: Show source badges on torrent cards (Nyaa, 1337x, YTS, etc.)

### 2.2 Anime Detail Page + Episode List
**Reference**: StreamNyaa anime pages with posters, genres, episode info, release schedule.

**Data Sources**:
- AniList: Full anime details (episodes count, nextAiringEpisode, genres, description, coverImage)
- Nyaa: Search per episode (`query: "anime title episode 5"`)

**UI Flow**: Click anime card → Detail view (sidebar stays, right panel shows details) → Episode list → Click episode → Search torrents for that episode → Play

**Files**: `public/index.html` (detail view template), `public/app.js` (routing/state), `public/style.css` (detail layout)

### 2.3 Magnet Link Handling & Playback
**Core Vision**: "Direct played on site using player inbuild player... like a cache file where when we close the movie it gone"

**Options** (in order of complexity):
1. **WebTorrent** (in-browser torrent streaming) - Most complex, true streaming
2. **"Open in VLC"** - `vlc://` protocol handler, user has VLC installed
3. **Magnet copy button** - Fallback, user pastes into their client
4. **External player links** - Stremio, WebTorrent Desktop, etc.

**Recommendation**: Start with #2 (VLC protocol) + #3 (copy magnet) for immediate utility. WebTorrent as Phase 4.

**Implementation**:
- Torrent cards show "Play in VLC" button (opens `vlc://{magnet}`)
- "Copy Magnet link)
- "Copy Magnet" button
- Video player only for direct MP4/HLS sources (user-added catalog)

---

## Phase 3: StreamNyaa Parity Features (Medium Priority)

### 3.1 Release Schedule / Calendar
**Reference**: StreamNyaa "release schedule for currently airing shows with automatic time conversion"

**Data**: AniList `nextAiringEpisode { airingAt, timeUntilAiring, episode }`

**UI**: Calendar view (week/month) showing airing anime with countdown timers, timezone-aware.

### 3.2 Advanced Search & Filters
- **Anime**: Season, year, genre, status (airing/completed), format (TV/Movie/OVA)
- **Movies/Shows**: Year, genre, rating, language, TMDB "with_keywords"
- **Torrents**: Category (anime/movie/tv), quality (1080p/720p/4K), seeders range, size range

### 3.3 User Preferences (localStorage)
- Default indexers enabled
- Preferred quality (1080p, 720p, 4K)
- Preferred language/subtitles
- Theme (dark/light/system)
- Auto-play next episode
- Player preferences (volume, speed, subtitle offset)

---

## Phase 4: Advanced Streaming (Future)

### 4.1 WebTorrent Integration
- Stream torrents directly in `<video>` element via WebRTC
- Requires: WebTorrent client, STUN/TURN servers, hybrid mode for mobile
- Complexity: High (NAT traversal, mobile Safari limitations)

### 4.2 Subtitle Support
- Fetch from OpenSubtitles, Subscene, or embedded in torrent
- WebVTT rendering in `<track>` element
- Multiple language selection

### 4.3 Quality Selection
- Multiple sources per title (different resolutions)
- Adaptive bitrate (HLS/DASH) if available
- Manual quality picker in player

---

## Phase 5: PWA & Platform (Polish)

### 5.1 PWA Enhancements
- Service Worker for offline shell (not content)
- Background sync for "continue watching"
- Install prompt optimization
- App shortcuts (Search, Trending, Calendar)

### 5.2 Mobile App Wrapper (Optional)
- Capacitor/Tauri for Android/iOS
- Native VLC intent handling on Android
- Background audio for music/anime OST

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Vanilla JS)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐   │
│  │  Index   │  │  Detail  │  │ Player   │  │  Settings  │   │
│  │  View    │  │  View    │  │  Panel   │  │  Modal     │   │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘   │
│         │           │            │              │            │
│         └───────────┴────────────┴──────────────┘            │
│                         │                                     │
│              ┌──────────▼──────────┐                          │
│              │   app.js (State)    │                          │
│              │  - search/query     │                          │
│              │  - currentView      │                          │
│              │  - selectedMedia    │                          │
│              │  - continueWatching │                          │
│              │  - preferences      │                          │
│              └──────────┬──────────┘                          │
└─────────────────────────│─────────────────────────────────────┘
                          │ fetch()
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Express.js)                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ /api/search │ │/api/trending│ │/api/catalog │            │
│  │  (unified)  │ │  (home)     │ │  (custom)   │            │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘            │
│         │               │               │                    │
│  ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐            │
│  │ searchNyaa  │ │searchAniList│ │ searchTMDB  │            │
│  │ (Torznab)   │ │ (GraphQL)   │ │ (REST)      │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ Prowlarr │    │ AniList  │    │   TMDB   │
   │ Indexers │    │ GraphQL  │    │   REST   │
   └──────────┘    └──────────┘    └──────────┘
```

---

## TorrServer Integration (Alternative Torrent Engine)

### Why TorrServer?
- **Standalone Go service** - Runs independently, no Node.js native dependencies
- **HLS/DASH streaming** - Native browser playback via `<video>` element
- **Built-in transcoding** - FFmpeg integration for codec compatibility
- **REST API** - Easy integration from our Express backend
- **Cross-platform** - Windows, Linux, macOS, ARM (Raspberry Pi, etc.)

### Architecture with TorrServer
```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vanilla JS)                     │
└─────────────────────────────┬───────────────────────────────┘
                              │ fetch()
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Express.js)                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ /api/search │ │/api/trending│ │/api/catalog │            │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘            │
│         │               │               │                    │
│  ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐            │
│  │ searchNyaa  │ │searchAniList│ │ searchTMDB  │            │
│  │ (Torznab)   │ │ (GraphQL)   │ │ (REST)      │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│         │               │               │                    │
│         └───────────────┼───────────────┘                    │
│                         ▼                                    │
│              ┌─────────────────────┐                         │
│              │  Torrent Engine     │                         │
│              │  Abstraction Layer  │                         │
│              └──────────┬──────────┘                         │
│                         │                                    │
│         ┌───────────────┼───────────────┐                    │
│         ▼               ▼               ▼                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │  Prowlarr   │ │  TorrServer │ │  WebTorrent │            │
│  │  (Indexers) │ │  (Streaming)│ │  (P2P WebRTC)│           │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### TorrServer API Integration

**Service Management** (Node.js manages TorrServer lifecycle):
```javascript
// services/torrserver.js
const { spawn } = require('child_process');

class TorrServerManager {
  constructor() {
    this.process = null;
    this.baseUrl = 'http://localhost:8090';
    this.apiKey = null; // Optional auth
  }

  async start() {
    if (this.process) return;
    
    // Download TorrServer binary if not present
    const binary = await this.ensureBinary();
    
    this.process = spawn(binary, ['-port', '8090'], {
      stdio: 'inherit',
      detached: false
    });
    
    // Wait for ready
    await this.waitForReady();
  }

  async addTorrent(magnetOrFile) {
    const res = await fetch(`${this.baseUrl}/api/torrents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: magnetOrFile })
    });
    return res.json(); // { id: "abc123", ... }
  }

  async getStreamUrl(torrentId, fileIndex = 0) {
    // Returns HLS manifest URL: http://localhost:8090/api/torrents/{id}/stream/{fileIndex}.m3u8
    return `${this.baseUrl}/api/torrents/${torrentId}/stream/${fileIndex}.m3u8`;
  }

  async getFiles(torrentId) {
    const res = await fetch(`${this.baseUrl}/api/torrents/${torrentId}/files`);
    return res.json(); // [{ index: 0, name: "ep01.mkv", size: 123456789, ... }]
  }

  async removeTorrent(torrentId) {
    await fetch(`${this.baseUrl}/api/torrents/${torrentId}`, { method: 'DELETE' });
  }
}
```

### Playback Flow with TorrServer
```
User clicks "Watch Episode 5"
       │
       ▼
Search Prowlarr for "Anime Title Episode 5"
       │
       ▼
Filter results: video files only, sort by seeders
       │
       ▼
Show torrent results with "Play via TorrServer" button
       │
       ▼
User clicks Play → POST /api/torrents { magnet }
       │
       ▼
TorrServer starts downloading, generates HLS manifest
       │
       ▼
Frontend: video.src = "http://localhost:8090/api/torrents/{id}/stream/0.m3u8"
       │
       ▼
Browser plays HLS stream natively (hls.js for Safari/Firefox)
       │
       ▼
On close: DELETE /api/torrents/{id} → cache cleared
```

### TorrServer vs WebTorrent vs Direct MP4

| Feature | TorrServer | WebTorrent | Direct MP4 |
|---------|------------|------------|------------|
| **Codec Support** | Full (FFmpeg) | Limited (WebM/MP4) | Native only |
| **Browser Playback** | HLS/DASH (hls.js) | WebRTC/MSE | Native `<video>` |
| **Transcoding** | ✅ Yes | ❌ No | ❌ No |
| **Seek Performance** | Excellent | Good | Excellent |
| **Resource Usage** | Medium (Go + FFmpeg) | Low (P2P) | Lowest |
| **Setup Complexity** | Medium (binary) | Low (npm) | None |
| **Mobile Support** | ✅ HLS works | ⚠️ Limited | ✅ Native |
| **Cache Behavior** | Auto-cleanup on delete | Auto-cleanup on close | Session only |

### Recommended: Hybrid Approach
1. **Primary**: Try direct MP4/WebM playback (fastest, lowest resource)
2. **Secondary**: TorrServer for MKV/HEVC/proprietary codecs (transcodes to HLS)
3. **Tertiary**: "Open in VLC" protocol handler for unsupported cases
4. **Future**: WebTorrent for pure P2P (when WebRTC works reliably)

---

## File-by-File Change Map

### Backend (`server.js`)
| Function/Route | Status | Changes Needed |
|---|---|---|
| `searchNyaa()` | ✅ Done | Extend to `searchIndexer(id, query)` |
| `searchAniList()` | ✅ Done | Add `getAnimeDetail(id)`, `getAiringSchedule()` |
| `searchTMDB()` | ⚠️ Needs API key | Add `getTrendingMovies()`, `getTrendingTV()`, `getMediaDetail()` |
| `parseTorznabItems()` | ✅ Done | - |
| `GET /api/search` | ✅ Done | Add `indexers[]` query param |
| `GET /api/trending` | ❌ Missing | **NEW** - Critical for Phase 1 |
| `GET /api/anime/:id` | ❌ Missing | **NEW** - For detail page |
| `GET /api/schedule` | ❌ Missing | **NEW** - For calendar |
| `GET /api/catalog` | ✅ Done | - |
| `POST /api/catalog` | ✅ Done | - |

### Frontend (`public/app.js`)
| Function | Status | Changes Needed |
|---|---|---|
| `loadCatalog()` | ✅ Done | Call `/api/trending` on init |
| `searchMedia()` | ✅ Done | Add indexer filter param |
| `renderAnimeGrid()` | ✅ Done | - |
| `renderMediaGrid()` | ✅ Done | - |
| `renderTorrentGrid()` | ✅ Done | Add source badges |
| `selectMedia()` | ✅ Done | Navigate to detail view for anime |
| `playDirectSource()` | ✅ Done | - |
| `openExternal()` | ✅ Done | Add VLC protocol handler |
| **NEW** `loadTrending()` | ❌ Missing | Fetch `/api/trending`, populate sections |
| **NEW** `showAnimeDetail(id)` | ❌ Missing | Fetch `/api/anime/:id`, render detail view |
| **NEW** `loadSchedule()` | ❌ Missing | Fetch `/api/schedule`, render calendar |
| **NEW** `handleMagnet(magnet)` | ❌ Missing | VLC protocol / copy / WebTorrent |

### Frontend (`public/index.html`)
| Section | Status | Changes Needed |
|---|---|---|
| Sidebar | ✅ Done | - |
| Hero/Search | ✅ Done | Add indexer selector dropdown |
| Continue Watching | ✅ Done | Auto-populate on load |
| Trending Anime | ⚠️ Empty | Populate from `/api/trending` |
| Popular Movies | ⚠️ Empty | Populate from `/api/trending` |
| Torrent Results | ⚠️ Empty | Populate from `/api/trending` |
| **NEW** Anime Detail View | ❌ Missing | Template for detail panel |
| **NEW** Schedule/Calendar | ❌ Missing | Calendar grid view |
| Player Panel | ✅ Done | Add VLC button for torrents |
| Settings Modal | ⚠️ Basic | Add preferences (indexers, quality, theme) |

---

## Implementation Sequence

### Sprint 1 (Week 1): "Make It Feel Alive"
- [ ] Add `/api/trending` endpoint
- [ ] Configure TMDB API key
- [ ] Frontend: Call trending on load, populate 3 sections
- [ ] Verify: User sees content immediately on visit

### Sprint 2 (Week 2): "Multi-Source Search"
- [ ] Refactor `searchNyaa` → `searchIndexer(id, query)`
- [ ] Add indexer selector to search UI
- [ ] Implement parallel multi-indexer search
- [ ] Add source badges to torrent cards

### Sprint 3 (Week 3): "Anime Deep Dive"
- [ ] Add `/api/anime/:id` (AniList detail)
- [ ] Build anime detail view (poster, synopsis, genres, episodes)
- [ ] Episode list with per-episode torrent search
- [ ] "Play in VLC" / "Copy Magnet" buttons

### Sprint 4 (Week 4): "Schedule & Polish"
- [ ] Add `/api/schedule` (AniList airing calendar)
- [ ] Build calendar view
- [ ] Settings modal with preferences
- [ ] localStorage persistence

### Sprint 5+ (Ongoing): "Streaming & Platform"
- [ ] WebTorrent integration
- [ ] Subtitle support
- [ ] PWA service worker
- [ ] Mobile wrapper (Capacitor/Tauri)

---

## Environment Configuration

```bash
# Required
TORZNAB_API_KEY=4bf8dd57f1d043ae88fb5da57f789994
TMDB_API_KEY=your_tmdb_key_here

# Optional (defaults shown)
TORZNAB_BASE_URL=https://powerlerr.ankitgupta.com.np/4/api
PORT=3000
NODE_ENV=development
```

---

## Testing Checklist

- [ ] Server starts on port 3000 (auto-increment on conflict)
- [ ] `/api/health` returns `{ok: true, service: "media-streamer"}`
- [ ] `/api/search?q=one piece` returns anime(75+), media(75+), torrents(75+)
- [ ] `/api/trending` returns populated anime[], movies[], torrents[]
- [ ] Initial page load shows content in all 3 sections
- [ ] Search with indexer filter works
- [ ] Anime card click → detail view loads
- [ ] Episode click → torrent search for that episode
- [ ] Magnet link → "Open in VLC" works (if VLC installed)
- [ ] Continue watching persists across reloads (sessionStorage)
- [ ] PWA installs correctly

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| TMDB API rate limits | Medium | Cache responses, implement retry/backoff |
| Prowlarr API changes | High | Abstract indexer client, version detection |
| WebTorrent mobile Safari | High | Fallback to VLC/external player |
| CORS on torrent sites | Medium | All via backend proxy (already done) |
| Large torrent files OOM | Medium | Stream don't buffer, cleanup on unload |

---

## Success Metrics

1. **Time to First Content**: < 2 seconds on localhost
2. **Search Latency**: < 3 seconds for multi-indexer
3. **Playback Start**: < 5 seconds for direct sources
4. **Zero Config**: Works with just `npm start` + TMDB key
5. **Private Use**: No auth, no external tracking, no logs

---

*Generated from conversation analysis on 2026-07-04. This plan reflects all user requirements from the full chat history.*