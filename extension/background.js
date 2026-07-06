// background.js

let activeStream = null;

// Initial settings values
const DEFAULT_SETTINGS = {
  saveOption: 'downloads', // 'downloads', 'native', 'filesystem'
  downloadFolder: 'C:\\StreamVault_Downloads',
  autoDownload: false,
  namingFormat: '{title}_{hash}.m3u8'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (items) => {
    if (Object.keys(items).length === 0) {
      chrome.storage.local.set(DEFAULT_SETTINGS);
    }
  });

  // Create context menu for video players
  chrome.contextMenus.create({
    id: 'download-stream-m3u8',
    title: 'Download Stream Playlists (.m3u8)',
    contexts: ['video', 'page']
  });
});

// Context Menu triggers
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'download-stream-m3u8') {
    if (activeStream) {
      triggerDownload(activeStream);
    } else {
      // Query content script for active video player
      chrome.tabs.sendMessage(tab.id, { action: 'query_stream' }, (response) => {
        if (response && response.active) {
          triggerDownload(response.stream);
        } else {
          console.log('[Background] No active stream found.');
        }
      });
    }
  }
});

// Message listener from content script or popup UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'stream_captured') {
    activeStream = request.stream;
    console.log('[Background] Captured active stream:', activeStream);

    // Update Extension icon status badge
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });

    // Handle auto-download preference
    chrome.storage.local.get(['autoDownload'], (settings) => {
      if (settings.autoDownload) {
        triggerDownload(activeStream);
      }
    });
  } else if (request.action === 'get_active_stream') {
    sendResponse({ stream: activeStream });
  } else if (request.action === 'clear_badge') {
    chrome.action.setBadgeText({ text: '' });
  }
  return true;
});

// Coordinates saving stream based on preferences
function triggerDownload(stream) {
  chrome.storage.local.get(null, (settings) => {
    const saveOption = settings.saveOption || 'downloads';
    const folder = settings.downloadFolder || 'C:\\StreamVault_Downloads';
    const format = settings.namingFormat || '{title}_{hash}.m3u8';

    // Format file name
    let filename = format
      .replace('{title}', stream.title.replace(/[^\w\s-]/g, '').trim())
      .replace('{hash}', stream.hash || 'stream')
      .replace('{id}', stream.fileId || '0');

    // Strip browser HLS transcode URL (video.m3u8) to give native players the raw HTTP stream
    let rawUrl = stream.url.includes('/stream/video.m3u8')
      ? stream.url.replace('/stream/video.m3u8', '/stream')
      : stream.url;

    // Wrap HTTPS links in the local HTTP relay to bypass VLC GnuTLS SSL blocks
    if (rawUrl.startsWith('https://')) {
      rawUrl = `https://moviewatch.ankitgupta.com.np/api/relay?url=${encodeURIComponent(rawUrl)}`;
    }

    // Create M3U playlist file content
    const m3uContent = `#EXTM3U\n#EXTINF:-1,${stream.title}\n${rawUrl}\n`;

    if (saveOption === 'native') {
      // Send to Native Messaging Host
      sendToNativeHost(m3uContent, folder, filename);
    } else {
      // Fallback to Downloads API (Option B)
      const blob = new Blob([m3uContent], { type: 'text/plain' });
      const reader = new FileReader();
      reader.onload = function() {
        chrome.downloads.download({
          url: reader.result,
          filename: filename,
          saveAs: true
        });
      };
      reader.readAsDataURL(blob);
    }
  });
}

// Option A: Communication with Native Messaging Host
function sendToNativeHost(m3uContent, folder, filename) {
  const hostName = 'com.streamvault.launcher';
  console.log(`[Background] Connecting to Native Messaging Host: ${hostName}`);

  try {
    const port = chrome.runtime.connectNative(hostName);

    port.postMessage({
      action: 'save_and_play',
      content: m3uContent,
      folder: folder,
      filename: filename
    });

    port.onMessage.addListener((response) => {
      console.log('[Background] Received from Native Host:', response);
    });

    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Native host disconnect error:', chrome.runtime.lastError.message);
      }
    });
  } catch (err) {
    console.error('[Background] Failed to connect to Native Host:', err.message);
  }
}
