/**
 * VideoPageButton — Group dropdown on video watch pages.
 * Shows which groups the video's channel belongs to.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGroups } from '../context/GroupsContext.jsx';
import { parseCurrentVideoChannelId } from '../utils/youtube-api.js';
import { log } from '../utils/logger.js';

const MOD = 'VideoPageBtn';

export default function VideoPageButton() {
  const { groups, channelMap, updateChannelMap } = useGroups();
  const [channelId, setChannelId] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // Get channel of current video
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      // Try to get UC ID directly
      let id = parseCurrentVideoChannelId();
      if (id) { if (!cancelled) setChannelId(id); return; }

      // If not found, try to extract handle from owner link and resolve it
      const ownerLink = document.querySelector(
        '#owner a[href*="/@"], ytd-video-owner-renderer a[href*="/@"]'
      );
      if (ownerLink) {
        const href = ownerLink.getAttribute('href') || '';
        const handleMatch = href.match(/\/@([\w.-]+)/);
        if (handleMatch) {
          const { resolveChannelId } = await import('../utils/youtube-api.js');
          id = await resolveChannelId('@' + handleMatch[1]);
          if (id && !cancelled) { setChannelId(id); return; }
        }
      }

      // Retry after delay — page may still be loading
      setTimeout(async () => {
        if (cancelled) return;
        id = parseCurrentVideoChannelId();
        if (id) { setChannelId(id); return; }

        // Final attempt: extract handle and resolve
        const link = document.querySelector('#owner a[href*="/@"]');
        if (link) {
          const m = link.getAttribute('href')?.match(/\/@([\w.-]+)/);
          if (m) {
            const { resolveChannelId } = await import('../utils/youtube-api.js');
            id = await resolveChannelId('@' + m[1]);
            if (id) setChannelId(id);
          }
        }
      }, 3000);
    }
    resolve();
    return () => { cancelled = true; };
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const toggleGroup = useCallback(async (groupId) => {
    if (!channelId) return;
    const entry = channelMap[channelId] || { name: channelId, groups: [] };
    const currentGroups = entry.groups || [];
    const isInGroup = currentGroups.includes(groupId);

    const newGroups = isInGroup
      ? currentGroups.filter(g => g !== groupId)
      : [...currentGroups, groupId];

    // Get channel name from the page
    const channelName = document.querySelector('#owner #channel-name a, ytd-channel-name a')?.textContent?.trim() || entry.name || channelId;

    // Partial update — only this channel, never overwrites others
    await updateChannelMap({ [channelId]: { ...entry, name: channelName, groups: newGroups } });
    log.info(MOD, `Channel ${channelId} ${isInGroup ? 'removed from' : 'added to'} group ${groupId}`);
  }, [channelId, channelMap, updateChannelMap]);

  if (!channelId) return null;

  const entry = channelMap[channelId] || { groups: [] };
  const memberGroups = entry.groups || [];
  const groupCount = memberGroups.length;

  return (
    <div className="ytsm-reset ytsm-group-dropdown-wrapper" ref={menuRef}>
      <button
        className="ytsm-group-dropdown-trigger"
        onClick={() => setShowMenu(!showMenu)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>
        </svg>
        {groupCount > 0 ? `${groupCount} Group${groupCount > 1 ? 's' : ''}` : 'Group'}
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 10l5 5 5-5z"/></svg>
      </button>

      {showMenu && (
        <div className="ytsm-group-dropdown-menu visible">
          {groups.length === 0 && (
            <div style={{ padding: '12px', fontSize: 13, color: 'var(--ytsm-text-disabled)' }}>
              No groups yet.
            </div>
          )}
          {groups.map(group => {
            const isIn = memberGroups.includes(group.id);
            return (
              <div key={group.id} className="ytsm-dropdown-item" onClick={() => toggleGroup(group.id)}>
                <div className={`ytsm-mini-checkbox ${isIn ? 'checked' : ''}`}></div>
                <span className="ytsm-dropdown-label">{group.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
