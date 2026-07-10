<p align="center">
  <img src="public/favicon.svg" alt="Stream Vault Logo" width="80" height="80">
  <h1 align="center">Stream Vault</h1>
  <p align="center">Your Personal Media Hub for Anime, Movies & TV Shows</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Version-1.0.6-success.svg" alt="Version"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-16%2B-green.svg" alt="Node.js"></a>
  <img src="https://img.shields.io/badge/Status-Active-brightgreen.svg" alt="Status">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/30ea9e94-b430-4723-a802-bfba024665c2" alt="Stream Vault Screenshot" width="800">
</p>

---

## ✨ Features

- **Direct Play** first stream plays instantly via dedicated direct-play servers
- **Torrent Streaming** download media or play via VLC using the browser extension
- **Search** concurrent results from Prowlarr indexers + YTS
- **Metadata** enriched from AniList (anime) and TMDB (movies/shows)
- **Stream** directly in browser or route to VLC/MPV
- **Anime & Movies & TV** separated sections with per-section filters
- **Language Filter** 16-language dropdown for Movies & TV
- **Suggestion System** three-channel notice/suggestion/status with admin workflow and tag-based filtering
- **Responsive** dark UI built with vanilla JS
- **Self-hosted** — no data leaves your server

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 16.0+
- **Prowlarr** Server (recommended)
- **TMDB API Key**

### Quick Start

```bash
git clone https://github.com/yourusername/stream-vault.git
cd stream-vault
npm install
```

Create a `.env` file:

```env
PORT=3000
TORZNAB_API_KEY=your_prowlarr_key
TORZNAB_BASE_URL=https://your-prowlarr-instance.com/api
TMDB_API_KEY=your_tmdb_api_key
```

Start the server:

```bash
npm start
```

Visit `http://localhost:3000`

---

## 📋 Data Sources

### Torrent Indexers

| Indexer | Content | Integration |
| --- | --- | --- |
| The Pirate Bay | Movies/Shows | Prowlarr Native |
| YTS | HD Movies | Direct Scraper |
| Nyaa.si | Anime | Prowlarr Native / Direct |
| EZTV | TV Shows | Prowlarr Native |
| LimeTorrents | All | Prowlarr Native |
| Torrentsome | All | Prowlarr Native |
| SkTorrent | All | Prowlarr Native |
| 1337x / Ext.to | Movies/Shows | Add to Prowlarr |

### Direct Play Sources

| Source | Content | Type |
| --- | --- | --- |
| Multi-server direct-play backends | Movies / TV / Anime | Instant stream (no download) |

### Metadata

- **AniList** — anime metadata
- **TMDB** — movies & TV metadata

---

## 🔧 Configuration

```env
PORT=3000
TORZNAB_API_KEY=your_api_key
TORZNAB_BASE_URL=https://your-instance.com
TMDB_API_KEY=your_tmdb_key
```

---

## 💾 Project Structure

```
stream-vault/
├── extension/                     # Browser extension
│   ├── EXTENSION_SETUP.md
│   ├── background.js
│   ├── content.js
│   ├── icon.png
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── settings.html
│   └── settings.js
├── native-host/                   # Native messaging host (VLC launcher)
│   ├── com.streamvault.launcher.json
│   ├── host.js
│   ├── host.log
│   ├── install_host.bat
│   └── run_host.bat
├── public/
│   ├── icons/
│   │   ├── android-chrome-192x192.png
│   │   ├── android-chrome-512x512.png
│   │   ├── apple-touch-icon.png
│   │   ├── favicon-16x16.png
│   │   ├── favicon-32x32.png
│   │   ├── favicon.ico
│   │   └── site.webmanifest
│   ├── app.js
│   ├── favicon.svg
│   ├── index.html
│   ├── manifest.json
│   ├── style.css
│   ├── sw.js
│   └── theme.css
├── routes/
│   └── stream.js
├── .env
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── README.md
├── catalog.json
├── main.js
├── package-lock.json
├── package.json
├── server.js
├── suggestions.json
└── users.json
```

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

Copyright (c) 2026 DTEmpire (DargoTamber)

---

<p align="center">
  Made with ❤️ for the Media Streaming Community<br>
  <strong>© DTEmpire (DargoTamber) | v1.0.6</strong>
</p>
