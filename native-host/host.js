#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const logFile = path.join(__dirname, 'host.log');
function log(msg) {
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
}

log('Stream Vault Native Messaging Host started');

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  parseMessages();
});

function parseMessages() {
  while (inputBuffer.length >= 4) {
    const msgLength = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length >= 4 + msgLength) {
      const msgBody = inputBuffer.slice(4, 4 + msgLength).toString('utf-8');
      inputBuffer = inputBuffer.slice(4 + msgLength);
      
      try {
        const msgJson = JSON.parse(msgBody);
        handleMessage(msgJson);
      } catch (err) {
        log('Error parsing JSON message: ' + err.message);
      }
    } else {
      break;
    }
  }
}

function sendResponse(msgObj) {
  const msgStr = JSON.stringify(msgObj);
  const msgBuffer = Buffer.from(msgStr, 'utf-8');
  
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(msgBuffer.length, 0);
  
  process.stdout.write(lengthBuffer);
  process.stdout.write(msgBuffer);
}

function handleMessage(msg) {
  log('Received message: ' + JSON.stringify(msg));

  if (msg.action === 'ping') {
    sendResponse({ status: 'pong' });
    return;
  }

  if (msg.action === 'save_and_play') {
    const { content, folder, filename } = msg;

    try {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }

      const filePath = path.join(folder, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      log(`Successfully saved playlist file to: ${filePath}`);

      const path64 = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';
      const path32 = 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe';
      let vlcPath = 'vlc';

      if (fs.existsSync(path64)) {
        vlcPath = path64;
      } else if (fs.existsSync(path32)) {
        vlcPath = path32;
      }

      log(`Spawning VLC path: "${vlcPath}" with file: "${filePath}"`);

      const vlcProcess = spawn(vlcPath, [filePath], {
        detached: true,
        stdio: 'ignore'
      });
      vlcProcess.unref();

      sendResponse({ success: true, path: filePath });
    } catch (err) {
      log('Error during save_and_play: ' + err.message);
      sendResponse({ success: false, error: err.message });
    }
  }
}

process.stdin.on('end', () => {
  log('Stream Vault Native Messaging Host stream ended');
  process.exit(0);
});
