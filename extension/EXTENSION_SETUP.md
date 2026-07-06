# Stream Vault Companion Extension Setup Guide

The Stream Vault Companion extension helps seamlessly pass video streams from the web app to native media players like VLC or MPV, bypassing browser restrictions and providing a better viewing experience.

Follow these steps to install and set up the extension on your browser.

## Step 1: Load the Unpacked Extension

Since this is a custom extension, it is not available on the Chrome Web Store. You will need to load it in "Developer mode."

**For Google Chrome / Microsoft Edge / Brave:**
1. Open your browser and navigate to the extensions page:
   - Chrome/Brave: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. Enable **Developer mode** (usually a toggle switch in the top right corner).
3. Click on the **Load unpacked** button.
4. Browse to your project folder and select the `extension` folder (`o:\website\extension`).
5. The **Stream Vault Companion** extension should now appear in your list of installed extensions.

## Step 2: Get Your Extension ID

Once the extension is installed, the browser assigns it a unique ID.
1. Look for the **Stream Vault Companion** card on your extensions page.
2. You will see an **ID** string (e.g., `ihpiinojhnfhpdmmacgmpoonphhimkaj`).
3. **Copy this ID**. You will need it for the next step.

## Step 3: Install the Native Messaging Host

To allow the extension to launch native video players (like VLC) directly from your system, you must register a Native Messaging Host in your Windows Registry.

1. Open your File Explorer and navigate to the `native-host` folder inside your project (`o:\website\native-host`).
2. Open a Command Prompt (cmd) or PowerShell in this folder.
3. Run the installation script, passing your copied Extension ID as the argument:
   ```cmd
   install_host.bat YOUR_EXTENSION_ID_HERE
   ```
   *Example:*
   ```cmd
   install_host.bat ihpiinojhnfhpdmmacgmpoonphhimkaj
   ```
4. You should see a success message indicating that the host manifest was registered with Google Chrome and Microsoft Edge.

## Step 4: Configure Stream Vault Settings

1. Open the Stream Vault web app (e.g., `http://localhost:3000` or your custom domain).
2. Go to the **Settings** view from the sidebar.
3. Under the **Playback** section, ensure your **Default Player** is set to use VLC or MPV via Local WebTorrent.
4. Under **External Players**, specify the custom path to your VLC or MPV executable if it is not in your system's default PATH (e.g., `C:\Program Files\VideoLAN\VLC\vlc.exe`).

## Troubleshooting

- **Extension Not Connecting to Site:** If you recently updated the extension's code (e.g., changing the allowed domains in `manifest.json`), ensure you click the **Reload** button (circular arrow icon) on the extension card in `chrome://extensions/`.
- **Player Not Launching:** Ensure the Native Messaging Host was installed correctly with the correct Extension ID. If the ID changes (which can happen if you move the extension folder), you must rerun `install_host.bat` with the new ID.
