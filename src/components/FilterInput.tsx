import React from 'react'
import './FilterInput.css'

interface FilterInputProps {
	value: string
	onChange: (value: string) => void
	/** What Enter does, where the filter is a search as well as a filter. */
	onSubmit?: () => void
	placeholder?: string
	title?: string
}

/**
 * A filter box with its clear button joined to it, so emptying a filter is one
 * click rather than a selection and a keystroke.  Every panel that filters a
 * list uses this, so the control reads the same wherever it appears.
 */
function FilterInput({ value, onChange, onSubmit, placeholder = 'Filter', title }: FilterInputProps) {
	const inputRef = React.useRef<HTMLInputElement>(null)
	return (
		<div className="filter-input">
			<input
				ref={inputRef}
				className="filter-text"
				value={value}
				placeholder={placeholder}
				title={title}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => { if (event.key === 'Enter') onSubmit?.() }}
			/>
			<button
				type="button"
				className="filter-clear"
				title="Clear the filter"
				aria-label="Clear the filter"
				disabled={value === ''}
				// The typing was in the box, so the box keeps the keyboard.
				onClick={() => { onChange(''); inputRef.current?.focus() }}
			>
				&times;
			</button>
		</div>
	)
}

export default FilterInput
