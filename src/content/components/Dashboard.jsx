/**
 * Dashboard — Modal overlay for managing groups, channels, settings, and import/export.
 * Phase 2: Channel avatars, group emoji icons, sidebar position, enrichment controls.
 */
import React, { useState, useRef, useCallback } from 'react';
import { useGroups } from '../context/GroupsContext.jsx';
import { StorageAPI } from '../utils/storage.js';
import EmojiPicker from './EmojiPicker.jsx';
import { log } from '../utils/logger.js';

const MOD = 'Dashboard';

const SIDEBAR_POSITIONS = [
  { value: 'after-home', label: 'After Home & Shorts' },
  { value: 'after-subscriptions', label: 'After Subscriptions' },
  { value: 'after-you', label: 'After You (History/Playlists)' },
  { value: 'before-explore', label: 'Before Explore' },
  { value: 'after-explore', label: 'After Explore' },
  { value: 'bottom', label: 'Bottom (default)' },
];

export default function Dashboard({ onClose }) {
  const { groups, channelMap, settings, updateGroups, updateChannelMap, updateSettings, enrichChannels, enrichmentStatus } = useGroups();
  const [activeTab, setActiveTab] = useState('groups');
  const [newGroupName, setNewGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [importStatus, setImportStatus] = useState(null);
  const [emojiPickerGroup, setEmojiPickerGroup] = useState(null); // group.id being edited
  const fileInputRef = useRef(null);

  // ─── Groups Tab ───────────────────────────────────────────────────────────
  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) return;
    if (groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      setImportStatus({ type: 'error', msg: `Group "${name}" already exists` });
      return;
    }
    const id = 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    const newGroup = { id, name, children: [] };
    await updateGroups([...groups, newGroup]);
    setNewGroupName('');
    log.info(MOD, `Created group: ${name}`);
  }, [newGroupName, groups, updateGroups]);

  const handleDeleteGroup = useCallback(async (groupId) => {
    if (!confirm('Delete this group? Channels will not be removed.')) return;
    const filtered = groups.filter(g => g.id !== groupId);
    await updateGroups(filtered);
    // Remove group from channel entries — read fresh from storage
    const stored = await StorageAPI.localGet(['channelMap']);
    const freshMap = stored.channelMap || {};
    const changes = {};
    for (const [chId, entry] of Object.entries(freshMap)) {
      if (entry.groups?.includes(groupId)) {
        changes[chId] = { ...entry, groups: entry.groups.filter(gid => gid !== groupId) };
      }
    }
    if (Object.keys(changes).length > 0) {
      await updateChannelMap(changes);
    }
    log.info(MOD, `Deleted group: ${groupId}`);
  }, [groups, channelMap, updateGroups, updateChannelMap]);

  const handleRenameGroup = useCallback(async (groupId, newName) => {
    const updated = groups.map(g => g.id === groupId ? { ...g, name: newName } : g);
    await updateGroups(updated);
  }, [groups, updateGroups]);

  const handleSetGroupIcon = useCallback(async (groupId, emoji) => {
    const updated = groups.map(g => {
      if (g.id !== groupId) return g;
      if (emoji) {
        return { ...g, icon: emoji, iconType: 'emoji' };
      } else {
        const { icon, iconType, ...rest } = g;
        return rest;
      }
    });
    await updateGroups(updated);
    setEmojiPickerGroup(null);
  }, [groups, updateGroups]);

  const moveGroup = useCallback(async (index, direction) => {
    const newGroups = [...groups];
    const target = index + direction;
    if (target < 0 || target >= newGroups.length) return;
    [newGroups[index], newGroups[target]] = [newGroups[target], newGroups[index]];
    await updateGroups(newGroups);
  }, [groups, updateGroups]);

  // ─── Channels Tab ─────────────────────────────────────────────────────────
  const channelEntries = Object.entries(channelMap)
    .filter(([id, entry]) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return id.toLowerCase().includes(q) || (entry.name || '').toLowerCase().includes(q);
    })
    .sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]));

  const getGroupName = useCallback((groupId) => {
    const g = groups.find(g => g.id === groupId);
    return g?.name || groupId;
  }, [groups]);

  // ─── Import / Export ──────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const result = await StorageAPI.exportData();
    if (result.error) {
      setImportStatus({ type: 'error', msg: 'Export failed — extension context lost' });
      return;
    }
    const blob = new Blob([JSON.stringify(result.exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yt-groups-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setImportStatus({ type: 'success', msg: 'Backup exported successfully!' });
  }, []);

  const handleImport = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setImportStatus({ type: 'info', msg: 'Importing...' });
      
      const result = await StorageAPI.importData(data);
      if (result.error) {
        setImportStatus({ type: 'error', msg: `Import failed: ${result.error}` });
      } else {
        const fmt = result.format === 'pockettube' 
          ? `PocketTube format detected! ${result.newGroups} new groups imported.`
          : 'Import complete!';
        setImportStatus({ type: 'success', msg: fmt });
        log.info(MOD, 'Import result', result);
        // Trigger enrichment for newly imported channels
        setTimeout(() => enrichChannels(false), 2000);
      }
    } catch (err) {
      setImportStatus({ type: 'error', msg: `Invalid JSON file: ${err.message}` });
      log.error(MOD, 'Import error', err);
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [enrichChannels]);

  // Enrichment status display
  const enrichStatusText = () => {
    if (!enrichmentStatus) return null;
    if (enrichmentStatus === 'running') return 'Starting channel enrichment...';
    if (enrichmentStatus.total === 0) return 'All channels are up to date!';
    return `Enriched ${enrichmentStatus.done} / ${enrichmentStatus.total} channels`;
  };

  return (
    <div className="ytsm-reset ytsm-overlay open" onClick={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      <div className="ytsm-dashboard" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ytsm-dash-header">
          <h2>
            <img 
              src={chrome.runtime.getURL('assets/icons/icon48.png')} 
              style={{ width: 28, height: 28, marginRight: 10, borderRadius: '6px' }} 
              alt="TubeStack Icon" 
            />
            TubeStack
          </h2>
          <button className="ytsm-dash-close" onClick={onClose}>
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="ytsm-dash-tabs">
          {['groups', 'channels', 'settings', 'import'].map(tab => (
            <button
              key={tab}
              className={`ytsm-dash-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="ytsm-dash-body">
          {/* ─── GROUPS TAB ───────────────────────────────────── */}
          {activeTab === 'groups' && (
            <>
              <div className="ytsm-group-create-bar">
                <input
                  className="ytsm-input"
                  placeholder="New group name..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                />
                <button className="ytsm-btn ytsm-btn-primary" onClick={handleCreateGroup}>
                  <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  Create
                </button>
              </div>

              <div className="ytsm-group-list">
                {groups.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--ytsm-text-disabled)' }}>
                    No groups yet. Create one above or import a backup!
                  </div>
                )}
                {groups.map((group, index) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    channelCount={Object.values(channelMap).filter(e => e.groups?.includes(group.id)).length}
                    onDelete={() => handleDeleteGroup(group.id)}
                    onRename={(name) => handleRenameGroup(group.id, name)}
                    onMoveUp={() => moveGroup(index, -1)}
                    onMoveDown={() => moveGroup(index, 1)}
                    onSetIcon={() => setEmojiPickerGroup(emojiPickerGroup === group.id ? null : group.id)}
                    showEmojiPicker={emojiPickerGroup === group.id}
                    onEmojiSelect={(emoji) => handleSetGroupIcon(group.id, emoji)}
                    isFirst={index === 0}
                    isLast={index === groups.length - 1}
                  />
                ))}
              </div>
            </>
          )}

          {/* ─── CHANNELS TAB ─────────────────────────────────── */}
          {activeTab === 'channels' && (
            <>
              <div className="ytsm-channels-toolbar">
                <input
                  className="ytsm-input ytsm-search-input"
                  placeholder="Search channels..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <span style={{ fontSize: 13, color: 'var(--ytsm-text-disabled)', whiteSpace: 'nowrap' }}>
                  {channelEntries.length} channels
                </span>
                <button
                  className="ytsm-btn ytsm-btn-secondary"
                  style={{ marginLeft: 8, fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap' }}
                  onClick={() => enrichChannels(true)}
                  disabled={enrichmentStatus === 'running'}
                >
                  {enrichmentStatus === 'running' ? '⏳ Fetching...' : '🔄 Refresh Details'}
                </button>
              </div>

              {enrichStatusText() && (
                <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--ytsm-primary)', background: 'var(--ytsm-surface)', borderRadius: 6, margin: '0 0 8px' }}>
                  {enrichStatusText()}
                </div>
              )}

              <div className="ytsm-channel-list">
                {channelEntries.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--ytsm-text-disabled)' }}>
                    {searchQuery ? 'No channels match your search.' : 'No channels mapped yet. Visit channel pages and add them to groups!'}
                  </div>
                )}
                {channelEntries.slice(0, 100).map(([chId, entry]) => (
                  <div key={chId} className="ytsm-channel-row">
                    <div className="ytsm-channel-avatar">
                      {entry.avatar ? (
                        <img src={entry.avatar} alt="" />
                      ) : (
                        <div className="ytsm-channel-avatar-placeholder">
                          {(entry.name || chId).charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="ytsm-channel-info">
                      <div className="ytsm-channel-name">{entry.name || chId}</div>
                      <div className="ytsm-channel-groups">
                        {(entry.groups || []).map(gid => (
                          <span key={gid} className="ytsm-channel-group-chip">
                            {getGroupName(gid)}
                          </span>
                        ))}
                        {(!entry.groups || entry.groups.length === 0) && (
                          <span style={{ fontSize: 12, color: 'var(--ytsm-text-disabled)' }}>Ungrouped</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {channelEntries.length > 100 && (
                  <div style={{ textAlign: 'center', padding: 12, fontSize: 13, color: 'var(--ytsm-text-disabled)' }}>
                    Showing first 100 of {channelEntries.length}. Use search to find specific channels.
                  </div>
                )}
              </div>
            </>
          )}

          {/* ─── SETTINGS TAB ─────────────────────────────────── */}
          {activeTab === 'settings' && (
            <div>
              <div className="ytsm-settings-section">
                <h3>Feed Settings</h3>
                <div className="ytsm-settings-row">
                  <label>Default fetch volume (total videos)</label>
                  <select
                    className="ytsm-select"
                    value={settings.defaultFetchVolume || 100}
                    onChange={(e) => updateSettings({ defaultFetchVolume: parseInt(e.target.value) })}
                  >
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="400">400</option>
                  </select>
                </div>
                <div className="ytsm-settings-row">
                  <label>Default grid columns</label>
                  <select
                    className="ytsm-select"
                    value={settings.defaultGridColumns || 4}
                    onChange={(e) => updateSettings({ defaultGridColumns: parseInt(e.target.value) })}
                  >
                    <option value="4">4 columns</option>
                    <option value="6">6 columns</option>
                  </select>
                </div>
              </div>

              <div className="ytsm-settings-section">
                <h3>Sidebar Position</h3>
                <p style={{ fontSize: 13, color: 'var(--ytsm-text-secondary)', marginBottom: 12 }}>
                  Choose where the Groups section appears in YouTube's sidebar menu.
                  Changes take effect on next page reload.
                </p>
                <div className="ytsm-settings-row">
                  <label>Position in guide menu</label>
                  <select
                    className="ytsm-select"
                    value={settings.sidebarPosition || 'bottom'}
                    onChange={(e) => updateSettings({ sidebarPosition: e.target.value })}
                  >
                    {SIDEBAR_POSITIONS.map(pos => (
                      <option key={pos.value} value={pos.value}>{pos.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ─── IMPORT/EXPORT TAB ────────────────────────────── */}
          {activeTab === 'import' && (
            <div>
              <div className="ytsm-settings-section">
                <h3>Export Backup</h3>
                <p style={{ fontSize: 13, color: 'var(--ytsm-text-secondary)', marginBottom: 12 }}>
                  Download all your groups, channel mappings, and settings as a JSON file.
                </p>
                <button className="ytsm-btn ytsm-btn-primary" onClick={handleExport}>
                  <svg viewBox="0 0 24 24"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>
                  Export Backup
                </button>
              </div>

              <div className="ytsm-settings-section">
                <h3>Import Backup</h3>
                <p style={{ fontSize: 13, color: 'var(--ytsm-text-secondary)', marginBottom: 12 }}>
                  Import a backup file. Supports our native format AND PocketTube exports.
                  Existing groups will be preserved — only new groups are added.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  style={{ display: 'none' }}
                />
                <button
                  className="ytsm-btn ytsm-btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>
                  Choose File
                </button>
              </div>

              {importStatus && (
                <div className={`ytsm-toast ${importStatus.type}`} style={{ position: 'relative', marginTop: 16 }}>
                  {importStatus.msg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── GroupRow subcomponent ───────────────────────────────────────────────────
function GroupRow({ group, channelCount, onDelete, onRename, onMoveUp, onMoveDown, onSetIcon, showEmojiPicker, onEmojiSelect, isFirst, isLast }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== group.name) {
      onRename(trimmed);
    } else {
      setName(group.name);
    }
    setEditing(false);
  };

  const displayIcon = group.icon || group.name.charAt(0).toUpperCase();
  const isEmoji = group.iconType === 'emoji';

  return (
    <div className="ytsm-group-row">
      <div className="ytsm-drag-handle" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button
          className="ytsm-icon-btn"
          onClick={onMoveUp}
          disabled={isFirst}
          style={{ width: 24, height: 24, opacity: isFirst ? 0.3 : 1 }}
          title="Move up"
        >
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 14l5-5 5 5H7z"/></svg>
        </button>
        <button
          className="ytsm-icon-btn"
          onClick={onMoveDown}
          disabled={isLast}
          style={{ width: 24, height: 24, opacity: isLast ? 0.3 : 1 }}
          title="Move down"
        >
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 10l5 5 5-5H7z"/></svg>
        </button>
      </div>

      <div
        className={`ytsm-group-icon-edit ${isEmoji ? 'emoji' : ''}`}
        onClick={onSetIcon}
        title="Change icon"
        style={{ cursor: 'pointer', position: 'relative' }}
      >
        <span style={{ fontSize: isEmoji ? 20 : 14, fontWeight: isEmoji ? 400 : 700, color: isEmoji ? 'inherit' : 'var(--ytsm-primary)' }}>
          {displayIcon}
        </span>
        {showEmojiPicker && (
          <EmojiPicker
            onSelect={onEmojiSelect}
            onClose={() => onSetIcon?.()}
          />
        )}
      </div>

      <div className="ytsm-group-row-info">
        {editing ? (
          <input
            className="ytsm-input"
            style={{ height: 32, fontSize: 14 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            autoFocus
          />
        ) : (
          <>
            <div className="ytsm-group-row-name">{group.name}</div>
            <div className="ytsm-group-row-meta">{channelCount} channels</div>
          </>
        )}
      </div>

      <div className="ytsm-group-row-actions">
        <button className="ytsm-icon-btn" onClick={() => { setEditing(true); setName(group.name); }} title="Rename">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button className="ytsm-icon-btn danger" onClick={onDelete} title="Delete">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>
  );
}
