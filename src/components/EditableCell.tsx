import React from 'react'
import './EditableCell.css'

interface EditableCellProps {
	/** What the cell shows when it is not being edited. */
	children: React.ReactNode
	/** The text an edit starts from, which is the value as it is shown. */
	text: string
	/** Off while a program is running: editing under it would race it. */
	editable: boolean
	title?: string
	className?: string
	/**
	 * What the cell covers, published as `data-address` and `data-size`.  The
	 * pointer finds a cell by looking for those, so a cell that does not carry
	 * them cannot be hovered even though it is drawn.
	 */
	address?: number
	size?: number
	/** Returns false to keep the editor open, which is how a bad value reads. */
	onCommit: (text: string) => boolean
}

/**
 * A value that becomes an input when it is double-clicked.  Enter commits,
 * Escape abandons, and moving away commits as Enter would, since leaving a
 * half-finished edit behind is the more surprising of the two.
 */
function EditableCell({ children, text, editable, title, className, address, size, onCommit }: EditableCellProps) {
	const [editing, setEditing] = React.useState(false)
	const [draft, setDraft] = React.useState(text)
	const [rejected, setRejected] = React.useState(false)

	const start = () => {
		if (!editable) return
		setDraft(text)
		setRejected(false)
		setEditing(true)
	}

	const commit = () => {
		if (onCommit(draft)) {
			setEditing(false)
			return
		}
		setRejected(true)
	}

	if (!editing) {
		// No title at all where none was asked for: the memory window has tips of
		// its own, and the browser's would sit on top of them.
		const tip = title === undefined ? undefined : editable ? `${title}: double-click to edit` : title
		return (
			<span
				className={className}
				title={tip}
				data-address={address}
				data-size={size}
				onDoubleClick={start}
			>
				{children}
			</span>
		)
	}

	return (
		<input
			className={`${className ?? ''} cell-editor${rejected ? ' rejected' : ''}`}
			value={draft}
			autoFocus
			spellCheck={false}
			onChange={(event) => {
				setDraft(event.target.value)
				setRejected(false)
			}}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault()
					commit()
				} else if (event.key === 'Escape') {
					event.preventDefault()
					setEditing(false)
				}
			}}
		/>
	)
}

export default EditableCell
