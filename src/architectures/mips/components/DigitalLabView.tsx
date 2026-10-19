import React from 'react'
import './DigitalLabView.css'
import { COUNTER_PERIOD, type DigitalLabState } from '../tools/digitalLab'
import PanelGroup from '../../../components/PanelGroup'

/** Where each of the seven segments sits, as a fraction of the display box. */
const SEGMENT_SHAPES: Array<{ bit: number, points: string }> = [
	{ bit: 0, points: '12,4 36,4 32,10 16,10' },
	{ bit: 1, points: '38,6 38,28 32,32 32,12' },
	{ bit: 2, points: '38,34 38,56 32,50 32,30' },
	{ bit: 3, points: '12,58 36,58 32,52 16,52' },
	{ bit: 4, points: '10,34 10,56 16,50 16,30' },
	{ bit: 5, points: '10,6 10,28 16,32 16,12' },
	{ bit: 6, points: '14,31 34,31 30,35 18,35' },
]

const POINT_BIT = 7

function SevenSegment({ bits }: { bits: number }) {
	const lit = (bit: number) => (bits & (1 << bit)) !== 0
	return (
		<svg className="seven-segment" viewBox="0 0 48 68" role="img" aria-label={`segments 0x${bits.toString(16)}`}>
			{SEGMENT_SHAPES.map(({ bit, points }) => (
				<polygon key={bit} className={`segment${lit(bit) ? ' lit' : ''}`} points={points} />
			))}
			<circle className={`segment${lit(POINT_BIT) ? ' lit' : ''}`} cx="43" cy="57" r="3" />
		</svg>
	)
}

interface DigitalLabViewProps {
	state: DigitalLabState
	onPressKey: (key: number | null) => void
}

/**
 * The device as the exercises use it: two displays the program lights segment
 * by segment, a keypad it scans a row at a time, and the timer.
 */
function DigitalLabView({ state, onPressKey }: DigitalLabViewProps) {
	return (
		<div className="digital-lab">
			<PanelGroup title="Displays">
				<div className="lab-displays">
					{/* The left display is the high byte, so it is drawn first. */}
					<SevenSegment bits={state.displays[1]} />
					<SevenSegment bits={state.displays[0]} />
				</div>
			</PanelGroup>

			<PanelGroup title="Keypad">
				<div className="lab-keypad">
					{Array.from({ length: 16 }, (unused, key) => (
						<button
							key={key}
							type="button"
							className={`lab-key${state.pressedKey === key ? ' held' : ''}`}
							title={`Key ${key.toString(16).toUpperCase()}`}
							onClick={() => onPressKey(state.pressedKey === key ? null : key)}
						>
							{key.toString(16).toUpperCase()}
						</button>
					))}
				</div>
			</PanelGroup>

			<PanelGroup title="Readout">
				<dl className="lab-readout">
					<dt>row</dt>
					<dd>0x{(state.keypadRow & 0xff).toString(16).padStart(2, '0')}</dd>
					<dt>reads</dt>
					<dd>0x{(state.keypadOut & 0xff).toString(16).padStart(2, '0')}</dd>
					<dt>counter</dt>
					<dd>{state.counterEnabled ? `${state.counterRemaining}/${COUNTER_PERIOD}` : 'off'}</dd>
					<dt>interrupts</dt>
					<dd>{state.timerInterrupts} timer, {state.keypadInterrupts} keypad</dd>
				</dl>
			</PanelGroup>

			<p className="lab-help">
				A key stays held until it is clicked again, so a scan of its row finds it.
				The program lights the displays by writing segment bits, selects a keypad row,
				and enables the timer, at the four bytes above the memory-mapped base.
			</p>
		</div>
	)
}

export default DigitalLabView
