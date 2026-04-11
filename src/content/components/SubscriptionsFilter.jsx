/**
 * SubscriptionsFilter — Filter chips on /feed/subscriptions page.
 * Adds group-based filter chips above YouTube's subscription feed.
 */
import React, { useState, useCallback } from 'react';
import { useGroups } from '../context/GroupsContext.jsx';

export default function SubscriptionsFilter() {
  const { groups, channelMap } = useGroups();
  const [activeGroup, setActiveGroup] = useState(null);

  const handleChipClick = useCallback((group) => {
    if (activeGroup === group.id) {
      setActiveGroup(null);
      // Show all videos
      showAllSubscriptionVideos();
    } else {
      setActiveGroup(group.id);
      // Filter to group channels only
      filterSubscriptionVideos(group, channelMap);
    }
  }, [activeGroup, channelMap]);

  if (groups.length === 0) return null;

  return (
    <div className="ytsm-reset ytsm-sub-filter-bar">
      <button
        className={`ytsm-filter-chip ${activeGroup === null ? 'active' : ''}`}
        onClick={() => { setActiveGroup(null); showAllSubscriptionVideos(); }}
      >
        All
      </button>
      <div className="ytsm-filter-separator" />
      {groups.map(group => (
        <button
          key={group.id}
          className={`ytsm-filter-chip ${activeGroup === group.id ? 'active' : ''}`}
          onClick={() => handleChipClick(group)}
        >
          {group.name}
        </button>
      ))}
    </div>
  );
}

function filterSubscriptionVideos(group, channelMap) {
  // Get channel IDs in this group
  const groupChannelIds = new Set();
  for (const [chId, entry] of Object.entries(channelMap)) {
    if (entry.groups?.includes(group.id)) {
      groupChannelIds.add(chId);
    }
  }

  // Hide videos from channels not in this group
  const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
  for (const item of items) {
    const channelLink = item.querySelector('a[href*="/channel/"], a[href*="/@"]');
    if (!channelLink) { item.style.display = ''; continue; }

    const href = channelLink.getAttribute('href') || '';
    let match = false;

    for (const chId of groupChannelIds) {
      if (href.includes(chId)) { match = true; break; }
    }

    // Also check by channel name in the map
    if (!match) {
      const nameEl = item.querySelector('#channel-name, ytd-channel-name');
      const name = nameEl?.textContent?.trim();
      if (name) {
        for (const [chId, entry] of Object.entries(channelMap)) {
          if (entry.name === name && groupChannelIds.has(chId)) {
            match = true;
            break;
          }
        }
      }
    }

    item.style.display = match ? '' : 'none';
  }
}

function showAllSubscriptionVideos() {
  const items = document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
  for (const item of items) {
    item.style.display = '';
  }
}
