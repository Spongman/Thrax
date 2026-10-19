import React from 'react'
import './RegisterView.css'
import './ToggleGroup.css'
import { RegisterFormat, type RegisterBank, type RegisterDescriptor, type Registers } from '../architectures/contracts'
import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../core/ieee754'
import { formatRegister } from '../core/format'
import { advanceOne, isSolo, nextToggles } from './toggleGroup'
import FloatBitsView from './FloatBitsView'
import PanelGroup from './PanelGroup'
import TabStrip, { type Tab } from './TabStrip'
import HexNumber from './HexNumber'
import EditableCell from './EditableCell'
import { parseEditedDouble, parseEditedValue, withoutLeadingZeros } from './editValue'
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
	onEdit?: (id: string, bits: number) => boolean
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

type Format = '0n' | '0x' | 'f' | 'd'

const FORMATS: Array<{ id: Format; title: string }> = [
	{ id: '0n', title: 'Decimal' },
	{ id: '0x', title: 'Hexadecimal' },
	{ id: 'f', title: 'Single precision float' },
	{ id: 'd', title: 'Double precision float, paired with the next register' },
]

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

type FormatFlags = Record<Format, boolean>

const flagsFrom = (formats: Format[]): FormatFlags =>
	Object.fromEntries(FORMATS.map((format) => [format.id, formats.includes(format.id)])) as FormatFlags

const INTEGER_FORMATS: Format[] = ['0n', '0x']
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

const formatsFor = (group: RegisterGroup) => group.format === RegisterFormat.FLOAT ? FLOAT_FORMATS : INTEGER_FORMATS

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

const initialFlags = (group: RegisterGroup) => flagsFrom([group.format === RegisterFormat.FLOAT ? 'f' : '0x'])

/** Stored formats: per heading, four flags with at least one turned on. */
const isPanelFormats = (value: unknown) =>
	typeof value === 'object' && value !== null &&
	Object.values(value as Record<string, unknown>).every((flags) => {
		if (typeof flags !== 'object' || flags === null) return false
		const entries = FORMATS.map((format) => (flags as Record<string, unknown>)[format.id])
		return entries.every((flag) => typeof flag === 'boolean') && entries.some(Boolean)
	})

const isText = (value: unknown) => typeof value === 'string'

/** Brings a navigated register into view, since it is rarely already on screen. */
const scrollIntoView = (element: HTMLDivElement | null) =>
	element?.scrollIntoView({ block: 'nearest' })

interface RegisterEntry {
	/** Descriptor id: what an edit, a hover and a navigation name. */
	id: string
	name: string
	bits: number
	/** The register's width, which its hex is padded to. */
	width: number
	editable: boolean
	/** The register holding the high word, when this one starts a double. */
	pairId?: string
	/** High word of the double this register starts, when it starts one. */
	highBits?: number
}

const formatBits = (format: Format, entry: RegisterEntry) => {
	switch (format) {
		case '0n': return `${entry.bits >>> 0}`
		case '0x': return formatRegister(entry.bits, entry.width)
		case 'f': return formatSingle(bitsToSingle(entry.bits))
		case 'd': return entry.highBits === undefined ? '' : formatDouble(bitsToDouble(entry.bits, entry.highBits))
	}
}

function RegisterPanel({ group, entries, flags, onToggle, selected, onSelect, onEdit, editable = false, flashed, changed, pointed, onHoverAddress, pointedRegister, onHoverRegister, isAddress }: {
	group: RegisterGroup
	entries: RegisterEntry[]
	flags: FormatFlags
	onToggle: (group: RegisterGroup, format: Format, event: React.MouseEvent) => void
	/** Id of the entry whose bits are being inspected, where that is offered. */
	selected?: string
	onSelect?: (id: string) => void
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
	isAddress: (value: number) => boolean
}) {
	const available = formatsFor(group)
	const formats = activeFormats(group, flags)

	// Columns are only as wide as the names and the visible radixes need.  Some
	// names carry what the register is for, which is wider than a `$t0`.
	const nameWidth = Math.ceil(Math.max(MIN_NAME_WIDTH, ...entries.map((entry) => entry.name.length * NAME_CHAR_WIDTH)))
	const columnWidth = nameWidth + 24 + formats.reduce((total, format) => total + formatWidth(format) + 8, 0)

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
				{entries.map((entry) => (
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
							// A register holding the hovered address is where that address
							// appears in this window, so it lights like the word does.
							// Unsigned on both sides: a register holds a signed word, and the
							// address a panel points at is unsigned, so anything at or above
							// 0x80000000 would never match itself.
							pointed !== null && pointed !== undefined && (entry.bits >>> 0) === pointed && isAddress(entry.bits) ? 'address-hovered' : '',
							// Named from another window: the history points at a register
							// by name, since the value it shows is the one from back then.
							entry.id === pointedRegister ? 'register-hovered' : '',
						].filter(Boolean).join(' ')}
						style={{ gridTemplateColumns: `minmax(${nameWidth}px, auto) repeat(${formats.length}, 1fr)` }}
						onMouseEnter={() => {
							// Only a value that is actually an address names one; otherwise
							// every register holding the same small number lights with it.
							onHoverAddress?.(isAddress(entry.bits) ? entry.bits >>> 0 : null)
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
							const shown = format === '0x' ? <HexNumber text={text} /> : text
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

const NOT_AN_ADDRESS = () => false

function RegisterView({ registers, descriptors, banks, isAddress = NOT_AN_ADDRESS, onEdit, editable = false, focused = null, hoveredAddress = null, onHoverAddress, hoveredRegister = null, onHoverRegister }: RegisterViewProps) {
	const tabs = React.useMemo(() => layoutOf(descriptors, banks), [banks, descriptors])
	const [storedTab, setTab] = useStoredState<string>('registers.tab', tabs[0]?.bank.id ?? '', isText)
	const current = tabs.find((candidate) => candidate.bank.id === storedTab) ?? tabs[0]
	const tab = current?.bank.id ?? ''
	const [panelFormats, setPanelFormats] = useStoredState<Record<string, FormatFlags>>('registers.formats', {}, isPanelFormats)
	const flagsOf = (group: RegisterGroup) => panelFormats[group.title] ?? initialFlags(group)
	/** Id of the float register whose IEEE-754 fields are shown, if any. */
	const [selectedRegister, setSelectedRegister] = React.useState<string | null>(null)

	// Every value on show, by id, so the ones that moved can be lit wherever
	// they are, across every tab.
	const named = React.useMemo(() => Object.entries(registers).map(([id, bits]) => [id, bits | 0] as const), [registers])
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
			const flags = stored[group.title] ?? initialFlags(group)
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
				const held = stored[sibling.title] ?? initialFlags(sibling)
				next[sibling.title] = isSolo(event) ? { ...clicked } : advanceOne({ ...held, [format]: clicked[format] }, format, formatsFor(sibling))
			}
			return next
		})
	}, [current, setPanelFormats])

	const entryFor = (register: RegisterDescriptor): RegisterEntry => ({
		id: register.id,
		name: register.name,
		bits: registers[register.id] || 0,
		width: register.bits,
		editable: register.editable,
		pairId: register.pairsWith,
		highBits: register.pairsWith === undefined ? undefined : registers[register.pairsWith] || 0,
	})

	// A double is written across the pair it starts.
	const edit = onEdit && ((entry: RegisterEntry, bits: number, high?: number) =>
		onEdit(entry.id, bits) && (high === undefined || entry.pairId === undefined || onEdit(entry.pairId, high)))

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
				const shown = double ? group.registers.filter((register) => register.pairsWith !== undefined) : group.registers
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
						{entry && (
							<PanelGroup
								title={`${entry.name}${pairName ? `/${pairName}` : ''} bits`}
								actions={<div className="toggle-group"><button className="toggle-button" title="Clear selection" onClick={() => setSelectedRegister(null)}>×</button></div>}
							>
								<FloatBitsView
									bits={entry.bits >>> 0}
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
