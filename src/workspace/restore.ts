// Pure draft-restore decision logic for the workspace (docs/design-v1.md §10).
//
// When a challenge opens, the workspace asks its reader seam for the stored
// draft. These helpers turn that nullable read into a concrete action and
// merge the draft back onto the starter files without ever trusting the
// draft for read-only bundle contents.

/** What the workspace should do with a stored draft on open. */
export type DraftAction = 'none' | 'restore' | 'seed';

/**
 * Map the stored draft to an open-time action:
 * - `none`: nothing was stored (null/undefined), so just use the starter.
 * - `seed`: an empty stored map; the existing `challengeOpened` seeding
 *   semantics re-apply the starter files.
 * - `restore`: a real draft exists; merge it over the starter files.
 */
export function decideDraftAction(stored: Record<string, string> | null | undefined): DraftAction {
  if (stored === null || stored === undefined) {
    return 'none';
  }
  if (Object.keys(stored).length === 0) {
    return 'seed';
  }
  return 'restore';
}

/**
 * Merge a stored draft onto the starter files. The starter is the base, so
 * read-only files (and any unknown draft paths outside `editablePaths`)
 * always keep their starter content, and tampered drafts can never touch
 * them. Draft entries on editable paths — including editable paths a newer
 * starter no longer lists — overwrite the starter value. Undefined values
 * (possible in older persisted records) are ignored.
 */
export function mergeRestoredFiles(
  starter: Readonly<Record<string, string>>,
  draft: Readonly<Record<string, string>>,
  editablePaths: readonly string[]
): Record<string, string> {
  const editable = new Set(editablePaths);
  const merged: Record<string, string> = { ...starter };
  for (const [path, value] of Object.entries(draft) as [string, string | undefined][]) {
    if (!editable.has(path) || value === undefined) {
      continue;
    }
    merged[path] = value;
  }
  return merged;
}
