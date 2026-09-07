import React from 'react'
import './MemoryView.css'
import './ToggleGroup.css'
import type { MemoryView as Memory } from '../core/types'
import { formatHex, formatWord, parseWord } from '../core/format'
import { disassemble } from '../core/disassembler'
import { nextToggles } from './toggleGroup'
import HexNumber, { HexWord, dimmedDigits } from './HexNumber'
import EditableCell from './EditableCell'
import { parseEditedValue } from './editValue'
import { flashClass, useChangedEntries, useFlash } from './highlight'
import { MEMORY_CONFIGURATIONS, type HexDimming, type MemoryConfigurationValues } from '../core/settings'
import { useTHRAXStore } from '../store/thraxStore'
import { isFlagSet, isOneOf, useStoredState } from '../hooks/useStoredState'
import { rowTop, rowWindow, useFixedRowScroller } from './rowWindow'

interface MemoryViewProps {
	memory: Memory
	/** Address of the instruction about to execute, or null when there is none. */
	pc: number | null
	/** Return addresses of the live call stack frames. */
	returnAddresses: Set<number>
	/** Address to scroll to when it changes, from a selected call stack frame. */
	focusAddress: number | null
	/** The address under the pointer anywhere in the workspace, lit here too. */
	hoveredAddress?: number | null
	/**
	 * Bumped each time a panel asks for an address, so asking for the one
	 * already shown brings it back into view rather than doing nothing.
	 */
	focusRequest?: number
	/** Off while a program runs; on, a word can be typed over. */
	editable?: boolean
	/** Writes one aligned word, returning false when the machine refused it. */
	onEditWord?: (address: number, value: number) => boolean
	onHoverAddress: (address: number | null) => void
}

interface MemorySection { id: string; label: string; start: number; end: number }

const SECTION_IDS = ['text', 'data', 'heap', 'stack', 'kdata', 'mmio']

/**
 * Memory map segments, ordered as they appear in the address space.  The
 * configuration draws every boundary but one: it gives the heap and the stack a
 * single region, since they grow towards each other.  They are shown apart, so
 * the stack takes the top eighth of that span and the heap the rest.
 */
export function sectionsFor(layout: MemoryConfigurationValues): MemorySection[] {
	// Unsigned: a bitwise AND alone would turn the top of the address space negative.
	const word = (address: number) => (address & ~3) >>> 0
	const stackStart = word(layout.stackBaseAddress - (layout.stackBaseAddress - layout.heapBaseAddress) / 8)
	return [
		{ id: 'text', label: '.text', start: layout.textBaseAddress, end: layout.textLimitAddress },
		{ id: 'data', label: '.data', start: layout.dataBaseAddress, end: layout.heapBaseAddress - 4 },
		{ id: 'heap', label: 'heap', start: layout.heapBaseAddress, end: stackStart - 4 },
		{ id: 'stack', label: 'stack', start: stackStart, end: layout.stackBaseAddress },
		{ id: 'kdata', label: 'kernel', start: layout.kernelBaseAddress, end: layout.memoryMapBaseAddress - 4 },
		{ id: 'mmio', label: 'MMIO', start: layout.memoryMapBaseAddress, end: word(layout.memoryMapLimitAddress) },
	]
}

const GROUP_SIZES = [1, 2, 4, 8]
const ROW_HEIGHT = 18
/** Rows kept in the scroll region; large sections are windowed around the current address. */
const MAX_WINDOW_ROWS = 16384
const ADDRESS_COLUMNS = 12
const OVERSCAN_ROWS = 6

const formatAddress = formatWord

const sectionForAddress = (sections: MemorySection[], address: number) =>
	sections.find((section) => address >= section.start && address <= section.end)

/** Little-endian byte read against the word-indexed memory view. */
const byteAt = (memory: Memory, address: number) => {
	const word = memory.words.get(address >>> 2) ?? 0
	return (word >>> ((address & 3) * 8)) & 0xff
}

const isPrintable = (byte: number) => byte >= 0x20 && byte <= 0x7e

/**
 * A byte that cannot be printed is named by what it does, not by its letters:
 * the arrows say which way the cursor moves, the bell is a bell.  Codes with no
 * such convention fall back to the Control Pictures block, which at least spells
 * the mnemonic.  Everything here is chosen to sit in a monospace column.
 */
const NAMED_ICONS: Record<number, string> = {
	// NUL fills whole pages of untouched memory, so it gets the quietest mark
	// there is: anything with more ink turns a zeroed region into noise.
	0x00: '·',
	0x07: '⍾', // BEL, bell symbol
	0x08: '⌫', // BS, erase to the left
	0x09: '⇥', // TAB, arrow to bar
	0x0a: '↓', // LF, down
	0x0b: '↧', // VT, down from bar
	0x0c: '⇟', // FF, page down
	0x0d: '↤', // CR, left to bar
	0x1b: '⎋', // ESC
	0x7f: '⌦', // DEL, erase to the right
}

/** The C0 names, in code order, so a control byte can be read out by name. */
const CONTROL_NAMES = [
	'NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL',
	'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI',
	'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB',
	'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US',
]

/**
 * What to call a byte in the tooltip.  A control code has a name worth more
 * than its glyph, the high half has none, and a space is easy to mistake for
 * nothing at all.
 */
export function asciiName(byte: number): string | null {
	if (byte < CONTROL_NAMES.length) return CONTROL_NAMES[byte]
	if (byte === 0x20) return 'SP'
	if (byte === 0x7f) return 'DEL'
	return null
}

export function toIcon(byte: number): string {
	const named = NAMED_ICONS[byte]
	if (named !== undefined) return named
	// The C0 codes all have a picture; nothing names the high half.
	if (byte <= 0x1f) return String.fromCharCode(0x2400 + byte)
	return '▯'
}

const toPrintable = (byte: number, icons: boolean) =>
	isPrintable(byte) ? String.fromCharCode(byte) : icons ? toIcon(byte) : '.'

/** A single byte reads as its character, or as its name beside the icon for it. */
function describeByte(byte: number): string {
	const name = asciiName(byte)
	if (name === null) return isPrintable(byte) ? `'${String.fromCharCode(byte)}'` : toIcon(byte)
	return isPrintable(byte) ? `'${String.fromCharCode(byte)}' ${name}` : `${name} (${toIcon(byte)})`
}

const toHex = (byte: number) => formatHex(byte, 2)

/** Little-endian value of a byte run; BigInt keeps 8-byte groups exact. */
const groupValue = (bytes: number[]) => {
	let value = 0n
	for (let index = bytes.length - 1; index >= 0; index--) value = (value << 8n) | BigInt(bytes[index])
	return value
}

interface HoverRange { start: number, size: number, rect: { left: number, top: number, bottom: number } }
interface MemoryByte { address: number, value: number }
interface MemoryGroup { start: number, bytes: MemoryByte[], zero: boolean, leadingZeros: number, value: number | null }
interface MemoryRowData { address: number, groups: MemoryGroup[], bytes: MemoryByte[] }

const MemoryRow = React.memo(function MemoryRow({ row, top, left, width, groupSize, showAscii, showIcons, hexDimming, hover, pc, returnAddresses, editable, onEditWord, pointed, flashed, changed }: {
	row: MemoryRowData
	top: number
	left: number
	width: number
	groupSize: number
	showAscii: boolean
	showIcons: boolean
	hexDimming: HexDimming
	hover: HoverRange | null
	pc: number | null
	returnAddresses: Set<number>
	editable: boolean
	onEditWord?: (address: number, value: number) => boolean
	/** The address under the pointer, wherever in the workspace it is being pointed at. */
	pointed: number | null
	/** The word a navigation landed on, lit until it fades. */
	flashed: number | null
	/** Words the last step moved, lit in the other colour. */
	changed: ReadonlySet<string>
}) {
	const isHovered = (address: number) => hover !== null && address >= hover.start && address < hover.start + hover.size

	return (
		<div className="memory-row" style={{ top, left, width }}>
			<span className={`memory-row-address${pointed !== null && pointed >= row.address && pointed < row.address + row.bytes.length ? ' address-hovered' : ''}`}>
				<HexNumber text={formatAddress(row.address)} />
			</span>
			<span className="memory-row-groups">
				{row.groups.map((group, groupIndex) => {
					const digits = group.bytes.length * 2
					// A word is what the machine writes, so only a four-byte group is
					// a cell an edit can land in whole.
					const writable = editable && onEditWord !== undefined && groupSize === 4 && group.start % 4 === 0
					const groupText = [...group.bytes].reverse().map((byte) => toHex(byte.value)).join('')
					return (
					<EditableCell
						key={groupIndex}
						text={groupText}
						title={`${formatAddress(group.start)}`}
						editable={writable}
						address={group.start}
						size={groupSize}
						onCommit={(typed) => {
							const value = parseEditedValue(typed, '0x')
							return value !== null && (onEditWord?.(group.start, value) ?? false)
						}}
						className={[
							'memory-group',
							group.zero ? 'zero' : '',
							group.start === pc ? 'current-instruction' : '',
							returnAddresses.has(group.start) ? 'return-address' : '',
							group.value !== null && returnAddresses.has(group.value) ? 'return-slot' : '',
							// The address itself, or a word holding it: both are places
							// the hovered address appears, so both light.
							group.start === pointed || (group.value !== null && group.value === pointed) ? 'address-hovered' : '',
							// Navigation wins where both apply: the click is the more
							// recent thing, and one colour on a cell reads better than two.
							group.start === flashed ? flashClass('navigation')
								: changed.has(formatWord(group.start)) ? flashClass('change') : '',
						].filter(Boolean).join(' ')}
					>
						{/* Little-endian: the highest address is the most significant digit pair. */}
						{[...group.bytes].reverse().map((byte, byteIndex) => {
							const text = toHex(byte.value)
							// The group is one number, so its leading zeros dim across byte
							// boundaries; how many of them dim is the workspace's setting,
							// applied here rather than baked into the row data.
							const dimTotal = dimmedDigits(group.leadingZeros, digits, hexDimming)
							const dimmed = Math.min(2, Math.max(0, dimTotal - byteIndex * 2))
							return (
								<span key={byteIndex} className={`memory-byte ${isHovered(byte.address) ? 'hovered' : ''}`}>
									{dimmed > 0 && <span className="hex-zero">{text.slice(0, dimmed)}</span>}
									{text.slice(dimmed)}
								</span>
							)
						})}
					</EditableCell>
					)
				})}
			</span>
			{showAscii && (
				<span className="memory-row-ascii">
					{row.bytes.map((byte, byteIndex) => (
						<span
							key={byteIndex}
							className={`memory-char ${isPrintable(byte.value) ? '' : showIcons ? 'icon' : 'unprintable'} ${isHovered(byte.address) ? 'hovered' : ''}`}
							data-address={byte.address}
							data-size={1}
						>
							{toPrintable(byte.value, showIcons)}
						</span>
					))}
				</span>
			)}
		</div>
	)
})

function MemoryView({ memory, pc, returnAddresses, focusAddress, focusRequest = 0, editable = false, onEditWord, onHoverAddress, hoveredAddress = null }: MemoryViewProps) {
	const memoryConfiguration = useTHRAXStore((state) => state.settings.memoryConfiguration)
	const sections = React.useMemo(() => sectionsFor(MEMORY_CONFIGURATIONS[memoryConfiguration]), [memoryConfiguration])
	const textSection = sections[0]
	const [addressInput, setAddressInput] = React.useState(formatAddress(textSection.start))
	const [sectionId, setSectionId] = useStoredState('memory.section', SECTION_IDS[0], isOneOf(SECTION_IDS))
	const [groupSize, setGroupSize] = useStoredState('memory.groupSize', 4, isOneOf(GROUP_SIZES))
	const hexDimming = useTHRAXStore((state) => state.settings.hexDimming)
	const [rowOptions, setRowOptions] = useStoredState('memory.rows', { powerOfTwo: true, ascii: true, icons: false }, isFlagSet(['powerOfTwo', 'ascii', 'icons']))
	const { ascii: showAscii, icons: showIcons, powerOfTwo: powerOfTwoRows } = rowOptions
	const [addressError, setAddressError] = React.useState<string | null>(null)
	const [windowStart, setWindowStart] = React.useState(textSection.start)
	const [pendingReveal, setPendingReveal] = React.useState<number | null>(null)
	// The ASCII column changes the frame without resizing the grid.
	const { ref: scrollRef, originRef, viewport, scrollTop, frame, onScroll } = useFixedRowScroller(ROW_HEIGHT, [showAscii])
	const [charWidth, setCharWidth] = React.useState(7.2)
	// The toolbar stands over the rows rather than above them, so the scrollbar
	// runs the whole height of the panel.  Its height is the band the rows are
	// padded down by, and it changes as the controls wrap.
	const toolbarRef = React.useRef<HTMLDivElement>(null)
	const [toolbarHeight, setToolbarHeight] = React.useState(0)
	// The row-shape options are behind the hamburger, so the toolbar is one line
	// deep until they are asked for.
	const [showOptions, setShowOptions] = React.useState(false)
	const [hover, setHover] = React.useState<HoverRange | null>(null)
	const focusedRef = React.useRef<string | null>(null)
	const probeRef = React.useRef<HTMLSpanElement>(null)

	const section = sections.find((entry) => entry.id === sectionId) ?? sections[0]

	React.useLayoutEffect(() => {
		const width = probeRef.current?.getBoundingClientRect().width
		if (width) setCharWidth(width / 20)
	}, [])

	React.useLayoutEffect(() => {
		const toolbar = toolbarRef.current
		if (!toolbar) return
		const measure = () => setToolbarHeight((current) => (current === toolbar.offsetHeight ? current : toolbar.offsetHeight))
		const observer = new ResizeObserver(measure)
		observer.observe(toolbar)
		measure()
		return () => observer.disconnect()
	}, [])

	// As many groups as fit the row, counting the ASCII column. Rounding the row
	// length down to a power of two keeps addresses aligned at the cost of width.
	const bytesPerRow = React.useMemo(() => {
		const perGroup = (groupSize * 2 + 1 + (showAscii ? groupSize : 0)) * charWidth
		const available = viewport.width - (ADDRESS_COLUMNS + (showAscii ? 2 : 0)) * charWidth - 16
		const groups = Math.max(1, Math.floor(available / perGroup))
		const bytes = groups * groupSize
		return powerOfTwoRows ? Math.max(groupSize, 2 ** Math.floor(Math.log2(bytes))) : bytes
	}, [charWidth, groupSize, powerOfTwoRows, showAscii, viewport.width])

	const alignedWindowStart = Math.max(section.start, windowStart - (windowStart % bytesPerRow)) >>> 0
	const windowBytes = Math.min(section.end - alignedWindowStart + 1, MAX_WINDOW_ROWS * bytesPerRow)
	const totalRows = Math.max(1, Math.ceil(windowBytes / bytesPerRow))
	const windowEnd = (alignedWindowStart + windowBytes - 1) >>> 0

	// Fixed-size row pool: the slot count only changes on resize, so scrolling
	// rewrites the contents of the same row elements instead of remounting them.
	// Row zero sits under the toolbar band, so the rows read a scroll offset that
	// is negative until the band has been scrolled away.
	const rowScroll = scrollTop - toolbarHeight
	const { first: firstRow, count: visibleRows } = rowWindow(rowScroll, viewport.height, ROW_HEIGHT, totalRows, OVERSCAN_ROWS)

	// Anchors the window at the section start whenever the address is near it, so
	// the rows above stay reachable, and only re-anchors for a distant address.
	const revealAddress = React.useCallback((address: number) => {
		const target = sectionForAddress(sections, address)
		if (!target) return false
		const span = MAX_WINDOW_ROWS * bytesPerRow
		setAddressError(null)
		setSectionId(target.id)
		setAddressInput(formatAddress(address))
		setWindowStart(address - target.start < span ? target.start : Math.max(target.start, address - Math.floor(span / 2)))
		setPendingReveal(address)
		return true
	}, [bytesPerRow])

	// A selected call stack frame, a symbol or a history row brings an address
	// into view.
	React.useEffect(() => {
		if (focusAddress === null) {
			focusedRef.current = null
			return
		}
		const asked = `${focusRequest}:${focusAddress}`
		if (asked === focusedRef.current) return
		focusedRef.current = asked
		revealAddress(focusAddress)
	}, [focusAddress, focusRequest, revealAddress])

	// Scrolls to a revealed address once the window that contains it is in place.
	React.useEffect(() => {
		if (pendingReveal === null || !scrollRef.current) return
		const row = Math.floor((pendingReveal - alignedWindowStart) / bytesPerRow)
		if (row < 0 || row >= totalRows) return
		scrollRef.current.scrollTop = Math.max(0, row * ROW_HEIGHT + toolbarHeight - Math.max(0, viewport.height / 2 - ROW_HEIGHT))
		setPendingReveal(null)
	}, [alignedWindowStart, bytesPerRow, pendingReveal, toolbarHeight, totalRows, viewport.height])

	const rows = React.useMemo<MemoryRowData[]>(() => Array.from({ length: visibleRows }, (unused, index) => {
		const rowAddress = (alignedWindowStart + (firstRow + index) * bytesPerRow) >>> 0
		const bytes = Array.from({ length: bytesPerRow }, (unusedByte, offset) => {
			const address = (rowAddress + offset) >>> 0
			return { address, value: byteAt(memory, address) }
		})
		const groups = Array.from({ length: bytesPerRow / groupSize }, (unusedGroup, groupIndex) => {
			const groupBytes = bytes.slice(groupIndex * groupSize, (groupIndex + 1) * groupSize)
			const digits = [...groupBytes].reverse().map((byte) => toHex(byte.value)).join('')
			const significant = digits.replace(/^0+/, '')
			return {
				start: groupBytes[0].address,
				bytes: groupBytes,
				// Only a word can hold a saved return address.
				value: groupBytes.length === 4 ? Number.parseInt(digits, 16) >>> 0 : null,
				zero: significant.length === 0,
				// An all-zero group keeps its final digit, so something stays readable.
				leadingZeros: significant.length === 0 ? digits.length - 1 : digits.length - significant.length,
			}
		})
		return { address: rowAddress, groups, bytes }
	}), [alignedWindowStart, bytesPerRow, firstRow, groupSize, memory, visibleRows])

	// Only the rows on screen are diffed: a word nobody is looking at cannot
	// flash, and the whole of memory is far more than a panel ever shows.
	const visibleWords = React.useMemo(() => rows.flatMap((row) =>
		row.groups.flatMap((group) => group.value === null ? [] : [[formatWord(group.start), group.value] as const])),
	[rows])
	const changed = useChangedEntries(visibleWords)

	const navigating = useFlash('navigation', focusAddress === null ? null : focusRequest)
	// The word a navigation asked for, aligned to the group it lands in.
	const flashed = navigating && focusAddress !== null ? focusAddress - (focusAddress % groupSize) : null

	const handleHover = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = (event.target as HTMLElement).closest<HTMLElement>('[data-address]')
		if (!target) {
			clearHover()
			return
		}
		const start = Number(target.dataset.address)
		const size = Number(target.dataset.size ?? 1)
		if (hover && hover.start === start && hover.size === size) return
		const rect = target.getBoundingClientRect()
		setHover({ start, size, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } })
		// Any segment: a register holding a data address is as worth lighting as a
		// source line, and the panels that cannot place an address simply ignore it.
		onHoverAddress(size === 4 ? start : null)
	}

	const clearHover = () => {
		setHover(null)
		onHoverAddress(null)
	}

	const tooltip = React.useMemo(() => {
		if (!hover) return null
		const bytes = Array.from({ length: hover.size }, (unused, offset) => byteAt(memory, (hover.start + offset) >>> 0))
		const value = groupValue(bytes)
		const signed = BigInt.asIntN(hover.size * 8, value)
		const range = hover.size > 1
			? `${formatAddress(hover.start)} - ${formatAddress(hover.start + hover.size - 1)}`
			: formatAddress(hover.start)
		const text = bytes.map((byte) => toPrintable(byte, showIcons)).join('')
		// Words in .text decode to an instruction; other widths and sections do not.
		const inText = hover.start >= textSection.start && hover.start <= textSection.end
		const assembly = hover.size === 4 && inText ? disassemble(Number(value), hover.start) : null
		return {
			range,
			hex: `0x${[...bytes].reverse().map(toHex).join('')}`,
			unsigned: value.toString(),
			signed: signed === value ? null : signed.toString(),
			ascii: hover.size > 1 ? `"${text}"` : describeByte(bytes[0]),
			assembly,
		}
	}, [hover, memory, showIcons])

	const showSection = (target: MemorySection) => {
		setAddressError(null)
		setSectionId(target.id)
		setWindowStart(target.start)
		setAddressInput(formatAddress(target.start))
		if (scrollRef.current) scrollRef.current.scrollTop = 0
	}

	const goToAddress = () => {
		const address = parseWord(addressInput)
		if (address === null || address < 0 || address > 0xffffffff) {
			setAddressError('Enter a valid 32-bit address')
			return
		}
		if (!revealAddress(address >>> 0)) setAddressError('Address is outside every memory section')
	}

	return (
		<div className="memory-view">
			<span className="memory-probe" ref={probeRef}>00000000000000000000</span>

			<div className="memory-grid" ref={scrollRef} onScroll={(event) => { onScroll(event); clearHover() }}>
				<span className="memory-origin" ref={originRef} />

				{/* Stands over the rows on the origin the rows are placed against, so
				    the grid can run the full height of the panel and own its scrollbar. */}
				<div
					className="memory-toolbar"
					ref={toolbarRef}
					style={{ top: frame.top, left: frame.left, width: frame.width }}
					// The options belong to whoever is using them, so they fold away as
					// soon as the toolbar is done with.
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setShowOptions(false)
					}}
				>
					<div className="memory-toolbar-row">
						<button
							className={`memory-options ${showOptions ? 'active' : ''}`}
							title="Row options"
							aria-expanded={showOptions}
							onClick={() => setShowOptions((current) => !current)}
						>
							&#9776;
						</button>
						<div className="toggle-group">
							{sections.map((entry) => (
								<button
									key={entry.id}
									className={`toggle-button ${entry.id === section.id ? 'active' : ''}`}
									title={`${formatAddress(entry.start)} - ${formatAddress(entry.end)}`}
									onClick={() => showSection(entry)}
								>
									{entry.label}
								</button>
							))}
						</div>
						<div className="memory-goto">
							<input
								className="memory-address-input"
								type="text"
								value={addressInput}
								onChange={(event) => setAddressInput(event.target.value)}
								onKeyDown={(event) => { if (event.key === 'Enter') goToAddress() }}
								placeholder="0x10010000"
							/>
							<button className="memory-go" onClick={goToAddress}>Go</button>
						</div>
						<span className="memory-status">
							<HexWord value={alignedWindowStart} /> - <HexWord value={windowEnd} />
						</span>
					</div>

					{showOptions && (
						<div className="memory-controls">
							<div className="toggle-group memory-sizes">
								{GROUP_SIZES.map((size) => (
									<button
										key={size}
										className={`toggle-button ${size === groupSize ? 'active' : ''}`}
										title={`${size}-byte groups`}
										onClick={() => setGroupSize(size)}
									>
										{size}
									</button>
								))}
							</div>
							<div className="toggle-group">
								<button
									className={`toggle-button ${powerOfTwoRows ? 'active' : ''}`}
									title="Wrap rows at a power of two bytes"
									onClick={(event) => setRowOptions((current) => nextToggles(current, 'powerOfTwo', event))}
								>
									^2
								</button>
								<button
									className={`toggle-button ${showAscii ? 'active' : ''}`}
									title="Show the ASCII column"
									onClick={(event) => setRowOptions((current) => nextToggles(current, 'ascii', event))}
								>
									ascii
								</button>
								<button
									className={`toggle-button ${showIcons ? 'active' : ''}`}
									title="Name each non-printing byte with its own glyph"
									disabled={!showAscii}
									onClick={(event) => setRowOptions((current) => nextToggles(current, 'icons', event))}
								>
									icons
								</button>
							</div>
						</div>
					)}
					{addressError && <div className="memory-error">{addressError}</div>}
				</div>

				<div className="memory-scroll" style={{ height: toolbarHeight + totalRows * ROW_HEIGHT }}>
					<div
						className="memory-rows"
						onMouseOver={handleHover}
						onMouseLeave={clearHover}
					>
						{rows.map((row, slot) => (
							<MemoryRow
								key={slot}
								row={row}
								top={rowTop(frame, firstRow + slot, ROW_HEIGHT, rowScroll)}
								left={frame.left}
								width={frame.width}
								groupSize={groupSize}
								showAscii={showAscii}
								editable={editable}
								onEditWord={onEditWord}
								showIcons={showIcons}
								hexDimming={hexDimming}
								pc={groupSize === 4 ? pc : null}
								returnAddresses={returnAddresses}
								hover={hover && hover.start >= row.address && hover.start < row.address + bytesPerRow ? hover : null}
								pointed={hoveredAddress}
								flashed={flashed !== null && flashed >= row.address && flashed < row.address + bytesPerRow ? flashed : null}
								changed={changed}
							/>
						))}
					</div>
				</div>
			</div>

			{hover && tooltip && (
				<div
					className="memory-tooltip"
					style={hover.rect.top < 96
						? { left: hover.rect.left, top: hover.rect.bottom + 4 }
						: { left: hover.rect.left, top: hover.rect.top - 4, transform: 'translateY(-100%)' }}
				>
					<div className="memory-tooltip-range">{tooltip.range}</div>
					<div><span>hex</span><HexNumber text={tooltip.hex} mode="off" /></div>
					<div><span>dec</span>{tooltip.unsigned}</div>
					{tooltip.signed && <div><span>signed</span>{tooltip.signed}</div>}
					<div><span>ascii</span>{tooltip.ascii}</div>
					{tooltip.assembly && <div><span>asm</span>{tooltip.assembly}</div>}
				</div>
			)}

		</div>
	)
}

export default MemoryView
