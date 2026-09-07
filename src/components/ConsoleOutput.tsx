import React from 'react'
import type { PendingInput } from '../core/types'
import { splitLocations } from './consoleLocations'
import './ConsoleOutput.css'

interface ConsoleOutputProps {
	output: string
	pendingInput: PendingInput | null
	onSubmitInput: (input: string, cancelled?: boolean) => void
	/** Where a clicked `file:line:` in the output sends the editor. */
	onSelectSource?: (file: string, line: number) => void
}

/** What to ask for, given the syscall that is waiting. */
function promptFor(request: PendingInput): string {
	if (request.prompt) return request.prompt
	if (request.type === 'integer') return 'Enter an integer'
	if (request.type === 'character') return 'Enter one character'
	if (request.type === 'float' || request.type === 'double') return 'Enter a number'
	if (request.type === 'confirm') return 'Confirm'
	return `Enter a string${request.maximumLength ? ` (max ${request.maximumLength - 1})` : ''}`
}

function ConsoleOutput({ output, pendingInput, onSubmitInput, onSelectSource }: ConsoleOutputProps) {
	const endRef = React.useRef<HTMLDivElement>(null)
	const [input, setInput] = React.useState('')

	React.useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [output])

	React.useEffect(() => {
		setInput('')
	}, [pendingInput])

	const submit = (event: React.FormEvent) => {
		event.preventDefault()
		if (!pendingInput) return
		onSubmitInput(input)
	}

	const confirming = pendingInput?.type === 'confirm'

	return (
		<div className="console-output">
			{output.length > 0 ? (
				<pre>
					{splitLocations(output).map((part, index) => part.kind === 'location' && onSelectSource
						? (
							<button
								key={index}
								type="button"
								className="console-location"
								title={`Go to ${part.location.file} line ${part.location.line}`}
								onClick={() => onSelectSource(part.location.file, part.location.line)}
							>
								{part.text}
							</button>
						)
						: <React.Fragment key={index}>{part.text}</React.Fragment>)}
				</pre>
			) : (
				<div className="console-empty">Program output will appear here</div>
			)}
			{pendingInput && (
				<form className={`console-input${pendingInput.dialog ? ' console-dialog' : ''}`} onSubmit={submit}>
					<label htmlFor="mips-console-input">{promptFor(pendingInput)}</label>
					<div className="console-entry">
						{confirming ? (
							<>
								<button type="button" onClick={() => onSubmitInput('yes')}>Yes</button>
								<button type="button" onClick={() => onSubmitInput('no')}>No</button>
							</>
						) : (
							<>
								<input
									autoFocus
									id="mips-console-input"
									maxLength={pendingInput.type === 'character' ? 1 : undefined}
									onChange={(event) => setInput(event.target.value)}
									value={input}
								/>
								<button type="submit">Send</button>
							</>
						)}
					</div>
					{pendingInput.dialog && (
						<button type="button" className="console-cancel" onClick={() => onSubmitInput('', true)}>
							Cancel
						</button>
					)}
				</form>
			)}
			<div ref={endRef} />
		</div>
	)
}

export default ConsoleOutput
