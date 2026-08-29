import { useSyncExternalStore } from 'react';

const DARK_SCHEMED = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_SCHEMED);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function getSnapshot(): boolean {
  return window.matchMedia(DARK_SCHEMED).matches;
}

/**
 * True while the OS/browser prefers a dark color scheme. Backed by
 * useSyncExternalStore so 'auto' editor themes follow live media-query
 * changes without a reload.
 */
export function useSystemTheme(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
