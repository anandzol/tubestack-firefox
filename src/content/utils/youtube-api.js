/**
 * YouTube Internal API — Fetches video feeds and channel data.
 * 
 * Architecture:
 *  1. RSS feed (PRIMARY) — /feeds/videos.xml?channel_id=UC… — no auth, up to 15 recent, instant
 *  2. InnerTube browse (FALLBACK) — youtubei/v1/browse — auth via cookies, pagination
 *  3. Handle resolution — youtubei/v1/navigation/resolve_url — converts @handle to UC ID
 */
import { log } from './logger.js';

const MOD = 'YouTubeAPI';

// ── In-memory caches ──────────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 3 * 60 * 1000; // 3 min for video data
const _resolvedIds = new Map(); // handle/slug → UC ID (persists for session)

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data;
}

function _cacheSet(key, data) {
  if (_cache.size > 300) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(key, { data, ts: Date.now() });
}

// ── InnerTube Configuration ───────────────────────────────────────────────────
function _getConfig() {
  try {
    const d = window.ytcfg?.data_ || {};
    return {
      apiKey: d.INNERTUBE_API_KEY || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientVersion: d.INNERTUBE_CLIENT_VERSION || '2.20250101.01.00',
      hl: d.HL || 'en',
      gl: d.GL || 'US',
      visitorData: d.VISITOR_DATA || '',
      sessionIndex: d.SESSION_INDEX || '',
    };
  } catch {
    return {
      apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientVersion: '2.20250101.01.00',
      hl: 'en', gl: 'US', visitorData: '', sessionIndex: '',
    };
  }
}

function _buildContext(cfg) {
  return {
    client: {
      hl: cfg.hl,
      gl: cfg.gl,
      clientName: 'WEB',
      clientVersion: cfg.clientVersion,
      ...(cfg.visitorData && { visitorData: cfg.visitorData }),
    },
  };
}

// ── Core InnerTube POST ───────────────────────────────────────────────────────
function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function _post(endpoint, body, retries = 2) {
  const cfg = _getConfig();
  const url = `https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': cfg.clientVersion,
          'X-Goog-AuthUser': cfg.sessionIndex,
          'Origin': 'https://www.youtube.com',
        },
        credentials: 'include',
        body: JSON.stringify({ context: _buildContext(cfg), ...body }),
      });

      if (resp.status === 429 && attempt < retries) {
        log.warn(MOD, `Rate limited on /${endpoint}, backing off`, { attempt });
        await _sleep(1000 * (attempt + 1));
        continue;
      }
      if (!resp.ok) throw new Error(`Innertube /${endpoint} HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await _sleep(500);
    }
  }
}

// ── Handle/Slug → UC ID Resolution ────────────────────────────────────────────
/**
 * Resolves a YouTube URL, @handle, or /c/ slug to a UC channel ID.
 * Uses InnerTube resolve_url endpoint.
 */
export async function resolveChannelId(input) {
  if (!input) return null;

  // Already a UC ID
  if (input.startsWith('UC') && input.length >= 24) return input;

  // Check cache
  const cached = _resolvedIds.get(input);
  if (cached) return cached;

  // Build URL for resolution
  let resolveUrl = input;
  if (input.startsWith('@')) {
    resolveUrl = `https://www.youtube.com/${input}`;
  } else if (!input.startsWith('http')) {
    resolveUrl = `https://www.youtube.com/c/${input}`;
  }

  try {
    const data = await _post('navigation/resolve_url', { url: resolveUrl });
    const channelId = data?.endpoint?.browseEndpoint?.browseId;
    if (channelId && channelId.startsWith('UC')) {
      _resolvedIds.set(input, channelId);
      log.info(MOD, `Resolved ${input} → ${channelId}`);
      return channelId;
    }
    log.warn(MOD, `Could not resolve ${input}`, data);
    return null;
  } catch (err) {
    log.error(MOD, `Failed to resolve ${input}`, err.message);
    return null;
  }
}

// ── Channel Detail Fetching ───────────────────────────────────────────────────
/**
 * Fetch channel details (name, avatar) using InnerTube browse endpoint.
 * Returns { name, avatar } or null on failure.
 */
export async function fetchChannelDetails(channelId) {
  if (!channelId || !channelId.startsWith('UC')) return null;

  const cacheKey = `details:${channelId}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const data = await _post('browse', { browseId: channelId });

    // Extract from C4 header
    const header = data?.header?.c4TabbedHeaderRenderer
      || data?.header?.pageHeaderRenderer;
    
    let name = null;
    let avatar = null;

    if (header?.title) {
      name = header.title;
    }
    if (header?.avatar?.thumbnails?.length) {
      // Pick the smallest that's at least 88px
      const thumbs = header.avatar.thumbnails;
      avatar = (thumbs.find(t => t.width >= 88) || thumbs[thumbs.length - 1])?.url || null;
    }

    // Fallback: pageHeaderRenderer (newer format)
    if (!name && data?.header?.pageHeaderRenderer?.pageTitle) {
      name = data.header.pageHeaderRenderer.pageTitle;
    }
    if (!avatar && data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.length) {
      avatar = data.header.pageHeaderRenderer.content.pageHeaderViewModel.image.decoratedAvatarViewModel.avatar.avatarViewModel.image.sources[0]?.url || null;
    }

    // Another fallback: metadata
    if (!name && data?.metadata?.channelMetadataRenderer?.title) {
      name = data.metadata.channelMetadataRenderer.title;
    }
    if (!avatar && data?.metadata?.channelMetadataRenderer?.avatar?.thumbnails?.length) {
      avatar = data.metadata.channelMetadataRenderer.avatar.thumbnails[0]?.url || null;
    }

    if (name || avatar) {
      const result = { name: name || channelId, avatar: avatar || null };
      _cacheSet(cacheKey, result);
      return result;
    }

    return null;
  } catch (err) {
    log.debug(MOD, `Failed to fetch details for ${channelId}`, err.message);
    return null;
  }
}

/**
 * Batch fetch channel details. Processes in chunks of CONCURRENCY.
 * Returns Map<channelId, { name, avatar }>.
 * Calls onProgress(completed, total) periodically.
 */
export async function fetchChannelDetailsBatch(channelIds, onProgress) {
  const CONCURRENCY = 4;
  const results = new Map();
  let completed = 0;

  const chunks = [];
  for (let i = 0; i < channelIds.length; i += CONCURRENCY) {
    chunks.push(channelIds.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (chId) => {
      const details = await fetchChannelDetails(chId);
      if (details) results.set(chId, details);
      completed++;
      onProgress?.(completed, channelIds.length);
    });
    await Promise.all(promises);
    await _sleep(100); // Rate limit courtesy
  }

  log.info(MOD, `Batch fetch complete: ${results.size}/${channelIds.length} channels enriched`);
  return results;
}

// ── YouTube RSS Feed ──────────────────────────────────────────────────────────
// Primary source — no auth, instant, up to 15 most recent videos.
async function _fetchRSS(channelId) {
  const cacheKey = `rss:${channelId}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`RSS fetch failed for ${channelId}: ${resp.status}`);

  const text = await resp.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');

  const parseErr = xml.querySelector('parsererror');
  if (parseErr) throw new Error(`RSS parse error for ${channelId}`);

  const entries = xml.querySelectorAll('entry');
  const channelName = xml.querySelector('author > name')?.textContent || '';

  const videos = Array.from(entries).map((entry) => {
    const videoId = entry.querySelector('videoId')?.textContent || '';
    const title = entry.querySelector('title')?.textContent || '';
    const published = entry.querySelector('published')?.textContent || '';
    const updated = entry.querySelector('updated')?.textContent || '';
    const viewCount = parseInt(
      entry.querySelector('statistics')?.getAttribute('views') || '0'
    );

    // Extract thumbnail from media:group > media:thumbnail
    const mediaThumbnail = entry.getElementsByTagName('media:thumbnail')[0];
    const thumbnail = mediaThumbnail?.getAttribute('url') || '';

    return {
      videoId,
      title,
      channelName,
      channelId,
      publishedAt: published || updated,
      viewCount,
      duration: 0,
      isLive: false,
      isShort: false,
      isPremiere: false,
      thumbnail,
      source: 'rss',
    };
  });

  _cacheSet(cacheKey, videos);
  return videos;
}

// ── Channel Browse via InnerTube (fallback) ───────────────────────────────────
async function _browseChannelVideos(channelId, maxCount = 30) {
  const cacheKey = `ch:${channelId}:${maxCount}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  const VIDEOS_TAB_PARAMS = 'EgZ2aWRlb3MyCRAC';

  let data;
  try {
    data = await _post('browse', { browseId: channelId, params: VIDEOS_TAB_PARAMS });
  } catch (err) {
    log.warn(MOD, `Browse failed for ${channelId}, trying without params`, err.message);
    data = await _post('browse', { browseId: channelId });
  }

  let videos = _parseChannelBrowseResponse(data, channelId);

  // Paginate with continuation tokens
  let continuation = _extractContinuationToken(data);
  while (videos.length < maxCount && continuation) {
    const more = await _post('browse', { continuation });
    const newVideos = _parseChannelBrowseResponse(more, channelId);
    if (newVideos.length === 0) break;
    videos = videos.concat(newVideos);
    continuation = _extractContinuationToken(more);
    await _sleep(80);
  }

  const result = videos.slice(0, maxCount);
  _cacheSet(cacheKey, result);
  return result;
}

// ── Parse Browse Response ─────────────────────────────────────────────────────
function _parseChannelBrowseResponse(data, channelId) {
  const videos = [];
  if (!data) return videos;

  try {
    const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const tr = tab.tabRenderer;
      if (!tr?.content) continue;

      // Modern layout: richGridRenderer
      const rgr = tr.content.richGridRenderer;
      if (rgr) {
        for (const item of rgr.contents || []) {
          const vr = item?.richItemRenderer?.content?.videoRenderer;
          if (vr) {
            const parsed = _parseVideoRenderer(vr, channelId);
            if (parsed) videos.push(parsed);
          }
        }
        if (videos.length > 0) return videos;
      }

      // Legacy layout: sectionListRenderer
      const slr = tr.content.sectionListRenderer;
      if (slr) {
        for (const section of slr.contents || []) {
          for (const inner of section.itemSectionRenderer?.contents || []) {
            for (const gi of inner.gridRenderer?.items || []) {
              const vr = gi.gridVideoRenderer;
              if (vr) {
                const parsed = _parseGridVideoRenderer(vr, channelId);
                if (parsed) videos.push(parsed);
              }
            }
          }
        }
        if (videos.length > 0) return videos;
      }
    }

    // Continuation response
    for (const action of data.onResponseReceivedActions || []) {
      for (const item of action.appendContinuationItemsAction?.continuationItems || []) {
        const vr = item?.richItemRenderer?.content?.videoRenderer;
        if (vr) {
          const parsed = _parseVideoRenderer(vr, channelId);
          if (parsed) videos.push(parsed);
        }
        const gvr = item?.gridVideoRenderer;
        if (gvr) {
          const parsed = _parseGridVideoRenderer(gvr, channelId);
          if (parsed) videos.push(parsed);
        }
      }
    }
  } catch (err) {
    log.error(MOD, '_parseChannelBrowseResponse error', err);
  }

  return videos;
}

function _parseVideoRenderer(vr, channelId) {
  if (!vr?.videoId) return null;

  const durationText = vr.thumbnailOverlays
    ?.find((o) => o.thumbnailOverlayTimeStatusRenderer)
    ?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '';

  const isShort = vr.navigationEndpoint?.reelWatchEndpoint != null ||
    vr.thumbnailOverlays?.some((o) =>
      o.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS'
    );

  const isLive = vr.badges?.some((b) =>
    b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_LIVE_NOW' ||
    b.metadataBadgeRenderer?.label === 'LIVE'
  ) || vr.thumbnailOverlays?.some((o) =>
    o.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE'
  );

  const isPremiere = vr.upcomingEventData != null ||
    vr.thumbnailOverlays?.some((o) =>
      o.thumbnailOverlayTimeStatusRenderer?.style === 'UPCOMING'
    );

  const relativeTime = _getText(vr.publishedTimeText) || '';
  const publishedAt = relativeTime ? _relativeToApproxDate(relativeTime) : '';

  // Best thumbnail
  const thumbs = vr.thumbnail?.thumbnails || [];
  const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';

  return {
    videoId: vr.videoId,
    title: _getText(vr.title) || '',
    channelId,
    channelName: _getText(vr.ownerText) || _getText(vr.longBylineText) || '',
    publishedAt,
    publishedRelative: relativeTime,
    duration: _parseDurationText(durationText),
    viewCount: _parseViewText(_getText(vr.viewCountText) || _getText(vr.shortViewCountText) || ''),
    isLive,
    isShort,
    isPremiere,
    thumbnail,
    source: 'innertube',
  };
}

function _parseGridVideoRenderer(vr, channelId) {
  if (!vr?.videoId) return null;

  const durationText = vr.thumbnailOverlays
    ?.find((o) => o.thumbnailOverlayTimeStatusRenderer)
    ?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '';

  const relativeTime = _getText(vr.publishedTimeText) || '';
  const thumbs = vr.thumbnail?.thumbnails || [];
  const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';

  return {
    videoId: vr.videoId,
    title: _getText(vr.title) || '',
    channelId,
    channelName: '',
    publishedAt: relativeTime ? _relativeToApproxDate(relativeTime) : '',
    publishedRelative: relativeTime,
    duration: _parseDurationText(durationText),
    viewCount: _parseViewText(_getText(vr.viewCountText) || _getText(vr.shortViewCountText) || ''),
    isLive: vr.thumbnailOverlays?.some((o) => o.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE') || false,
    isShort: false,
    isPremiere: vr.thumbnailOverlays?.some((o) => o.thumbnailOverlayTimeStatusRenderer?.style === 'UPCOMING') || false,
    thumbnail,
    source: 'innertube',
  };
}

function _extractContinuationToken(data) {
  if (!data) return null;

  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  for (const tab of tabs) {
    const contents = tab.tabRenderer?.content?.richGridRenderer?.contents || [];
    for (const item of contents) {
      const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token) return token;
    }
  }
  for (const tab of tabs) {
    for (const section of tab.tabRenderer?.content?.sectionListRenderer?.contents || []) {
      const token = section?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token) return token;
    }
  }
  for (const action of data.onResponseReceivedActions || []) {
    for (const item of action.appendContinuationItemsAction?.continuationItems || []) {
      const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token) return token;
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get latest videos for a single channel.
 * RSS is primary (instant, no auth). InnerTube is fallback.
 */
export async function getChannelVideos(channelId, maxCount = 15, channelName = '') {
  // Resolve handle to UC ID if needed
  const resolvedId = await resolveChannelId(channelId);
  if (!resolvedId) {
    log.warn(MOD, `Cannot resolve channel: ${channelId}`);
    return [];
  }

  let videos;

  // Always try RSS first — it's instant and near-realtime
  try {
    videos = await _fetchRSS(resolvedId);
    if (videos.length > 0) {
      // If we need more than RSS provides, supplement with InnerTube
      if (maxCount > 15 && videos.length < maxCount) {
        try {
          const itVideos = await _browseChannelVideos(resolvedId, maxCount);
          // Merge: use RSS videos (more accurate timestamps) + InnerTube extras
          const rssIds = new Set(videos.map(v => v.videoId));
          const extras = itVideos.filter(v => !rssIds.has(v.videoId));
          videos = [...videos, ...extras];
        } catch (_) { /* RSS data is sufficient */ }
      }
      videos = videos.slice(0, maxCount);
    }
  } catch {
    // RSS failed — fall back to InnerTube
    log.debug(MOD, `RSS failed for ${resolvedId}, falling back to InnerTube`);
    try {
      videos = await _browseChannelVideos(resolvedId, maxCount);
    } catch (err) {
      log.error(MOD, `InnerTube also failed for ${resolvedId}`, err.message);
      return [];
    }
  }

  // Apply channel name from our stored map
  if (channelName) {
    videos.forEach((v) => { if (!v.channelName) v.channelName = channelName; });
  }

  return videos;
}

/**
 * Get latest videos for ALL channels in a group, concurrently.
 * NO channel cap — fetches from every channel.
 * Returns flat array sorted by publishedAt (newest first).
 */
export async function getGroupVideos(channelIds, channelMap = {}, maxPerChannel = 15) {
  const CONCURRENCY = 6;
  const allVideos = [];
  const results = { success: 0, failed: 0, channels: {} };

  // Process in concurrent chunks
  const chunks = [];
  for (let i = 0; i < channelIds.length; i += CONCURRENCY) {
    chunks.push(channelIds.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (chId) => {
      const chName = channelMap[chId]?.name || chId;
      const start = performance.now();
      try {
        const videos = await getChannelVideos(chId, maxPerChannel, chName);
        const ms = (performance.now() - start).toFixed(0);
        results.success++;
        results.channels[chId] = { status: 'ok', count: videos.length, ms };
        return videos;
      } catch (err) {
        const ms = (performance.now() - start).toFixed(0);
        results.failed++;
        results.channels[chId] = { status: 'fail', error: err.message, ms };
        return [];
      }
    });

    const batchResults = await Promise.all(promises);
    for (const batch of batchResults) {
      for (const video of batch) {
        // Ensure channel name from our map
        const mapEntry = channelMap[video.channelId];
        if (mapEntry?.name && mapEntry.name !== video.channelId) {
          video.channelName = mapEntry.name;
        }
        allVideos.push(video);
      }
    }
    await _sleep(30);
  }

  log.info(MOD, `Group fetch complete: ${results.success} ok, ${results.failed} failed, ${allVideos.length} videos total`);

  // Sort by published date — newest first
  allVideos.sort((a, b) => {
    const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return db - da;
  });

  return allVideos;
}

/**
 * Parse the channel ID from the current video page.
 */
export function parseCurrentVideoChannelId() {
  // Method 1: Channel link in the owner section (most reliable in content scripts)
  const ownerLinks = document.querySelectorAll(
    '#owner a[href*="/channel/"], #owner a[href*="/@"], ytd-video-owner-renderer a[href*="/channel/"], ytd-video-owner-renderer a[href*="/@"]'
  );
  for (const link of ownerLinks) {
    const href = link.getAttribute('href') || '';
    const channelMatch = href.match(/\/channel\/(UC[\w-]+)/);
    if (channelMatch) return channelMatch[1];
  }

  // Method 2: Meta tag
  const metaChannelId = document.querySelector('meta[itemprop="channelId"]');
  if (metaChannelId) {
    const val = metaChannelId.getAttribute('content');
    if (val && val.startsWith('UC')) return val;
  }

  // Method 3: Any channel link on the page
  const links = document.querySelectorAll('a[href*="/channel/UC"]');
  for (const link of links) {
    const match = link.href.match(/\/channel\/(UC[\w-]+)/);
    if (match) return match[1];
  }

  // Method 4: Script tag text (ytInitialPlayerResponse might be server-rendered)
  for (const s of document.querySelectorAll('script:not([src])')) {
    const t = s.textContent;
    if (t && t.includes('channelId')) {
      const m = t.match(/"channelId"\s*:\s*"(UC[\w-]+)"/);
      if (m) return m[1];
    }
  }

  log.debug(MOD, 'Could not find channel ID on video page');
  return null;
}

/**
 * Parse channel handle from the current channel page URL.
 */
export function parseCurrentChannelInfo() {
  const path = location.pathname;
  if (path.startsWith('/@')) {
    return { handle: path.split('/')[1], type: 'handle' };
  }
  if (path.startsWith('/channel/')) {
    return { channelId: path.split('/')[2], type: 'id' };
  }
  if (path.startsWith('/c/') || path.startsWith('/user/')) {
    return { slug: path.split('/')[2], type: 'slug' };
  }
  return null;
}

/**
 * Auto-tag a channel based on keywords from the page.
 */
export function generateChannelTags() {
  const tagMap = {
    '#Tech': ['tech', 'computer', 'software', 'hardware', 'programming', 'code', 'linux', 'developer', 'ai', 'machine learning'],
    '#Gaming': ['game', 'gaming', 'gamer', 'esport', 'twitch', 'playstation', 'xbox', 'nintendo'],
    '#Music': ['music', 'song', 'album', 'concert', 'producer', 'beats'],
    '#Education': ['learn', 'tutorial', 'course', 'lecture', 'education', 'study', 'how to', 'explained'],
    '#Entertainment': ['entertainment', 'comedy', 'funny', 'vlog', 'reaction', 'podcast'],
    '#Science': ['science', 'physics', 'chemistry', 'biology', 'experiment', 'space'],
    '#Finance': ['invest', 'stock', 'crypto', 'finance', 'money', 'trading'],
  };

  const src = [
    document.querySelector('meta[name="keywords"]')?.content || '',
    document.querySelector('#channel-tagline, #description-text')?.textContent || '',
    document.title,
  ].join(' ').toLowerCase();

  const tags = [];
  for (const [tag, kws] of Object.entries(tagMap)) {
    if (kws.some((k) => src.includes(k))) tags.push(tag);
  }
  return tags.slice(0, 4);
}

// ── Utility Functions ─────────────────────────────────────────────────────────

function _getText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (obj.simpleText) return obj.simpleText;
  if (obj.runs) return obj.runs.map((r) => r.text).join('');
  return '';
}

function _parseDurationText(text) {
  if (!text || text === 'LIVE') return text === 'LIVE' ? -1 : 0;
  const parts = text.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(parts[0]) || 0;
}

function _parseViewText(text) {
  if (!text) return 0;
  const clean = text.toLowerCase().replace(/[, views]/g, '').trim();
  if (clean.includes('k')) return Math.round(parseFloat(clean) * 1_000);
  if (clean.includes('m')) return Math.round(parseFloat(clean) * 1_000_000);
  if (clean.includes('b')) return Math.round(parseFloat(clean) * 1_000_000_000);
  return parseInt(clean) || 0;
}

function _relativeToApproxDate(text) {
  if (!text) return '';
  if (text.includes('just now') || text.includes('second')) return new Date().toISOString();

  const now = Date.now();
  const match = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/i);
  if (!match) return '';

  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms = {
    second: 1_000, minute: 60_000, hour: 3_600_000,
    day: 86_400_000, week: 7 * 86_400_000,
    month: 30 * 86_400_000, year: 365 * 86_400_000,
  }[unit] || 0;

  return new Date(now - n * ms).toISOString();
}

/**
 * Format seconds into human-readable duration string.
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format view count into human-readable string.
 */
export function formatViews(count) {
  if (!count) return '0 views';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B views`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}

/**
 * Format a date into a relative time string.
 */
export function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`;
}
