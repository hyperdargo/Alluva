# Stream Vault v1.0.3 - Bug Fixes & Improvements

## 🐛 Bug Fixes
- **VLC Playback Failure**: Fixed a critical issue where VLC media player failed to open streams (Input can't be opened). The legacy, hardcoded `moviewatch` API relay was stripped from the companion browser extension, enabling direct and clean HTTPS handoffs to TorrServer.
- **Infinite Search Loading Spinner**: Fixed a bug where the search UI would hang indefinitely (up to 45 seconds) if a background indexer like EZTV hit a Cloudflare block and FlareSolverr timed out. 
- **Prowlarr Bottlenecks**: Fixed an issue where the site felt slow due to waiting on Prowlarr indexers for every search. Direct scrapers are now queried independently and asynchronously.

## 🚀 Improvements & Features
- **Strict 5-Second Search Timeout**: Implemented a hard 5-second maximum timeout for the Server-Sent Events (SSE) search route. If an indexer is unresponsive, it is seamlessly dropped, ensuring instant results.
- **Direct Scraper Defaulting**: By default, the search engine now exclusively checks lightning-fast direct indexers (The Pirate Bay, Nyaa, YTS, EZTV) to guarantee instant results. Prowlarr indexers are now unchecked by default, acting as secondary fallbacks.
- **Redesigned Home Banner**: The "Install Extension" notice was completely redesigned into a sleek, dismissible, dark-themed card with better typography and clearly defined ID/Password fields.
- **Multi-Language Support**: Added a dropdown to the home banner allowing instant text translation into English, Nepali, Hindi, Italian, Japanese, Chinese, and Russian.
