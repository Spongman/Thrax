import { formatAddress, formatRegister, formatWord } from '../core/format'
import { type HexDimming } from '../core/settings'
import { useTHRAXStore } from '../store/thraxStore'
import './HexNumber.css'

/** Digits in one unit of each fixed granularity; `pow2` is not one of them. */
const UNIT_DIGITS: Record<string, number> = { nibbles: 1, bytes: 2, halfwords: 4 }

/** The smallest power of two at least `count`, and never less than one digit. */
function roundUpToPowerOfTwo(count: number): number {
	return 2 ** Math.ceil(Math.log2(Math.max(1, count)))
}

/**
 * How many of `total` digits to dim, given that `leading` of them are zero.
 *
 * The fixed granularities dim whole units, so the dimmed run keeps the shape of
 * the value rather than cutting a byte or a halfword in half.  `pow2` instead
 * fixes what is left: the significant digits are rounded up to a power of two,
 * so a number always reads as 1, 2, 4 or 8 digits wide and columns of them line
 * up with each other.
 */
export function dimmedDigits(leading: number, total: number, mode: HexDimming): number {
	if (mode === 'off' || leading <= 0) return 0
	if (mode === 'pow2') return Math.max(0, total - roundUpToPowerOfTwo(total - leading))
	const unit = UNIT_DIGITS[mode] ?? 1
	return Math.floor(leading / unit) * unit
}

/** Splits `0x0040F000` into its prefix, the zeros to dim, and the rest. */
export function splitHex(text: string, mode: HexDimming = 'nibbles') {
	const prefix = /^0[xX]/.test(text) ? text.slice(0, 2) : ''
	const digits = text.slice(prefix.length)
	const significant = digits.replace(/^0+/, '')
	// An all-zero value keeps its final digit, so something stays readable.
	const leading = significant.length === 0 ? digits.length - 1 : digits.length - significant.length
	const dimmed = dimmedDigits(leading, digits.length, mode)
	return { prefix, zeros: digits.slice(0, dimmed), rest: digits.slice(dimmed) }
}

/**
 * Renders a hex number with its leading zeros dimmed.  The granularity is one
 * workspace-wide setting rather than a prop threaded through every panel that
 * shows a number; `mode` overrides it where a caller needs to.
 */
function HexNumber({ text, mode }: { text: string, mode?: HexDimming }) {
	const setting = useTHRAXStore((state) => state.settings.hexDimming)
	const { prefix, zeros, rest } = splitHex(text, mode ?? setting)
	return (
		<>
			{prefix}
			{zeros && <span className="hex-zero">{zeros}</span>}
			{rest}
		</>
	)
}

/**
 * A register value, spelled the one way the workspace spells them: a word,
 * or a double word when it is a bigint.
 *
 * Every panel that shows a word goes through this rather than formatting one of
 * its own, so the leading-zero setting reaches all of them and a number reads
 * the same in the history as it does in the registers.
 */
export function HexWord({ value, mode }: { value: number | bigint, mode?: HexDimming }) {
	return <HexNumber text={typeof value === 'bigint' ? formatRegister(value, 64) : formatWord(value >>> 0)} mode={mode} />
}

/** Addresses preserve all safe integer bits; register words keep their native width. */
export function HexAddress({ value, mode }: { value: number, mode?: HexDimming }) {
	return <HexNumber text={formatAddress(value)} mode={mode} />
}

export default HexNumber
