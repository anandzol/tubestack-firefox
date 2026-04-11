/**
 * MastheadButton — "TubeStack" button injected into YouTube's masthead (#end area).
 * Opens the Dashboard on click.
 */
import React from 'react';

export default function MastheadButton({ onClick }) {
  return (
    <div className="ytsm-reset ysm-tags" style={{ display: 'flex', alignItems: 'center' }}>
      <button
        className="yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading-trailing yt-spec-button-shape-next--disable-text-ellipsis yt-spec-button-shape-next--enable-backdrop-filter-experiment"
        onClick={onClick}
        title="Manage Subscription Groups"
        style={{ cursor: 'pointer' }}
      >
        <img 
          src={chrome.runtime.getURL('assets/icons/icon48.png')} 
          style={{ width: 24, height: 24, marginRight: 6, borderRadius: '4px' }} 
          alt="TubeStack" 
        />
        <div className="yt-spec-button-shape-next__button-text-content">
          <span className="yt-core-attributed-string yt-core-attributed-string--white-space-no-wrap" role="text"
            style={{ color: 'var(--iron-icon-fill-color, var(--yt-spec-text-primary))' }}>
            TubeStack
          </span>
        </div>
      </button>
    </div>
  );
}
