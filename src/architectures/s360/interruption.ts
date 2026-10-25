/** Program interruption codes (GA22-6821, "Program Interruption"). */
export const OPERATION = 1, PRIVILEGED = 2, EXECUTE = 3, PROTECTION = 4, ADDRESSING = 5, SPECIFICATION = 6, DATA = 7
export const FIXED_OVERFLOW = 8, FIXED_DIVIDE = 9, DECIMAL_OVERFLOW = 10, DECIMAL_DIVIDE = 11
export const EXPONENT_OVERFLOW = 12, EXPONENT_UNDERFLOW = 13, SIGNIFICANCE = 14, FLOAT_DIVIDE = 15

const names = ['', 'operation', 'privileged-operation', 'execute', 'protection', 'addressing', 'specification', 'data',
	'fixed-point-overflow', 'fixed-point-divide', 'decimal-overflow', 'decimal-divide',
	'exponent-overflow', 'exponent-underflow', 'significance', 'floating-point-divide']

/** No interruption handler is modelled: the instruction faults and retires nothing. */
export class ProgramInterruption extends Error {
	constructor(readonly code: number, detail?: string) {
		super(`Program interruption ${code.toString(16).toUpperCase().padStart(4, '0')}: ${names[code]} exception${detail ? ` (${detail})` : ''}`)
	}
}

export function interrupt(code: number, detail?: string): never { throw new ProgramInterruption(code, detail) }

/** Program mask bits, PSW bits 36-39. */
export const MASK_FIXED = 8, MASK_DECIMAL = 4, MASK_UNDERFLOW = 2, MASK_SIGNIFICANCE = 1
