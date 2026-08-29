export type ErrorDetailLevel = 'hidden' | 'preview' | 'full';

/** Three-step disclosure: hidden -> 3-line preview -> 10-line scroller -> hidden. */
export function nextErrorDetailLevel(level: ErrorDetailLevel): ErrorDetailLevel {
  if (level === 'hidden') {
    return 'preview';
  }
  if (level === 'preview') {
    return 'full';
  }
  return 'hidden';
}

/** Keeps preview content small even before CSS applies its visual line clamp. */
export function errorPreview(error: string, lines = 3): string {
  const parts = error.split('\n');
  if (parts.length <= lines) {
    return error;
  }
  return `${parts.slice(0, lines).join('\n')}\n…`;
}
