import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../core/coprocessor'
import { formatHex, formatWord } from '../core/format'
import './ToolPanels.css'
import EditableCell from './EditableCell'
import { parseEditedDouble, parseEditedValue, withoutLeadingZeros } from './editValue'

interface Props {
	/** The raw word of the register being inspected, or the low word of a pair. */
	bits: number
	/** High word of the pair, which makes this a double-precision reading. */
	highBits?: number
	/**
	 * Writes the register back.  Absent, the panel is a reading of the register
	 * rather than a way into it, which is what it is while a program runs.
	 */
	onEdit?: (bits: number, high?: number) => boolean
	editable?: boolean
}

const binary = (value: number, width: number) => (value >>> 0).toString(2).padStart(width, '0')

/** What the exponent field means, which is where the special cases live. */
function describe(exponent: number, zeroFraction: boolean, reserved: number, bias: number): string {
	if (exponent === 0) return zeroFraction ? 'zero' : 'subnormal'
	if (exponent === reserved) return zeroFraction ? 'infinity' : 'NaN'
	return `normal, exponent ${exponent - bias}`
}

/** The IEEE-754 fields of one register, or of the pair holding a double. */
function FloatBitsView({ bits: word, highBits, onEdit, editable = false }: Props) {
	const double = highBits !== undefined
	// A double keeps its sign, exponent and the top of its fraction in the odd
	// register of the pair, and the rest of the fraction in the even one.
	const high = highBits ?? word
	const sign = high >>> 31
	const exponent = double ? (high >>> 20) & 0x7ff : (high >>> 23) & 0xff
	const fractionHigh = double ? high & 0xfffff : high & 0x7fffff
	const fractionLow = double ? word >>> 0 : 0
	const zeroFraction = fractionHigh === 0 && fractionLow === 0
	// Both scales are exact powers of two, so the significand divides out whole.
	const significand = (fractionHigh * (double ? 0x100000000 : 1) + fractionLow) / (double ? 2 ** 52 : 0x800000)
	const writable = editable && onEdit !== undefined

	return (
		<div className="tool float-bits">
			<div className="tool-headline">
				<div className="tool-metric">
					<EditableCell
						className="tool-metric-value"
						text={double ? formatDouble(bitsToDouble(word, high)) : formatSingle(bitsToSingle(word))}
						editable={writable}
						onCommit={(typed) => {
							if (!onEdit) return false
							if (double) {
								const pair = parseEditedDouble(typed)
								return pair !== null && onEdit(pair.low, pair.high)
							}
							const value = parseEditedValue(typed, 'f')
							return value !== null && onEdit(value)
						}}
					>
						{double ? formatDouble(bitsToDouble(word, high)) : formatSingle(bitsToSingle(word))}
					</EditableCell>
					<span className="tool-metric-label">{double ? 'Double-precision value' : 'Single-precision value'}</span>
				</div>
				<div className="tool-metric">
					{/* A double is two words, so only the single form is one cell. */}
					<EditableCell
						className="tool-metric-value"
						text={double ? `${formatWord(high)} ${formatWord(word)}` : withoutLeadingZeros(formatWord(word))}
						editable={writable && !double}
						onCommit={(typed) => {
							const value = parseEditedValue(typed, '0x')
							return value !== null && (onEdit?.(value) ?? false)
						}}
					>
						{double ? `${formatWord(high)} ${formatWord(word)}` : formatWord(word)}
					</EditableCell>
					<span className="tool-metric-label">Bit pattern</span>
				</div>
			</div>

			<div className="tool-bits">
				<div className="tool-bit-group">
					<span className="tool-bit-sign">{binary(sign, 1)}</span>
					<span className="tool-metric-label">sign</span>
				</div>
				<div className="tool-bit-group">
					<span className="tool-bit-exponent">{binary(exponent, double ? 11 : 8)}</span>
					<span className="tool-metric-label">exponent</span>
				</div>
				<div className="tool-bit-group">
					<span className="tool-bit-fraction">{double ? binary(fractionHigh, 20) + binary(fractionLow, 32) : binary(fractionHigh, 23)}</span>
					<span className="tool-metric-label">fraction</span>
				</div>
			</div>

			<table>
				<tbody>
					<tr><td>Sign</td><td>{sign === 0 ? 'positive' : 'negative'}</td></tr>
					<tr><td>Exponent field</td><td>{exponent} ({describe(exponent, zeroFraction, double ? 0x7ff : 0xff, double ? 1023 : 127)})</td></tr>
					<tr><td>Fraction field</td><td>0x{double ? `${formatHex(fractionHigh, 5)}${formatHex(fractionLow, 8)}` : formatHex(fractionHigh, 6)}</td></tr>
					<tr><td>Significand</td><td>{exponent === 0 ? '0' : '1'}.{significand.toFixed(double ? 16 : 10).slice(2)}</td></tr>
				</tbody>
			</table>
		</div>
	)
}

export default FloatBitsView
