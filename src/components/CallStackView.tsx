import type { CallFrame } from '../architectures/contracts'
import { formatWord } from '../core/format'
import { HexWord } from './HexNumber'
import './CallStackView.css'

interface CallStackViewProps {
	frames: readonly CallFrame[]
	pc: number
	labels: ReadonlyMap<string, number>
	hasProgram: boolean
	halted: boolean
	/** Index into frames of the selected frame, -1 for the running frame, null for none. */
	selectedFrame: number | null
	onSelect: (frame: number | null) => void
}

const formatAddress = formatWord

/** Nearest label at or below `address`, rendered as `name` or `name+0x<offset>`. */
function describeAddress(address: number, labels: ReadonlyMap<string, number>) {
	let bestName: string | null = null
	let bestAddress = -1
	for (const [name, labelAddress] of labels) {
		if (labelAddress <= address && labelAddress > bestAddress) {
			bestName = name
			bestAddress = labelAddress
		}
	}
	if (bestName === null) return formatAddress(address)
	const offset = address - bestAddress
	return offset === 0 ? bestName : `${bestName}+0x${offset.toString(16)}`
}

function CallStackView({ frames, pc, labels, hasProgram, halted, selectedFrame, onSelect }: CallStackViewProps) {
	if (!hasProgram) return <div className="call-stack-empty">Assemble a program to see the call stack</div>

	const reversed = [...frames].reverse()

	return (
		<div className="call-stack-view">
			<button
				type="button"
				className={`call-stack-frame call-stack-frame-current${selectedFrame === -1 ? ' selected' : ''}`}
				onClick={() => onSelect(selectedFrame === -1 ? null : -1)}
			>
				<div className="call-stack-name">#0 {describeAddress(pc, labels)}{halted ? ' (halted)' : ''}</div>
				<div>PC <HexWord value={pc} /></div>
				{reversed.length > 0 && <div>Return <HexWord value={reversed[0].returnAddress} /></div>}
			</button>
			{reversed.map((frame, index) => {
				// Recursion repeats addresses, so frames are identified by position.
				const frameIndex = frames.length - 1 - index
				return (
				<button
					type="button"
					key={frameIndex}
					className={`call-stack-frame${selectedFrame === frameIndex ? ' selected' : ''}`}
					onClick={() => onSelect(selectedFrame === frameIndex ? null : frameIndex)}
				>
					<div className="call-stack-name">#{index + 1} {describeAddress(frame.callAddress, labels)}</div>
					<div>Call <HexWord value={frame.callAddress} /></div>
					<div>Target <HexWord value={frame.targetAddress} /></div>
					<div>Return <HexWord value={frame.returnAddress} /></div>
				</button>
				)
			})}
		</div>
	)
}

export default CallStackView
