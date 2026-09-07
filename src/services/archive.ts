/**
 * A workspace as a `.zip`: every file at the top level, plus a manifest naming
 * the file in front and the multi-file setting.  Reading one back accepts any
 * archive of sources, including one with a folder around everything, so a zip
 * made elsewhere opens too.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { toWorkspaceDocument, WORKSPACE_MANIFEST, workspaceFromFiles, type WorkspaceFile, type WorkspaceSnapshot } from './workspace'

export function zipWorkspace(snapshot: WorkspaceSnapshot): Uint8Array {
	const entries: Record<string, Uint8Array> = {}
	for (const file of snapshot.files) entries[file.title] = strToU8(file.code)
	entries[WORKSPACE_MANIFEST] = strToU8(JSON.stringify(toWorkspaceDocument(snapshot), null, '\t'))
	return zipSync(entries, { level: 6 })
}

/** Archive housekeeping nobody asked to open. */
function isNoise(path: string): boolean {
	const segments = path.split('/')
	return segments.some((segment) => segment === '__MACOSX' || segment.startsWith('.')) || path.endsWith('/')
}

/**
 * Strips the one folder every entry sits inside, so `project/main.asm` is
 * opened as `main.asm` and `.include "main.asm"` still finds it.
 */
export function stripCommonFolder(paths: readonly string[]): string[] {
	const split = paths.map((path) => path.split('/'))
	while (split.every((segments) => segments.length > 1) && new Set(split.map((segments) => segments[0])).size === 1) {
		for (const segments of split) segments.shift()
	}
	return split.map((segments) => segments.join('/'))
}

export function unzipFiles(bytes: Uint8Array): WorkspaceFile[] {
	const entries = Object.entries(unzipSync(bytes)).filter(([path]) => !isNoise(path))
	const titles = stripCommonFolder(entries.map(([path]) => path))
	return entries.map(([, data], index) => ({ title: titles[index], code: strFromU8(data) }))
}

/** The workspace an archive holds, or null when there is nothing in it to open. */
export function unzipWorkspace(bytes: Uint8Array): WorkspaceSnapshot | null {
	return workspaceFromFiles(unzipFiles(bytes))
}

export function isZipName(name: string): boolean {
	return name.toLowerCase().endsWith('.zip')
}

/** `PK\x03\x04`: the header every zip starts with. */
export function looksLikeZip(bytes: Uint8Array): boolean {
	return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}
