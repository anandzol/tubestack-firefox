/**
 * ChannelPageButton — Group dropdown on channel pages.
 * Lets the user add/remove the current channel from groups.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGroups } from '../context/GroupsContext.jsx';
import { resolveChannelId, parseCurrentChannelInfo, generateChannelTags } from '../utils/youtube-api.js';
import { log } from '../utils/logger.js';

const MOD = 'ChannelPageBtn';

export default function ChannelPageButton() {
  const { groups, channelMap, updateChannelMap } = useGroups();
  const [channelId, setChannelId] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef(null);

  // Resolve current channel
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      setLoading(true);
      const info = parseCurrentChannelInfo();
      if (!info) { setLoading(false); return; }

      let id = null;
      if (info.type === 'id') {
        id = info.channelId;
      } else if (info.type === 'handle') {
        id = await resolveChannelId(info.handle);
      } else if (info.type === 'slug') {
        id = await resolveChannelId(info.slug);
      }

      if (!cancelled && id) {
        setChannelId(id);
        // Auto-register channel name + avatar (partial update — safe even during loading)
        if (!channelMap[id] || !channelMap[id]?.avatar) {
          const name = document.querySelector('#channel-name yt-formatted-string, #channel-header ytd-channel-name yt-formatted-string')?.textContent || channelMap[id]?.name || id;
          const avatar = document.querySelector('yt-page-header-renderer yt-img-shadow img, #channel-header-container yt-img-shadow img, ytd-c4-tabbed-header-renderer #avatar img')?.src || channelMap[id]?.avatar || null;
          await updateChannelMap({ [id]: { name, avatar, groups: channelMap[id]?.groups || [] } });
        }
      }
      if (!cancelled) setLoading(false);
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

    // Partial update — only this channel, never overwrites others
    await updateChannelMap({ [channelId]: { ...entry, groups: newGroups } });
    log.info(MOD, `Channel ${channelId} ${isInGroup ? 'removed from' : 'added to'} group ${groupId}`);
  }, [channelId, channelMap, updateChannelMap]);

  if (loading || !channelId) return null;

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
        {groupCount > 0 ? `${groupCount} Group${groupCount > 1 ? 's' : ''}` : 'Add to Group'}
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 10l5 5 5-5z"/></svg>
      </button>

      {showMenu && (
        <div className="ytsm-group-dropdown-menu visible">
          {groups.length === 0 && (
            <div style={{ padding: '12px', fontSize: 13, color: 'var(--ytsm-text-disabled)' }}>
              No groups yet. Create one in the Dashboard.
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
