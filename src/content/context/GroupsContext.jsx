/**
 * GroupsContext — React Context providing groups, channelMap, settings to all components.
 */
import React, { createContext, useContext } from 'react';
import { useStorageSync } from '../hooks/useStorageSync.js';

const GroupsContext = createContext(null);

export function GroupsProvider({ children }) {
  const store = useStorageSync();
  return (
    <GroupsContext.Provider value={store}>
      {children}
    </GroupsContext.Provider>
  );
}

export function useGroups() {
  const ctx = useContext(GroupsContext);
  if (!ctx) throw new Error('useGroups must be used within GroupsProvider');
  return ctx;
}
