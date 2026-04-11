/**
 * content-main.jsx — React entry point for the content script.
 *
 * Mounts React components into YouTube's DOM (guide panel, masthead, video/channel pages).
 * A single GroupsProvider context wraps a controller that manages injection points.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import { GroupsProvider, useGroups } from './context/GroupsContext.jsx';
import SidebarSection from './components/SidebarSection.jsx';
import GroupFeed from './components/GroupFeed.jsx';
import Dashboard from './components/Dashboard.jsx';
import MastheadButton from './components/MastheadButton.jsx';
import ChannelPageButton from './components/ChannelPageButton.jsx';
import VideoPageButton from './components/VideoPageButton.jsx';
import SubscriptionsFilter from './components/SubscriptionsFilter.jsx';
import { init as initDOMObserver, onPageChange, watchElement, getPageContext } from './utils/dom-observer.js';
import { log } from './utils/logger.js';

// Import CSS so Vite bundles it
import '../styles/global.css';

const MOD = 'ContentMain';

// ─── App Controller ─────────────────────────────────────────────────────────
function AppController() {
  const [feedGroup, setFeedGroup] = useState(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [pageContext, setPageContext] = useState(getPageContext());

  // Track page context changes
  useEffect(() => {
    onPageChange((ctx) => {
      setPageContext(ctx);
      // Close feed/dashboard on navigation
      setFeedGroup(null);
      setShowDashboard(false);
    });
  }, []);

  // Listen for messages from popup
  useEffect(() => {
    function handleMessage(msg, sender, sendResponse) {
      if (msg.type === 'OPEN_DASHBOARD') {
        setShowDashboard(true);
        sendResponse?.({ ok: true });
      }
      if (msg.type === 'CHECK_SESSION') {
        const signedIn = !!document.querySelector('ytd-topbar-menu-button-renderer #avatar-btn');
        const username = document.querySelector('#account-name')?.textContent?.trim() || '';
        sendResponse?.({ signedIn, username });
      }
    }

    try {
      chrome.runtime.onMessage.addListener(handleMessage);
      return () => { try { chrome.runtime.onMessage.removeListener(handleMessage); } catch (_) {} };
    } catch (_) {}
  }, []);

  // Check for dashboard trigger in URL hash
  useEffect(() => {
    if (location.hash === '#ytsubmgr-dashboard') {
      setShowDashboard(true);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);

  const handleOpenFeed = useCallback((group) => {
    log.info(MOD, `Opening feed for group: ${group.name}`);
    setFeedGroup(group);
  }, []);

  const handleSwitchGroup = useCallback((group) => {
    log.info(MOD, `Switching to group: ${group.name}`);
    setFeedGroup(group);
  }, []);

  return (
    <>
      {/* Sidebar — inject into YouTube guide */}
      <SidebarInjector onOpenFeed={handleOpenFeed} onOpenDashboard={() => setShowDashboard(true)} />

      {/* Masthead button */}
      <MastheadInjector onOpenDashboard={() => setShowDashboard(true)} />

      {/* Channel page button */}
      {pageContext.pageType === 'channel' && (
        <ChannelPageInjector key={pageContext.url} />
      )}

      {/* Video page button */}
      {pageContext.pageType === 'watch' && (
        <VideoPageInjector key={pageContext.videoId} />
      )}

      {/* Subscriptions filter */}
      {pageContext.pageType === 'subscriptions' && (
        <SubscriptionsInjector />
      )}

      {/* Group Feed overlay */}
      {feedGroup && (
        <GroupFeed
          group={feedGroup}
          onClose={() => setFeedGroup(null)}
          onSwitchGroup={handleSwitchGroup}
        />
      )}

      {/* Dashboard overlay */}
      {showDashboard && (
        <Dashboard onClose={() => setShowDashboard(false)} />
      )}
    </>
  );
}

// ─── Injection Components ───────────────────────────────────────────────────

function SidebarInjector({ onOpenFeed, onOpenDashboard }) {
  const [container, setContainer] = useState(null);
  const { settings, loading } = useGroups();

  useEffect(() => {
    if (loading) return; // Wait for settings to load before injecting

    let cancelled = false;
    let retryTimer;
    let cleanupWatch;

    function getInsertionPoint(guideEl) {
      const position = settings.sidebarPosition || 'bottom';
      const sections = guideEl.querySelectorAll('ytd-guide-renderer > #sections > ytd-guide-section-renderer');
      
      if (!sections || sections.length === 0) return null;
      
      // Map position to section index
      // Section 0: Home/Shorts, 1: Subscriptions, 2: You, 3: Explore, 4: More from YT, 5: Report
      const posMap = {
        'after-home': 1,          // After section 0 → before section 1
        'after-subscriptions': 2, // After section 1 → before section 2
        'after-you': 3,           // After section 2 → before section 3
        'before-explore': 3,      // Same as after-you
        'after-explore': 4,       // After section 3 → before section 4
        'bottom': null,           // Before footer
      };

      const targetIndex = posMap[position];
      if (targetIndex !== null && targetIndex !== undefined && sections[targetIndex]) {
        return sections[targetIndex]; // insertBefore this element
      }
      return null; // Will fall through to footer/append
    }

    function tryInject() {
      // Find the currently ACTIVE guide panel
      const guides = Array.from(document.querySelectorAll('ytd-guide-renderer #guide-inner-content, tp-yt-app-drawer #guide-inner-content, #guide-content #guide-inner-content'));
      const activeGuide = guides.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (!activeGuide) return false;

      const sectionsContainer = activeGuide.querySelector('ytd-guide-renderer > #sections')
        || activeGuide.querySelector('#sections');
      const insertBefore = getInsertionPoint(activeGuide);

      function placeElement(el) {
        if (insertBefore && sectionsContainer) {
          if (el.nextElementSibling !== insertBefore) {
            sectionsContainer.insertBefore(el, insertBefore);
          }
        } else {
          // Fallback: insert before footer or at end
          const footer = activeGuide.querySelector('#footer');
          if (footer) {
            if (el.nextElementSibling !== footer) {
              footer.parentElement.insertBefore(el, footer);
            }
          } else {
            if (el.parentElement !== activeGuide || el.nextElementSibling) {
              activeGuide.appendChild(el);
            }
          }
        }
      }

      let el = document.getElementById('ytsm-sidebar-root');
      let isNew = false;
      if (!el) {
        el = document.createElement('div');
        el.id = 'ytsm-sidebar-root';
        isNew = true;
      }

      placeElement(el);

      if (!cancelled) {
        setContainer(prev => (prev === el ? prev : el));
      }
      
      if (isNew) {
        log.info(MOD, `Sidebar injected at position: ${settings.sidebarPosition || 'bottom'}`);
      }
      return true;
    }

    // Try immediately
    tryInject();

    // Poll to keep the sidebar attached through YouTube SPA navigations
    retryTimer = setInterval(() => {
      if (!cancelled) tryInject();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(retryTimer);
    };
  }, [settings.sidebarPosition, loading]);

  if (!container) return null;

  return ReactDOM.createPortal(
    <SidebarSection onOpenFeed={onOpenFeed} onOpenDashboard={onOpenDashboard} />,
    container
  );
}

function MastheadInjector({ onOpenDashboard }) {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer;

    function tryInject() {
      const mastheadEnd = document.querySelector('ytd-masthead #end #buttons')
        || document.querySelector('ytd-masthead #end');
      
      if (!mastheadEnd) return false;

      if (mastheadEnd.querySelector('#ytsm-masthead-root')) {
        const existing = mastheadEnd.querySelector('#ytsm-masthead-root');
        if (existing.parentElement !== mastheadEnd || mastheadEnd.firstChild !== existing) {
          mastheadEnd.insertBefore(existing, mastheadEnd.firstChild);
        }
        if (!cancelled) setContainer(existing);
        return true;
      }

      let el = document.getElementById('ytsm-masthead-root');
      let isNew = false;
      if (!el) {
        el = document.createElement('div');
        el.id = 'ytsm-masthead-root';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        isNew = true;
      }

      mastheadEnd.insertBefore(el, mastheadEnd.firstChild);
      if (!cancelled) setContainer(el);
      
      if (isNew) log.info(MOD, 'Masthead container injected');
      return true;
    }

    // Try immediately
    tryInject();

    // Poll to keep the button attached through SPA navigations
    retryTimer = setInterval(() => {
      if (!cancelled) tryInject();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(retryTimer);
    };
  }, []);

  if (!container) return null;

  return ReactDOM.createPortal(
    <MastheadButton onClick={onOpenDashboard} />,
    container
  );
}

function ChannelPageInjector() {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer;

    function tryInject() {
      // Modern YouTube channel header: try multiple selectors
      // yt-flexible-actions-view-model is the direct container for Subscribe/Join buttons
      const selectors = [
        'yt-flexible-actions-view-model',
        'ytd-c4-tabbed-header-renderer #inner-header-container #buttons',
        'ytd-c4-tabbed-header-renderer #channel-header #buttons',
        '#channel-header-container #buttons',
        'ytd-c4-tabbed-header-renderer #buttons',
      ];

      let target = null;
      for (const sel of selectors) {
        target = document.querySelector(sel);
        if (target) {
          log.info(MOD, `Channel page: found target with selector "${sel}"`);
          break;
        }
      }

      if (!target) return false;
      if (target.querySelector('#ytsm-channel-btn-root')) {
        const existing = target.querySelector('#ytsm-channel-btn-root');
        if (!cancelled) setContainer(existing);
        return true;
      }

      // Create a wrapper div that matches YouTube's flex action structure
      const wrapper = document.createElement('div');
      wrapper.className = 'ytFlexibleActionsViewModelAction';
      
      const el = document.createElement('div');
      el.id = 'ytsm-channel-btn-root';
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      
      wrapper.appendChild(el);
      target.appendChild(wrapper);
      if (!cancelled) setContainer(el);
      log.info(MOD, 'Channel page button injected');
      return true;
    }

    if (!tryInject()) {
      let attempts = 0;
      retryTimer = setInterval(() => {
        if (tryInject() || ++attempts > 20) clearInterval(retryTimer);
      }, 1000);
    }

    return () => {
      cancelled = true;
      clearInterval(retryTimer);
    };
  }, []);

  if (!container) return null;
  return ReactDOM.createPortal(<ChannelPageButton />, container);
}

function VideoPageInjector() {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer;

    function tryInject() {
      // Target: the #owner div inside #top-row, which contains channel info + subscribe
      const selectors = [
        'ytd-watch-metadata #top-row #owner',
        '#above-the-fold #top-row #owner',
        '#top-row #owner',
      ];

      let owner = null;
      for (const sel of selectors) {
        owner = document.querySelector(sel);
        if (owner) {
          log.info(MOD, `Video page: found target with selector "${sel}"`);
          break;
        }
      }

      if (!owner) return false;
      if (owner.querySelector('#ytsm-video-btn-root')) {
        const existing = owner.querySelector('#ytsm-video-btn-root');
        if (!cancelled) setContainer(existing);
        return true;
      }

      const el = document.createElement('div');
      el.id = 'ytsm-video-btn-root';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.marginLeft = '8px';
      el.style.flexShrink = '0';

      // Insert after subscribe-button (last child of #owner)
      owner.appendChild(el);
      if (!cancelled) setContainer(el);
      log.info(MOD, 'Video page button injected into #owner');
      return true;
    }

    if (!tryInject()) {
      let attempts = 0;
      retryTimer = setInterval(() => {
        if (tryInject() || ++attempts > 20) clearInterval(retryTimer);
      }, 1000);
    }

    return () => {
      cancelled = true;
      clearInterval(retryTimer);
    };
  }, []);

  if (!container) return null;
  return ReactDOM.createPortal(<VideoPageButton />, container);
}

function SubscriptionsInjector() {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer;

    function tryInject() {
      const target = document.querySelector('ytd-browse[page-subtype="subscriptions"] #header, ytd-browse[page-subtype="subscriptions"] ytd-rich-grid-renderer');
      if (target && !document.querySelector('#ytsm-sub-filter-root')) {
        const el = document.createElement('div');
        el.id = 'ytsm-sub-filter-root';
        target.insertBefore(el, target.firstChild);
        if (!cancelled) setContainer(el);
        log.info(MOD, 'Subscriptions filter injected');
        return true;
      }
      return false;
    }

    if (!tryInject()) {
      let attempts = 0;
      retryTimer = setInterval(() => {
        if (tryInject() || ++attempts > 10) clearInterval(retryTimer);
      }, 1000);
    }

    return () => {
      cancelled = true;
      clearInterval(retryTimer);
      container?.remove();
    };
  }, []);

  if (!container) return null;
  return ReactDOM.createPortal(<SubscriptionsFilter />, container);
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

function bootstrap() {
  log.info(MOD, 'Bootstrapping extension...');

  // Initialize DOM observer
  initDOMObserver();

  // Create a root container for the main React tree
  const rootEl = document.createElement('div');
  rootEl.id = 'ytsm-app-root';
  rootEl.style.position = 'fixed';
  rootEl.style.top = '0';
  rootEl.style.left = '0';
  rootEl.style.width = '0';
  rootEl.style.height = '0';
  rootEl.style.overflow = 'visible';
  rootEl.style.zIndex = '99999';
  rootEl.style.pointerEvents = 'none';
  document.body.appendChild(rootEl);

  // Mount React
  const root = createRoot(rootEl);
  root.render(
    <GroupsProvider>
      <div style={{ pointerEvents: 'auto' }}>
        <AppController />
      </div>
    </GroupsProvider>
  );

  log.info(MOD, 'React tree mounted');
}

// Wait for body to be ready
if (document.body) {
  bootstrap();
} else {
  document.addEventListener('DOMContentLoaded', bootstrap);
}
