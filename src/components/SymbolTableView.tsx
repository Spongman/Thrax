import React from 'react'
import './SymbolTableView.css'
import './ToggleGroup.css'
import type { DataEntry, SymbolTables } from '../core/types'
import { formatWord } from '../core/format'
import HexNumber from './HexNumber'
import FilterInput from './FilterInput'
import { useHover, useHovered } from '../store/hover'
import { dataRuns, runAt, valueOf } from './symbolValue'
import type { MemoryView } from '../core/types'
import type { SourceLocation } from '../core/sourceIndex'
import { useTHRAXStore } from '../store/thraxStore'
import { isFlagSet, useStoredState } from '../hooks/useStoredState'
import { nextToggles } from './toggleGroup'

/** The columns beside the name, each of which can be turned off. */
const COLUMNS = ['address', 'type', 'value'] as const
const ALL_COLUMNS = { address: true, type: true, value: true }

/** The directives whose value is text, so it is coloured as text. */
const TEXT_DIRECTIVES = ['.ascii', '.asciiz']

/** One row of the table: a name, where it points, and who can see it. */
export interface SymbolRow {
	name: string
	address: number
	/** The file that defined it, or null for a name every file can see. */
	file: string | null
}

export type SymbolSort = 'name' | 'address'

/**
 * Every symbol as rows, globals first.  Two files may each define the same
 * name, so the file is part of what identifies a row rather than decoration.
 */
export function symbolRows(symbols: SymbolTables, sort: SymbolSort = 'name'): SymbolRow[] {
	const rows: SymbolRow[] = []
	for (const [name, address] of symbols.globals) rows.push({ name, address, file: null })
	for (const [file, table] of symbols.locals) {
		for (const [name, address] of table) rows.push({ name, address, file })
	}
	return sortSymbols(rows, sort)
}

export function sortSymbols(rows: SymbolRow[], sort: SymbolSort): SymbolRow[] {
	return [...rows].sort((left, right) => {
		// Globals stay above the per-file sections whichever column is sorted on.
		if ((left.file === null) !== (right.file === null)) return left.file === null ? -1 : 1
		if (left.file !== right.file) return (left.file ?? '').localeCompare(right.file ?? '')
		return sort === 'address' ? left.address - right.address : left.name.localeCompare(right.name)
	})
}

/** The rows grouped under the heading each belongs to. */
export function symbolSections(rows: SymbolRow[]): Array<{ file: string | null, rows: SymbolRow[] }> {
	const sections: Array<{ file: string | null, rows: SymbolRow[] }> = []
	for (const row of rows) {
		const last = sections[sections.length - 1]
		if (last && last.file === row.file) last.rows.push(row)
		else sections.push({ file: row.file, rows: [row] })
	}
	return sections
}

/**
 * The line a name is written on.
 *
 * A row names its unit, and a unit's names are its own, so a local is looked up
 * there.  A global has left its unit's table behind, so every unit is asked;
 * two units cannot both define one global, which is what makes that safe.
 */
export function symbolSite(sites: Map<string, Map<string, SourceLocation>>, row: SymbolRow): SourceLocation | null {
	if (row.file !== null) return sites.get(row.file)?.get(row.name) ?? null
	for (const unit of sites.values()) {
		const site = unit.get(row.name)
		if (site) return site
	}
	return null
}

interface SymbolTableViewProps {
	symbols: SymbolTables
	onSelectAddress?: (address: number) => void
	/** The address under the pointer anywhere, lit here wherever it appears. */
	hoveredAddress?: number | null
	/** The symbol under the pointer anywhere, which may be one of these rows. */
	hoveredSymbol?: string | null
	/** Says what is under the pointer here: a symbol is its address as well. */
	onHover?: (values: { address?: number | null, symbol?: string | null }) => void
	/** The runs the data directives laid out, which say what a name was declared as. */
	data?: readonly DataEntry[]
	/** Memory as it stands, so the value shown is the value now rather than at load. */
	memory?: MemoryView
	/** Where a symbol is written, or null where nothing says. */
	sourceOf?: (row: SymbolRow) => SourceLocation | null
	/** Asks the editor to show a line, which is what a name here points at. */
	onSelectSource?: (file: string, line: number) => void
}

function SymbolTableView({ symbols, onSelectAddress, hoveredAddress = null, hoveredSymbol = null, onHover, data, memory, sourceOf, onSelectSource }: SymbolTableViewProps) {
	const [sort, setSort] = React.useState<SymbolSort>('name')
	const [filter, setFilter] = React.useState('')
	const [columns, setColumns] = useStoredState('symbols.columns', ALL_COLUMNS, isFlagSet(COLUMNS))

	const sections = React.useMemo(() => {
		const needle = filter.trim().toLowerCase()
		const rows = symbolRows(symbols, sort)
		return symbolSections(needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows)
	}, [symbols, sort, filter])

	// What each name was declared as, looked up by address rather than kept with
	// the symbol: the assembler already wrote the directive down beside the bytes.
	const runs = React.useMemo(() => dataRuns(data ?? []), [data])
	const declared = React.useCallback((address: number) => {
		const run = runAt(runs, address)
		if (!run) return { type: null, value: null }
		return { type: run.directive, value: memory ? valueOf(memory, run, address) : null }
	}, [memory, runs])
	// A program with no data at all is a table of names and addresses, as before.
	const typed = runs.length > 0
	const showType = typed && columns.type
	const showValue = typed && columns.value

	const empty = sections.length === 0

	/**
	 * A symbol is a name, a line and an address at once, so going to one goes to
	 * all of it: the memory window shows the address and the editor the line,
	 * whichever half of the row was clicked.
	 */
	const goTo = (row: SymbolRow) => {
		onSelectAddress?.(row.address)
		const source = sourceOf?.(row)
		if (source) onSelectSource?.(source.file, source.line)
	}

	// Filtering is a search, and a search answers with the thing it found.
	const goToFirstMatch = () => {
		const first = sections[0]?.rows[0]
		if (first) goTo(first)
	}

	return (
		<div className="symbol-view">
			<div className="symbol-controls">
				<FilterInput
					value={filter}
					onChange={setFilter}
					onSubmit={goToFirstMatch}
					title="Filter the names; Enter goes to the first match"
				/>
				<div className="toggle-group" role="group" aria-label="Sort">
					{(['name', 'address'] as const).map((column) => (
						<button
							key={column}
							type="button"
							className={`toggle-button${sort === column ? ' active' : ''}`}
							title={`Sort by ${column}`}
							onClick={() => setSort(column)}
						>
							{column}
						</button>
					))}
				</div>
				{/* The name is what the table is for, so every other column is optional. */}
				<div className="toggle-group" role="group" aria-label="Columns">
					{COLUMNS.map((column) => (
						<button
							key={column}
							type="button"
							className={`toggle-button${columns[column] ? ' active' : ''}`}
							title={`Show the ${column} column`}
							aria-pressed={columns[column]}
							disabled={column !== 'address' && !typed}
							onClick={(event) => setColumns((current) => nextToggles({ ...ALL_COLUMNS, ...current }, column, event))}
						>
							{column === 'address' ? 'addr' : column}
						</button>
					))}
				</div>
			</div>

			{empty && <div className="symbol-empty">{filter ? 'No symbol matches.' : 'Assemble a program to see its symbols.'}</div>}

			{sections.map((section) => (
				<div className="symbol-section" key={section.file === null ? 'globals' : `file:${section.file}`}>
					<div className="symbol-heading">{section.file ?? 'global'}</div>
					<table className="symbol-table">
						<tbody>
							{section.rows.map((row) => {
								const source = sourceOf?.(row) ?? null
								// Both halves of a row go to the same two places, so they say so
								// in the same words; a name with no line still has an address.
								const goTitle = `Show ${formatWord(row.address)} in memory${source ? ` and ${source.file}:${source.line} in the editor` : ''}`
								// A name is the address it stands for, so hovering either lights
								// the memory, the history and the source too.
								const hovers = {
									onMouseEnter: () => onHover?.({ symbol: row.name, address: row.address }),
									onMouseLeave: () => onHover?.({ symbol: null, address: null }),
								}
								return (
									<tr
										key={`${section.file ?? ''}:${row.name}`}
										// The row is what the eye is looking for when an address is
										// hovered elsewhere: it says which name stands for it.
										className={row.address === hoveredAddress || row.name === hoveredSymbol ? 'address-hovered' : undefined}
									>
										{columns.address && (
											<td className="symbol-address">
												<button
													type="button"
													className="symbol-link"
													title={goTitle}
													{...hovers}
													onClick={() => goTo(row)}
												>
													<HexNumber text={formatWord(row.address)} />
												</button>
											</td>
										)}
										<td className="symbol-name" {...hovers}>
											<button
												type="button"
												className="symbol-link"
												title={goTitle}
												onClick={() => goTo(row)}
											>
												{/* A name is a label, and a label is written with its colon. */}
												{row.name}
												<span className="symbol-colon">:</span>
											</button>
										</td>
										{(showType || showValue) && (() => {
											const { type, value } = declared(row.address)
											return (
												<>
													{showType && <td className="symbol-type">{type ?? ''}</td>}
													{showValue && (
														<td className={`symbol-value${type !== null && TEXT_DIRECTIVES.includes(type) ? ' text' : ''}`}>{value ?? ''}</td>
													)}
												</>
											)
										})()}
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			))}
		</div>
	)
}

/** Reads the assembled program's symbols straight from the workspace. */
export function SymbolTablePanel() {
	const symbols = useTHRAXStore((state) => state.symbols)
	const focusAddress = useTHRAXStore((state) => state.focusMemoryAddress)
	const hover = useHover()
	const hoveredAddress = useHovered('address')
	const hoveredSymbol = useHovered('symbol')
	const data = useTHRAXStore((state) => state.programData)
	const memory = useTHRAXStore((state) => state.memory)
	const sourceIndex = useTHRAXStore((state) => state.sourceIndex)
	const symbolSites = useTHRAXStore((state) => state.symbolSites)
	const focusSourceLine = useTHRAXStore((state) => state.focusSourceLine)
	const sourceOf = React.useCallback(
		(row: SymbolRow) => symbolSite(symbolSites, row) ?? sourceIndex.lineForAddress(row.address),
		[sourceIndex, symbolSites],
	)
	return (
		<SymbolTableView
			symbols={symbols}
			data={data}
			memory={memory}
			sourceOf={sourceOf}
			onSelectSource={focusSourceLine}
			onSelectAddress={focusAddress}
			hoveredAddress={hoveredAddress}
			hoveredSymbol={hoveredSymbol}
			onHover={hover}
		/>
	)
}

export default SymbolTableView
