/**
 * SidebarSection — Injected into YouTube's left guide panel.
 * Shows expandable list of subscription groups.
 * Clicking a group opens the GroupFeed overlay.
 */
import React, { useState, useCallback } from 'react';
import { useGroups } from '../context/GroupsContext.jsx';
import { log } from '../utils/logger.js';

const MOD = 'Sidebar';

/** Count channels in a group by checking channelMap */
function countGroupChannels(group, channelMap) {
  let count = 0;
  for (const entry of Object.values(channelMap)) {
    if (entry.groups?.includes(group.id)) count++;
  }
  return count;
}

/** Flatten nested groups for display */
function flattenGroups(groups, depth = 0) {
  const result = [];
  for (const g of groups) {
    result.push({ ...g, depth });
    if (g.children?.length > 0) {
      result.push(...flattenGroups(g.children, depth + 1));
    }
  }
  return result;
}

export default function SidebarSection({ onOpenFeed, onOpenDashboard }) {
  const { groups, channelMap, loading } = useGroups();
  const [expanded, setExpanded] = useState(true);

  const handleGroupClick = useCallback((group) => {
    log.info(MOD, `Group clicked: ${group.name} (${group.id})`);
    onOpenFeed?.(group);
  }, [onOpenFeed]);

  if (loading) return null;

  const flatGroups = flattenGroups(groups);

  return (
    <div className={`ytsm-reset ytsm-sidebar-section ${expanded ? 'expanded' : ''}`}>
      <div
        className="ytsm-sidebar-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="ytsm-sidebar-header-left">
          <svg className="ytsm-sidebar-chevron" viewBox="0 0 24 24">
            <path d="M7 10l5 5 5-5z" />
          </svg>
          <span className="ytsm-sidebar-title">TubeStack</span>
        </div>
      </div>

      <div className="ytsm-sidebar-groups">
        {flatGroups.map((group) => (
          <button
            key={group.id}
            className="ytsm-sidebar-group-item"
            data-depth={group.depth}
            onClick={() => handleGroupClick(group)}
          >
            <span className={`ytsm-group-icon ${group.iconType === 'emoji' ? 'emoji' : ''}`}>
              {group.icon || group.name.charAt(0).toUpperCase()}
            </span>
            <span className="ytsm-group-name">{group.name}</span>
            <span className="ytsm-group-count">
              {countGroupChannels(group, channelMap)}
            </span>
          </button>
        ))}

        {/* Add Group / Open Dashboard */}
        <button
          className="ytsm-sidebar-add-btn"
          onClick={() => onOpenDashboard?.()}
        >
          <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          Manage Groups
        </button>
      </div>
    </div>
  );
}
