import React from 'react'
import type { KeyboardDisplayState } from '../core/types'
import PanelGroup from './PanelGroup'
import './KeyboardDisplayTool.css'

interface KeyboardDisplayToolProps {
	device: KeyboardDisplayState
	onSend: (input: string) => void
}

/** What a key press hands the receiver, or null for a key that types nothing. */
export function keyToInput(event: { key: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean }): string | null {
	if (event.ctrlKey || event.metaKey || event.altKey) return null
	if (event.key === 'Enter') return '\n'
	if (event.key === 'Tab') return '\t'
	if (event.key === 'Backspace') return '\b'
	return event.key.length === 1 ? event.key : null
}

/**
 * The Keyboard and Display Simulator: programs reach it through the MMIO words
 * at 0xffff0000 through 0xffff000c.  The keyboard is the box itself: click it
 * and type, and each key goes to the receiver as it is pressed, the way MARS's
 * does; pasting hands over the whole text.
 */
function KeyboardDisplayTool({ device, onSend }: KeyboardDisplayToolProps) {
	const outputRef = React.useRef<HTMLPreElement>(null)
	const [focused, setFocused] = React.useState(false)

	React.useEffect(() => {
		if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
	}, [device.displayOutput])

	const handleKeyDown = (event: React.KeyboardEvent) => {
		const input = keyToInput(event)
		if (input === null) return
		event.preventDefault()
		onSend(input)
	}

	const handlePaste = (event: React.ClipboardEvent) => {
		const text = event.clipboardData.getData('text')
		if (!text) return
		event.preventDefault()
		onSend(text)
	}

	return (
		<section className="keyboard-display-tool" aria-label="Keyboard and Display Simulator">
		<p className="keyboard-display-help">
			MMIO: receiver control/data <code>0xffff0000</code>/<code>0xffff0004</code>; transmitter control/data <code>0xffff0008</code>/<code>0xffff000c</code>.
		</p>

		<PanelGroup title="Status">
			<div className="keyboard-display-status">
				<span>Receiver: {device.queuedInput ? `ready (${device.queuedInput.length} queued)` : 'empty'}</span>
				<span>Transmitter: ready</span>
			</div>
		</PanelGroup>

		<PanelGroup title="Display" flush>
			<pre className="keyboard-display-output" ref={outputRef} aria-label="Display">
				{device.displayOutput || 'Program MMIO output will appear here'}
			</pre>
		</PanelGroup>

		<PanelGroup title="Keyboard" flush>
			<div
				className={`keyboard-display-keys${focused ? ' focused' : ''}`}
				role="textbox"
				aria-label="Keyboard: click here and type"
				aria-multiline="true"
				tabIndex={0}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onKeyDown={handleKeyDown}
				onPaste={handlePaste}
			>
				{device.queuedInput
					? <span className="keyboard-display-queued">{device.queuedInput}</span>
					: <span className="keyboard-display-hint">{focused ? 'Type; each key goes to the receiver' : 'Click here and type'}</span>}
				{focused && <span className="keyboard-display-caret" aria-hidden="true" />}
			</div>
		</PanelGroup>
		</section>
	)
}

export default KeyboardDisplayTool
