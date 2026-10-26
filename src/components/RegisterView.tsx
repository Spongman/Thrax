import { registerAddress } from '../core/format'
import React from 'react'
import './RegisterView.css'
import './ToggleGroup.css'
import { RegisterFormat, type RegisterBank, type RegisterDescriptor, type RegisterValue, type Registers } from '../architectures/contracts'
import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../core/ieee754'
import { formatOctal, formatRegister } from '../core/format'
import { FLOAT_ENCODINGS, formatEncodedFloat, type FloatEncoding } from '../core/floatEncodings'
import { advanceOne, isSolo, nextToggles } from './toggleGroup'
import FloatBitsView from './FloatBitsView'
import PanelGroup from './PanelGroup'
import TabStrip, { type Tab } from './TabStrip'
import HexNumber from './HexNumber'
import EditableCell from './EditableCell'
import { parseEditedDouble, parseEditedValue, parseEditedWide, withoutLeadingZeros } from './editValue'
import { flashClass, useChangedEntries, useFlash } from './highlight'
import { useStoredState } from '../hooks/useStoredState'

interface RegisterViewProps {
	/** Values by descriptor id. */
	registers: Registers
	/** The target's registers, in the order they are listed. */
	descriptors: readonly RegisterDescriptor[]
	/** Tabs, in order; derived from the descriptors when absent. */
	banks?: readonly RegisterBank[]
	/** Whether a value is an address, so only real ones name one. */
	isAddress?: (value: number) => boolean
	/**
	 * Writes a register's raw bits.  Absent, or returning false, leaves the cell
	 * read-only: a hardwired register and a running program's state are not edited.
	 */
	onEdit?: (id: string, bits: RegisterValue) => boolean
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
	/** Radix integer headings first show; hexadecimal when absent. */
	radix?: 8 | 16
}

type Format = '0n' | '0o' | '0x' | 'f' | 'd'

const FORMATS: Array<{ id: Format; title: string }> = [
	{ id: '0n', title: 'Decimal' },
	{ id: '0o', title: 'Octal' },
	{ id: '0x', title: 'Hexadecimal' },
	{ id: 'f', title: 'Single precision float' },
	{ id: 'd', title: 'Double precision float, paired with the next register' },
]

/** Widest rendering of each format, in characters: `0xffffffff`, `4294967295`. */
const FORMAT_CHARS: Record<Format, number> = { '0n': 10, '0o': 11, '0x': 10, 'f': 13, 'd': 18 }
/** The same for a 64-bit register: `0xffffffffffffffff`, `18446744073709551615`. */
const WIDE_FORMAT_CHARS: Record<Format, number> = { ...FORMAT_CHARS, '0n': 20, '0o': 22, '0x': 18 }

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
const formatWidth = (format: Format, bits: number) => {
	const chars = bits > 64 && format === '0x' ? Math.ceil(bits / 4) + 2 : bits > 64 && format === '0o' ? Math.ceil(bits / 3) : bits > 64 && format === '0n' ? Math.ceil(bits * Math.LOG10E * Math.LN2) : (bits > 32 ? WIDE_FORMAT_CHARS : FORMAT_CHARS)[format]
	return Math.ceil(chars * NAME_CHAR_WIDTH) + 2
}

type FormatFlags = Record<Format, boolean>

const flagsFrom = (formats: Format[]): FormatFlags =>
	Object.fromEntries(FORMATS.map((format) => [format.id, formats.includes(format.id)])) as FormatFlags

const INTEGER_FORMATS: Format[] = ['0n', '0o', '0x']
/** A float's bits say nothing as a decimal, so a float file offers neither. */
const FLOAT_FORMATS: Format[] = ['f', 'd']

/** One heading of a tab: registers of one kind, read the same way. */
interface RegisterGroup {
	title: string
	/** A `RegisterFormat`. */
	format: number
	registers: RegisterDescriptor[]
}

interface RegisterTabLayout {
	bank: RegisterBank
	groups: RegisterGroup[]
}

/** Tabs and their headings, in descriptor order. */
function layoutOf(descriptors: readonly RegisterDescriptor[], banks: readonly RegisterBank[] | undefined): RegisterTabLayout[] {
	const tabs = (banks ?? [...new Set(descriptors.map((register) => register.bank))].map((id) => ({ id, label: id })))
		.map((bank): RegisterTabLayout => ({ bank, groups: [] }))
	for (const register of descriptors) {
		const tab = tabs.find((candidate) => candidate.bank.id === register.bank)
		if (!tab) continue
		const title = register.group ?? tab.bank.label
		let group = tab.groups.find((candidate) => candidate.title === title)
		if (!group) {
			group = { title, format: register.format ?? RegisterFormat.INTEGER, registers: [] }
			tab.groups.push(group)
		}
		group.registers.push(register)
	}
	return tabs
}

/** A file of 64-bit float registers holds doubles only; integers with a float encoding also read as floats. */
const formatsFor = (group: RegisterGroup): Format[] => group.format !== RegisterFormat.FLOAT ? group.registers.some((register) => register.floatEncoding) ? [...INTEGER_FORMATS, ...FLOAT_FORMATS] : INTEGER_FORMATS : group.registers.every((register) => register.bits === 64) ? ['d'] : FLOAT_FORMATS

/**
 * Single and double are two readings of the same registers rather than two
 * columns of one, so a float file switches between them instead of showing
 * both: in double, each register pairs with the one after it.
 */
const isExclusive = (group: RegisterGroup) => group.format === RegisterFormat.FLOAT

/** The radixes a group is showing, which for an exclusive group is exactly one. */
const activeFormats = (group: RegisterGroup, flags: FormatFlags): Format[] => {
	const available = formatsFor(group)
	const active = available.filter((format) => flags[format])
	return isExclusive(group) ? [active[0] ?? available[0]] : active
}

/** A heading of wide registers that only ever hold encoded floats also starts with their single reading. */
const initialFlags = (group: RegisterGroup, radix: 8 | 16 = 16) => flagsFrom(group.format === RegisterFormat.FLOAT ? [formatsFor(group)[0]]
	: [radix === 8 ? '0o' : '0x', ...group.registers.every((register) => register.floatEncoding && register.bits > 32) ? ['f' as const] : []])

/** Stored formats: per heading, a flag per format with at least one turned on; one stored before octal lacks that flag. */
const isPanelFormats = (value: unknown) =>
	typeof value === 'object' && value !== null &&
	Object.values(value as Record<string, unknown>).every((flags) => {
		if (typeof flags !== 'object' || flags === null) return false
		const entries = FORMATS.map((format) => (flags as Record<string, unknown>)[format.id])
		return entries.every((flag, index) => typeof flag === 'boolean' || flag === undefined && FORMATS[index].id === '0o') && entries.some(Boolean)
	})

const isText = (value: unknown) => typeof value === 'string'

/** Brings a navigated register into view, since it is rarely already on screen. */
const scrollIntoView = (element: HTMLDivElement | null) =>
	element?.scrollIntoView({ block: 'nearest' })

interface RegisterEntry {
	/** Descriptor id: what an edit, a hover and a navigation name. */
	id: string
	name: string
	/** A bigint for a register wider than a word. */
	bits: RegisterValue
	/** The register's width. */
	width: number
	editable: boolean
	/** The register holding the high word, when this one starts a double. */
	pairId?: string
	/** High word of the double this register starts, when it starts one. */
	highBits?: number
	/** Low word of that double when the pair is big-endian; otherwise `bits`. */
	lowBits?: number
	/** A non-IEEE float reading of the bits. */
	encoding?: FloatEncoding
}

const formatBits = (format: Format, entry: RegisterEntry) => {
	const { bits } = entry
	switch (format) {
		case '0n': return typeof bits === 'bigint' ? bits.toString() : `${bits >>> 0}`
		case '0o': return formatOctal(bits, entry.width)
		case '0x': return formatRegister(bits, entry.width)
		case 'f': return entry.encoding ? formatEncodedFloat(entry.encoding, entry.width > 32 ? entry.highBits ?? 0 : Number(bits)) : formatSingle(bitsToSingle(Number(bits)))
		case 'd': return entry.highBits === undefined ? '' : entry.encoding ? formatEncodedFloat(entry.encoding, entry.lowBits ?? Number(bits), entry.highBits) : formatDouble(bitsToDouble(entry.lowBits ?? Number(bits), entry.highBits))
	}
}

/** The address a value names, if it is small enough to be one; unsigned either way. */
const addressOf = registerAddress

/** A value typed into a cell, read as the register's width. */
const parseEdited = (text: string, format: Format, entry: RegisterEntry): RegisterValue | null =>
	entry.width > 32 && (format === '0n' || format === '0o' || format === '0x') ? parseEditedWide(text, format, entry.width) : parseEditedValue(text, format)

function RegisterPanel({ group, entries, flags, onToggle, selected, onSelect, onEdit, editable = false, flashed, changed, pointed, onHoverAddress, pointedRegister, onHoverRegister, isAddress }: {
	group: RegisterGroup
	entries: RegisterEntry[]
	flags: FormatFlags
	onToggle: (group: RegisterGroup, format: Format, event: React.MouseEvent) => void
	/** Id of the entry whose bits are being inspected, where that is offered. */
	selected?: string
	onSelect?: (id: string) => void
	onEdit?: (entry: RegisterEntry, bits: RegisterValue, high?: number) => boolean
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
	isAddress: (value: number) => boolean
}) {
	const available = formatsFor(group)
	const formats = activeFormats(group, flags)

	// Columns are only as wide as the names and the visible radixes need.  Some
	// names carry what the register is for, which is wider than a `$t0`.
	const nameWidth = Math.ceil(Math.max(MIN_NAME_WIDTH, ...entries.map((entry) => entry.name.length * NAME_CHAR_WIDTH)))
	const maxBits = Math.max(32, ...entries.map(entry => entry.width))
	const columnWidth = nameWidth + 24 + formats.reduce((total, format) => total + formatWidth(format, maxBits) + 8, 0)

	return (
		<PanelGroup
			title={group.title}
			flush
			actions={(
				<div className="toggle-group">
					{FORMATS.filter((format) => available.includes(format.id)).map((format) => (
						<button
							key={format.id}
							className={`toggle-button${formats.includes(format.id) ? ' active' : ''}`}
							title={format.title}
							onClick={(event) => onToggle(group, format.id, event)}
						>
							{format.id}
						</button>
					))}
				</div>
			)}
		>
			<div className="register-list" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, 1fr))` }}>
				{entries.map((entry) => {
					const address = addressOf(entry.bits)
					return (
						<div
							key={entry.id}
							ref={entry.id === flashed ? scrollIntoView : undefined}
							className={[
								'register-item',
								onSelect ? 'register-item-selectable' : '',
								entry.id === selected ? 'selected' : '',
								// Navigation wins where both apply: the click that put the eye
								// here is the more recent thing, and one colour reads better.
								entry.id === flashed ? flashClass('navigation') : changed?.has(entry.id) ? flashClass('change') : '',
								// A named register hover takes precedence over equal values.
								// A register holding the hovered address is where that address
								// appears in this window, so it lights like the word does.
								// Unsigned on both sides: a register holds a signed word, and the
								// address a panel points at is unsigned, so anything at or above
								// 0x80000000 would never match itself.
								pointedRegister == null && pointed !== null && pointed !== undefined && address === pointed && isAddress(address) ? 'address-hovered' : '',
								// Named from another window: the history points at a register
								// by name, since the value it shows is the one from back then.
								entry.id === pointedRegister ? 'register-hovered' : '',
							].filter(Boolean).join(' ')}
							style={{ gridTemplateColumns: `minmax(${nameWidth}px, auto) repeat(${formats.length}, 1fr)` }}
							onMouseEnter={() => {
								// Only a value that is actually an address names one; otherwise
								// every register holding the same small number lights with it.
								onHoverAddress?.(address !== null && isAddress(address) ? address : null)
								onHoverRegister?.(entry.id)
							}}
							onMouseLeave={() => {
								onHoverAddress?.(null)
								onHoverRegister?.(null)
							}}
							onClick={onSelect && (() => onSelect(entry.id))}
							role={onSelect && 'button'}
							tabIndex={onSelect && 0}
							onKeyDown={onSelect && ((event) => {
								if (event.key !== 'Enter' && event.key !== ' ') return
								event.preventDefault()
								onSelect(entry.id)
							})}
						>
							<span className="reg-name">{entry.name}</span>
							{formats.map((format) => {
								const text = formatBits(format, entry)
								const shown = format === '0x' || format === '0o' ? <HexNumber text={text} /> : text
								// A hardwired register reads the same however it is written, so
								// offering to edit it would only mislead.
								const writable = editable && onEdit !== undefined && entry.editable && !(format === 'd' && entry.highBits === undefined)
								return (
									<EditableCell
										key={format}
										className="reg-value"
										text={withoutLeadingZeros(text)}
										title={text}
										editable={writable}
										onCommit={(typed) => {
											if (!onEdit) return false
											if (entry.encoding && (format === 'f' || format === 'd')) {
												const value = typed.trim() === '' ? NaN : Number(typed)
												const single = format === 'f' ? entry.encoding.encodeSingle(value) : null, pair = format === 'd' ? entry.encoding.encodeDouble(value) : null
												// One wide register holding the whole image keeps its sign and exponent in the low longword.
												if (entry.width > 32 && entry.pairId === undefined) return single !== null ? onEdit(entry, BigInt(entry.bits) >> 32n << 32n | BigInt(single >>> 0)) : pair !== null && onEdit(entry, pair.high, pair.low)
												return single !== null ? onEdit(entry, single) : pair !== null && onEdit(entry, pair.low, pair.high)
											}
											if (format === 'd') {
												const pair = parseEditedDouble(typed)
												return pair !== null && onEdit(entry, pair.low, pair.high)
											}
											const bits = parseEdited(typed, format, entry)
											return bits !== null && onEdit(entry, bits)
										}}
									>
										{shown}
									</EditableCell>
								)
							})}
						</div>
					)
				})}
			</div>
		</PanelGroup>
	)
}

const NOT_AN_ADDRESS = () => false

function RegisterView({ registers, descriptors, banks, isAddress = NOT_AN_ADDRESS, onEdit, editable = false, focused = null, hoveredAddress = null, onHoverAddress, hoveredRegister = null, onHoverRegister, radix = 16 }: RegisterViewProps) {
	const tabs = React.useMemo(() => layoutOf(descriptors, banks), [banks, descriptors])
	const [storedTab, setTab] = useStoredState<string>('registers.tab', tabs[0]?.bank.id ?? '', isText)
	const current = tabs.find((candidate) => candidate.bank.id === storedTab) ?? tabs[0]
	const tab = current?.bank.id ?? ''
	const [panelFormats, setPanelFormats] = useStoredState<Record<string, FormatFlags>>('registers.formats', {}, isPanelFormats)
	const flagsOf = (group: RegisterGroup) => panelFormats[group.title] ?? initialFlags(group, radix)
	/** Id of the float register whose IEEE-754 fields are shown, if any. */
	const [selectedRegister, setSelectedRegister] = React.useState<string | null>(null)

	// Every value on show, by id, so the ones that moved can be lit wherever
	// they are, across every tab.
	const named = React.useMemo(() => Object.entries(registers).map(([id, bits]) => [id, typeof bits === 'bigint' ? bits : bits | 0] as const), [registers])
	const changed = useChangedEntries(named)

	// A navigation names a register on any tab, so it opens the one the register
	// is on before the panel tries to light it.
	const flashing = useFlash('navigation', focused?.request ?? null)
	const flashed = flashing ? focused?.name ?? null : null
	React.useEffect(() => {
		const bank = focused && descriptors.find((register) => register.id === focused.name)?.bank
		if (bank) setTab(bank)
	}, [descriptors, focused, setTab])

	const handleToggle = React.useCallback((group: RegisterGroup, format: Format, event: React.MouseEvent) => {
		setPanelFormats((stored) => {
			const flags = stored[group.title] ?? initialFlags(group, radix)
			// One format always stays on: an entry with no value column says nothing,
			// so turning off the last one moves to the next radix instead.  An
			// exclusive group simply moves to the radix that was clicked.
			const clicked = isExclusive(group)
				? flagsFrom([format])
				: advanceOne(nextToggles(flags, format, event), format, formatsFor(group))
			const next = { ...stored, [group.title]: clicked }
			if (!event.shiftKey) return next
			// Shift-click lands the same change on the other groups of this tab.
			for (const sibling of current?.groups ?? []) {
				if (sibling === group || sibling.format !== group.format) continue
				const held = stored[sibling.title] ?? initialFlags(sibling, radix)
				next[sibling.title] = isSolo(event) ? { ...clicked } : advanceOne({ ...held, [format]: clicked[format] }, format, formatsFor(sibling))
			}
			return next
		})
	}, [current, radix, setPanelFormats])

	const entryFor = (register: RegisterDescriptor): RegisterEntry => {
		// A 64-bit float register is its own pair: low word as bits, high word beside it.
		if (register.format === RegisterFormat.FLOAT && register.bits === 64) {
			const wide = BigInt(registers[register.id] ?? 0)
			return { id: register.id, name: register.name, bits: Number(wide & 0xffffffffn), width: 64, editable: register.editable, highBits: Number(wide >> 32n),
				encoding: register.floatEncoding === undefined ? undefined : FLOAT_ENCODINGS[register.floatEncoding] }
		}
		const encoding = register.floatEncoding === undefined ? undefined : FLOAT_ENCODINGS[register.floatEncoding]
		// A wide encoded register is its own pair: the low longword carries the sign and exponent.
		if (encoding && register.bits > 32 && register.pairsWith === undefined) {
			const wide = BigInt(registers[register.id] ?? 0)
			return { id: register.id, name: register.name, bits: wide, width: register.bits, editable: register.editable, highBits: Number(wide & 0xffffffffn), lowBits: Number(wide >> 32n & 0xffffffffn), encoding }
		}
		return {
			id: register.id,
			name: register.name,
			bits: registers[register.id] ?? 0,
			width: register.bits,
			editable: register.editable,
			pairId: register.pairsWith,
			highBits: register.pairsWith === undefined ? undefined : Number(registers[register.highWordFirst ? register.id : register.pairsWith] ?? 0),
			lowBits: register.pairsWith === undefined || !register.highWordFirst ? undefined : Number(registers[register.pairsWith] ?? 0),
			encoding,
		}
	}

	// A double is written across the pair it starts, high word first when big-endian.
	const edit = onEdit && ((entry: RegisterEntry, bits: RegisterValue, high?: number) => {
		if (high !== undefined && entry.width === 64 && entry.pairId === undefined) return onEdit(entry.id, BigInt(high >>> 0) << 32n | BigInt(Number(bits) >>> 0))
		const swap = high !== undefined && entry.lowBits !== undefined
		return onEdit(entry.id, swap ? high : bits) && (high === undefined || entry.pairId === undefined || onEdit(entry.pairId, swap ? Number(bits) : high))
	})

	const panelProps = {
		onToggle: handleToggle,
		flashed,
		changed,
		pointed: hoveredAddress,
		onHoverAddress,
		pointedRegister: hoveredRegister,
		onHoverRegister,
		isAddress,
		onEdit: edit,
		editable,
	}

	return (
		<div className="register-view">
			<TabStrip tabs={tabs.map(({ bank }): Tab<string> => ({ id: bank.id, label: bank.label }))} active={tab} onSelect={setTab} />

			{current?.groups.map((group) => {
				if (group.format === RegisterFormat.FLAG) {
					return (
						<PanelGroup key={group.title} title={group.title} flush>
							<div className="register-list">
								{group.registers.map((register) => (
									<div key={register.id} className="register-item register-item-flag">
										<span className="reg-name">{register.name}</span>
										<span className="reg-value">{registers[register.id] ? '1' : '0'}</span>
									</div>
								))}
							</div>
						</PanelGroup>
					)
				}
				const flags = flagsOf(group)
				if (group.format !== RegisterFormat.FLOAT) {
					return <RegisterPanel key={group.title} group={group} flags={flags} entries={group.registers.map(entryFor)} {...panelProps} />
				}
				// Read as doubles, only a register that starts a pair has anything of
				// its own to show, and a selection moves to the pair it belongs to.
				const double = activeFormats(group, flags)[0] === 'd'
				const shown = double ? group.registers.filter((register) => register.pairsWith !== undefined || register.bits === 64) : group.registers
				const selected = selectedRegister === null ? undefined
					: shown.find((register) => register.id === selectedRegister || (double && register.pairsWith === selectedRegister))
				const entry = selected && entryFor(selected)
				const pairName = double && selected?.pairsWith !== undefined
					? descriptors.find((register) => register.id === selected.pairsWith)?.name
					: undefined
				return (
					<React.Fragment key={group.title}>
						<RegisterPanel
							group={group}
							flags={flags}
							entries={shown.map(entryFor)}
							selected={selected?.id}
							onSelect={(id) => setSelectedRegister((held) => held === id ? null : id)}
							{...panelProps}
						/>
						{/* The bit fields shown are IEEE-754's, so an encoded register has none. */}
						{entry && !entry.encoding && (
							<PanelGroup
								title={`${entry.name}${pairName ? `/${pairName}` : ''} bits`}
								actions={<div className="toggle-group"><button className="toggle-button" title="Clear selection" onClick={() => setSelectedRegister(null)}>×</button></div>}
							>
								<FloatBitsView
									bits={(double ? entry.lowBits ?? Number(entry.bits) : Number(entry.bits)) >>> 0}
									highBits={double && entry.highBits !== undefined ? entry.highBits >>> 0 : undefined}
									editable={editable}
									onEdit={edit && ((bits, high) => edit(entry, bits, high))}
								/>
							</PanelGroup>
						)}
					</React.Fragment>
				)
			})}
		</div>
	)
}

export default RegisterView
