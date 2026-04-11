/**
 * DOM Observer — YouTube SPA navigation and element detection.
 */
import { log } from './logger.js';

const MOD = 'DOMObserver';

const listeners = [];
let currentUrl = location.href;
let initialized = false;

/** Get structured context about the current YouTube page */
export function getPageContext() {
  const url = new URL(location.href);
  const path = url.pathname;

  let pageType = 'unknown';
  let channelId = null;
  let channelHandle = null;
  let videoId = null;

  if (path === '/' || path === '') {
    pageType = 'home';
  } else if (path === '/feed/subscriptions') {
    pageType = 'subscriptions';
  } else if (path.startsWith('/watch')) {
    pageType = 'watch';
    videoId = url.searchParams.get('v');
  } else if (path.startsWith('/@')) {
    pageType = 'channel';
    channelHandle = path.split('/')[1];
  } else if (path.startsWith('/channel/')) {
    pageType = 'channel';
    channelId = path.split('/')[2];
  } else if (path.startsWith('/c/') || path.startsWith('/user/')) {
    pageType = 'channel';
    channelHandle = path.split('/')[2];
  } else if (path.startsWith('/feed/')) {
    pageType = 'feed';
  }

  return { pageType, channelId, channelHandle, videoId, path, url: location.href };
}

/** Register a callback for URL/page changes */
export function onPageChange(callback) {
  listeners.push(callback);
  callback(getPageContext());
}

/** Notify all registered listeners */
function notifyListeners() {
  const ctx = getPageContext();
  for (const cb of listeners) {
    try { cb(ctx); } catch (err) {
      log.error(MOD, 'Page change listener error', err);
    }
  }
}

/** Wait until a specific element appears in the DOM */
export function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    const observer = new MutationObserver(() => {
      const target = document.querySelector(selector);
      if (target) {
        observer.disconnect();
        resolve(target);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

/** Debounce helper */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Watch for an element to appear/disappear in the DOM.
 * Returns a cleanup function.
 */
export function watchElement(selector, { onMount, onUnmount } = {}) {
  let mounted = !!document.querySelector(selector);
  if (mounted && onMount) onMount(document.querySelector(selector));

  const check = debounce(() => {
    const el = document.querySelector(selector);
    if (el && !mounted) {
      mounted = true;
      log.debug(MOD, `Element mounted: ${selector}`);
      onMount?.(el);
    } else if (!el && mounted) {
      mounted = false;
      log.debug(MOD, `Element unmounted: ${selector}`);
      onUnmount?.();
    }
  }, 200);

  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => observer.disconnect();
}

/** Initialize the observer system */
export function init() {
  if (initialized) return;
  initialized = true;

  // YouTube SPA navigation event
  document.addEventListener('yt-navigate-finish', () => {
    const newUrl = location.href;
    if (newUrl !== currentUrl) {
      currentUrl = newUrl;
      log.info(MOD, 'Navigation detected', newUrl);
      setTimeout(notifyListeners, 300);
    }
  });

  // Fallback: poll for URL changes
  setInterval(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      setTimeout(notifyListeners, 300);
    }
  }, 1000);

  // Guide panel open/close
  document.addEventListener('yt-guide-toggle', () => {
    setTimeout(notifyListeners, 500);
  });

  log.info(MOD, 'Initialized');
}
