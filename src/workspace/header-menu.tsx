// Single-line header menu: a gear icon button that opens a popover holding the
// editor settings and progress import/export rows. The open state is fully
// self-managed; closing happens on outside pointer-down or Escape, and focus
// returns to the trigger so aria-expanded settles to false. When storage is
// unavailable the trigger shows an orange dot and the popover carries the
// warning as a red status row instead of a page-level banner.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ProgressIO } from './progress-io.tsx';
import type { ProgressIOProps } from './progress-io.tsx';
import { SettingsBar } from './settings-bar.tsx';
import type { SettingsBarProps } from './settings-bar.tsx';

export interface HeaderMenuProps {
  storageAvailable: boolean;
  /** Settings row props, passed straight through; null hides the Editor row. */
  settings: SettingsBarProps | null;
  /** Progress row props, passed straight through. */
  progress: ProgressIOProps;
}

const POPOVER_ID = 'header-menu-popover';

export function HeaderMenu({ storageAvailable, settings, progress }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (root === null || !(target instanceof Node) || root.contains(target)) {
        return;
      }
      const focusWasInside = root.contains(document.activeElement);
      setOpen(false);
      if (focusWasInside) {
        buttonRef.current?.focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAndRestoreFocus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, closeAndRestoreFocus]);

  return (
    <div className="header-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="header-menu-trigger"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={open ? POPOVER_ID : undefined}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        <svg
          className="header-menu-icon"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z" />
        </svg>
        {!storageAvailable && <span className="header-menu-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="header-menu-popover" id={POPOVER_ID}>
          {!storageAvailable && (
            <p className="header-menu-storage" role="status">
              Local storage unavailable — progress won&apos;t be saved
            </p>
          )}
          {settings !== null && (
            <div className="header-menu-row">
              <span className="header-menu-row-label">Editor</span>
              <SettingsBar {...settings} />
            </div>
          )}
          <div className="header-menu-row">
            <span className="header-menu-row-label">Progress</span>
            <ProgressIO {...progress} />
          </div>
        </div>
      )}
    </div>
  );
}
