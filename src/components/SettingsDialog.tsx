import React from 'react'
import { HEX_DIMMING_MODES, MAX_BACKSTEP_LIMIT, MAX_HIGHLIGHT_SECONDS, MEMORY_CONFIGURATIONS, MIN_HIGHLIGHT_SECONDS, SETTINGS_VALIDATORS, type HexDimming, type MemoryConfigurationName, type ThraxSettings } from '../core/settings'
import { formatWord } from '../core/format'
import { useTHRAXStore } from '../store/thraxStore'
import Modal from './Modal'
import './SettingsDialog.css'

const MEMORY_CONFIGURATION_LABELS: Array<{ id: MemoryConfigurationName, label: string }> = [
	{ id: 'default', label: 'Default' },
	{ id: 'dataBasedCompact', label: 'Compact, data at address 0' },
	{ id: 'textBasedCompact', label: 'Compact, text at address 0' },
]

const HEX_DIMMING_LABELS: Record<HexDimming, string> = {
	off: 'Off',
	nibbles: 'Every zero digit',
	bytes: 'Whole bytes',
	halfwords: 'Whole halfwords',
	pow2: 'Leave 1, 2, 4 or 8 digits',
}

/**
 * How far to scroll a container so a whole section is on screen, moving as
 * little as possible: a section taller than the view, or one above it, aligns
 * to the top; one hanging off the bottom is pulled up just enough.
 */
export function scrollDelta(section: { top: number, bottom: number }, container: { top: number, bottom: number }): number {
	const tallerThanView = section.bottom - section.top >= container.bottom - container.top
	if (tallerThanView || section.top < container.top) return section.top - container.top
	if (section.bottom > container.bottom) return section.bottom - container.bottom
	return 0
}

/** Height of one sticky header, and the step by which they stack. */
const HEADER_HEIGHT = 24

/**
 * A section's rows, from the first after its title to the last before the next.
 *
 * The title itself is deliberately excluded: it is sticky, so its rectangle
 * reports where it is currently pinned rather than where it sits in the flow,
 * and measuring from it would make an already-stuck header look like it needed
 * no scrolling at all.
 */
function sectionContent(heading: HTMLElement) {
	const first = heading.nextElementSibling
	if (!(first instanceof HTMLElement) || first.tagName === 'H3') return null
	let last: HTMLElement = first
	for (let node = first.nextElementSibling; node instanceof HTMLElement && node.tagName !== 'H3'; node = node.nextElementSibling) {
		last = node
	}
	return { top: first.getBoundingClientRect().top, bottom: last.getBoundingClientRect().bottom }
}

/**
 * Clicking a title brings its whole section into view, moving as little as it
 * can.  The room the stacked titles take is frame rather than content: those
 * above this one, and this one itself, sit above the rows; those below it sit
 * under them.  A section too tall for what is left simply starts at the top,
 * which puts its own title directly under the stack above it.
 */
function revealSection(heading: HTMLElement) {
	const body = heading.closest('.modal-body')
	const content = sectionContent(heading)
	if (!body || !content) return
	const headings = [...body.querySelectorAll('h3')]
	const index = headings.indexOf(heading as HTMLHeadingElement)
	const box = body.getBoundingClientRect()
	const frame = {
		top: box.top + (index + 1) * HEADER_HEIGHT,
		bottom: box.bottom - (headings.length - 1 - index) * HEADER_HEIGHT,
	}
	body.scrollTop += scrollDelta(content, frame)
}

/**
 * One group of settings.  A fragment rather than a wrapper: a sticky header is
 * held inside its parent's box, so a section element of its own would let each
 * title scroll away with its section instead of stacking with the others.
 */
function Group({ title, index, count, children }: { title: string, index: number, count: number, children: React.ReactNode }) {
	return (
		<>
			<h3
				className="settings-title"
				style={{ top: index * HEADER_HEIGHT, bottom: (count - 1 - index) * HEADER_HEIGHT }}
				onClick={(event) => revealSection(event.currentTarget)}
			>
				{title}
			</h3>
			{children}
		</>
	)
}

interface CheckProps {
	label: string
	hint: string
	checked: boolean
	onChange: (checked: boolean) => void
}

function Check({ label, hint, checked, onChange }: CheckProps) {
	return (
		<label className="settings-row" title={hint}>
			<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
			<span>
				{label}
				<span className="settings-hint">{hint}</span>
			</span>
		</label>
	)
}

interface SettingsDialogProps {
	onClose: () => void
}

/**
 * The IDE settings, grouped the way the Settings menu groups them.  Every value
 * lives in the store, so the assembler and the simulator see a change; a
 * setting no chain consumes yet is shown all the same and simply has no effect.
 */
function SettingsDialog({ onClose }: SettingsDialogProps) {
	const { gutterColumns, heatMap, heatMapLines, setGutterColumns, setHeatMap, setHeatMapLines, setSetting, settings } = useTHRAXStore()
	const set = <Key extends keyof ThraxSettings>(key: Key) => (value: ThraxSettings[Key]) => setSetting(key, value)
	const configuration = MEMORY_CONFIGURATIONS[settings.memoryConfiguration]

	return (
		<Modal title="Settings" onClose={onClose} className="settings-dialog" movable persistKey="dialog.settings">
			<Group title="Assembler" index={0} count={5}>
				<Check
					label="Permit extended (pseudo) instructions and formats"
					hint="Off assembles only the basic MIPS instruction set"
					checked={settings.extendedAssembler}
					onChange={set('extendedAssembler')}
				/>
				<Check
					label="Assemble all open files"
					hint="Assemble every open tab as one program; the active tab holds the entry point"
					checked={settings.assembleAll}
					onChange={set('assembleAll')}
				/>
				<Check
					label="Initialize the program counter to global 'main' if defined"
					hint="Off starts at the text base of the memory configuration"
					checked={settings.startAtMain}
					onChange={set('startAtMain')}
				/>
				<Check
					label="Assembler warnings are considered errors"
					hint="A warning stops the assembly rather than annotating it"
					checked={settings.warningsAreErrors}
					onChange={set('warningsAreErrors')}
				/>
				<label className="settings-row settings-field" title="Source file prepended to every assembly; empty means none">
					<span>Exception handler</span>
					<input
						type="text"
						value={settings.exceptionHandler}
						placeholder="none"
						onChange={(event) => setSetting('exceptionHandler', event.target.value)}
					/>
				</label>
			</Group>

			<Group title="Simulator" index={1} count={5}>
				<Check
					label="Delayed branching"
					hint="Run the instruction after a branch or jump before control transfers, as real MIPS hardware does"
					checked={settings.delayedBranching}
					onChange={set('delayedBranching')}
				/>
				<Check
					label="Self-modifying code"
					hint="Permit writes into the text segment and execution outside it"
					checked={settings.selfModifyingCode}
					onChange={set('selfModifyingCode')}
				/>
				<Check
					label="Bare machine"
					hint="Allow only the instructions real hardware implements"
					checked={settings.bareMachine}
					onChange={set('bareMachine')}
				/>
				<Check
					label="Program arguments provided to the program"
					hint="Place the arguments below on the stack, with their count in $a0"
					checked={settings.programArguments}
					onChange={set('programArguments')}
				/>
				<label className="settings-row settings-field" title="Arguments passed to the program, separated by spaces">
					<span>Arguments</span>
					<input
						type="text"
						value={settings.programArgumentsText}
						disabled={!settings.programArguments}
						onChange={(event) => setSetting('programArgumentsText', event.target.value)}
					/>
				</label>
				<label className="settings-row settings-field" title="Instructions the step-back history keeps">
					<span>Backstep limit</span>
					{/* A part-typed value such as an empty field fails the validator, so
					    the field simply keeps the last accepted number. */}
					<input
						type="number"
						min={1}
						max={MAX_BACKSTEP_LIMIT}
						title={`Instructions the history keeps, at about 370 bytes each. Up to ${MAX_BACKSTEP_LIMIT.toLocaleString()}.`}
						value={settings.backstepLimit}
						onChange={(event) => {
							const limit = Number(event.target.value)
							if (SETTINGS_VALIDATORS.backstepLimit(limit)) setSetting('backstepLimit', limit)
						}}
					/>
				</label>
			</Group>

			<Group title="Memory configuration" index={2} count={5}>
				<label className="settings-row settings-field" title="Where the segments of the address space start">
					<span>Layout</span>
					<select
						value={settings.memoryConfiguration}
						onChange={(event) => setSetting('memoryConfiguration', event.target.value as MemoryConfigurationName)}
					>
						{MEMORY_CONFIGURATION_LABELS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
					</select>
				</label>
				<div className="settings-addresses">
					<span>.text {formatWord(configuration.textBaseAddress)}</span>
					<span>.data {formatWord(configuration.dataBaseAddress)}</span>
					<span>heap {formatWord(configuration.heapBaseAddress)}</span>
					<span>$sp {formatWord(configuration.stackPointer)}</span>
				</div>
			</Group>

			<Group title="Display" index={3} count={5}>
				{/* Seeds only: the registers panel keeps per-register formats, where
				    decimal and hex can both be on, and the memory panel keeps its own
				    group size and row options. */}
				<Check
					label="Values displayed in hexadecimal"
					hint="The radix a register or memory panel starts in"
					checked={settings.displayValuesInHex}
					onChange={set('displayValuesInHex')}
				/>
				<Check
					label="Addresses displayed in hexadecimal"
					hint="The radix a memory panel starts in"
					checked={settings.displayAddressesInHex}
					onChange={set('displayAddressesInHex')}
				/>
				<Check
					label="Flash where a click navigates to"
					hint="The register, word or source line a click in another panel sent the eye to"
					checked={settings.highlightNavigation}
					onChange={set('highlightNavigation')}
				/>
				<Check
					label="Flash a value that just changed"
					hint="A second colour, since where you went and what moved are different questions"
					checked={settings.highlightChanges}
					onChange={set('highlightChanges')}
				/>
				<label className="settings-row settings-field" title="How long a highlight takes to fade">
					<span>
						Highlight fade
						<span className="settings-hint">Long enough to catch, since the eye is often in another panel when a flash starts, and short enough not to sit there afterwards</span>
					</span>
					<input
						type="number"
						min={MIN_HIGHLIGHT_SECONDS}
						max={MAX_HIGHLIGHT_SECONDS}
						step={0.1}
						value={settings.highlightSeconds}
						disabled={!settings.highlightNavigation && !settings.highlightChanges}
						onChange={(event) => {
							const seconds = Number(event.target.value)
							if (SETTINGS_VALIDATORS.highlightSeconds(seconds)) set('highlightSeconds')(seconds)
						}}
					/>
				</label>
				<label className="settings-row settings-field" title="The colour a navigation destination fades from">
					<span>Navigation colour</span>
					<input
						type="color"
						value={settings.highlightNavigationColor}
						disabled={!settings.highlightNavigation}
						onChange={(event) => set('highlightNavigationColor')(event.target.value)}
					/>
				</label>
				<label className="settings-row settings-field" title="The colour a changed value fades from">
					<span>Change colour</span>
					<input
						type="color"
						value={settings.highlightChangeColor}
						disabled={!settings.highlightChanges}
						onChange={(event) => set('highlightChangeColor')(event.target.value)}
					/>
				</label>
				<label className="settings-row settings-field" title="How much of a hex number's leading zero run is dimmed">
					<span>
						Dim leading zeros
						<span className="settings-hint">A coarser unit dims only whole bytes or words, so the dimmed run keeps the shape of the value</span>
					</span>
					<select value={settings.hexDimming} onChange={(event) => set('hexDimming')(event.target.value as HexDimming)}>
						{HEX_DIMMING_MODES.map((mode) => <option key={mode} value={mode}>{HEX_DIMMING_LABELS[mode]}</option>)}
					</select>
				</label>
			</Group>

			<Group title="Editor" index={4} count={5}>
				<Check
					label="Show the address of each machine word"
					hint="A gutter column between the line numbers and the code"
					checked={gutterColumns.address}
					onChange={(address) => setGutterColumns({ ...gutterColumns, address })}
				/>
				<Check
					label="Show each machine word"
					hint="A gutter column between the line numbers and the code"
					checked={gutterColumns.code}
					onChange={(code) => setGutterColumns({ ...gutterColumns, code })}
				/>
				<Check
					label="Show the decoded instruction"
					hint="Stepping then stops at every machine word, not only the first of a line"
					checked={gutterColumns.disassembly}
					onChange={(disassembly) => setGutterColumns({ ...gutterColumns, disassembly })}
				/>
				<Check
					label="Colour line numbers by how often they ran"
					hint="The execution profile, drawn as a heat map"
					checked={heatMap}
					onChange={setHeatMap}
				/>
				<Check
					label="Tint the source line with its heat as well"
					hint="Applies only while the heat map is on"
					checked={heatMapLines}
					onChange={setHeatMapLines}
				/>
			</Group>
		</Modal>
	)
}

export default SettingsDialog
