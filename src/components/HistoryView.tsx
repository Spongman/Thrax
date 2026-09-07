import React from 'react'
import './HistoryView.css'
import { disassemble } from '../core/disassembler'
import { formatWord } from '../core/format'
import { KIND_CALL, KIND_CONSOLE, KIND_CONSOLE_RESET, KIND_CP0, KIND_DISPLAY, KIND_EXIT_CODE, KIND_FLAG, KIND_FP, KIND_HALTED, KIND_HEAP_POINTER, KIND_HI_LO, KIND_INPUT, KIND_MEMORY, KIND_QUEUED_INPUT, KIND_REGISTER, KIND_SERVICE, KIND_SLEEP } from '../core/effectKind'
import type { EffectStore } from '../core/effectStore'
import type { HistoryLog } from '../core/historyLog'
import type { Effect, HistoryEntry } from '../core/types'
import { useTHRAXStore } from '../store/thraxStore'
import { HexWord } from './HexNumber'
import { rowAt, rowForScroll, scrollStep } from './historyDrag'
import { rowTop, rowWindow, useFixedRowScroller } from './rowWindow'

const ROW_HEIGHT = 20
const OVERSCAN_ROWS = 8

/**
 * What one effect did, taken apart rather than spelled out.
 *
 * An effect holds the value that is not in the machine, so which side of the
 * present it is on decides whether that reads as the old value or the new one:
 * `applied` puts the value after the arrow instead of before it.
 *
 * The parts stay parts because the panel does more with them than print them:
 * a word goes through the workspace's own hex rendering, a register name is
 * something to navigate to, and an address is somewhere to send the memory
 * view.  `label` is the whole of it as text, for a title and for a test.
 */
export interface DescribedEffect {
	/** What changed: a register name, a bracketed address, `console`. */
	subject: string
	/** The register file name this names, when a click should go to one. */
	register?: string
	/** An address this names, when a click should go to the memory view. */
	address?: number
	/** The word held, when the effect holds one. */
	value?: number
	/** A second word, since hi and lo move together. */
	second?: number
	/** What is held when it is not a word, and was exchanged like one: a flag. */
	text?: string
	/**
	 * What the effect carries rather than what it replaced.  Console text and a
	 * line of input were not swapped for anything, so no arrow: there is no
	 * other value to point away from or towards.
	 */
	detail?: string
	/** The value is what the instruction produced rather than what it destroyed. */
	applied: boolean
	/** The whole of it as one string. */
	label: string
}

function described(applied: boolean, parts: Omit<DescribedEffect, 'applied' | 'label'>): DescribedEffect {
	const held = parts.value === undefined ? parts.text
		: parts.second === undefined ? hex(parts.value)
			: `${hex(parts.value)}/${hex(parts.second)}`
	const label = held !== undefined
		? (applied ? `${parts.subject} → ${held}` : `${parts.subject} ${held} →`)
		: parts.detail !== undefined ? `${parts.subject} ${parts.detail}` : parts.subject
	return { ...parts, applied, label }
}

export function describeEffect(effect: Effect, applied: boolean): DescribedEffect {
	const at = (parts: Omit<DescribedEffect, 'applied' | 'label'>) => described(applied, parts)
	switch (effect.kind) {
		case KIND_REGISTER: return at({ subject: effect.name, register: effect.name, value: effect.value })
		case KIND_FP: return at({ subject: `$f${effect.index}`, register: `$f${effect.index}`, value: effect.value })
		case KIND_FLAG: return at({ subject: `cc${effect.index}`, text: String(effect.value) })
		case KIND_CP0: return at({ subject: `cp0[${effect.index}]`, value: effect.value })
		case KIND_MEMORY: {
			// Unsigned: a word address in the kernel or the MMIO region shifts into a
			// negative byte address, which no panel would match.
			const address = (effect.wordAddress << 2) >>> 0
			const span = effect.words.length === 1 ? formatWord(address) : `${formatWord(address)}+${effect.words.length * 4}`
			return at({ subject: `[${span}]`, address })
		}
		case KIND_CONSOLE: return at({ subject: 'console', detail: JSON.stringify(effect.text) })
		case KIND_CONSOLE_RESET: return at({ subject: 'console cleared' })
		case KIND_DISPLAY: return at({ subject: 'display' })
		case KIND_QUEUED_INPUT: return at({ subject: 'keyboard read' })
		case KIND_CALL: return at({ subject: `call ${formatWord(effect.frame.targetAddress)}`, address: effect.frame.targetAddress })
		case KIND_HI_LO: return at({ subject: 'hi/lo', register: '$hi', value: effect.hi, second: effect.lo })
		case KIND_HEAP_POINTER: return at({ subject: 'heap', value: effect.value })
		case KIND_HALTED: return at({ subject: effect.value ? 'running' : 'halted' })
		case KIND_EXIT_CODE: return at({ subject: 'exit code' })
		case KIND_SLEEP: return at({ subject: 'sleep' })
		case KIND_INPUT: return at({ subject: 'read', detail: JSON.stringify(effect.value) })
		// Only the service knows what its slots mean, so the chip names the
		// service and leaves it at that.
		case KIND_SERVICE: return at({ subject: effect.name })
	}
}

const hex = (value: number) => formatWord(value >>> 0)

/**
 * The effects worth a chip on the row, in the order they happened.  They live
 * in columns, so an object is built only for the rows actually on screen.
 */
export function rowEffects(entry: HistoryEntry, effects: EffectStore, applied: boolean) {
	return Array.from({ length: entry.effectCount }, (unused, offset) =>
		describeEffect(effects.materialize(entry.effectStart + offset), applied))
}

/**
 * The subject of a chip, with any address in it spelled the way every other
 * panel spells one.  Split on the text the subject was built from rather than
 * carried as separate fields: `label` stays one string for a title and a test,
 * and a subject that does not contain it simply renders whole.
 */
function ChipSubject({ chip }: { chip: DescribedEffect }) {
	if (chip.address === undefined) return <>{chip.subject}</>
	const text = formatWord(chip.address)
	const at = chip.subject.indexOf(text)
	if (at < 0) return <>{chip.subject}</>
	return (
		<>
			{chip.subject.slice(0, at)}
			<HexWord value={chip.address} />
			{chip.subject.slice(at + text.length)}
		</>
	)
}

/**
 * One effect on a row.  A register chip is the one that moves time: the value
 * it shows belongs to this instruction, so reaching it means putting the
 * machine here first.
 */
function EffectChip({ chip, hoveredAddress, onHoverAddress, hoveredRegister, onHoverRegister, onRunTo, onSelectAddress, onSelectRegister }: {
	chip: DescribedEffect
	hoveredAddress: number | null
	onHoverAddress: (address: number | null) => void
	hoveredRegister: string | null
	onHoverRegister: (name: string | null) => void
	/** Puts the machine at the entry this chip belongs to. */
	onRunTo: () => void
	onSelectAddress: (address: number) => void
	onSelectRegister: (register: string) => void
}) {
	// One element, so the row's gap falls between the parts of the chip rather
	// than between the `0x` and the digits of one number.
	const held = chip.value !== undefined
		? (
			<span className="history-chip-value">
				<HexWord value={chip.value} />
				{chip.second !== undefined && <>/<HexWord value={chip.second} /></>}
			</span>
		)
		: chip.text !== undefined ? <span className="history-chip-value">{chip.text}</span> : null
	const target = chip.register !== undefined ? 'register' : chip.address !== undefined ? 'address' : null
	// Everything from the disassembly rightwards runs to the entry, so a chip
	// with nowhere of its own to go is still worth clicking.
	const title = chip.register !== undefined ? `Run to here and go to ${chip.register}`
		: chip.address !== undefined ? `Run to here and show ${formatWord(chip.address)} in memory`
			: `${chip.label}: run to here`
	return (
		<button
			type="button"
			className={[
				'history-chip',
				target === null ? 'history-chip-inert' : '',
				chip.address !== undefined && chip.address === hoveredAddress ? 'address-hovered' : '',
				chip.register !== undefined && chip.register === hoveredRegister ? 'register-hovered' : '',
			].filter(Boolean).join(' ')}
			title={title}
			onMouseEnter={() => {
				if (chip.address !== undefined) onHoverAddress(chip.address)
				if (chip.register !== undefined) onHoverRegister(chip.register)
			}}
			onMouseLeave={() => {
				if (chip.address !== undefined) onHoverAddress(null)
				if (chip.register !== undefined) onHoverRegister(null)
			}}
			onClick={(event) => {
				event.stopPropagation()
				// Time first, then the panel: the value a chip names belongs to this
				// instruction, so the machine has to be here before it is looked at.
				onRunTo()
				if (chip.register !== undefined) onSelectRegister(chip.register)
				else if (chip.address !== undefined) onSelectAddress(chip.address)
			}}
		>
			<span className="history-chip-subject"><ChipSubject chip={chip} /></span>
			{held !== null && (
				<>
					{!chip.applied && held}
					<span className="history-chip-arrow">{'→'}</span>
					{chip.applied && held}
				</>
			)}
			{chip.detail !== undefined && <span className="history-chip-value">{chip.detail}</span>}
		</button>
	)
}

interface HistoryViewProps {
	entries: HistoryLog
	/** How many entries stand behind the present; the rest are ahead of it. */
	cursor: number
	/** Bumped whenever the log changes, since it is written in place. */
	version: number
	sourceOf: (entry: HistoryEntry) => { file: string, line: number, text?: string } | null
	onSelect: (entry: HistoryEntry) => void
	onSetNow: (entry: HistoryEntry) => void
	onSelectAddress: (address: number) => void
	/** Sends the editor to the line an entry ran. */
	onSelectSource: (file: string, line: number) => void
	/**
	 * Sends the registers panel to `register`.  The chip has already put the
	 * machine at its entry, since a register in the history is a value at a
	 * moment and the moment has to be reached first.
	 */
	onSelectRegister: (register: string) => void
	/** Lights the address elsewhere while the pointer is over it here. */
	onHoverAddress: (address: number | null) => void
	/** The address under the pointer anywhere, lit here wherever it appears. */
	hoveredAddress: number | null
	/** Names the register under the pointer here, so the register file can light it. */
	onHoverRegister: (name: string | null) => void
	/** The register under the pointer anywhere, lit here wherever it appears. */
	hoveredRegister: string | null
	selectedId: number | null
	/** The columns every entry's effects are read out of. */
	effects: EffectStore
}

function HistoryView({ entries, cursor, version, sourceOf, onSelect, onSetNow, onSelectAddress, onSelectSource, onSelectRegister, onHoverAddress, hoveredAddress, onHoverRegister, hoveredRegister, selectedId, effects }: HistoryViewProps) {
	const { ref: scrollRef, originRef, viewport, scrollTop, frame, onScroll } = useFixedRowScroller(ROW_HEIGHT)
	const [following, setFollowing] = React.useState(true)
	/** Whether the marker is being dragged, and where the pointer last was. */
	const [dragging, setDragging] = React.useState(false)
	const pointerY = React.useRef(0)
	// Read inside the drag handlers, which outlive the render that made them.
	const cursorRef = React.useRef(cursor)
	cursorRef.current = cursor
	const entriesRef = React.useRef(entries)
	entriesRef.current = entries

	/** Puts the present on the row the pointer is over, if it is not there. */
	const moveToPointer = React.useCallback(() => {
		const element = scrollRef.current
		const held = entriesRef.current
		if (!element || held.length === 0) return
		const box = element.getBoundingClientRect()
		const row = rowAt(pointerY.current, box.top, box.bottom, element.scrollTop, ROW_HEIGHT, held.length)
		const entry = held.at(row)
		if (entry && row !== cursorRef.current) onSetNow(entry)
	}, [onSetNow, scrollRef])

	// Wherever the present lands, it is brought into sight: a step back from the
	// tail otherwise leaves the marker somewhere above the panel with nothing to
	// say where.  The drag does its own scrolling, so it is left alone.
	React.useEffect(() => {
		const element = scrollRef.current
		if (fromScroll.current) {
			fromScroll.current = false
			return
		}
		if (!element || dragging || cursor >= entries.length) return
		const top = cursor * ROW_HEIGHT
		if (top < element.scrollTop) element.scrollTop = top
		else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
			element.scrollTop = top + ROW_HEIGHT - element.clientHeight
		}
	}, [cursor, dragging, entries.length, scrollRef])

	// The pointer is followed wherever it goes, since a drag that leaves the
	// panel is how the list is asked to scroll rather than the end of it.
	React.useEffect(() => {
		if (!dragging) return
		const move = (event: PointerEvent) => {
			pointerY.current = event.clientY
			moveToPointer()
		}
		const stop = () => setDragging(false)
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', stop)
		window.addEventListener('pointercancel', stop)
		return () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', stop)
			window.removeEventListener('pointercancel', stop)
		}
	}, [dragging, moveToPointer])

	// Held outside the panel, the list scrolls under the marker until it is let
	// go, so the run can be crossed without a pointer big enough to reach it.
	React.useEffect(() => {
		if (!dragging) return
		let frameHandle = 0
		const tick = () => {
			const element = scrollRef.current
			if (element) {
				const box = element.getBoundingClientRect()
				const step = scrollStep(pointerY.current, box.top, box.bottom)
				if (step !== 0) {
					element.scrollTop += step
					moveToPointer()
				}
			}
			frameHandle = requestAnimationFrame(tick)
		}
		frameHandle = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frameHandle)
	}, [dragging, moveToPointer, scrollRef])

	// The list follows the tail while a program runs, until the user scrolls off
	// it.  Once the present is behind the tail the marker is what matters, and
	// chasing the end would drag the view off it after every step back.
	React.useEffect(() => {
		const element = scrollRef.current
		if (!element || !following || cursor < entries.length) return
		element.scrollTop = element.scrollHeight
	}, [version, following, cursor, entries.length, scrollRef])

	// Shift is read from the events themselves rather than held as state: a
	// scroll event says nothing about the keyboard, and the pointer that took
	// hold of the scrollbar does.
	const shiftHeld = React.useRef(false)
	/** Set when the present moved because the view did, to break the loop. */
	const fromScroll = React.useRef(false)
	React.useEffect(() => {
		const track = (event: KeyboardEvent) => { shiftHeld.current = event.shiftKey }
		window.addEventListener('keydown', track)
		window.addEventListener('keyup', track)
		return () => {
			window.removeEventListener('keydown', track)
			window.removeEventListener('keyup', track)
		}
	}, [])

	const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
		onScroll(event)
		const element = event.currentTarget
		const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT
		setFollowing(atEnd)
		// Held down, the scrollbar drags the present as well as the view: the
		// whole run under the track, first instruction at the top of it and last
		// at the bottom.
		if (!shiftHeld.current || entriesRef.current.length === 0) return
		const row = rowForScroll(element.scrollTop, element.scrollHeight, element.clientHeight, entriesRef.current.length)
		const entry = entriesRef.current.at(row)
		if (!entry || row === cursorRef.current) return
		// Scrolling to the marker now would undo the scroll that moved it, which
		// is what pinned it to the last instruction once it reached the bottom.
		fromScroll.current = true
		onSetNow(entry)
	}

	// A fixed pool of rows pinned by hand, as the memory window draws its own: the
	// count only changes when the panel is resized, so a scroll rewrites the same
	// row elements rather than mounting one per entry that came into view.
	const { first, count } = rowWindow(scrollTop, viewport.height, ROW_HEIGHT, entries.length, OVERSCAN_ROWS)
	const rows = entries.slice(first, first + count)

	return (
		<div className={`history-view${dragging ? ' dragging' : ''}`}>
			<div
				className="history-scroll"
				ref={scrollRef}
				onScroll={handleScroll}
				onPointerDown={(event) => { shiftHeld.current = event.shiftKey }}
			>
				{entries.length === 0 && <div className="history-empty">Step or run a program to fill the history.</div>}
				<div className="history-spacer" style={{ height: entries.length * ROW_HEIGHT }}>
					{/* Reports where fixed positioning resolves from, for the rows below. */}
					<span className="history-origin" ref={originRef} />
					{rows.map((entry, slot) => {
						const index = first + slot
						const ahead = index >= cursor
						// The cursor sits on the instruction about to run: everything
						// before it has happened, everything from it has not.
						const next = index === cursor
						const source = sourceOf(entry)
						const runToTitle = ahead ? 'Run forward to here' : 'Step back to here'
						return (
							<div
								key={slot}
								className={`history-row${ahead ? ' ahead' : ''}${entry.id === selectedId ? ' selected' : ''}${entry.kind === 'edit' ? ' edit' : ''}`}
								style={{ top: rowTop(frame, index, ROW_HEIGHT, scrollTop), left: frame.left, width: frame.width, height: ROW_HEIGHT }}
								onClick={() => onSelect(entry)}
								onDoubleClick={() => onSetNow(entry)}
								title={ahead ? 'Ahead of the present' : 'Already run'}
							>
								<span className="history-count">{entry.kind === 'edit' ? 'edit' : entry.instructionCount}</span>
								<span
									className={`history-next${next ? ' active' : ''}`}
									aria-hidden={!next}
									title={next ? 'The next instruction to run; drag it to move through the run' : undefined}
									onPointerDown={next ? (event) => {
										// The row beneath would otherwise take it as a click on itself,
										// and the list must stop chasing the tail while it is dragged.
										event.preventDefault()
										event.stopPropagation()
										pointerY.current = event.clientY
										setFollowing(false)
										setDragging(true)
									} : undefined}
								/>
								{/* The address and the source name the same line, so both go there;
								    hovering either lights it in the editor without moving anything. */}
								<button
									type="button"
									className={`history-address${entry.address === hoveredAddress ? ' address-hovered' : ''}`}
									title={source ? `Go to ${source.file}:${source.line}` : 'No source line for this address'}
									disabled={source === null}
									onMouseEnter={() => onHoverAddress(entry.address)}
									onMouseLeave={() => onHoverAddress(null)}
									onClick={(event) => {
										event.stopPropagation()
										if (source) onSelectSource(source.file, source.line)
									}}
								>
									<HexWord value={entry.address} />
								</button>
								<button
									type="button"
									className="history-source"
									title={source ? `Go to ${source.file}:${source.line}` : ''}
									disabled={source === null}
									onMouseEnter={() => onHoverAddress(entry.address)}
									onMouseLeave={() => onHoverAddress(null)}
									onClick={(event) => {
										event.stopPropagation()
										if (source) onSelectSource(source.file, source.line)
									}}
								>
									{source ? `${source.file}:${source.line}` : ''}
								</button>
								<button
									type="button"
									className="history-instruction"
									title={runToTitle}
									onClick={(event) => {
										event.stopPropagation()
										onSetNow(entry)
									}}
								>
									{entry.kind === 'edit' ? 'edited by hand' : entry.word === null ? '' : disassemble(entry.word)}
								</button>
								{/* The effects fill the rest of the row, so the empty space
								    beyond the last chip runs to the entry as well. */}
								<span
									className="history-effects"
									title={runToTitle}
									onClick={(event) => {
										event.stopPropagation()
										onSetNow(entry)
									}}
								>
									{rowEffects(entry, effects, ahead).map((chip, index) => (
										<EffectChip
											key={index}
											chip={chip}
											onRunTo={() => onSetNow(entry)}
											hoveredAddress={hoveredAddress}
											onHoverAddress={onHoverAddress}
											hoveredRegister={hoveredRegister}
											onHoverRegister={onHoverRegister}
											onSelectAddress={onSelectAddress}
											onSelectRegister={onSelectRegister}
										/>
									))}
								</span>
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}

/** The history of the program the workspace is running. */
export function HistoryPanel() {
	const { executionHistory, historyCursor, historyEffects, historyVersion, hovered, sourceIndex, focusMemoryAddress, focusRegister, focusSourceLine, moveHistoryTo, hover } = useTHRAXStore()
	const [selectedId, setSelectedId] = React.useState<number | null>(null)

	const sourceOf = React.useCallback((entry: HistoryEntry) => sourceIndex.lineForAddress(entry.address), [sourceIndex])

	const setNow = React.useCallback((entry: HistoryEntry) => {
		setSelectedId(entry.id)
		moveHistoryTo(entry.id)
	}, [moveHistoryTo])

	return (
		<HistoryView
			entries={executionHistory}
			effects={historyEffects}
			cursor={historyCursor}
			version={historyVersion}
			sourceOf={sourceOf}
			selectedId={selectedId}
			onSelect={(entry) => setSelectedId(entry.id)}
			onSetNow={setNow}
			onSelectAddress={focusMemoryAddress}
			onSelectSource={focusSourceLine}
			onSelectRegister={focusRegister}
			onHoverAddress={(address) => hover({ address })}
			hoveredAddress={hovered.address}
			onHoverRegister={(register) => hover({ register })}
			hoveredRegister={hovered.register}
		/>
	)
}

export default HistoryView
