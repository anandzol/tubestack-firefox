/**
 * EmojiPicker — Lightweight emoji picker for group icons.
 * Curated set of ~60 emojis across categories.
 */
import React, { useState, useRef, useEffect } from 'react';

const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😎', '🤓', '🔥', '⭐', '💡', '❤️', '💪', '🎯', '🚀'],
  'Tech': ['💻', '🖥️', '⌨️', '🎮', '📱', '🔧', '⚙️', '🤖', '🧠', '📡'],
  'Media': ['🎬', '🎵', '📺', '🎨', '📸', '🎙️', '📻', '🎧', '🎭', '📰'],
  'Nature': ['🌍', '🌊', '🌲', '🌸', '🐱', '🐕', '🦊', '🐸', '🦅', '🌙'],
  'Objects': ['💰', '💎', '🏆', '🎓', '📚', '✏️', '🔬', '🧪', '⚡', '🛡️'],
  'Symbols': ['✅', '❌', '⚠️', '💬', '🏷️', '📌', '🔖', '🏁', '♻️', '🔔'],
};

export default function EmojiPicker({ onSelect, onClose }) {
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const pickerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div className="ytsm-emoji-picker" ref={pickerRef}>
      <div className="ytsm-emoji-categories">
        {Object.keys(EMOJI_CATEGORIES).map(cat => (
          <button
            key={cat}
            className={`ytsm-emoji-cat-btn ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat)}
            title={cat}
          >
            {EMOJI_CATEGORIES[cat][0]}
          </button>
        ))}
      </div>
      <div className="ytsm-emoji-grid">
        {EMOJI_CATEGORIES[activeCategory].map(emoji => (
          <button
            key={emoji}
            className="ytsm-emoji-btn"
            onClick={() => {
              onSelect?.(emoji);
              onClose?.();
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <button
        className="ytsm-emoji-clear-btn"
        onClick={() => {
          onSelect?.(null); // Clear custom icon → back to letter
          onClose?.();
        }}
      >
        Reset to letter
      </button>
    </div>
  );
}
