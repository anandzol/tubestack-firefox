/**
 * Popup.jsx — Extension popup React component.
 * Shows stats, session status, export, and open-dashboard button.
 */
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function Popup() {
  const [stats, setStats] = useState({ groups: 0, channels: 0, watched: 0, ungrouped: 0 });
  const [session, setSession] = useState({ status: 'unknown', text: 'Checking session...' });

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, resolve);
    });
  }

  // Callback-based wrapper so this works in Firefox too (its `chrome.*`
  // namespace does not return promises).
  function queryTabs(queryInfo) {
    return new Promise((resolve) => {
      chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
    });
  }

  function countGroups(groups) {
    let count = 0;
    for (const g of groups) {
      count++;
      if (g.children?.length) count += countGroups(g.children);
    }
    return count;
  }

  useEffect(() => {
    async function loadStats() {
      try {
        const [groupsRes, channelRes, watchedRes] = await Promise.all([
          send('GET_GROUPS'),
          send('GET_CHANNEL_MAP'),
          send('GET_WATCHED'),
        ]);

        const groups = groupsRes?.groups || [];
        const channelMap = channelRes?.channelMap || {};
        const watched = watchedRes?.watchedVideos || {};

        const ungrouped = Object.values(channelMap)
          .filter((c) => !c.groups || c.groups.length === 0).length;

        setStats({
          groups: countGroups(groups),
          channels: Object.keys(channelMap).length,
          watched: Object.keys(watched).length,
          ungrouped,
        });
      } catch (err) {
        console.error('Error loading stats:', err);
      }
    }

    async function checkSession() {
      try {
        const [tab] = await queryTabs({ url: 'https://www.youtube.com/*' });
        if (tab) {
          chrome.tabs.sendMessage(tab.id, { type: 'CHECK_SESSION' }, (resp) => {
            if (chrome.runtime.lastError || !resp) {
              setSession({ status: 'active', text: 'YouTube tab open' });
              return;
            }
            if (resp.signedIn) {
              setSession({ status: 'active', text: `Signed in${resp.username ? ` as ${resp.username}` : ''}` });
            } else {
              setSession({ status: 'inactive', text: 'Not signed in' });
            }
          });
        } else {
          setSession({ status: 'inactive', text: 'Open YouTube for full functionality' });
        }
      } catch {
        setSession({ status: 'unknown', text: 'Session status unknown' });
      }
    }

    loadStats();
    checkSession();
  }, []);

  const handleOpenDashboard = async () => {
    const [tab] = await queryTabs({ active: true, currentWindow: true });
    if (tab?.url?.includes('youtube.com')) {
      chrome.tabs.sendMessage(tab.id, { type: 'OPEN_DASHBOARD' });
      window.close();
    } else {
      chrome.tabs.create({ url: 'https://www.youtube.com/#ytsubmgr-dashboard' });
      window.close();
    }
  };

  const handleExport = async () => {
    const result = await send('EXPORT_DATA');
    const blob = new Blob([JSON.stringify(result.exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yt-groups-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { width: 340px; font-family: 'Roboto', 'Segoe UI', sans-serif; background: #0f0f0f; color: #f1f1f1; }
        .popup-header { padding: 20px 20px 16px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-bottom: 1px solid #2e2e2e; }
        .popup-header h1 { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .popup-header h1 svg { width: 20px; height: 20px; fill: #3ea6ff; }
        .popup-header p { font-size: 12px; color: #aaa; margin-top: 4px; }
        .popup-body { padding: 16px 20px; }
        .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .stat-card { background: #1a1a1a; border: 1px solid #2e2e2e; border-radius: 10px; padding: 14px; text-align: center; }
        .stat-value { font-size: 24px; font-weight: 700; color: #3ea6ff; }
        .stat-label { font-size: 11px; color: #717171; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
        .popup-actions { display: flex; flex-direction: column; gap: 6px; }
        .popup-btn { width: 100%; height: 40px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 150ms ease; }
        .popup-btn svg { width: 18px; height: 18px; fill: currentColor; }
        .popup-btn-primary { background: #3ea6ff; color: #0f0f0f; }
        .popup-btn-primary:hover { background: #65b8ff; box-shadow: 0 2px 12px rgba(62,166,255,0.3); }
        .popup-btn-secondary { background: #272727; color: #f1f1f1; }
        .popup-btn-secondary:hover { background: #3e3e3e; }
        .session-status { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; background: #1a1a1a; margin-bottom: 12px; font-size: 12px; border: 1px solid #2e2e2e; }
        .session-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .session-dot.active { background: #2ba640; box-shadow: 0 0 6px #2ba64066; }
        .session-dot.inactive { background: #ff4e45; }
        .session-dot.unknown { background: #f0a500; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        .no-api-badge { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; background: rgba(43,166,64,.1); border: 1px solid rgba(43,166,64,.25); font-size: 11px; color: #2ba640; margin-bottom: 10px; font-weight: 500; }
        .popup-footer { padding: 12px 20px; border-top: 1px solid #2e2e2e; text-align: center; font-size: 11px; color: #717171; }
      `}</style>

      <div className="popup-header">
        <h1>
          <img 
            src="assets/icons/icon48.png" 
            style={{ width: 28, height: 28, marginRight: 10, borderRadius: '6px' }} 
            alt="TubeStack Icon" 
          />
          TubeStack
        </h1>
        <p>Organize your YouTube subscriptions</p>
      </div>

      <div className="popup-body">
        <div className="no-api-badge">✅ No API Key — uses YouTube internal API</div>
        <div className="session-status">
          <span className={`session-dot ${session.status}`}></span>
          <span>{session.text}</span>
        </div>

        <div className="stat-grid">
          <div className="stat-card"><div className="stat-value">{stats.groups}</div><div className="stat-label">Groups</div></div>
          <div className="stat-card"><div className="stat-value">{stats.channels}</div><div className="stat-label">Channels</div></div>
          <div className="stat-card"><div className="stat-value">{stats.watched}</div><div className="stat-label">Watched</div></div>
          <div className="stat-card"><div className="stat-value">{stats.ungrouped}</div><div className="stat-label">Ungrouped</div></div>
        </div>

        <div className="popup-actions">
          <button className="popup-btn popup-btn-primary" onClick={handleOpenDashboard}>
            <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>
            Open Dashboard
          </button>
          <button className="popup-btn popup-btn-secondary" onClick={handleExport}>
            <svg viewBox="0 0 24 24"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>
            Export Backup
          </button>
        </div>
      </div>

      <div className="popup-footer">v2.0.0 · React + Vite</div>
    </div>
  );
}

// Mount
const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<Popup />);
}
