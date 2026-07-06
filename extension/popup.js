// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const settingsBtn = document.getElementById('settingsBtn');
  const container = document.getElementById('activeStreamContent');

  // Open settings page
  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'settings.html' });
  });

  // Query background for captured stream
  chrome.runtime.sendMessage({ action: 'get_active_stream' }, (response) => {
    if (response && response.stream) {
      renderStream(response.stream);
      chrome.runtime.sendMessage({ action: 'clear_badge' });
    } else {
      // Fallback: Query active tab DOM directly
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'query_stream' }, (tabResponse) => {
            if (tabResponse && tabResponse.active) {
              renderStream(tabResponse.stream);
            } else {
              renderNoStream();
            }
          });
        } else {
          renderNoStream();
        }
      });
    }
  });

  function renderNoStream() {
    container.innerHTML = `
      <div class="no-stream">
        <p>No active media stream detected.</p>
        <p style="font-size: 11px; margin-top: 8px;">Play a video stream in Stream Vault to activate the companion.</p>
      </div>
    `;
  }

  function renderStream(stream) {
    container.innerHTML = `
      <div class="card">
        <div class="stream-status">
          <span class="status-dot active"></span>
          <span>Active stream detected</span>
        </div>
        <h4 class="stream-title">${stream.title}</h4>
        <div class="stream-url" title="${stream.url}">${stream.url}</div>
      </div>

      <button class="btn btn-primary" id="nativeSaveBtn">
        🚀 Save & Open in VLC (Host Option A)
      </button>

      <button class="btn btn-blue" id="downloadsSaveBtn">
        📥 Browser Download (Downloads API Option B)
      </button>

      <button class="btn btn-secondary" id="pickerSaveBtn">
        📂 Directory Picker (File Access Option C)
      </button>
    `;

    // Strip browser HLS transcode URL (video.m3u8) to give native players the raw HTTP stream
    let rawUrl = stream.url.includes('/stream/video.m3u8')
      ? stream.url.replace('/stream/video.m3u8', '/stream')
      : stream.url;

    // Wrap HTTPS links in the local HTTP relay to bypass VLC GnuTLS SSL blocks
    // Removed because VLC handles torrserver HTTPS links directly fine, and hardcoded moviewatch fails.

    const m3uContent = `#EXTM3U\n#EXTINF:-1,${stream.title}\n${rawUrl}\n`;
    
    // Format filename
    chrome.storage.local.get(['namingFormat', 'downloadFolder'], (settings) => {
      const format = settings.namingFormat || '{title}_{hash}.m3u8';
      const folder = settings.downloadFolder || 'C:\\StreamVault_Downloads';
      
      let filename = format
        .replace('{title}', stream.title.replace(/[^\w\s-]/g, '').trim())
        .replace('{hash}', stream.hash || 'stream')
        .replace('{id}', stream.fileId || '0');

      // 1. Option A (Native Messaging Host)
      document.getElementById('nativeSaveBtn').addEventListener('click', () => {
        sendToNativeHost(m3uContent, folder, filename);
      });

      // 2. Option B (Downloads API)
      document.getElementById('downloadsSaveBtn').addEventListener('click', () => {
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
      });

      // 3. Option C (File System Access API)
      document.getElementById('pickerSaveBtn').addEventListener('click', async () => {
        try {
          if ('showSaveFilePicker' in window) {
            const handle = await window.showSaveFilePicker({
              suggestedName: filename,
              types: [{
                description: 'M3U8 Playlist File',
                accept: { 'text/plain': ['.m3u8', '.m3u'] }
              }]
            });
            const writable = await handle.createWritable();
            await writable.write(m3uContent);
            await writable.close();
            showStatusMessage('File saved successfully!');
          } else {
            alert('File System Access API is not supported in your browser.');
          }
        } catch (err) {
          console.error(err);
        }
      });
    });
  }

  function sendToNativeHost(m3uContent, folder, filename) {
    const hostName = 'com.streamvault.launcher';
    showStatusMessage('Connecting to host...');
    try {
      const port = chrome.runtime.connectNative(hostName);
      port.postMessage({
        action: 'save_and_play',
        content: m3uContent,
        folder: folder,
        filename: filename
      });
      port.onMessage.addListener((res) => {
        if (res.success) {
          showStatusMessage('Host played successfully!');
        } else {
          showStatusMessage('Host error: ' + res.error);
        }
      });
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          showStatusMessage('Host not installed. Check settings.');
        }
      });
    } catch (err) {
      showStatusMessage('Host connect failed.');
    }
  }

  function showStatusMessage(msg) {
    const status = document.createElement('div');
    status.style.cssText = 'position: fixed; bottom: 8px; left: 8px; right: 8px; padding: 6px; border-radius: 4px; background: rgba(0,0,0,0.85); color: #10b981; font-size: 11px; text-align: center; z-index: 1000; border: 1px solid rgba(16,185,129,0.3);';
    status.textContent = msg;
    document.body.appendChild(status);
    setTimeout(() => status.remove(), 2500);
  }
});
