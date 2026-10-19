import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../../../core/ieee754'
import { decode, type Decoded, type DecodedOperand } from './decoder'
import { OP_NAMES } from './ops'
import { formatHex, formatWord } from '../../../core/format'
import { REGISTER_NAMES } from './registers'
import type { CodeRow } from '../../contracts'

const register = (index: number) => REGISTER_NAMES[index] ?? `$${index}`

const fpRegister = (index: number) => `$f${index}`

const hex = formatWord

const hexImmediate = (value: number) => `0x${value.toString(16).toUpperCase()}`

/** Branch and jump targets resolve against the instruction's own address when known. */
const branchTarget = (address: number | undefined, offset: number) =>
	address === undefined ? `${offset}` : hex((address + 4 + offset * 4) >>> 0)

const jumpTarget = (address: number | undefined, index: number) =>
	hex(address === undefined ? index << 2 : ((address & 0xf0000000) | (index << 2)) >>> 0)

/**
 * Renders one operand as the isa table's own example spells it, so a form's
 * syntax is described in one place.  The FP condition code comes first for
 * `bc1t`/`bc1f`/`c.cond.fmt` and last for the conditional moves
 *, which is the operand order
 * the table already carries.
 */
function operand(decoded: DecodedOperand, address: number | undefined): string {
	const { value } = decoded
	switch (decoded.kind) {
		case 'gpr': return register(value)
		case 'fpr':
		case 'fpr-even': return fpRegister(value)
		case 'cp0': return `$${value}`
		case 'imm16u': return hexImmediate(value)
		case 'label': return branchTarget(address, value)
		case 'target26': return jumpTarget(address, value)
		case 'mem': return `${value}(${register(decoded.base ?? 0)})`
		// The remaining kinds are plain numbers: shift amounts, condition codes,
		// signed immediates, and the `break` code.
		default: return `${value}`
	}
}

/** Renders a decoded instruction's operands in its own layout. */
function operands(decoded: Decoded, address: number | undefined): string {
	return decoded.operands.map((each) => operand(each, address)).join(', ')
}

/**
 * Renders one machine word as MIPS assembly, or null when it matches no
 * instruction this assembler emits.
 */
export function disassemble(word: number, address?: number): string | null {
	if ((word >>> 0) === 0) return 'nop'

	const decoded = decode(word)
	if (!decoded) return null

	const text = operands(decoded, address)
	const mnemonic = OP_NAMES[decoded.op]
	return text ? `${mnemonic} ${text}` : mnemonic
}

/** Memory holds a word little end first, which is the order the row carries. */
const dataWord = (bytes: number[]) => bytes.reduce((word, byte, index) => word | (byte << (index * 8)), 0) >>> 0

const ASCII_ESCAPES: Record<number, string> = { 0: '\\0', 9: '\\t', 10: '\\n', 13: '\\r' }

const asciiText = (bytes: number[]) => bytes
	.map((byte) => ASCII_ESCAPES[byte] ?? (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : `\\x${formatHex(byte, 2)}`))
	.join('')

/**
 * A data row read back as the directive that wrote it, which is what the
 * disassembly column shows where there is no instruction to decode.  `next` is
 * the row after this one, which a double needs for its high word.
 */
export function disassembleData(row: CodeRow, next?: CodeRow): string {
	const { bytes, directive, offset = 0 } = row
	if (directive === undefined) return ''
	switch (directive) {
		case '.float':
			return `.float ${formatSingle(bitsToSingle(dataWord(bytes)))}`
		case '.double': {
			// A double spans two rows, and reads on the one it starts.
			if (offset % 8 !== 0) return ''
			const high = next?.directive === directive && next.offset === offset + 4 ? next : undefined
			return high === undefined ? '.double' : `.double ${formatDouble(bitsToDouble(dataWord(bytes), dataWord(high.bytes)))}`
		}
		case '.half':
			return `.half ${[0, 2].filter((at) => at < bytes.length).map((at) => `0x${formatHex(dataWord(bytes.slice(at, at + 2)), 4)}`).join(' ')}`
		case '.byte':
			return `.byte ${bytes.map((byte) => `0x${formatHex(byte, 2)}`).join(' ')}`
		case '.ascii':
		case '.asciiz':
			return `${directive} "${asciiText(bytes)}"`
		case '.space':
		case '.extern':
			return directive
		default:
			return `${directive} ${formatWord(dataWord(bytes))}`
	}
}
