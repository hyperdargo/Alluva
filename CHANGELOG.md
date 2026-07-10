# Changelog

## v1.1.0 (Latest)

### Rebrand: Stream Vault → Alluva
- Complete rebrand from "Stream Vault" to "Alluva" — "all of it" in one place.
- Updated all branding across HTML, CSS, JS, server, manifest, and README.
- New logo references (favicon, PWA icons, splash screen, header).
- Per-view accent colors: Home=amber, Movies=red, TV=teal, Anime=purple.

### iOS Tab Bar with Sliding Indicator
- Glassmorphism oval pill navigation tabs (Home, Movies, TV, Anime).
- Sliding indicator animates smoothly between tabs on click.
- Tab bar hidden on mobile (uses side drawer instead).

### Search Redesign
- Glassmorphism search container with focus ring.
- Cleaner input styling — transparent background, no redundant borders.
- Responsive sizing across all screen sizes.

### Hamburger Menu Fix
- Hamburger button now works on ALL views including detail pages.
- Fixed double-fire bug (direct + delegation handlers ran on one click).
- Proper z-index layering: detail view (90) < header (100) < overlay (400) < drawer (500).
- Drawer uses inline styles instead of CSS classes to avoid specificity issues.

### Hero Banner Animation
- Staggered fade-up animation for title, meta, synopsis, and action buttons.
- Ken Burns zoom effect on backdrop (1.08→1 over 8s).
- Each new slide reveals content with 0.1s delay cascade.

### 18+ Adult Content Filter Tightening
- Drama + Romance combo blocked (removed History requirement).
- Romance genre without rating → blocked.
- Drama genre with zero votes + zero rating → blocked.
- Same multi-signal filter on both server (`filterAdultTMDB`) and client (`filterAdult`).

### Responsive Grid Improvements
- All views (home, movies, TV, anime) now show 3 rows of content.
- Items per row adapts to screen: phone=3, tablet=5, desktop=7.
- Filter pills use same responsive grid count.
- Movies/TV/Anime views limited to 3 rows on first page; infinite scroll loads more.

### Footer & About Modal
- Three-column footer: left (copyright + version), center (About), right (logo + Discord).
- About modal with slide-up animation showing site history, name origin, and feature list.
- About link also available in side drawer.

### Theme Toggle
- Dark/Light theme toggle button in header.
- Light mode overrides all backgrounds, borders, text colors, shadows.
- Preference saved to localStorage (`alluva-theme`).

### Docker Support
- Added `Dockerfile` (node:22-alpine) and `docker-compose.yml`.
- Fixed ESM import for `http-proxy-middleware` using dynamic import.

### Other Fixes
- Fixed side drawer overlay click to close.
- Fixed duplicate overlay event handler.
- Fixed footer visible on detail view.
- Updated manifest.json and site.webmanifest with new branding.
- Removed startup log messages (1337x support, Ext.to, YTS, EZTV).
- Cache-busting bumped for CSS, JS, and icon references.
