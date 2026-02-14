/**
 * Utility functions for working with registered groups.
 * Eliminates duplicate group resolution patterns across the codebase.
 */

import type { RegisteredGroup } from './types.js';

/**
 * Find a group's JID by its folder name
 * @param registeredGroups - Map of JID -> RegisteredGroup
 * @param folder - Folder name to search for
 * @returns JID if found, undefined otherwise
 */
export function findJidByFolder(
  registeredGroups: Record<string, RegisteredGroup>,
  folder: string
): string | undefined {
  return Object.entries(registeredGroups).find(([, g]) => g.folder === folder)?.[0];
}

/**
 * Find a group entry (JID and config) by folder name
 * @param registeredGroups - Map of JID -> RegisteredGroup
 * @param folder - Folder name to search for
 * @returns Tuple of [jid, group] if found, undefined otherwise
 */
export function findGroupByFolder(
  registeredGroups: Record<string, RegisteredGroup>,
  folder: string
): [string, RegisteredGroup] | undefined {
  return Object.entries(registeredGroups).find(([, g]) => g.folder === folder);
}

/**
 * Find the main group's JID (folder === 'main')
 * @param registeredGroups - Map of JID -> RegisteredGroup
 * @returns Main group JID if found, undefined otherwise
 */
export function findMainGroupJid(registeredGroups: Record<string, RegisteredGroup>): string | undefined {
  return Object.entries(registeredGroups).find(([, g]) => g.folder === 'main')?.[0];
}

/**
 * Check if a folder is the main group
 * @param folder - Folder name to check
 * @returns true if folder is 'main'
 */
export function isMainGroup(folder: string): boolean {
  return folder === 'main';
}
