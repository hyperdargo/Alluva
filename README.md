# 🎬 Stream Vault v1.0.2

> Your Personal Media Hub for Anime, Movies & TV Shows

<div align="center">

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.2-success.svg)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-16%2B-green.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen.svg)](#)

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗      ║
║   ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║      ║
║   ███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║      ║
║   ╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║      ║
║   ███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║      ║
║   ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝      ║
║                                                               ║
║             🚀 Self-Hosted Personal Media Hub 🚀             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

</div>

---

## ✨ What's New in v1.0.2?

- **Prowlarr Integration (Major Update)**: The entire scraping backend has been overhauled to sync natively with your Prowlarr instance. This completely eliminates Cloudflare `Turnstile` timeouts (which blocked 1337x, EZTV, and Ext.to on older FlareSolverr setups) by offloading the proxy/captcha handling directly to Prowlarr!
- **HDHub4u Direct Links**: Added a powerful new "Direct Download" button for movies that intelligently routes you straight to `new2.hdhub4u.c` to grab DDLs safely without brittle scrapers.
- **YTS Direct Engine**: Retained a custom fallback scraper specifically for `yts.gg` to ensure lightning-fast YTS queries outside of Prowlarr!

---

## ✨ Features

<div align="center">

| Feature | Description |
|---------|-------------|
| 🔍 **Lightning Fast Search** | Discover content concurrently from all your Prowlarr indexers + YTS direct |
| 📺 **Metadata Hub** | Enriched information from AniList (anime) and TMDB (movies/shows) |
| 🎥 **In-Browser Playback** | Stream directly in your browser without downloads |
| 🚀 **Native Player Support** | One-click stream routing to VLC & MPV media players |
| 📱 **Responsive Design** | Works seamlessly on desktop, tablet, and mobile |
| 🔐 **Private & Secure** | 100% self-hosted, no data leaves your server |
| 🎨 **Modern UI** | Beautiful dark-themed interface with smooth animations |

</div>

---

## 🎯 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   STREAM VAULT SYSTEM                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Frontend                 Backend             External │
│   ┌──────────────┐    ┌────────────────┐   ┌──────────┐ │
│   │   React UI   │───▶│ Express Server │──▶│ Prowlarr ││
│   │  (Responsive)│    │   (Node.js)    │   │ Indexers │ │
│   └──────────────┘    └────────────────┘   └──────────┘ │
│         │                     │                    │    │
│         │                     ▼                    │    │
│         │              ┌──────────────┐           │     │
│         │              │ Metadata APIs│◀──────────┘    │
│         │              │ (AniList,    │                 │
│         │              │  TMDB)       │                 │
│         │              └──────────────┘                 │
│         │                     │                         │
│         └─────────────┬───────┘                         │
│                       ▼                                 │
│              ┌─────────────────┐                        │
│              │  Cache Layer    │                        │
│              │ (Session-Only)  │                        │
│              └─────────────────┘                        │
│                       │                                 │
│                       ▼                                 │
│              ┌─────────────────┐                        │
│              │  Media Player   │                        │
│              │ (HTML5/VLC/MPV) │                        │
│              └─────────────────┘                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 16.0 or higher
- **npm** or **yarn** package manager
- **Prowlarr** Server (Highly recommended for indexer management)
- **API Keys**:
  - TMDB API Key (for movies/TV metadata)

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/stream-vault.git
   cd stream-vault
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root with your configuration:
   ```env
   PORT=3000
   TORZNAB_API_KEY=your_prowlarr_key
   TORZNAB_BASE_URL=https://your-prowlarr-instance.com/api
   TMDB_API_KEY=your_tmdb_api_key
   ```

4. **Start the Application**
   ```bash
   npm start
   ```
   
   Visit `http://localhost:3000` in your browser

---

## 📋 Data Sources

### Supported Torrent Indexers

Stream Vault now perfectly maps to your Prowlarr instance. Just add these to Prowlarr and Stream Vault will automatically pick them up!

| Indexer | Content Type | Integration |
|---------|--------------|--------|
| 🐉 **The Pirate Bay** | Movies/Shows | ✅ Prowlarr Native |
| 🍿 **YTS** | HD Movies | ✅ Direct Web Scraper (`yts.gg`) |
| 🍚 **Nyaa.si** | Anime | ✅ Prowlarr Native / Direct |
| 📺 **EZTV** | TV Shows | ✅ Prowlarr Native |
| 🍋 **LimeTorrents** | All Content | ✅ Prowlarr Native |
| 🎬 **Torrentsome** | All Content | ✅ Prowlarr Native |
| ⚡ **SkTorrent** | All Content | ✅ Prowlarr Native |
| 🔥 **1337x / Ext.to** | Movies/Shows | ℹ️ Add to Prowlarr to use |

### Metadata APIs

- **AniList** - Comprehensive anime metadata and information
- **TMDB** - Movies and TV shows with ratings, posters, and details

---

## 🔧 Configuration

### Environment Variables

```env
# Server Configuration
PORT=3000                                    # Server port

# Prowlarr/Torznab Configuration
TORZNAB_API_KEY=your_api_key                 # Your Prowlarr API key
TORZNAB_BASE_URL=https://your-instance.com   # Your Prowlarr base URL

# API Keys
TMDB_API_KEY=your_tmdb_key                   # TMDB API key for metadata
```

---

## 💾 Project Structure

```text
stream-vault/
├── public/                 # Frontend files
│   ├── index.html         # Main HTML UI
│   ├── app.js             # Frontend Vanilla JS
│   ├── style.css          # Styling (CSS Variables, Dark Mode)
│   ├── manifest.json      # PWA manifest
│   └── favicon.svg        # Icon
├── server.js              # Express backend & SSE Engine
├── package.json           # Dependencies & scripts
├── .env                   # Environment variables (create locally)
├── .gitignore             # Git ignore rules
├── README.md              # This file
└── LICENSE                # MIT License
```

---

## 🔐 Security Features

✅ **Privacy First**
- No external logging of your searches
- No telemetry or tracking
- Self-hosted means complete data control

✅ **Local Processing**
- All metadata caching happens in-session
- Auto-cleanup on browser close
- No persistent user data storage

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

---

## 🐛 Troubleshooting

### API Connection Issues
- Verify Prowlarr is running and accessible
- Check API key in `.env`
- Ensure TORZNAB_BASE_URL is correct (e.g. `http://localhost:9696`)
- Check firewall rules

### Empty Search Results
- Verify at least one indexer is configured in Prowlarr
- Check internet connection
- Try searching with different keywords

---

## 📄 License

This project is licensed under the **MIT License**.

```text
MIT License

Copyright (c) 2026 DTEmpire (DargoTamber)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

## 🌟 Show Your Support

If you find Stream Vault helpful, please:

- ⭐ **Star** the repository
- 🐛 **Report** bugs or issues
- 💡 **Suggest** new features
- 📤 **Share** with others
- 🤝 **Contribute** code or documentation

---

<div align="center">

### Made with ❤️ for the Media Streaming Community

**© copyright by DTEmpire (DargoTamber) | version 1.0.2**

```text
█████████████████████████████████████████████
█                                           █
█   Happy Streaming! Enjoy Stream Vault ✨  █
█                                           █
█████████████████████████████████████████████
```

</div>
