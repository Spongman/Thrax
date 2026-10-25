import React from 'react'
import type { ArchitectureDefinition } from '../architectures/contracts'
import { architectureManifests } from '../architectures/registry'
import { HEX_DIMMING_MODES, MAX_BACKSTEP_LIMIT, MAX_HIGHLIGHT_SECONDS, MIN_HIGHLIGHT_SECONDS, SETTINGS_VALIDATORS, offeredOptions, type ArchitectureSettings, type SettingField, type TargetSettings, type HexDimming, type ThraxSettings } from '../core/settings'
import { useTHRAXStore } from '../store/thraxStore'
import Modal from './Modal'
import './SettingsDialog.css'

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
function Group({ title, scope, index, count, children }: { title: string, scope?: string, index: number, count: number, children: React.ReactNode }) {
	return (
		<>
			<h3
				className="settings-title"
				style={{ top: index * HEADER_HEIGHT, bottom: (count - 1 - index) * HEADER_HEIGHT }}
				onClick={(event) => revealSection(event.currentTarget)}
			>
				{title}
				{scope && <span className="settings-scope">{scope}</span>}
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

/**
 * Common controls never share a section with architecture-specific fields.
 */
const SHARED_GROUPS = ['Common', 'Display', 'Editor']
const TARGET_GROUPS = ['CPU', 'Memory', 'Memory timing', 'Assembler', 'Execution']

/**
 * Architecture sections follow a consistent order, led by CPU, which holds the
 * architecture selector.  Additional contributed groups follow those, then the
 * shared settings.
 */
export function dialogGroups(definition: ArchitectureDefinition | undefined): string[] {
	return dialogSections(definition).map(section => section.title)
}

/** Separate IDs keep an architecture's Display/Editor group distinct from the common one. */
export function dialogSections(definition: ArchitectureDefinition | undefined, values = definition?.settings.defaults) {
	const contributed = [...new Set(definition?.settings.fields.filter(field => !field.visibleWhen || field.visibleWhen(values!)).map((field) => field.group))]
	const ordered = TARGET_GROUPS.filter((title) => title === 'CPU' || contributed.includes(title))
	const additional = contributed.filter((title) => !TARGET_GROUPS.includes(title))
	const shared = (title: string) => ({ id: `common:${title}`, title, group: title, architecture: false })
	return [...[...ordered, ...additional].map(group => ({
		id: `architecture:${group}`, group, architecture: true,
		title: definition?.settings.groups?.find(section => section.id === group)?.title ?? group,
	})), ...SHARED_GROUPS.map(shared)]
}

/** The rows an architecture contributes to one group, drawn with the shared controls. */
export function TargetFields({ schema, group, values, onChange }: { schema: ArchitectureSettings, group: string, values: TargetSettings, onChange: (key: string, value: unknown) => void }) {
	const fields = schema.fields.filter((field) => field.group === group && (!field.visibleWhen || field.visibleWhen(values)))
	const details = schema.details?.(group, values) ?? []
	return (
		<>
			{fields.map((field) => <TargetField key={field.key} field={field} defaultValue={schema.defaults[field.key]} values={values} onChange={onChange} />)}
			{details.length > 0 && <div className="settings-addresses">
				{details.map((line) => <span key={line}>{line}</span>)}
			</div>}
		</>
	)
}

function TargetField({ field, defaultValue, values, onChange }: { field: SettingField, defaultValue: unknown, values: TargetSettings, onChange: (key: string, value: unknown) => void }) {
	const { control, hint = '', key, label } = field
	const value = values[key]
	const disabled = field.enabledBy !== undefined && values[field.enabledBy] !== true
	switch (control.kind) {
		case 'check':
			return <Check label={label} hint={hint} checked={value === true} onChange={(checked) => onChange(key, checked)} />
		case 'text':
			return (
				<label className="settings-row settings-field" title={hint}>
					<span>{label}</span>
					<input
						type="text"
						value={typeof value === 'string' ? value : ''}
						placeholder={control.placeholder}
						disabled={disabled}
						onChange={(event) => onChange(key, event.target.value)}
					/>
				</label>
			)
		case 'choice': {
			// Options are keyed by position, since a value need not be a string.
			const options = offeredOptions(control.options, values)
			return (
				<label className="settings-row settings-field" title={hint}>
					<span>{label}</span>
					<select
						value={options.findIndex((option) => option.value === value)}
						disabled={disabled}
						onChange={(event) => onChange(key, options[Number(event.target.value)].value)}
					>
						{options.map((option, index) => <option key={option.label} value={index}>{option.label}{field.role === 'variant' && option.value === defaultValue ? ' (default)' : ''}</option>)}
					</select>
				</label>
			)
		}
	}
}

/** Each architecture by name, its maker right-aligned beside it. */
export function ArchitectureOptions() {
	return architectureManifests().map(({ id, name, maker }) => <option key={id} value={id}>
		<span>{maker && name.startsWith(`${maker} `) ? name.slice(maker.length + 1) : name}</span>
		{/* The separator shows only where a select cannot lay out its options. */}
		{maker && <span className="architecture-maker"><span className="architecture-separator"> · </span>{maker}</span>}
	</option>)
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
	const { architecture, gutterColumns, heatMap, heatMapLines, setGutterColumns, setHeatMap, setHeatMapLines, setSetting, setTargetSetting, settings, switchArchitecture, target, targetSettings } = useTHRAXStore()
	const set = <Key extends keyof ThraxSettings>(key: Key) => (value: ThraxSettings[Key]) => setSetting(key, value)
	const schema = target?.definition.settings
	const multipleEntries = target?.definition.multipleEntries === true
	const sections = dialogSections(target?.definition, targetSettings)
	const place = (title: string) => ({ title, index: sections.findIndex(section => section.id === `common:${title}`), count: sections.length })
	const contribution = (title: string) => schema && <TargetFields schema={schema} group={title} values={targetSettings} onChange={setTargetSetting} />
	const ownGroups = sections.filter(section => section.architecture)

	return (
		<Modal title="Settings" onClose={onClose} className="settings-dialog" movable persistKey="dialog.settings">
			{ownGroups.map((section) => <Group key={section.id} title={section.title} index={sections.indexOf(section)} count={sections.length} scope={target?.definition.name}>
				{section.group === 'CPU' && <label className="settings-row settings-field" title="The processor the open files are assembled for and run on">
					<span>Architecture</span>
					<select className="architecture-select" value={architecture} onChange={(event) => void switchArchitecture(event.target.value)}>
						{/* The closed select shows the chosen option's own layout; React has no type for this element yet. */}
						<button type="button">{React.createElement('selectedcontent')}</button>
						<ArchitectureOptions />
					</select>
				</label>}
				{contribution(section.group)}
			</Group>)}

			<Group {...place('Common')}>
				{multipleEntries && <Check
					label="Assemble all open files"
					hint="Assemble every open tab as one program; the active tab holds the entry point"
					checked={settings.assembleAll}
					onChange={set('assembleAll')}
				/>}
				<label className="settings-row settings-field" title="Instructions the step-back history keeps">
					<span>Backstep limit</span>
					{/* A part-typed value such as an empty field fails the validator, so
					    the field simply keeps the last accepted number. */}
					<input
						type="number"
						min={1}
						max={MAX_BACKSTEP_LIMIT}
						title={`Instruction target for retained history, up to ${MAX_BACKSTEP_LIMIT.toLocaleString()}. Memory use depends on the CPU and recorded effects; the history memory budget also applies.`}
						value={settings.backstepLimit}
						onChange={(event) => {
							const limit = Number(event.target.value)
							if (SETTINGS_VALIDATORS.backstepLimit(limit)) setSetting('backstepLimit', limit)
						}}
					/>
				</label>
			</Group>

			<Group {...place('Display')} scope="Common">
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

			<Group {...place('Editor')} scope="Common">
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
