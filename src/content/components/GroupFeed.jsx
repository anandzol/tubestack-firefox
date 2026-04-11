/**
 * GroupFeed — Full-page overlay showing videos from a subscription group.
 * 
 * Features:
 *  - Close button (top-left ×) + ESC key
 *  - Group name as clickable dropdown switcher with arrow
 *  - Horizontal group chips for quick switching
 *  - Video grid with skeleton loading
 *  - React state drives rendering — no DOM hacks
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGroups } from '../context/GroupsContext.jsx';
import VideoCard, { VideoCardSkeleton } from './VideoCard.jsx';
import { getGroupVideos } from '../utils/youtube-api.js';
import { log } from '../utils/logger.js';

const MOD = 'GroupFeed';

export default function GroupFeed({ group, onClose, onSwitchGroup }) {
  const { groups, channelMap, watchedVideos, toggleWatched, settings } = useGroups();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [gridCols, setGridCols] = useState(settings.defaultGridColumns || 4);
  const dropdownRef = useRef(null);

  // Get channel IDs for this group
  const getGroupChannelIds = useCallback((g) => {
    const ids = [];
    for (const [chId, entry] of Object.entries(channelMap)) {
      if (entry.groups?.includes(g.id)) {
        ids.push(chId);
      }
    }
    return ids;
  }, [channelMap]);

  // Fetch videos when group changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVideos([]);

    async function fetchVideos() {
      const channelIds = getGroupChannelIds(group);
      log.info(MOD, `Fetching videos for "${group.name}" (${channelIds.length} channels)`);

      if (channelIds.length === 0) {
        setLoading(false);
        setError('No channels in this group. Add channels from channel pages or the Dashboard.');
        return;
      }

      try {
        const maxPerCh = Math.max(5, Math.ceil((settings.defaultFetchVolume || 100) / channelIds.length));
        const result = await getGroupVideos(channelIds, channelMap, maxPerCh);
        if (!cancelled) {
          setVideos(result);
          setLoading(false);
          log.info(MOD, `Loaded ${result.length} videos for "${group.name}"`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Failed to load videos: ${err.message}`);
          setLoading(false);
          log.error(MOD, `Feed fetch failed for "${group.name}"`, err);
        }
      }
    }

    fetchVideos();
    return () => { cancelled = true; };
  }, [group, channelMap, getGroupChannelIds, settings.defaultFetchVolume]);

  // ESC key to close
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (showDropdown) setShowDropdown(false);
        else onClose?.();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, showDropdown]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  // Flatten groups for switcher
  const allGroups = flattenGroupsForSwitcher(groups);

  const colsClass = `cols-${gridCols}`;

  return (
    <div className="ytsm-reset ytsm-overlay open" onClick={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      <div className="ytsm-feed-container" style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'var(--ytsm-bg-primary)', zIndex: 10000,
        overflow: 'auto',
      }}>
        {/* Topbar */}
        <div className="ytsm-feed-topbar">
          <button className="ytsm-feed-close-btn" onClick={onClose} title="Close (ESC)">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
          </button>

          {/* Group Switcher */}
          <div className="ytsm-feed-group-switcher" ref={dropdownRef}>
            <button
              className="ytsm-feed-group-name-btn"
              onClick={() => setShowDropdown(!showDropdown)}
            >
              <span className="ytsm-feed-group-name-text" style={{ minWidth: 'max-content' }}>
                {group.name}
              </span>
              <svg className="ytsm-feed-group-chevron" width="20" height="20" viewBox="0 0 24 24"
                style={{ transform: showDropdown ? 'rotate(180deg)' : 'none' }}>
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>

            {showDropdown && (
              <div className="ytsm-feed-group-dropdown visible">
                {allGroups.map((g) => (
                  <div
                    key={g.id}
                    className={`ytsm-feed-group-dropdown-item ${g.id === group.id ? 'active' : ''}`}
                    onClick={() => {
                      setShowDropdown(false);
                      if (g.id !== group.id) onSwitchGroup?.(g);
                    }}
                  >
                    <span>{g.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--ytsm-text-disabled)' }}>
                      {getGroupChannelIds(g).length} ch
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {/* Grid columns toggle */}
            {[4, 6].map(n => (
              <button
                key={n}
                className={`ytsm-btn ytsm-btn-sm ${gridCols === n ? 'ytsm-btn-primary' : 'ytsm-btn-secondary'}`}
                onClick={() => setGridCols(n)}
              >
                {n} cols
              </button>
            ))}
          </div>
        </div>

        {/* Video count badge */}
        {!loading && !error && (
          <div style={{ padding: '0 24px 16px', fontSize: 14, color: 'var(--ytsm-text-secondary)' }}>
            {videos.length} videos from {getGroupChannelIds(group).length} channels
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--ytsm-text-secondary)' }}>
            <p style={{ fontSize: 16 }}>{error}</p>
          </div>
        )}

        {/* Video Grid */}
        <div style={{ padding: '0 24px 24px' }}>
          <div className={`ytsm-video-grid ${colsClass}`}>
            {loading && Array.from({ length: 12 }).map((_, i) => (
              <VideoCardSkeleton key={i} />
            ))}
            {!loading && videos.map((video) => (
              <VideoCard
                key={video.videoId}
                video={video}
                watched={!!watchedVideos[video.videoId]}
                onToggleWatched={toggleWatched}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function flattenGroupsForSwitcher(groups, depth = 0) {
  const result = [];
  for (const g of groups) {
    result.push({ ...g, depth });
    if (g.children?.length > 0) {
      result.push(...flattenGroupsForSwitcher(g.children, depth + 1));
    }
  }
  return result;
}
