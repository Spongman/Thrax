import type { ReactElement } from 'react'

/** Every icon is a component of no props, so a list can hold one per entry. */
export type Icon = () => ReactElement

/** Addresses: a location marker over its column. */
export function AddressIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M5.5 2 L5.5 14 M10.5 2 L10.5 14 M2 5.5 L14 5.5 M2 10.5 L14 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
		</svg>
	)
}

/** Machine words: two rows of byte cells. */
export function CodeBytesIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1" y="3" width="6" height="4" rx="1" />
			<rect x="9" y="3" width="6" height="4" rx="1" />
			<rect x="1" y="9" width="6" height="4" rx="1" />
			<rect x="9" y="9" width="6" height="4" rx="1" />
		</svg>
	)
}

/** Disassembly: a prompt chevron ahead of instruction text. */
export function DisassemblyIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.5 4 L4 6.5 L1.5 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
			<rect x="6" y="3" width="9" height="1.6" rx="0.8" />
			<rect x="6" y="7" width="6" height="1.6" rx="0.8" />
			<rect x="1" y="11" width="14" height="1.6" rx="0.8" />
		</svg>
	)
}

/** Profile heat map: a flame over the line numbers. */
export function HeatMapIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 1c2.5 3 4.5 4.6 4.5 7.5A4.5 4.5 0 0 1 3.5 8.5C3.5 6.8 4.4 5.6 5.4 4.6c.2 1.3.8 2 1.6 2.2C6.4 4.6 6.8 2.7 8 1z" />
			<path d="M8 14.5a2.4 2.4 0 0 0 2.4-2.4c0-1.4-1.2-2.2-2.4-3.9-1.2 1.7-2.4 2.5-2.4 3.9A2.4 2.4 0 0 0 8 14.5z" fill="var(--surface-input, #1e1e1e)" />
		</svg>
	)
}

/** Line tint: the heat map painted behind the source line as well. */
export function HeatLinesIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1" y="2" width="14" height="2.4" rx="0.8" opacity="0.45" />
			<rect x="1" y="6.8" width="14" height="2.4" rx="0.8" />
			<rect x="1" y="11.6" width="14" height="2.4" rx="0.8" opacity="0.45" />
		</svg>
	)
}

/** Remove: a bin with its lid. */
export function TrashIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3 4.5 L13 4.5 M6 4.5 L6 2.5 L10 2.5 L10 4.5 M4.5 4.5 L5.2 13.5 L10.8 13.5 L11.5 4.5 M7 7 L7 11.5 M9 7 L9 11.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** New file: a page with a plus. */
export function NewFileIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4 1.5 L9.5 1.5 L13 5 L13 14.5 L4 14.5 Z M9.5 1.5 L9.5 5 L13 5 M8.5 7.5 L8.5 12 M6.25 9.75 L10.75 9.75" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Open: a folder. */
export function OpenIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.5 3.5 L6 3.5 L7.5 5 L14.5 5 L14.5 13 L1.5 13 Z M1.5 7.5 L14.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Export: an arrow down into a tray. */
export function ExportIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 1.5 L8 9.5 M4.5 6.5 L8 10 L11.5 6.5 M2 11 L2 14 L14 14 L14 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Save to the gist: an arrow up into a cloud. */
export function UploadIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4.5 12.5 A3 3 0 0 1 4.5 6.5 A4 4 0 0 1 12 7.5 A2.5 2.5 0 0 1 12 12.5 M8 14 L8 8 M5.5 10.5 L8 8 L10.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Save as a new gist: the cloud with a plus. */
export function UploadNewIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4.5 12.5 A3 3 0 0 1 4.5 6.5 A4 4 0 0 1 12 7.5 A2.5 2.5 0 0 1 12 12.5 M8 13 L8 7 M5.5 9.5 L10.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** A new gist project: a page with a plus, under a cloud line. */
export function NewGistIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2 3.5 A2 2 0 0 1 4.5 1.8 A2.5 2.5 0 0 1 9 2.5 A1.6 1.6 0 0 1 9.5 5.5 L3.5 5.5 A2 2 0 0 1 2 3.5 Z M4 7.5 L11 7.5 L13 9.5 L13 14.5 L4 14.5 Z M8.5 9.5 L8.5 13 M6.75 11.25 L10.25 11.25" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/*
 * Running controls.  These were Unicode arrows, which come from whichever
 * fallback font has each one and so sat at a different height apiece; drawn on
 * one 16-unit grid they line up with each other and with everything else.
 */

/** Run, or continue from a pause: a play triangle. */
export function RunIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M5 3.2 L12.6 8 L5 12.8 Z" />
		</svg>
	)
}

/** Pause: the two bars. */
export function PauseIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="4.6" y="3.2" width="2.4" height="9.6" rx="0.7" />
			<rect x="9" y="3.2" width="2.4" height="9.6" rx="0.7" />
		</svg>
	)
}

/** Reset: a circle come almost the whole way back round. */
export function ResetIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 3.4 A4.6 4.6 0 1 0 12.6 8 M10.9 9.7 L12.6 8 L14.3 9.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/*
 * The three ways forward share one shape: the instruction as a dot on the
 * line, and an arrow saying where the step goes.  Stepping back is the step
 * over run the other way, as it is the same move undone.
 */

/** Step over: an arc that clears the call and lands past it. */
export function StepOverIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3.6 9 A4.4 4.4 0 0 1 12.4 9 M10.6 7.4 L12.4 9.6 L14.2 7.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			<circle cx="8" cy="12.4" r="1.7" />
		</svg>
	)
}

/** Step back: the same arc, run the other way. */
export function StepBackIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M12.4 9 A4.4 4.4 0 0 0 3.6 9 M1.8 7.4 L3.6 9.6 L5.4 7.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			<circle cx="8" cy="12.4" r="1.7" />
		</svg>
	)
}

/** Step into: an arrow down onto the call. */
export function StepIntoIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 2.6 L8 9.8 M5.4 7.2 L8 9.9 L10.6 7.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			<circle cx="8" cy="12.8" r="1.7" />
		</svg>
	)
}

/** Step out: an arrow up, away from where the call returns to. */
export function StepOutIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 9.8 L8 2.6 M5.4 5.2 L8 2.5 L10.6 5.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			<circle cx="8" cy="12.8" r="1.7" />
		</svg>
	)
}

/*
 * Menu icons.  One glyph per line of the menu, drawn on the same 16-unit grid
 * as everything above so a list of them reads evenly, and monochrome so a row
 * is one colour whether it is hovered, disabled or plain.
 */

/** Settings: the sliders a preference is set with. */
export function SettingsIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2.2 4.2 L13.8 4.2 M2.2 8 L13.8 8 M2.2 11.8 L13.8 11.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
			<circle cx="5.4" cy="4.2" r="1.7" />
			<circle cx="10.6" cy="8" r="1.7" />
			<circle cx="6.6" cy="11.8" r="1.7" />
		</svg>
	)
}

/** The File menu: a page. */
export function FileMenuIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4 1.5 L9.5 1.5 L13 5 L13 14.5 L4 14.5 Z M9.5 1.5 L9.5 5 L13 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** The Examples menu: a book, open at the middle. */
export function ExamplesIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 4.4 C6.5 3.1 4.4 2.9 2.4 3.1 L2.4 12.1 C4.4 11.9 6.5 12.1 8 13.4 C9.5 12.1 11.6 11.9 13.6 12.1 L13.6 3.1 C11.6 2.9 9.5 3.1 8 4.4 Z M8 4.4 L8 13.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** The Window menu: a pane under its tab bar. */
export function WindowIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.8 2.8 L14.2 2.8 L14.2 13.2 L1.8 13.2 Z M1.8 6 L14.2 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
			<circle cx="4" cy="4.4" r="0.8" />
		</svg>
	)
}

/** The Tools menu: a cog. */
export function ToolsIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
			<path d="M8 1.4 L8 3.2 M8 12.8 L8 14.6 M1.4 8 L3.2 8 M12.8 8 L14.6 8 M3.3 3.3 L4.6 4.6 M11.4 11.4 L12.7 12.7 M12.7 3.3 L11.4 4.6 M4.6 11.4 L3.3 12.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	)
}

/** Files: one page in front of another. */
export function FilesIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M6 1.5 L10.2 1.5 L13 4.3 L13 11.6 L6 11.6 Z M10.2 1.5 L10.2 4.3 L13 4.3 M10 11.6 L10 14.5 L3 14.5 L3 4.6 L6 4.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Open a folder: the folder standing open. */
export function OpenFolderIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.5 12.6 L1.5 3.4 L5.8 3.4 L7.3 5.2 L12.3 5.2 L12.3 7 M1.5 12.6 L3.4 7 L14.5 7 L12.6 12.6 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Save: the disk the metaphor never let go of. */
export function SaveIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2.5 2.5 L11 2.5 L13.5 5 L13.5 13.5 L2.5 13.5 Z M5.2 2.5 L5.2 6.4 L10.4 6.4 L10.4 2.5 M4.6 13.5 L4.6 9.4 L11.4 9.4 L11.4 13.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Save every file: one disk behind another. */
export function SaveAllIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4.6 1.5 L11.6 1.5 L13.8 3.7 L13.8 10.6 M1.5 4.6 L9.4 4.6 L11.6 6.8 L11.6 14.5 L1.5 14.5 Z M3.9 4.6 L3.9 7.9 L8.4 7.9 L8.4 4.6 M3.4 14.5 L3.4 10.9 L9.7 10.9 L9.7 14.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Download a .zip: the archive box, banded and latched. */
export function ArchiveIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.8 2.6 L14.2 2.6 L14.2 6 L1.8 6 Z M3.1 6 L3.1 13.4 L12.9 13.4 L12.9 6 M6.4 8.8 L9.6 8.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Keep in this browser: the window, with the work going into it. */
export function BrowserSaveIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.8 2.8 L14.2 2.8 L14.2 13.2 L1.8 13.2 Z M1.8 5.8 L14.2 5.8 M8 7.4 L8 11.2 M6.1 9.3 L8 11.3 L9.9 9.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Take back out of this browser: the same window, the other way. */
export function BrowserLoadIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.8 2.8 L14.2 2.8 L14.2 13.2 L1.8 13.2 Z M1.8 5.8 L14.2 5.8 M8 11.3 L8 7.5 M6.1 9.4 L8 7.4 L9.9 9.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Copy a share link: the two links of a chain. */
export function LinkIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M6.7 9.3 A2.6 2.6 0 0 1 6.7 5.7 L8.5 3.9 A2.6 2.6 0 0 1 12.1 7.5 L11.2 8.4 M9.3 6.7 A2.6 2.6 0 0 1 9.3 10.3 L7.5 12.1 A2.6 2.6 0 0 1 3.9 8.5 L4.8 7.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Open from a URL: the globe the address points into. */
export function GlobeIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 1.6 A6.4 6.4 0 1 1 8 14.4 A6.4 6.4 0 1 1 8 1.6 Z M1.6 8 L14.4 8 M8 1.6 A8 8 0 0 0 8 14.4 A8 8 0 0 0 8 1.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
		</svg>
	)
}

/** GitHub: the branch a gist is one commit on. */
export function GitBranchIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4.6 5.6 L4.6 10.4 M11.4 6.4 A5 5 0 0 1 6.6 11.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
			<circle cx="4.6" cy="3.6" r="2" />
			<circle cx="4.6" cy="12.4" r="2" />
			<circle cx="11.4" cy="4.4" r="2" />
		</svg>
	)
}

/*
 * The windows, each drawn as what it shows: a table of registers, a stack of
 * frames, and so on, so a name in the menu has a shape to be known by before
 * it is read.
 */

/** Registers: names in one column, what they hold in the other. */
export function RegistersIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1.6" y="2.8" width="4" height="2" rx="1" />
			<rect x="7.2" y="2.8" width="7.2" height="2" rx="1" />
			<rect x="1.6" y="7" width="4" height="2" rx="1" />
			<rect x="7.2" y="7" width="7.2" height="2" rx="1" />
			<rect x="1.6" y="11.2" width="4" height="2" rx="1" />
			<rect x="7.2" y="11.2" width="7.2" height="2" rx="1" />
		</svg>
	)
}

/** The call stack: frames piled up, the innermost marked. */
export function CallStackIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="2" cy="3.7" r="1.3" />
			<rect x="4.8" y="2.4" width="9.6" height="2.6" rx="0.9" />
			<rect x="4.8" y="6.7" width="9.6" height="2.6" rx="0.9" />
			<rect x="4.8" y="11" width="9.6" height="2.6" rx="0.9" />
		</svg>
	)
}

/** Symbols: a name tagged to the address it stands for. */
export function SymbolsIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M2.2 8.6 L8.6 2.2 L13.8 2.2 L13.8 7.4 L7.4 13.8 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
			<circle cx="11.1" cy="4.9" r="1.2" />
		</svg>
	)
}

/** Memory: the chip, pins out both sides. */
export function MemoryIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4.2 4.2 L11.8 4.2 L11.8 11.8 L4.2 11.8 Z M6.4 6.4 L9.6 6.4 L9.6 9.6 L6.4 9.6 Z M6.2 4.2 L6.2 1.8 M9.8 4.2 L9.8 1.8 M6.2 11.8 L6.2 14.2 M9.8 11.8 L9.8 14.2 M4.2 6.2 L1.8 6.2 M4.2 9.8 L1.8 9.8 M11.8 6.2 L14.2 6.2 M11.8 9.8 L14.2 9.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** The console: a prompt waiting on a line of its own. */
export function ConsoleIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.6 2.8 L14.4 2.8 L14.4 13.2 L1.6 13.2 Z M4.4 6.2 L6.8 8.4 L4.4 10.6 M8.6 10.6 L11.8 10.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** History: the clock, with the hand able to go back. */
export function HistoryIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3 8.4 A5.2 5.2 0 1 1 4.7 12.3 M1.2 6.4 L3 8.6 L5.2 7 M8 5.4 L8 8.8 L10.5 10.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/*
 * The tools, each drawn as the thing it watches: the pixels, the keys, the
 * counts, the blocks, the branches, and the rest.
 */

/** The bitmap display: memory as pixels. */
export function BitmapIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
			<rect x="4.2" y="4.2" width="3.6" height="3.6" />
			<rect x="8.2" y="8.2" width="3.6" height="3.6" />
		</svg>
	)
}

/** Keyboard and display: the keys the program is fed from. */
export function KeyboardIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1.4" y="4" width="13.2" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
			<path d="M3.9 6.6 L4 6.6 M6.1 6.6 L6.2 6.6 M8.3 6.6 L8.4 6.6 M10.5 6.6 L10.6 6.6 M12.5 6.6 L12.6 6.6 M3.9 9.4 L4 9.4 M12.5 9.4 L12.6 9.4 M6.4 9.4 L9.9 9.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

/** Instruction statistics: the counts as bars. */
export function StatisticsIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="2.2" y="8.2" width="2.8" height="5.6" rx="0.8" />
			<rect x="6.6" y="4.4" width="2.8" height="9.4" rx="0.8" />
			<rect x="11" y="6.4" width="2.8" height="7.4" rx="0.8" />
		</svg>
	)
}

/** The cache: blocks stacked between the program and memory. */
export function CacheIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 1.8 L14.6 5 L8 8.2 L1.4 5 Z M1.4 8 L8 11.2 L14.6 8 M1.4 11 L8 14.2 L14.6 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** The branch history table: the two ways a branch can go. */
export function BranchHistoryIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 14.2 L8 9.2 C8 6.4 5 6.2 5 3.4 M8 9.2 C8 6.4 11 6.2 11 3.4 M3.4 5.2 L5 3.2 L6.6 5.2 M9.4 5.2 L11 3.2 L12.6 5.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Memory reference: the grid, with the region being worked lit. */
export function MemoryReferenceIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.8 1.8 L14.2 1.8 L14.2 14.2 L1.8 14.2 Z M6 1.8 L6 14.2 M10 1.8 L10 14.2 M1.8 6 L14.2 6 M1.8 10 L14.2 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
			<rect x="6" y="6" width="4" height="4" />
		</svg>
	)
}

/** The pipeline: the stages an instruction is handed along. */
export function PipelineIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.2 5.6 L4.6 5.6 L4.6 10.4 L1.2 10.4 Z M6.3 5.6 L9.7 5.6 L9.7 10.4 L6.3 10.4 Z M11.4 5.6 L14.8 5.6 L14.8 10.4 L11.4 10.4 Z M4.6 8 L6.3 8 M9.7 8 L11.4 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
		</svg>
	)
}

/** The X-ray: the datapath looked into. */
export function XRayIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M6.9 2.3 A4.6 4.6 0 1 1 6.9 11.5 A4.6 4.6 0 1 1 6.9 2.3 Z M10.3 10.3 L14.2 14.2 M4.6 6.9 L9.2 6.9 M6.9 4.6 L6.9 9.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Mars Bot: the bot the five registers drive. */
export function BotIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 4.6 L8 2.6 M3.2 4.6 L12.8 4.6 L12.8 12 L3.2 12 Z M5.6 12 L5.6 13.8 M10.4 12 L10.4 13.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
			<circle cx="8" cy="2" r="1.1" />
			<circle cx="6" cy="8.2" r="1.1" />
			<circle cx="10" cy="8.2" r="1.1" />
		</svg>
	)
}

/** The scavenger hunt: the flag at what is still to be reached. */
export function ScavengerIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4 14.2 L4 1.8 M4 2.6 L12.6 2.6 L10.5 5.7 L12.6 8.8 L4 8.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** The digital lab: a seven-segment digit, every segment lit. */
export function DigitalLabIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M5.4 2.4 L10.6 2.4 M4.6 3.2 L4.6 7.2 M11.4 3.2 L11.4 7.2 M5.4 8 L10.6 8 M4.6 8.8 L4.6 12.8 M11.4 8.8 L11.4 12.8 M5.4 13.6 L10.6 13.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

/*
 * The examples, each drawn as what its program is about.  Two of them drive a
 * tool and wear that tool's own glyph, since that is what they are for.
 */

/** Interactive input: the caret waiting in a field. */
export function InputIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.6 4.2 L14.4 4.2 L14.4 11.8 L1.6 11.8 Z M4.4 6.6 L4.4 9.4 M6.4 9.4 L11 9.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Hello: the string said out loud. */
export function HelloIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.8 3 L14.2 3 L14.2 10.4 L7.2 10.4 L4.4 13.4 L4.4 10.4 L1.8 10.4 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** A sum: the sign the running total is kept under. */
export function SumIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M11.6 3 L4.4 3 L8.4 8 L4.4 13 L11.6 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** A factorial: what it does to a number, one step at a time. */
export function FactorialIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.8 13.6 L1.8 11 L5.6 11 L5.6 7.6 L9.4 7.6 L9.4 4.2 L13.2 4.2 L13.2 1.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** Fibonacci: the spiral the ratio settles into. */
export function FibonacciIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M13.8 11.2 A5.8 5.8 0 0 0 8 5.4 A3.6 3.6 0 0 0 8 12.6 A2.2 2.2 0 0 0 10.2 10.4 A1.4 1.4 0 0 0 8.8 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	)
}

/** Ackermann: a call inside a call inside a call. */
export function RecursionIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.6 1.6 L14.4 1.6 L14.4 14.4 L1.6 14.4 Z M4.4 4.4 L11.6 4.4 L11.6 11.6 L4.4 11.6 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
			<rect x="6.9" y="6.9" width="2.2" height="2.2" />
		</svg>
	)
}

/** A loop: round again until it is done. */
export function LoopIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 3.4 A4.6 4.6 0 1 1 3.4 8 M1.7 9.7 L3.4 8 L5.1 9.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

/** The coprocessors: the second processor beside the first. */
export function CoprocessorIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.4 4.4 L7 4.4 L7 11.6 L1.4 11.6 Z M9 4.4 L14.6 4.4 L14.6 11.6 L9 11.6 Z M7 8 L9 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
		</svg>
	)
}

/** Bitwise work: the bits themselves, some set and some clear. */
export function BitwiseIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1.4" y="3" width="13.2" height="4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
			<rect x="1.4" y="9" width="13.2" height="4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
			<circle cx="4.4" cy="5" r="1.2" />
			<circle cx="11.6" cy="11" r="1.2" />
		</svg>
	)
}

/** Macros: written once, between the braces, and used many times. */
export function MacrosIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M6.2 2.4 C4.6 2.4 5 7 3.2 8 C5 9 4.6 13.6 6.2 13.6 M9.8 2.4 C11.4 2.4 11 7 12.8 8 C11 9 11.4 13.6 9.8 13.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	)
}

/** The Mandelbrot set: the cardioid and the bulb beside it. */
export function MandelbrotIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M12.6 8 C12.6 11.2 10.9 13.4 8.8 13.4 C6.6 13.4 5 11.2 5 8 C5 4.8 6.6 2.6 8.8 2.6 C10.9 2.6 12.6 4.8 12.6 8 Z" />
			<circle cx="3.2" cy="8" r="2" />
		</svg>
	)
}
