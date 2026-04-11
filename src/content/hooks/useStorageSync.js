/**
 * useStorageSync — Custom hook that syncs React state with chrome.storage.
 * Fetches all data once at startup, then listens to chrome.storage.onChanged.
 * 
 * Hooks into custom events to persist data across DOM contexts.
 * Data: groups (array), channelMap (object), settings (object), watchedVideos (Set).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { StorageAPI } from '../utils/storage.js';
import { fetchChannelDetailsBatch } from '../utils/youtube-api.js';
import { log } from '../utils/logger.js';

const MOD = 'useStorageSync';

export function useStorageSync() {
  const [groups, setGroups] = useState([]);
  const [channelMap, setChannelMap] = useState({});
  const [settings, setSettings] = useState({});
  const [watchedVideos, setWatchedVideos] = useState({});
  const [loading, setLoading] = useState(true);
  const [enrichmentStatus, setEnrichmentStatus] = useState(null); // null | 'running' | { done: N, total: N }
  
  // Keep a ref to the latest channelMap so we never use stale closures
  const channelMapRef = useRef({});
  const loadedRef = useRef(false);
  const enrichingRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    channelMapRef.current = channelMap;
  }, [channelMap]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    
    async function load() {
      log.info(MOD, 'Loading initial data from storage...');
      
      // Use direct storage access for reliability
      const data = await StorageAPI.localGet(['groups', 'channelMap', 'settings', 'watchedVideos']);
      
      if (cancelled) return;
      
      const loadedGroups = data.groups || [];
      const loadedChannelMap = data.channelMap || {};
      const loadedSettings = data.settings || {};
      const loadedWatched = data.watchedVideos || {};

      setGroups(loadedGroups);
      setChannelMap(loadedChannelMap);
      channelMapRef.current = loadedChannelMap;
      setSettings(loadedSettings);
      setWatchedVideos(loadedWatched);
      setLoading(false);
      loadedRef.current = true;
      
      log.info(MOD, 'Initial data loaded', {
        groups: loadedGroups.length,
        channels: Object.keys(loadedChannelMap).length,
      });
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Listen for storage changes
  useEffect(() => {
    if (!StorageAPI.isAlive()) return;

    function handleChanges(changes, area) {
      if (area !== 'local') return;
      
      if (changes.groups) {
        setGroups(changes.groups.newValue || []);
        log.debug(MOD, 'Groups updated from storage');
      }
      if (changes.channelMap) {
        const newMap = changes.channelMap.newValue || {};
        setChannelMap(newMap);
        channelMapRef.current = newMap;
        log.debug(MOD, `ChannelMap updated from storage (${Object.keys(newMap).length} channels)`);
      }
      if (changes.settings) {
        setSettings(changes.settings.newValue || {});
        log.debug(MOD, 'Settings updated from storage');
      }
      if (changes.watchedVideos) {
        setWatchedVideos(changes.watchedVideos.newValue || {});
      }
    }

    try {
      chrome.storage.onChanged.addListener(handleChanges);
      return () => {
        try { chrome.storage.onChanged.removeListener(handleChanges); } catch (_) {}
      };
    } catch (_) {
      log.warn(MOD, 'Cannot listen to storage changes — context may be invalidated');
    }
  }, []);

  // Update groups
  const updateGroups = useCallback(async (newGroups) => {
    setGroups(newGroups);
    await StorageAPI.localSet({ groups: newGroups });
  }, []);

  /**
   * ATOMIC updateChannelMap — merges changes into the CURRENT storage state.
   * Never uses stale React state. Does: read from storage → merge → write back.
   * 
   * @param {Object} changes - Object with channelId keys to add/update.
   *   Example: { 'UCxxx': { name: 'Foo', groups: ['g1'] } }
   * @param {string[]} [removeIds] - Optional array of channel IDs to remove.
   */
  const updateChannelMap = useCallback(async (changes, removeIds = []) => {
    if (!loadedRef.current) {
      log.warn(MOD, 'Refusing to update channelMap — data not loaded yet');
      return;
    }

    // Read FRESH data from storage to avoid any stale state issues
    const stored = await StorageAPI.localGet(['channelMap']);
    const current = stored.channelMap || {};
    
    // Merge changes
    const merged = { ...current };
    
    // If `changes` is a plain partial update object
    if (changes && typeof changes === 'object') {
      for (const [chId, entry] of Object.entries(changes)) {
        merged[chId] = { ...merged[chId], ...entry };
      }
    }
    
    // Remove any specified IDs
    for (const id of removeIds) {
      delete merged[id];
    }

    // Write back
    await StorageAPI.localSet({ channelMap: merged });
    
    // Update React state
    setChannelMap(merged);
    channelMapRef.current = merged;
    
    log.debug(MOD, `ChannelMap atomically updated (${Object.keys(merged).length} channels total)`);
  }, []);

  const updateSettings = useCallback(async (newSettings) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
    const stored = await StorageAPI.localGet(['settings']);
    const merged = { ...(stored.settings || {}), ...newSettings };
    await StorageAPI.localSet({ settings: merged });
  }, []);

  const toggleWatched = useCallback(async (videoId) => {
    setWatchedVideos(prev => {
      const next = { ...prev };
      if (next[videoId]) delete next[videoId];
      else next[videoId] = Date.now();
      return next;
    });
    // Atomic toggle in storage
    const stored = await StorageAPI.localGet(['watchedVideos']);
    const watched = stored.watchedVideos || {};
    if (watched[videoId]) delete watched[videoId];
    else watched[videoId] = Date.now();
    await StorageAPI.localSet({ watchedVideos: watched });
  }, []);

  /**
   * Enrich channels that are missing names or avatars.
   * Can be called manually from Dashboard or runs automatically after load.
   */
  const enrichChannels = useCallback(async (force = false) => {
    if (enrichingRef.current) return;
    enrichingRef.current = true;
    setEnrichmentStatus('running');

    try {
      const stored = await StorageAPI.localGet(['channelMap']);
      const current = stored.channelMap || {};
      
      // Find channels needing enrichment
      const needsEnrich = Object.entries(current).filter(([id, entry]) => {
        if (force) return !entry.avatar; // Force: re-fetch all missing avatars
        // Auto: only fetch if name equals ID or no avatar
        const nameIsId = !entry.name || entry.name === id || entry.name.startsWith('UC');
        return nameIsId || !entry.avatar;
      }).map(([id]) => id);

      if (needsEnrich.length === 0) {
        log.info(MOD, 'All channels already enriched');
        setEnrichmentStatus({ done: 0, total: 0 });
        enrichingRef.current = false;
        return;
      }

      log.info(MOD, `Enriching ${needsEnrich.length} channels...`);

      const results = await fetchChannelDetailsBatch(needsEnrich, (done, total) => {
        setEnrichmentStatus({ done, total });
      });

      // Merge results into storage atomically
      if (results.size > 0) {
        const freshStored = await StorageAPI.localGet(['channelMap']);
        const freshMap = freshStored.channelMap || {};
        for (const [chId, details] of results) {
          if (freshMap[chId]) {
            if (details.name && (!freshMap[chId].name || freshMap[chId].name === chId || freshMap[chId].name.startsWith('UC'))) {
              freshMap[chId].name = details.name;
            }
            if (details.avatar) {
              freshMap[chId].avatar = details.avatar;
            }
          }
        }
        await StorageAPI.localSet({ channelMap: freshMap });
        setChannelMap(freshMap);
        channelMapRef.current = freshMap;
        log.info(MOD, `Enriched ${results.size} channels with details`);
      }

      setEnrichmentStatus({ done: needsEnrich.length, total: needsEnrich.length });
    } catch (err) {
      log.error(MOD, 'Enrichment failed', err.message);
      setEnrichmentStatus(null);
    } finally {
      enrichingRef.current = false;
    }
  }, []);

  // Auto-enrich after initial load (3s delay to not block UI)
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      enrichChannels(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [loading, enrichChannels]);

  return {
    groups, channelMap, settings, watchedVideos, loading,
    enrichmentStatus, enrichChannels,
    updateGroups, updateChannelMap, updateSettings, toggleWatched,
  };
}
