// content.js
console.log('[Stream Vault Companion] Content script injected');

// Listen for play event from the main app
document.addEventListener('stream-vault-play', (event) => {
  console.log('[Stream Vault Companion] Captured stream play event:', event.detail);
  chrome.runtime.sendMessage({
    action: 'stream_captured',
    stream: event.detail
  });
});

// Notify background that the tab is active
chrome.runtime.sendMessage({ action: 'page_active' });

// Listen for queries from the extension popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'query_stream') {
    const video = document.getElementById('videoPlayer');
    if (video && video.src) {
      const titleEl = document.getElementById('playerTitle');
      sendResponse({
        active: true,
        stream: {
          title: titleEl ? titleEl.textContent : 'Unknown Stream',
          url: video.src,
          magnet: video.getAttribute('data-magnet') || '',
          hash: video.getAttribute('data-hash') || '',
          fileId: video.getAttribute('data-file-id') || '0'
        }
      });
    } else {
      sendResponse({ active: false });
    }
  }
  return true;
});
