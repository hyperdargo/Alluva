// settings.js

document.addEventListener('DOMContentLoaded', () => {
  const saveOptionSelect = document.getElementById('saveOption');
  const downloadFolderInput = document.getElementById('downloadFolder');
  const namingFormatInput = document.getElementById('namingFormat');
  const autoDownloadCheckbox = document.getElementById('autoDownload');
  const hostStatusBadge = document.getElementById('hostStatus');
  const saveBtn = document.getElementById('saveBtn');

  // Load saved preferences
  chrome.storage.local.get(null, (settings) => {
    saveOptionSelect.value = settings.saveOption || 'downloads';
    downloadFolderInput.value = settings.downloadFolder || 'C:\\StreamVault_Downloads';
    namingFormatInput.value = settings.namingFormat || '{title}_{hash}.m3u8';
    autoDownloadCheckbox.checked = !!settings.autoDownload;

    toggleFolderInput(saveOptionSelect.value);
  });

  // Toggle folder input based on selected strategy
  saveOptionSelect.addEventListener('change', (e) => {
    toggleFolderInput(e.target.value);
  });

  function toggleFolderInput(value) {
    if (value === 'native') {
      downloadFolderInput.disabled = false;
      downloadFolderInput.style.opacity = '1';
    } else {
      downloadFolderInput.disabled = true;
      downloadFolderInput.style.opacity = '0.5';
    }
  }

  // Check if Native Host is installed and responsive
  checkNativeHostStatus();

  function checkNativeHostStatus() {
    const hostName = 'com.streamvault.launcher';
    try {
      const port = chrome.runtime.connectNative(hostName);
      port.postMessage({ action: 'ping' });
      
      port.onMessage.addListener((response) => {
        if (response && response.status === 'pong') {
          hostStatusBadge.textContent = 'Connected / Installed';
          hostStatusBadge.className = 'status-badge connected';
        }
      });

      port.onDisconnect.addListener(() => {
        // Suppress console errors if lastError matches not found
        const err = chrome.runtime.lastError;
        hostStatusBadge.textContent = 'Disconnected / Not Installed';
        hostStatusBadge.className = 'status-badge';
      });
    } catch (e) {
      hostStatusBadge.textContent = 'Disconnected / Not Installed';
      hostStatusBadge.className = 'status-badge';
    }
  }

  // Save settings
  saveBtn.addEventListener('click', () => {
    const preferences = {
      saveOption: saveOptionSelect.value,
      downloadFolder: downloadFolderInput.value.trim(),
      namingFormat: namingFormatInput.value.trim(),
      autoDownload: autoDownloadCheckbox.checked
    };

    chrome.storage.local.set(preferences, () => {
      showStatusMessage('Preferences saved successfully!');
      checkNativeHostStatus();
    });
  });

  function showStatusMessage(msg) {
    const status = document.createElement('div');
    status.style.cssText = 'position: fixed; bottom: 24px; right: 24px; padding: 12px 24px; border-radius: 6px; background: #10b981; color: #fff; font-size: 14px; font-weight: 600; text-align: center; z-index: 1000; box-shadow: 0 4px 12px rgba(16,185,129,0.3);';
    status.textContent = msg;
    document.body.appendChild(status);
    setTimeout(() => status.remove(), 2500);
  }
});
