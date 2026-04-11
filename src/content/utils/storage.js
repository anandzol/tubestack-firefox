/**
 * Storage utility — thin wrapper around chrome.runtime.sendMessage.
 * Handles extension runtime messaging with context invalidation protection.
 * Returns fallback values on lost connections.
 * All console calls are wrapped in try/catch because console itself fails
 * after context invalidation.
 */
import { log } from './logger.js';

const MOD = 'Storage';
const INVALIDATED = { error: 'context_invalidated' };

function isContextAlive() {
  try {
    return !!chrome?.runtime?.id;
  } catch (_) {
    return false;
  }
}

function send(type, payload = {}) {
  return new Promise((resolve) => {
    // Guard: if runtime is gone, return fallback — never reject
    if (!isContextAlive()) {
      resolve(INVALIDATED);
      return;
    }

    try {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        try {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            if (msg.includes('Extension context invalidated') || msg.includes('message port closed')) {
              resolve(INVALIDATED);
              return;
            }
            log.warn(MOD, `Runtime error on ${type}`, msg);
            resolve({ error: msg });
            return;
          }
          resolve(response || {});
        } catch (_) {
          resolve(INVALIDATED);
        }
      });
    } catch (_) {
      // Synchronous throw — runtime is truly dead
      resolve(INVALIDATED);
    }
  });
}

/** Direct chrome.storage.local access (works even when service worker is asleep) */
function localGet(keys) {
  return new Promise((resolve) => {
    if (!isContextAlive()) { resolve({}); return; }
    try {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) { resolve({}); return; }
        resolve(result || {});
      });
    } catch (_) { resolve({}); }
  });
}

function localSet(data) {
  return new Promise((resolve) => {
    if (!isContextAlive()) { resolve(false); return; }
    try {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(true);
      });
    } catch (_) { resolve(false); }
  });
}

export const StorageAPI = {
  getGroups: () => send('GET_GROUPS'),
  saveGroups: (groups) => send('SAVE_GROUPS', { groups }),
  getChannelMap: () => send('GET_CHANNEL_MAP'),
  saveChannelMap: (channelMap) => send('SAVE_CHANNEL_MAP', { channelMap }),
  getSettings: () => send('GET_SETTINGS'),
  saveSettings: (settings) => send('SAVE_SETTINGS', { settings }),
  getWatched: () => send('GET_WATCHED'),
  toggleWatched: (videoId) => send('TOGGLE_WATCHED', { videoId }),
  exportData: () => send('EXPORT_DATA'),
  importData: (data) => send('IMPORT_DATA', { data }),

  // Direct storage access (bypasses service worker)
  localGet,
  localSet,

  // Check if the extension context is still alive
  isAlive: isContextAlive,
};
