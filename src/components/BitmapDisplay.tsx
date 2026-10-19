import { useEffect, useMemo, useRef } from 'react'
import { formatWord, parseWord } from '../core/format'
import type { MemoryInspector } from '../architectures/contracts'
import { isOneOf, useStoredState } from '../hooks/useStoredState'
import PanelGroup from './PanelGroup'
import './BitmapDisplay.css'

interface BitmapDisplayProps {
	memory: MemoryInspector
	/** Where the display starts until one is chosen: the target's data base. */
	defaultBase?: number
}

const DISPLAY_SIZES = [128, 256, 512]
const UNIT_SIZES = [1, 2, 4, 8, 16]

function parseAddress(value: string) {
	const parsed = parseWord(value)
	return parsed !== null && parsed >= 0 && parsed <= 0xffffffff ? parsed >>> 0 : null
}

function BitmapDisplay({ memory, defaultBase = 0 }: BitmapDisplayProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [baseAddress, setBaseAddress] = useStoredState('bitmap.base', formatWord(defaultBase), (value) => typeof value === 'string')
	const [unitSize, setUnitSize] = useStoredState('bitmap.unit', 8, isOneOf(UNIT_SIZES))
	const [width, setWidth] = useStoredState('bitmap.width', 256, isOneOf(DISPLAY_SIZES))
	const [height, setHeight] = useStoredState('bitmap.height', 256, isOneOf(DISPLAY_SIZES))
	const parsedBaseAddress = useMemo(() => parseAddress(baseAddress), [baseAddress])
	const columns = Math.max(1, Math.floor(width / unitSize))
	const rows = Math.max(1, Math.floor(height / unitSize))

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || parsedBaseAddress === null) return
		const context = canvas.getContext('2d')
		if (!context) return
		canvas.width = width
		canvas.height = height
		context.fillStyle = '#000000'
		context.fillRect(0, 0, width, height)
		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const address = (parsedBaseAddress + ((row * columns + column) * 4)) >>> 0
				const color = memory.word(address)
				if (color === undefined || color === 0) continue
				context.fillStyle = `#${(color & 0x00ffffff).toString(16).padStart(6, '0')}`
				context.fillRect(column * unitSize, row * unitSize, unitSize, unitSize)
			}
		}
	}, [columns, height, memory, parsedBaseAddress, rows, unitSize, width])

	return (
		<div className="bitmap-display">
			<PanelGroup title="Framebuffer" flush>
				{parsedBaseAddress === null ? (
					<div className="bitmap-error">Enter a 32-bit decimal or hexadecimal base address.</div>
				) : (
					<canvas className="bitmap-canvas" ref={canvasRef} aria-label="Bitmap display" />
				)}
			</PanelGroup>
			<div className="bitmap-controls">
				<label>
					Base address
					<input aria-label="Bitmap base address" value={baseAddress} onChange={(event) => setBaseAddress(event.target.value)} spellCheck={false} />
				</label>
				<label>
					Unit pixels
					<select value={unitSize} onChange={(event) => setUnitSize(Number(event.target.value))}>
						{UNIT_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
					</select>
				</label>
				<label>
					Width
					<select value={width} onChange={(event) => setWidth(Number(event.target.value))}>
						{DISPLAY_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
					</select>
				</label>
				<label>
					Height
					<select value={height} onChange={(event) => setHeight(Number(event.target.value))}>
						{DISPLAY_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
					</select>
				</label>
			</div>
			<p className="bitmap-description">Each word is a 24-bit RGB pixel (0x00RRGGBB), in row-major order.</p>
		</div>
	)
}

export default BitmapDisplay
