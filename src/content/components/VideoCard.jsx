/**
 * VideoCard — Reusable video card component.
 * Renders thumbnail, title, channel, duration, views, and time ago.
 */
import React from 'react';
import { formatDuration, formatViews, formatTimeAgo } from '../utils/youtube-api.js';

export default function VideoCard({ video, watched, onToggleWatched }) {
  const thumbnail = video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
  const duration = formatDuration(video.duration);
  const views = formatViews(video.viewCount);
  const timeAgo = formatTimeAgo(video.publishedAt);

  const handleClick = (e) => {
    // Don't navigate if clicking the watched button
    if (e.target.closest('.ytsm-video-watched-btn')) return;
    window.open(`https://www.youtube.com/watch?v=${video.videoId}`, '_blank');
  };

  return (
    <div className="ytsm-video-card" onClick={handleClick}>
      <div className="ytsm-video-thumb-wrapper">
        <img
          src={thumbnail}
          alt={video.title}
          loading="lazy"
        />
        {duration && (
          <span className="ytsm-video-duration">{duration}</span>
        )}
        {video.isLive && (
          <span className="ytsm-video-duration" style={{ background: '#c00' }}>LIVE</span>
        )}
        {onToggleWatched && (
          <button
            className={`ytsm-video-watched-btn ${watched ? 'watched' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleWatched(video.videoId); }}
            title={watched ? 'Mark as unwatched' : 'Mark as watched'}
          >
            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
          </button>
        )}
      </div>
      <a
        className="ytsm-video-title"
        href={`https://www.youtube.com/watch?v=${video.videoId}`}
        onClick={(e) => e.stopPropagation()}
        title={video.title}
      >
        {video.title}
      </a>
      <div className="ytsm-video-meta">
        <a 
          className="ytsm-video-channel-link"
          href={video.channelId ? `https://www.youtube.com/channel/${video.channelId}` : '#'}
          onClick={(e) => e.stopPropagation()}
        >
          {video.channelName || 'Unknown Channel'}
        </a>
        <span> • {views}</span>
        {timeAgo && <span> • {timeAgo}</span>}
      </div>
    </div>
  );
}

/** Skeleton loading card */
export function VideoCardSkeleton() {
  return (
    <div className="ytsm-video-card">
      <div className="ytsm-skeleton ytsm-skeleton-thumb"></div>
      <div className="ytsm-skeleton ytsm-skeleton-text"></div>
      <div className="ytsm-skeleton ytsm-skeleton-text-sm"></div>
    </div>
  );
}
