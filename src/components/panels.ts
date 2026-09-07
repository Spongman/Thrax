import type { Icon } from './icons'
import { BitmapIcon, BotIcon, BranchHistoryIcon, CacheIcon, CallStackIcon, ConsoleIcon, DigitalLabIcon, FilesIcon, HistoryIcon, KeyboardIcon, MemoryIcon, MemoryReferenceIcon, PipelineIcon, RegistersIcon, ScavengerIcon, StatisticsIcon, SymbolsIcon, XRayIcon } from './icons'

/**
 * Every dock panel, and what the menu and the default layout each need to know
 * about it.
 *
 * One list rather than two: a panel added here appears in its menu and can be
 * opened without anything else being touched, and the default layout cannot
 * drift from what the menu offers.
 *
 * Every window is open on a fresh workspace; a tool waits to be asked for, and
 * its code is fetched when it is: a tool nobody opened costs neither a tab nor
 * a download.  A window only reads the machine, so having it open costs the
 * run nothing; a tool watches the run through the observer seam and does.
 */

export type PanelGroup = 'window' | 'tool'

/** Which of the two groups a panel joins when the menu opens it. */
export type PanelDock = 'side' | 'bottom'

export interface PanelSpec {
	id: string
	/** The glyph the menu shows beside the name, so a panel is known by shape too. */
	icon: Icon
	/** What the tab reads, kept short enough to sit beside its neighbours. */
	title: string
	/** What the menu reads, where there is room for the whole name. */
	menuTitle?: string
	/**
	 * What a tool watches and what it draws, in one line.  The menu is where a
	 * tool is described now: a page about the tools is one more thing to open
	 * and to keep current, and it said nothing that does not belong beside the
	 * name being chosen.
	 */
	description?: string
	group: PanelGroup
	dock: PanelDock
	/** Open on a fresh workspace.  Every window is; no tool starts by itself. */
	initial?: true
}

/**
 * Windows are the workspace's own views of the machine; tools watch a run
 * through the observer seam and are the ported MARS tool set.
 */
export const PANELS: readonly PanelSpec[] = [
	{ id: 'registers', icon: RegistersIcon, title: 'Registers', group: 'window', dock: 'side', initial: true },
	{ id: 'callStack', icon: CallStackIcon, title: 'Call Stack', group: 'window', dock: 'side', initial: true },
	{ id: 'files', icon: FilesIcon, title: 'Files', group: 'window', dock: 'side', initial: true },
	{ id: 'symbols', icon: SymbolsIcon, title: 'Symbols', menuTitle: 'Symbol Table', group: 'window', dock: 'side', initial: true },
	{ id: 'memory', icon: MemoryIcon, title: 'Memory', group: 'window', dock: 'bottom', initial: true },
	{ id: 'console', icon: ConsoleIcon, title: 'Console', group: 'window', dock: 'bottom', initial: true },
	{ id: 'history', icon: HistoryIcon, title: 'History', menuTitle: 'Execution History', group: 'window', dock: 'bottom', initial: true },

	{
		id: 'bitmap', icon: BitmapIcon, title: 'Bitmap', menuTitle: 'Bitmap Display', group: 'tool', dock: 'side',
		description: 'Word-addressed memory drawn as 24-bit RGB pixels, at a base address and scale you choose.',
	},
	{
		id: 'keyboardDisplay', icon: KeyboardIcon, title: 'Keyboard / Display', menuTitle: 'Keyboard and Display MMIO', group: 'tool', dock: 'side',
		description: 'The memory-mapped device registers: keyboard input you queue, and what the transmitter has sent.',
	},
	{
		id: 'statistics', icon: StatisticsIcon, title: 'Statistics', menuTitle: 'Instruction Statistics', group: 'tool', dock: 'side',
		description: 'How many instructions ran in each category, and the count for every mnemonic, most frequent first.',
	},
	{
		id: 'cache', icon: CacheIcon, title: 'Cache', menuTitle: 'Cache Simulator', group: 'tool', dock: 'side',
		description: 'Hit rate and block contents for a configurable block count, block size, associativity and replacement policy.',
	},
	{
		id: 'branchHistory', icon: BranchHistoryIcon, title: 'Branches', menuTitle: 'Branch History Table', group: 'tool', dock: 'side',
		description: 'Every conditional branch: each entry’s saturating counter, its prediction, and the accuracy so far.',
	},
	{
		id: 'memoryReference', icon: MemoryReferenceIcon, title: 'Memory Reference', menuTitle: 'Memory Reference Visualization', group: 'tool', dock: 'side',
		description: 'Every data read and write as a colour-coded grid, so the busiest region of memory stands out.',
	},
	{
		id: 'pipeline', icon: PipelineIcon, title: 'Pipeline', menuTitle: 'Pipeline Model', group: 'tool', dock: 'bottom',
		description: 'Where each instruction would sit in a classic five-stage pipeline, what the machine holds on a chosen cycle, and what the hazards between them cost.',
	},
	{
		id: 'xray', icon: XRayIcon, title: 'X-Ray', menuTitle: 'MIPS X-Ray Datapath', group: 'tool', dock: 'bottom',
		description: 'The datapath, control unit, ALU control and register bank, with the instruction at the pc animated through them.',
	},
	{
		id: 'marsBot', icon: BotIcon, title: 'Mars Bot', group: 'tool', dock: 'bottom',
		description: 'A bot driven by five memory-mapped registers: its heading, where it has reached, and the trail behind it.',
	},
	{
		id: 'scavengerHunt', icon: ScavengerIcon, title: 'Scavenger Hunt', group: 'tool', dock: 'bottom',
		description: 'Each player’s position, energy and score, the locations still to visit, and the writes that broke the rules.',
	},
	{
		id: 'digitalLab', icon: DigitalLabIcon, title: 'Digital Lab', menuTitle: 'Digital Lab Simulator', group: 'tool', dock: 'bottom',
		description: 'Two seven-segment displays, a hexadecimal keypad, and a counter that raises a timer interrupt.',
	},
]

/** The panels one menu lists, in the order they are shown. */
export function panelsIn(group: PanelGroup): PanelSpec[] {
	return PANELS.filter((panel) => panel.group === group)
}

/** What a fresh workspace opens, and all that the first bundle has to carry. */
export const INITIAL_PANELS: readonly PanelSpec[] = PANELS.filter((panel) => panel.initial)

export function panelById(id: string): PanelSpec | undefined {
	return PANELS.find((panel) => panel.id === id)
}

/** How the menu names a panel: its full name where it has one. */
export function menuLabel(panel: PanelSpec): string {
	return panel.menuTitle ?? panel.title
}
