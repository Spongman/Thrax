import { useEffect, useMemo, useRef } from 'react'
import { formatAddress, parseAddress } from '../core/format'
import type { BitmapFormat, MemoryInspector } from '../architectures/contracts'
import { isOneOf, useStoredState } from '../hooks/useStoredState'
import PanelGroup from './PanelGroup'
import { pixelBytes, pixelColor } from './bitmapPixels'
import './BitmapDisplay.css'

interface BitmapDisplayProps {
	format: BitmapFormat
	palette?: readonly number[] | null
	memory: MemoryInspector
	/** Where the display starts until one is chosen: the target's data base. */
	defaultBase?: number
	/** The architecture, whose own base address is remembered apart from every other's. */
	architecture: string
}

const DISPLAY_SIZES = [128, 256, 512]
const UNIT_SIZES = [1, 2, 4, 8, 16]


function BitmapDisplay({ memory, defaultBase = 0, architecture, palette, format }: BitmapDisplayProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [baseAddress, setBaseAddress] = useStoredState(`bitmap.base.${architecture}`, formatAddress(defaultBase), (value) => typeof value === 'string')
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
		const stride = pixelBytes(format)
		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const address = parsedBaseAddress + ((row * columns + column) * stride)
				const color = pixelColor(memory, address, format, palette)
				if (color === undefined || color === 0) continue
				context.fillStyle = `#${color.toString(16).padStart(6, '0')}`
				context.fillRect(column * unitSize, row * unitSize, unitSize, unitSize)
			}
		}
	}, [columns, format, height, memory, palette, parsedBaseAddress, rows, unitSize, width])

	return (
		<div className="bitmap-display">
			<PanelGroup title="Framebuffer" flush>
				{parsedBaseAddress === null ? (
					<div className="bitmap-error">Enter a decimal or hexadecimal base address.</div>
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
			<p className="bitmap-description">{format.kind === 'indexed8'
				? `Each byte selects a colour from the ${palette ? 'example' : 'configured'} palette, in row-major order.`
				: 'Each four-byte pixel holds a 24-bit RGB colour (0x00RRGGBB), in row-major order.'}</p>
		</div>
	)
}

export default BitmapDisplay
