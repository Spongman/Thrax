import React from 'react'
import { createPortal } from 'react-dom'
import { readStoredSetting, writeStoredSetting } from '../hooks/useStoredState'
import './Modal.css'

/** Selector for what Tab can reach, so the trap knows where the ends are. */
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export type ModalKeyAction = 'close' | 'wrap-first' | 'wrap-last' | null

/**
 * What a key pressed while a modal is open should do, given whether focus is
 * sitting on the first or the last thing the dialog can focus.  Split out from
 * the component so the policy is testable without a DOM.
 */
export function modalKeyAction(event: { key: string, shiftKey: boolean }, edge: { first: boolean, last: boolean }): ModalKeyAction {
	if (event.key === 'Escape') return 'close'
	if (event.key !== 'Tab') return null
	if (event.shiftKey) return edge.first ? 'wrap-last' : null
	return edge.last ? 'wrap-first' : null
}

/** Where a dragged or resized dialog sits, once it stops being centred. */
export interface ModalFrame {
	left: number
	top: number
	width: number
	height: number
}

const MIN_WIDTH = 320
const MIN_HEIGHT = 160
/** Enough of the header must stay on screen to grab it again. */
const KEEP_ON_SCREEN = 48

/**
 * Keeps a dragged dialog reachable: it may hang off any edge, but never so far
 * that the header it is dragged by is out of reach.
 */
export function clampFrame(frame: ModalFrame, viewport: { width: number, height: number }): ModalFrame {
	return {
		...frame,
		left: Math.min(Math.max(frame.left, KEEP_ON_SCREEN - frame.width), viewport.width - KEEP_ON_SCREEN),
		top: Math.min(Math.max(frame.top, 0), viewport.height - KEEP_ON_SCREEN),
	}
}

/** A resize never shrinks past what the dialog needs to stay usable. */
export function resizeFrame(frame: ModalFrame, deltaX: number, deltaY: number): ModalFrame {
	return {
		...frame,
		width: Math.max(MIN_WIDTH, frame.width + deltaX),
		height: Math.max(MIN_HEIGHT, frame.height + deltaY),
	}
}

/** How much of the screen a reopened dialog leaves around itself. */
const EDGE = 8

/**
 * Brings a remembered frame back onto the screen it is being reopened on.
 * Unlike the drag clamp, which only keeps the header reachable, this puts the
 * whole dialog in view: the window may have been resized, or moved to a smaller
 * display, since the frame was stored.
 */
export function fitOnScreen(frame: ModalFrame, viewport: { width: number, height: number }): ModalFrame {
	const width = Math.max(MIN_WIDTH, Math.min(frame.width, viewport.width - EDGE * 2))
	const height = Math.max(MIN_HEIGHT, Math.min(frame.height, viewport.height - EDGE * 2))
	return {
		width,
		height,
		left: Math.min(Math.max(frame.left, EDGE), Math.max(EDGE, viewport.width - width - EDGE)),
		top: Math.min(Math.max(frame.top, EDGE), Math.max(EDGE, viewport.height - height - EDGE)),
	}
}

const isFrame = (value: unknown): value is ModalFrame =>
	typeof value === 'object' && value !== null &&
	(['left', 'top', 'width', 'height'] as const).every((key) => Number.isFinite((value as Record<string, unknown>)[key]))

const isScrollTop = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0

interface ModalProps {
	title: string
	onClose: () => void
	children: React.ReactNode
	/** Actions along the bottom; a confirm prompt puts its button pair here. */
	footer?: React.ReactNode
	/** Extra class on the dialog, for a caller that needs its own width. */
	className?: string
	/** Lets the dialog be moved by its header and resized from its corner. */
	movable?: boolean
	/** Remembers where the dialog was left, how big, and how far scrolled. */
	persistKey?: string
}

/**
 * A dialog over the workspace: portalled to the body so no panel's overflow or
 * stacking context can clip it, dismissed by Escape or the backdrop, and with
 * Tab kept inside it while it is open.
 */
function Modal({ title, onClose, children, footer, className, movable = false, persistKey }: ModalProps) {
	const dialogRef = React.useRef<HTMLDivElement>(null)
	const bodyRef = React.useRef<HTMLDivElement>(null)
	// Null until the dialog is first moved or resized; until then the backdrop
	// centres it and its own CSS sizes it.  A remembered frame is fitted to the
	// screen it is reopening on, which may not be the one it was left on.
	const [frame, setFrame] = React.useState<ModalFrame | null>(() => {
		if (persistKey === undefined) return null
		const stored = readStoredSetting<ModalFrame | null>(`${persistKey}.frame`, null, isFrame)
		return stored && fitOnScreen(stored, { width: window.innerWidth, height: window.innerHeight })
	})

	// Written on close rather than on every pointer move, so a drag is one write.
	React.useEffect(() => {
		if (persistKey === undefined) return
		const body = bodyRef.current
		const stored = readStoredSetting(`${persistKey}.scroll`, 0, isScrollTop)
		if (body) body.scrollTop = stored
		return () => {
			writeStoredSetting(`${persistKey}.scroll`, body?.scrollTop ?? stored)
		}
	}, [persistKey])

	/**
	 * Both gestures work the same way: take the dialog's current box as the
	 * starting frame, then follow the pointer until it is released.
	 */
	const startGesture = (event: React.PointerEvent, move: (from: ModalFrame, dx: number, dy: number) => ModalFrame) => {
		if (event.button !== 0) return
		const box = dialogRef.current?.getBoundingClientRect()
		if (!box) return
		event.preventDefault()
		const from: ModalFrame = { left: box.left, top: box.top, width: box.width, height: box.height }
		const originX = event.clientX
		const originY = event.clientY
		const onMove = (moveEvent: PointerEvent) => {
			setFrame(clampFrame(move(from, moveEvent.clientX - originX, moveEvent.clientY - originY), { width: window.innerWidth, height: window.innerHeight }))
		}
		const onUp = () => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
			if (persistKey !== undefined) {
				setFrame((current) => {
					if (current) writeStoredSetting(`${persistKey}.frame`, current)
					return current
				})
			}
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
	}

	const onHeaderPointerDown = (event: React.PointerEvent) => {
		// The close button is in the header and is not a drag handle.
		if (!movable || (event.target as HTMLElement).closest('button')) return
		startGesture(event, (from, dx, dy) => ({ ...from, left: from.left + dx, top: from.top + dy }))
	}

	const onResizePointerDown = (event: React.PointerEvent) => {
		startGesture(event, (from, dx, dy) => resizeFrame(from, dx, dy))
	}

	// Read through a ref so the trap below is set up once, when the dialog opens.
	// A caller that passes a fresh `onClose` on every render is ordinary, and
	// re-running the trap for it moved focus to the first control: typing in a
	// field published a setting, which re-rendered the caller, which took the
	// cursor to the close button between one keystroke and the next.
	const onCloseRef = React.useRef(onClose)
	onCloseRef.current = onClose

	React.useEffect(() => {
		// Whatever opened the dialog gets focus back when it closes.
		const opener = document.activeElement as HTMLElement | null
		const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
		focusable()[0]?.focus()

		const onKeyDown = (event: KeyboardEvent) => {
			const items = focusable()
			const active = document.activeElement
			const action = modalKeyAction(event, {
				first: items.length === 0 || active === items[0],
				last: items.length === 0 || active === items[items.length - 1],
			})
			if (action === null) return
			event.preventDefault()
			if (action === 'close') onCloseRef.current()
			else if (action === 'wrap-first') items[0]?.focus()
			else items[items.length - 1]?.focus()
		}

		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('keydown', onKeyDown)
			opener?.focus()
		}
	}, [])

	return createPortal(
		<div
			className="modal-backdrop"
			// Only a press that starts on the backdrop dismisses, so a drag that
			// ends outside a text field in the dialog does not.
			onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
		>
			<div
				className={`modal${className ? ` ${className}` : ''}${movable ? ' modal-movable' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				ref={dialogRef}
				style={frame ? { position: 'fixed', left: frame.left, top: frame.top, width: frame.width, height: frame.height, maxWidth: 'none', maxHeight: 'none' } : undefined}
			>
				<div className={`modal-header${movable ? ' modal-grip' : ''}`} onPointerDown={onHeaderPointerDown}>
					<span className="modal-title">{title}</span>
					<button className="btn btn-icon" onClick={onClose} aria-label="Close" title="Close">✕</button>
				</div>
				<div className="modal-body" ref={bodyRef}>{children}</div>
				{footer && <div className="modal-footer">{footer}</div>}
				{movable && <div className="modal-resize" onPointerDown={onResizePointerDown} aria-hidden="true" />}
			</div>
		</div>,
		document.body,
	)
}

export default Modal
