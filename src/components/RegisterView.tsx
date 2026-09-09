import React from 'react'
import './RegisterView.css'
import './ToggleGroup.css'
import { bitsToDouble, bitsToSingle, CP0_REGISTERS, formatDouble, formatSingle } from '../core/coprocessor'
import { formatWord } from '../core/format'
import type { CoprocessorState, Registers } from '../core/types'
import { advanceOne, isSolo, nextToggles } from './toggleGroup'
import FloatBitsView from './FloatBitsView'
import PanelGroup from './PanelGroup'
import TabStrip, { type Tab } from './TabStrip'
import HexNumber from './HexNumber'
import EditableCell from './EditableCell'
import { parseEditedDouble, parseEditedValue, withoutLeadingZeros } from './editValue'
import { flashClass, useChangedEntries, useFlash } from './highlight'
import { MEMORY_CONFIGURATIONS, isMappedAddress } from '../core/settings'
import { useTHRAXStore } from '../store/thraxStore'
import { isOneOf, useStoredState } from '../hooks/useStoredState'

interface RegisterViewProps extends CoprocessorState {
	registers: Registers
	/**
	 * Writes an entry's raw bits.  Absent, or returning false, leaves the cell
	 * read-only: `$zero` is hardwired and a running program owns its own state.
	 */
	onEdit?: (entry: RegisterEntry, bits: number, high?: number) => boolean
	editable?: boolean
	/**
	 * A register another panel has sent the eye to.  The request counter is what
	 * makes it a navigation rather than a name, so asking twice lights it twice.
	 */
	focused?: { name: string, request: number } | null
	/**
	 * The address under the pointer anywhere in the workspace.  A register
	 * holding it lights, which is how a pointer is found without reading the file.
	 */
	hoveredAddress?: number | null
	/** Names the value under the pointer here as an address for the other panels. */
	onHoverAddress?: (address: number | null) => void
	/** The register under the pointer, wherever it is being pointed at. */
	hoveredRegister?: string | null
	/** Names the register under the pointer here, so the history can light it. */
	onHoverRegister?: (name: string | null) => void
}

type RegisterTab = 'registers' | 'coproc1' | 'coproc0'

/** Which tab a register is on, so a navigation can open the right one. */
export function tabForRegister(name: string): RegisterTab {
	if (/^\$f\d+$/.test(name)) return 'coproc1'
	if (CP0_REGISTERS.some((register) => register.name === name)) return 'coproc0'
	return 'registers'
}

type Format = '0n' | '0x' | 'f' | 'd'

const TABS: Array<Tab<RegisterTab>> = [
	{ id: 'registers', label: 'Registers' },
	{ id: 'coproc1', label: 'Coproc 1' },
	{ id: 'coproc0', label: 'Coproc 0' },
]

const FORMATS: Array<{ id: Format; title: string }> = [
	{ id: '0n', title: 'Decimal' },
	{ id: '0x', title: 'Hexadecimal' },
	{ id: 'f', title: 'Single precision float' },
	{ id: 'd', title: 'Double precision float, paired with the next register' },
]

const REGISTER_GROUPS: Record<string, string[]> = {
	'Zero/At': ['$zero', '$at'],
	'Return Values': ['$v0', '$v1'],
	'Arguments': ['$a0', '$a1', '$a2', '$a3'],
	'Temporaries': ['$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7'],
	'Saved': ['$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7'],
	'More Temps': ['$t8', '$t9'],
	'Reserved': ['$k0', '$k1'],
	'Pointers': ['$gp', '$sp', '$fp', '$ra'],
	'Special': ['$pc', '$hi', '$lo'],
}

/** Widest rendering of each format, in characters: `0xffffffff`, `4294967295`. */
const FORMAT_CHARS: Record<Format, number> = { '0n': 10, '0x': 10, 'f': 13, 'd': 18 }

/** Advance of the monospace list font at 12px, which names are measured in. */
const NAME_CHAR_WIDTH = 7.2
const MIN_NAME_WIDTH = 48

/**
 * Room for the widest value a format can show, with a couple of pixels over.
 * A character of the list font measures a shade wider than its nominal advance
 * at the weight a value is set in, so reserving an exact multiple loses the
 * last digit to the ellipsis: `0x00000000` comes to 72.01px in the 72 that ten
 * characters of 7.2 pay for.
 */
const formatWidth = (format: Format) => Math.ceil(FORMAT_CHARS[format] * NAME_CHAR_WIDTH) + 2

const hex = formatWord

type FormatFlags = Record<Format, boolean>

const flagsFrom = (formats: Format[]): FormatFlags =>
	Object.fromEntries(FORMATS.map((format) => [format.id, formats.includes(format.id)])) as FormatFlags

const FLOATING_POINT = 'Floating Point'
const SYSTEM_CONTROL = 'System Control'

const INTEGER_FORMATS: Format[] = ['0n', '0x']
/** A float's bits say nothing as a decimal, so the FPU file offers neither. */
const FLOAT_FORMATS: Format[] = ['f', 'd']

const formatsFor = (panel: string) => panel === FLOATING_POINT ? FLOAT_FORMATS : INTEGER_FORMATS

/**
 * Single and double are two readings of the same registers rather than two
 * columns of one, so the FPU file switches between them instead of showing
 * both: in double, each register pairs with the odd one after it.
 */
const isExclusive = (panel: string) => panel === FLOATING_POINT

/** The radixes a panel is showing, which for an exclusive panel is exactly one. */
const activeFormats = (panel: string, flags: FormatFlags): Format[] => {
	const available = formatsFor(panel)
	const active = available.filter((format) => flags[format])
	return isExclusive(panel) ? [active[0] ?? available[0]] : active
}

/** Panels of one processor, which is as far as a shift-click reaches. */
const TAB_PANELS: Record<RegisterTab, string[]> = {
	registers: Object.keys(REGISTER_GROUPS),
	coproc1: [FLOATING_POINT],
	coproc0: [SYSTEM_CONTROL],
}

/** Every known panel must carry its four flags, with at least one turned on. */
const isPanelFormats = (value: unknown) =>
	typeof value === 'object' && value !== null &&
	Object.keys(INITIAL_PANEL_FORMATS).every((panel) => {
		const flags = (value as Record<string, unknown>)[panel]
		if (typeof flags !== 'object' || flags === null) return false
		const entries = FORMATS.map((format) => (flags as Record<string, unknown>)[format.id])
		return entries.every((flag) => typeof flag === 'boolean') && entries.some(Boolean)
	})

const INITIAL_PANEL_FORMATS: Record<string, FormatFlags> = {
	...Object.fromEntries(Object.keys(REGISTER_GROUPS).map((group) => [group, flagsFrom(['0x'])])),
	[FLOATING_POINT]: flagsFrom(['f']),
	[SYSTEM_CONTROL]: flagsFrom(['0x']),
}

/** Brings a navigated register into view, since it is rarely already on screen. */
const scrollIntoView = (element: HTMLDivElement | null) =>
	element?.scrollIntoView({ block: 'nearest' })

interface RegisterEntry {
	name: string
	bits: number
	/** High word of the double this register starts, when it starts one. */
	highBits?: number
}

const formatBits = (format: Format, entry: RegisterEntry) => {
	switch (format) {
		case '0n': return `${entry.bits >>> 0}`
		case '0x': return hex(entry.bits)
		case 'f': return formatSingle(bitsToSingle(entry.bits))
		case 'd': return entry.highBits === undefined ? '' : formatDouble(bitsToDouble(entry.bits, entry.highBits))
	}
}

function RegisterPanel({ title, entries, flags, onToggle, selected, onSelect, onEdit, editable = false, flashed, changed, pointed, onHoverAddress, pointedRegister, onHoverRegister, isAddress }: {
	title: string
	entries: RegisterEntry[]
	flags: FormatFlags
	onToggle: (title: string, format: Format, event: React.MouseEvent) => void
	/** Name of the entry whose bits are being inspected, where that is offered. */
	selected?: string
	onSelect?: (name: string) => void
	onEdit?: (entry: RegisterEntry, bits: number, high?: number) => boolean
	editable?: boolean
	/** The register a navigation has just landed on, lit until it fades. */
	flashed?: string | null
	/** Registers whose value the last step moved, lit in the other colour. */
	changed?: ReadonlySet<string>
	/** The address under the pointer; a register holding it lights. */
	pointed?: number | null
	onHoverAddress?: (address: number | null) => void
	/** The register under the pointer, named rather than valued. */
	pointedRegister?: string | null
	onHoverRegister?: (name: string | null) => void
	/** Whether a value is an address, so only real ones name one. */
	isAddress: (value: number) => boolean
}) {
	const available = formatsFor(title)
	const formats = activeFormats(title, flags)

	// Columns are only as wide as the names and the visible radixes need.  CP0
	// names carry what the register is for, which is wider than a `$t0`.
	const nameWidth = Math.ceil(Math.max(MIN_NAME_WIDTH, ...entries.map((entry) => entry.name.length * NAME_CHAR_WIDTH)))
	const columnWidth = nameWidth + 24 + formats.reduce((total, format) => total + formatWidth(format) + 8, 0)

	return (
		<PanelGroup
			title={title}
			flush
			actions={(
				<div className="toggle-group">
					{FORMATS.filter((format) => available.includes(format.id)).map((format) => (
						<button
							key={format.id}
							className={`toggle-button${formats.includes(format.id) ? ' active' : ''}`}
							title={format.title}
							onClick={(event) => onToggle(title, format.id, event)}
						>
							{format.id}
						</button>
					))}
				</div>
			)}
		>
			<div className="register-list" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, 1fr))` }}>
				{entries.map((entry) => (
					<div
						key={entry.name}
						ref={entry.name === flashed ? scrollIntoView : undefined}
						className={[
							'register-item',
							onSelect ? 'register-item-selectable' : '',
							entry.name === selected ? 'selected' : '',
							// Navigation wins where both apply: the click that put the eye
							// here is the more recent thing, and one colour reads better.
							entry.name === flashed ? flashClass('navigation') : changed?.has(entry.name) ? flashClass('change') : '',
							// A register holding the hovered address is where that address
							// appears in this window, so it lights like the word does.
							// Unsigned on both sides: a register holds a signed word, and the
							// address a panel points at is unsigned, so anything at or above
							// 0x80000000 would never match itself.
							pointed !== null && pointed !== undefined && (entry.bits >>> 0) === pointed && isAddress(entry.bits) ? 'address-hovered' : '',
							// Named from another window: the history points at a register
							// by name, since the value it shows is the one from back then.
							entry.name === pointedRegister ? 'register-hovered' : '',
						].filter(Boolean).join(' ')}
						style={{ gridTemplateColumns: `minmax(${nameWidth}px, auto) repeat(${formats.length}, 1fr)` }}
						onMouseEnter={() => {
							// Only a value that is actually an address names one; otherwise
							// every register holding the same small number lights with it.
							onHoverAddress?.(isAddress(entry.bits) ? entry.bits >>> 0 : null)
							onHoverRegister?.(entry.name)
						}}
						onMouseLeave={() => {
							onHoverAddress?.(null)
							onHoverRegister?.(null)
						}}
						onClick={onSelect && (() => onSelect(entry.name))}
						role={onSelect && 'button'}
						tabIndex={onSelect && 0}
						onKeyDown={onSelect && ((event) => {
							if (event.key !== 'Enter' && event.key !== ' ') return
							event.preventDefault()
							onSelect(entry.name)
						})}
					>
						<span className="reg-name">{entry.name}</span>
						{formats.map((format) => {
							const text = formatBits(format, entry)
							const shown = format === '0x' ? <HexNumber text={text} /> : text
							// `$zero` reads as zero however it is written, so offering
							// to edit it would only mislead.
							const writable = editable && onEdit !== undefined && entry.name !== '$zero' && !(format === 'd' && entry.highBits === undefined)
							return (
								<EditableCell
									key={format}
									className="reg-value"
									text={withoutLeadingZeros(text)}
									title={text}
									editable={writable}
									onCommit={(typed) => {
										if (!onEdit) return false
										if (format === 'd') {
											const pair = parseEditedDouble(typed)
											return pair !== null && onEdit(entry, pair.low, pair.high)
										}
										const bits = parseEditedValue(typed, format)
										return bits !== null && onEdit(entry, bits)
									}}
								>
									{shown}
								</EditableCell>
							)
						})}
					</div>
				))}
			</div>
		</PanelGroup>
	)
}

function RegisterView({ registers, fpRegisters, fpConditionFlags, cp0Registers, onEdit, editable = false, focused = null, hoveredAddress = null, onHoverAddress, hoveredRegister = null, onHoverRegister }: RegisterViewProps) {
	const [tab, setTab] = useStoredState<RegisterTab>('registers.tab', 'registers', isOneOf(TABS.map((item) => item.id)))
	const [panelFormats, setPanelFormats] = useStoredState('registers.formats', INITIAL_PANEL_FORMATS, isPanelFormats)
	/** Index of the CP1 register whose IEEE-754 fields are shown, if any. */
	const [selectedRegister, setSelectedRegister] = React.useState<number | null>(null)
	const fpDouble = activeFormats(FLOATING_POINT, panelFormats[FLOATING_POINT])[0] === 'd'
	// A double is read from a register pair, so a selected odd register belongs
	// to the pair before it once the file is being read that way.
	const selectedFp = selectedRegister === null ? null : fpDouble ? selectedRegister & ~1 : selectedRegister

	// Every value on show, by name, so the ones that moved can be lit wherever
	// they are: the integer file, the FPU file and the CP0 registers together.
	const named = React.useMemo(() => [
		...Object.entries(registers).map(([name, bits]) => [name, bits | 0] as const),
		...fpRegisters.map((bits, index) => [`$f${index}`, bits] as const),
		...CP0_REGISTERS.map((register) => [register.name, cp0Registers[register.index] ?? 0] as const),
	], [cp0Registers, fpRegisters, registers])
	const changed = useChangedEntries(named)

	// A register holds a number; only some of those numbers are addresses, and
	// only those are worth lighting across the workspace.
	const memoryConfiguration = useTHRAXStore((state) => state.settings.memoryConfiguration)
	const isAddress = React.useCallback(
		(value: number) => isMappedAddress(value, MEMORY_CONFIGURATIONS[memoryConfiguration]),
		[memoryConfiguration],
	)

	// A navigation names a register on any of the three tabs, so it opens the one
	// the register is on before the panel tries to light it.
	const flashing = useFlash('navigation', focused?.request ?? null)
	const flashed = flashing ? focused?.name ?? null : null
	React.useEffect(() => {
		if (focused) setTab(tabForRegister(focused.name))
	}, [focused, setTab])

	const handleToggle = React.useCallback((panel: string, format: Format, event: React.MouseEvent) => {
		setPanelFormats((current) => {
			// One format always stays on: an entry with no value column says nothing,
			// so turning off the last one moves to the next radix instead.  An
			// exclusive panel simply moves to the radix that was clicked.
			const clicked = isExclusive(panel)
				? flagsFrom([format])
				: advanceOne(nextToggles(current[panel], format, event), format, formatsFor(panel))
			if (!event.shiftKey) return { ...current, [panel]: clicked }
			// Shift-click lands the same change on the other panels of this processor.
			const siblings = TAB_PANELS[tab]
			return Object.fromEntries(Object.entries(current).map(([name, flags]) => {
				if (name === panel) return [name, clicked]
				if (!siblings.includes(name)) return [name, flags]
				return [name, isSolo(event) ? { ...clicked } : advanceOne({ ...flags, [format]: clicked[format] }, format, formatsFor(name))]
			}))
		})
	}, [tab])

	return (
		<div className="register-view">
			<TabStrip tabs={TABS} active={tab} onSelect={setTab} />

			{tab === 'registers' && Object.entries(REGISTER_GROUPS).map(([group, names]) => (
				<RegisterPanel
					key={group}
					title={group}
					flags={panelFormats[group]}
					onToggle={handleToggle}
					flashed={flashed}
					changed={changed}
					pointed={hoveredAddress}
					onHoverAddress={onHoverAddress}
					pointedRegister={hoveredRegister}
					onHoverRegister={onHoverRegister}
					isAddress={isAddress}
					onEdit={onEdit}
					editable={editable}
					entries={names.map((name, index) => ({
						name,
						bits: registers[name] || 0,
						highBits: index + 1 < names.length ? registers[names[index + 1]] || 0 : undefined,
					}))}
				/>
			))}

			{tab === 'coproc1' && (
				<>
					<PanelGroup title="Condition Flags" flush>
						<div className="register-list">
							{fpConditionFlags.map((flag, index) => (
								<div key={index} className="register-item register-item-flag">
									<span className="reg-name">{`cc${index}`}</span>
									<span className="reg-value">{flag ? '1' : '0'}</span>
								</div>
							))}
						</div>
					</PanelGroup>

					<RegisterPanel
						title={FLOATING_POINT}
						flags={panelFormats[FLOATING_POINT]}
						onToggle={handleToggle}
					flashed={flashed}
					changed={changed}
					pointed={hoveredAddress}
					onHoverAddress={onHoverAddress}
					pointedRegister={hoveredRegister}
					onHoverRegister={onHoverRegister}
					isAddress={isAddress}
						onEdit={onEdit}
						editable={editable}
						selected={selectedFp === null ? undefined : `$f${selectedFp}`}
						onSelect={(name) => {
							const index = Number(name.slice(2))
							setSelectedRegister((current) => current === index ? null : index)
						}}
						// Doubles live in an even/odd pair, so only even registers start
						// one and the odd half of the file has nothing of its own to show.
						entries={fpRegisters
							.map((bits, index) => ({ name: `$f${index}`, bits, highBits: index % 2 === 0 ? fpRegisters[index + 1] || 0 : undefined }))
							.filter((_, index) => !fpDouble || index % 2 === 0)}
					/>

					{selectedFp !== null && (
						<PanelGroup
							title={`$f${selectedFp}${fpDouble ? `/$f${selectedFp + 1}` : ''} bits`}
							actions={<div className="toggle-group"><button className="toggle-button" title="Clear selection" onClick={() => setSelectedRegister(null)}>×</button></div>}
						>
							<FloatBitsView
								bits={fpRegisters[selectedFp] >>> 0}
								highBits={fpDouble ? fpRegisters[selectedFp + 1] >>> 0 : undefined}
								editable={editable}
								onEdit={onEdit && ((bits, high) => onEdit({ name: `$f${selectedFp}`, bits }, bits, high))}
							/>
						</PanelGroup>
					)}
				</>
			)}

			{tab === 'coproc0' && (
				<RegisterPanel
					title={SYSTEM_CONTROL}
					flags={panelFormats[SYSTEM_CONTROL]}
					onToggle={handleToggle}
					flashed={flashed}
					changed={changed}
					pointed={hoveredAddress}
					onHoverAddress={onHoverAddress}
					pointedRegister={hoveredRegister}
					onHoverRegister={onHoverRegister}
					isAddress={isAddress}
					onEdit={onEdit}
					editable={editable}
					entries={CP0_REGISTERS.map(({ index, name }) => ({ name, bits: cp0Registers[index] || 0 }))}
				/>
			)}
		</div>
	)
}

export default RegisterView
