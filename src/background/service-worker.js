/**
 * TubeStack — Background Service Worker
 * Handles storage, message routing, PocketTube import detection.
 * 
 * Storage strategy:
 *  - chrome.storage.local for everything (no sync quota limits)
 *  - Auto-migrates from sync to local on first run
 */

// ─── Default Data ─────────────────────────────────────────────────────────────

const DEFAULT_STORAGE = {
  groups: [],
  channelMap: {},
  watchedVideos: {},
  settings: {
    hideWatchedDefault: false,
    defaultFetchVolume: 100,
    defaultLayout: 'grid',
    defaultGridColumns: 4,
  },
  exportVersion: 3,
};

// ─── Install & Migration ──────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const existing = await chrome.storage.local.get(null);
    if (!existing.groups) {
      await chrome.storage.local.set({
        groups: DEFAULT_STORAGE.groups,
        channelMap: DEFAULT_STORAGE.channelMap,
        watchedVideos: DEFAULT_STORAGE.watchedVideos,
        settings: DEFAULT_STORAGE.settings,
        exportVersion: DEFAULT_STORAGE.exportVersion,
      });
    }
    console.log('[YTSM:SW] Extension installed, storage initialized.');
  }

  if (details.reason === 'update') {
    // Migrate from sync to local if needed
    try {
      const syncData = await chrome.storage.sync.get(['groups', 'settings']);
      if (syncData.groups && syncData.groups.length > 0) {
        const localData = await chrome.storage.local.get('groups');
        if (!localData.groups || localData.groups.length === 0) {
          await chrome.storage.local.set({
            groups: syncData.groups,
            settings: { ...DEFAULT_STORAGE.settings, ...syncData.settings },
          });
          console.log('[YTSM:SW] Migrated groups from sync to local storage.');
        }
      }
    } catch (e) {
      console.warn('[YTSM:SW] Migration check failed:', e);
    }
  }
});

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message.type];
  if (handler) {
    handler(message.payload, sender)
      .then(sendResponse)
      .catch((err) => {
        console.error(`[YTSM:SW] Handler error for ${message.type}:`, err);
        sendResponse({ error: err.message });
      });
    return true;
  }
  return false;
});

const messageHandlers = {
  GET_GROUPS: async () => {
    const data = await chrome.storage.local.get('groups');
    return { groups: data.groups || [] };
  },

  SAVE_GROUPS: async (payload) => {
    await chrome.storage.local.set({ groups: payload.groups });
    return { success: true };
  },

  GET_CHANNEL_MAP: async () => {
    const data = await chrome.storage.local.get('channelMap');
    return { channelMap: data.channelMap || {} };
  },

  SAVE_CHANNEL_MAP: async (payload) => {
    await chrome.storage.local.set({ channelMap: payload.channelMap });
    return { success: true };
  },

  GET_SETTINGS: async () => {
    const data = await chrome.storage.local.get('settings');
    return { settings: { ...DEFAULT_STORAGE.settings, ...data.settings } };
  },

  SAVE_SETTINGS: async (payload) => {
    const existing = await chrome.storage.local.get('settings');
    const merged = { ...DEFAULT_STORAGE.settings, ...existing.settings, ...payload.settings };
    await chrome.storage.local.set({ settings: merged });
    return { success: true };
  },

  GET_WATCHED: async () => {
    const data = await chrome.storage.local.get('watchedVideos');
    return { watchedVideos: data.watchedVideos || {} };
  },

  TOGGLE_WATCHED: async (payload) => {
    const data = await chrome.storage.local.get('watchedVideos');
    const watched = data.watchedVideos || {};
    if (watched[payload.videoId]) {
      delete watched[payload.videoId];
    } else {
      watched[payload.videoId] = Date.now();
    }
    await chrome.storage.local.set({ watchedVideos: watched });
    return { watchedVideos: watched };
  },

  EXPORT_DATA: async () => {
    const data = await chrome.storage.local.get(null);
    return {
      exportData: {
        ...data,
        exportTimestamp: new Date().toISOString(),
      },
    };
  },

  IMPORT_DATA: async (payload) => {
    const data = payload.data;
    
    // Detect format: our native format vs PocketTube/third-party
    if (data.groups && Array.isArray(data.groups)) {
      // Native format — direct import
      return await importNativeFormat(data);
    }
    
    if (data.ysc_collection || isPocketTubeFormat(data)) {
      // PocketTube format detected
      return await importPocketTubeFormat(data);
    }

    // Unknown format — try native as fallback
    return await importNativeFormat(data);
  },
};

// ─── Import Handlers ──────────────────────────────────────────────────────────

async function importNativeFormat(data) {
  const existing = await chrome.storage.local.get(['groups', 'channelMap', 'watchedVideos', 'settings']);
  
  if (data.groups) {
    // Merge: add new groups, skip duplicates by name
    const existingNames = new Set((existing.groups || []).map(g => g.name));
    const newGroups = data.groups.filter(g => !existingNames.has(g.name));
    const mergedGroups = [...(existing.groups || []), ...newGroups];
    await chrome.storage.local.set({ groups: mergedGroups });
  }
  if (data.channelMap) {
    const merged = { ...(existing.channelMap || {}), ...data.channelMap };
    await chrome.storage.local.set({ channelMap: merged });
  }
  if (data.settings) {
    await chrome.storage.local.set({ settings: { ...DEFAULT_STORAGE.settings, ...data.settings } });
  }
  if (data.watchedVideos) {
    const merged = { ...(existing.watchedVideos || {}), ...data.watchedVideos };
    await chrome.storage.local.set({ watchedVideos: merged });
  }
  
  console.log('[YTSM:SW] Native import complete.');
  return { success: true, format: 'native' };
}

function isPocketTubeFormat(data) {
  // Check if the data has group-name keys whose values are arrays of UC IDs
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('ysc_')) continue;
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string' && value[0].startsWith('UC')) {
      return true;
    }
  }
  return false;
}

async function importPocketTubeFormat(data) {
  const existing = await chrome.storage.local.get(['groups', 'channelMap']);
  const existingGroups = existing.groups || [];
  const existingChannelMap = existing.channelMap || {};
  const existingNames = new Set(existingGroups.map(g => g.name));
  
  const newGroups = [];
  const newChannelMap = { ...existingChannelMap };

  // Extract group names from ysc_collection or from top-level keys
  const groupEntries = {};
  
  for (const [key, value] of Object.entries(data)) {
    // Skip PocketTube metadata keys
    if (key.startsWith('ysc_') || key === 'exportTimestamp' || key === 'exportVersion') continue;
    
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      groupEntries[key] = value;
    }
  }

  for (const [groupName, channelIds] of Object.entries(groupEntries)) {
    // Skip if group already exists
    if (existingNames.has(groupName)) {
      // But still add channels to the existing group's channel map
      const existingGroup = existingGroups.find(g => g.name === groupName);
      if (existingGroup) {
        for (const chId of channelIds) {
          if (!newChannelMap[chId]) {
            newChannelMap[chId] = { name: chId, groups: [existingGroup.id] };
          } else if (!newChannelMap[chId].groups?.includes(existingGroup.id)) {
            newChannelMap[chId].groups = [...(newChannelMap[chId].groups || []), existingGroup.id];
          }
        }
      }
      continue;
    }

    // Create new group
    const groupId = generateId();
    const group = {
      id: groupId,
      name: groupName,
      children: [],
    };
    newGroups.push(group);
    existingNames.add(groupName);

    // Map channels to this group
    for (const chId of channelIds) {
      if (!newChannelMap[chId]) {
        newChannelMap[chId] = { name: chId, groups: [groupId] };
      } else {
        newChannelMap[chId].groups = [...(newChannelMap[chId].groups || []), groupId];
      }
    }
  }

  const mergedGroups = [...existingGroups, ...newGroups];
  await chrome.storage.local.set({ groups: mergedGroups, channelMap: newChannelMap });
  
  console.log(`[YTSM:SW] PocketTube import complete: ${newGroups.length} new groups, ${Object.keys(groupEntries).length} total groups processed.`);
  return { success: true, format: 'pockettube', newGroups: newGroups.length };
}

function generateId() {
  // crypto.randomUUID not available in service workers on all browsers
  return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}
