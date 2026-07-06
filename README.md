# 🎬 Stream Vault v1.0.0

> Your Personal Media Hub for Anime, Movies & TV Shows

<div align="center">

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.0-success.svg)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-14%2B-green.svg)](https://nodejs.org)
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

## ✨ Features

<div align="center">

| Feature | Description |
|---------|-------------|
| 🔍 **Torrent Search** | Discover content from 8+ torrent indexers (Nyaa, 1337x, YTS, EZTV, and more) |
| 📺 **Metadata Hub** | Enriched information from AniList (anime) and TMDB (movies/shows) |
| 🎥 **In-Browser Playback** | Stream directly in your browser without downloads |
| 📱 **Responsive Design** | Works seamlessly on desktop, tablet, and mobile |
| 🔐 **Private & Secure** | 100% self-hosted, no data leaves your server |
| ⚡ **Session Cache** | Ephemeral caching that auto-cleans on session close |
| 🎨 **Modern UI** | Beautiful dark-themed interface with smooth animations |

</div>

---

## 🎯 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   STREAM VAULT SYSTEM                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Frontend                 Backend                API       │
│   ┌──────────────┐    ┌────────────────┐   ┌───────────┐  │
│   │   React UI   │───▶│ Express Server │──▶│ Prowlarr  │  │
│   │  (Responsive)│    │   (Node.js)    │   │  Indexers │  │
│   └──────────────┘    └────────────────┘   └───────────┘  │
│         │                     │                    │       │
│         │                     ▼                    │       │
│         │              ┌──────────────┐           │       │
│         │              │ Metadata API │◀──────────┘       │
│         │              │ (AniList,    │                   │
│         │              │  TMDB)       │                   │
│         │              └──────────────┘                   │
│         │                     │                           │
│         └─────────────┬───────┘                           │
│                       ▼                                   │
│              ┌─────────────────┐                         │
│              │  Cache Layer    │                         │
│              │ (Session-Only)  │                         │
│              └─────────────────┘                         │
│                       │                                   │
│                       ▼                                   │
│              ┌─────────────────┐                         │
│              │  Media Player   │                         │
│              │  (HTML5 Video)  │                         │
│              └─────────────────┘                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 14.0 or higher
- **npm** or **yarn** package manager
- **API Keys** (optional for enhanced features):
  - TMDB API Key (for movies/TV metadata)
  - Prowlarr setup with torrent indexers

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/stream-vault.git
   cd stream-vault
   ```

2. **Install Dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
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

5. **Development Mode** (with auto-reload)
   ```bash
   npm run dev
   ```

---

## 📋 Data Sources

### Supported Torrent Indexers

| Indexer | Content Type | Status |
|---------|--------------|--------|
| 🍚 **Nyaa.si** | Anime | ✅ Integrated |
| 🔥 **1337x** | Movies/Shows | ✅ Integrated |
| 🐉 **The Pirate Bay** | Movies/Shows | ✅ Integrated |
| 🍿 **YTS** | HD Movies | ✅ Integrated |
| 📺 **EZTV** | TV Shows | ✅ Integrated |
| 🍋 **LimeTorrents** | All Content | ⏳ Planned |
| 🎬 **Torrentsome** | All Content | ⏳ Planned |
| ⚡ **SkTorrent** | All Content | ⏳ Planned |

### Metadata APIs

- **AniList** - Comprehensive anime metadata and information
- **TMDB** - Movies and TV shows with ratings, posters, and details

---

## 🔧 Configuration

### Environment Variables

```env
# Server Configuration
PORT=3000                                    # Server port
NODE_ENV=development                        # Environment: development|production

# Prowlarr/Torznab Configuration
TORZNAB_API_KEY=your_api_key                # Your Prowlarr API key
TORZNAB_BASE_URL=https://your-instance.com  # Your Prowlarr base URL

# API Keys
TMDB_API_KEY=your_tmdb_key                  # TMDB API key for metadata
ANILIST_API_URL=https://graphql.anilist.co  # AniList GraphQL endpoint
```

---

## 💾 Project Structure

```
stream-vault/
├── public/                 # Frontend files
│   ├── index.html         # Main HTML
│   ├── app.js             # Frontend JavaScript
│   ├── style.css          # Styling
│   ├── manifest.json      # PWA manifest
│   └── favicon.svg        # Icon
├── server.js              # Express backend
├── package.json           # Dependencies & scripts
├── .env                   # Environment variables (create locally)
├── .gitignore             # Git ignore rules
├── README.md              # This file
└── LICENSE                # MIT License
```

---

## 🎬 Usage Examples

### Search for Content
```javascript
// Example API call
fetch('/api/search?query=Demon Slayer&type=anime')
  .then(res => res.json())
  .then(data => console.log(data))
```

### Stream Torrent
```javascript
// Stream a torrent directly
const magnet = 'magnet:?xt=urn:btih:...'
fetch(`/api/stream?magnet=${encodeURIComponent(magnet)}`)
  .then(res => res.blob())
  .then(blob => playInBrowser(blob))
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

✅ **API Protection**
- CORS enabled for same-origin requests
- Request logging for monitoring
- Rate limiting ready (implement as needed)

---

## 📦 Dependencies

```json
{
  "express": "^4.18.2",     // Web framework
  "cors": "^2.8.5",         // Cross-origin support
  "node-fetch": "^2.7.0",   // HTTP requests
  "dotenv": "^16.3.1"       // Environment management
}
```

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Workflow

```bash
# 1. Clone and install
git clone <your-fork-url>
cd stream-vault
npm install

# 2. Create feature branch
git checkout -b feature/my-feature

# 3. Make changes and test
npm run dev

# 4. Commit and push
git add .
git commit -m "Add my feature"
git push origin feature/my-feature

# 5. Create Pull Request on GitHub
```

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Change port in .env
PORT=3001

# Or kill the process using port 3000
# On Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# On macOS/Linux
lsof -i :3000
kill -9 <PID>
```

### API Connection Issues
- Verify Prowlarr is running and accessible
- Check API key in `.env`
- Ensure TORZNAB_BASE_URL is correct
- Check firewall rules

### Empty Search Results
- Verify at least one indexer is configured in Prowlarr
- Check internet connection
- Try searching with different keywords

---

## 📚 Resources

- [Express.js Documentation](https://expressjs.com/)
- [Node.js Guide](https://nodejs.org/docs/)
- [TMDB API Docs](https://developers.themoviedb.org/)
- [AniList API](https://anilist.gitbook.io/anilist-apiv2-docs/)
- [Prowlarr Setup](https://wiki.servarr.com/prowlarr)

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2026 Stream Vault Contributors

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

## 📞 Support & Contact

- 📧 **Issues**: Open an issue on GitHub for bugs or features
- 💬 **Discussions**: Use GitHub Discussions for questions
- 🔔 **Updates**: Watch the repository for latest releases

---

<div align="center">

### Made with ❤️ for the Media Streaming Community

**Stream Vault v1.0.0** • [GitHub](https://github.com) • [License](LICENSE)

```
█████████████████████████████████████████████
█                                           █
█   Happy Streaming! Enjoy Stream Vault ✨  █
█                                           █
█████████████████████████████████████████████
```

</div>
