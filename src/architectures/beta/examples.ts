import { BitmapIcon, BitwiseIcon, FactorialIcon, FibonacciIcon, HelloIcon, InputIcon, KeyboardIcon, LoopIcon, MacrosIcon, RecursionIcon, SumIcon } from '../../components/icons'
import type { Example } from '../contracts'
import tinyOs from './tinyos.uasm?raw'

/**
 * Example Beta programs in 6.004 UASM, ported from the MIPS examples.
 *
 * Calls follow the course convention: arguments pushed last to first, CALL(f, n)
 * pops them on return, the result comes back in R0, and the callee saves every
 * other register it uses.
 */

// Subroutines shared by several examples, pasted into each so it stands alone.

const PRINT_STRING = `// print_string(s): write the zero-terminated string at address s.
print_string:
	PUSH(LP) PUSH(BP)
	MOVE(SP, BP)
	PUSH(R0) PUSH(R1) PUSH(R2) PUSH(R3)
	LD(BP, -12, R1)         // R1 <- address of the next character
ps_next:
	ANDC(R1, -4, R3)        // loads are whole words, so fetch the word holding it
	LD(R3, 0, R0)
	ANDC(R1, 3, R2)         // and shift its byte down; words are little-endian
	SHLC(R2, 3, R2)
	SHR(R0, R2, R0)
	ANDC(R0, 0xFF, R0)
	BEQ(R0, ps_done)        // stop at the terminating zero
	WRCHAR()
	ADDC(R1, 1, R1)
	BR(ps_next)
ps_done:
	POP(R3) POP(R2) POP(R1) POP(R0)
	MOVE(BP, SP)
	POP(BP) POP(LP)
	RTN()
`

const PRINT_DECIMAL = `// print_decimal(n): write n >= 0 in decimal, leading digits first.
print_decimal:
	PUSH(LP) PUSH(BP)
	MOVE(SP, BP)
	PUSH(R0) PUSH(R1)
	LD(BP, -12, R1)         // R1 <- n
	DIVC(R1, 10, R0)        // R0 <- n / 10, the leading digits
	BEQ(R0, pd_digit)
	PUSH(R0)
	CALL(print_decimal, 1)
pd_digit:
	MULC(R0, 10, R0)        // R0 <- n % 10, the last digit
	SUB(R1, R0, R0)
	ADDC(R0, '0', R0)
	WRCHAR()
	POP(R1) POP(R0)
	MOVE(BP, SP)
	POP(BP) POP(LP)
	RTN()
`

const TINYOS_STUB = `MapUserAddress:
        // [Design Problem 1] your code here...
`

/** Fills in the lab's Design Problem 1: add the current process's segment base. */
function solveTinyOs(code: string) {
	if (!code.includes(TINYOS_STUB)) throw new Error('TinyOS MapUserAddress stub not found')
	return code.replace(TINYOS_STUB, `MapUserAddress:
        // [Design Problem 1] solved for THRAX: add the current base.
        PUSH(r1)
        LD(CurProc, r1)         // current process table entry,
        LD(r1, 31*4, r1)        //   whose base address follows R0-R30
        ADD(r0, r1, r0)
        POP(r1)
`)
}

export const EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		icon: InputIcon,
		name: 'Interactive Input',
		description: 'Read a line with RDCHAR into a buffer, then print it',
		code: `// Read a line into a data buffer, then print it

.include "beta.uasm"
.options tty                // RDCHAR and WRCHAR need the tty

	CMOVE(stack, SP)
	CMOVE(64, R1)           // read_line(buffer, 64)
	PUSH(R1)
	CMOVE(buffer, R1)
	PUSH(R1)
	CALL(read_line, 2)

	PUSH(R1)                // print_string(buffer)
	CALL(print_string, 1)
	HALT()

// read_line(buffer, size): read up to size - 1 characters, through the first
// newline, into buffer and end them with a zero.
read_line:
	PUSH(LP) PUSH(BP)
	MOVE(SP, BP)
	PUSH(R1) PUSH(R2) PUSH(R3)
	LD(BP, -12, R1)         // R1 <- where the next character goes
	LD(BP, -16, R2)
	ADD(R1, R2, R2)
	SUBC(R2, 1, R2)         // R2 <- the last byte, kept for the zero
rl_next:
	CMPLT(R1, R2, R3)
	BF(R3, rl_done)         // the buffer is full
	RDCHAR()                // R0 <- next character, waiting for one to be typed
	PUSH(R0)
	PUSH(R1)
	CALL(store_byte, 2)
	ADDC(R1, 1, R1)
	CMPEQC(R0, '\\n', R3)
	BF(R3, rl_next)
rl_done:
	PUSH(R31)               // the terminating zero
	PUSH(R1)
	CALL(store_byte, 2)
	POP(R3) POP(R2) POP(R1)
	MOVE(BP, SP)
	POP(BP) POP(LP)
	RTN()

// store_byte(address, byte): stores are whole words, so merge the byte into
// the word that holds it.
store_byte:
	PUSH(LP) PUSH(BP)
	MOVE(SP, BP)
	PUSH(R1) PUSH(R2) PUSH(R3) PUSH(R4)
	LD(BP, -12, R1)         // R1 <- address
	ANDC(R1, 3, R2)
	SHLC(R2, 3, R2)         // R2 <- the byte's bit offset in its word
	ANDC(R1, -4, R1)        // R1 <- the word's address
	CMOVE(0xFF, R3)
	SHL(R3, R2, R3)
	XORC(R3, -1, R3)        // R3 <- mask that clears the old byte
	LD(R1, 0, R4)
	AND(R4, R3, R4)
	LD(BP, -16, R3)         // R3 <- byte, moved into place
	ANDC(R3, 0xFF, R3)
	SHL(R3, R2, R3)
	OR(R4, R3, R4)
	ST(R4, 0, R1)
	POP(R4) POP(R3) POP(R2) POP(R1)
	MOVE(BP, SP)
	POP(BP) POP(LP)
	RTN()

${PRINT_STRING}
buffer: STORAGE(16)         // 64 bytes
stack: STORAGE(64)
`,
	},

	hello: {
		icon: HelloIcon,
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code with a WRCHAR loop',
		code: `// .text data and a print-string subroutine

.include "beta.uasm"
.options tty

	CMOVE(stack, SP)        // the stack grows up from the end of the program
	CMOVE(message, R1)
	PUSH(R1)
	CALL(print_string, 1)
	HALT()

message: .text "Hello, THRAX!\\n"

${PRINT_STRING}
stack: STORAGE(64)
`,
	},

	sum: {
		icon: SumIcon,
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: `// Simple addition example
// Compute 5 + 3 = 8

.include "beta.uasm"
.options tty

	CMOVE(stack, SP)

	// Load values
	CMOVE(5, R1)            // R1 <- 5
	CMOVE(3, R2)            // R2 <- 3

	// Add them
	ADD(R1, R2, R3)         // R3 <- R1 + R2 = 8

	// Print result
	PUSH(R3)
	CALL(print_decimal, 1)

	// Print newline
	CMOVE('\\n', R0)
	WRCHAR()

	HALT()

${PRINT_DECIMAL}
stack: STORAGE(64)
`,
	},

	factorial: {
		icon: FactorialIcon,
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
		code: `// Factorial example
// Compute 5! = 5 * 4 * 3 * 2 * 1 = 120

.include "beta.uasm"
.options tty

	CMOVE(stack, SP)
	CMOVE(5, R1)            // n = 5
	CMOVE(1, R2)            // result = 1

loop:
	BEQ(R1, done)           // if n == 0, exit loop
	MUL(R2, R1, R2)         // result = result * n
	SUBC(R1, 1, R1)         // n--
	BR(loop)

done:
	// Print result
	PUSH(R2)
	CALL(print_decimal, 1)
	HALT()

${PRINT_DECIMAL}
stack: STORAGE(64)
`,
	},

	fibonacci: {
		icon: FibonacciIcon,
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: `// Fibonacci sequence
// Compute fib(10)

.include "beta.uasm"
.options tty

	CMOVE(stack, SP)
	CMOVE(0, R1)            // fib(0) = 0
	CMOVE(1, R2)            // fib(1) = 1
	CMOVE(2, R3)            // i = 2

loop:
	CMPLEC(R3, 10, R5)      // if i > 10, exit
	BF(R5, done)
	ADD(R1, R2, R4)         // temp = fib(n-2) + fib(n-1)
	MOVE(R2, R1)            // fib(n-2) = fib(n-1)
	MOVE(R4, R2)            // fib(n-1) = temp
	ADDC(R3, 1, R3)         // i++
	BR(loop)

done:
	// Print result
	PUSH(R2)
	CALL(print_decimal, 1)
	HALT()

${PRINT_DECIMAL}
stack: STORAGE(64)
`,
	},

	ackermann: {
		icon: RecursionIcon,
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: `// Ackermann function
// A(m, n) = n + 1                    when m = 0
//         = A(m - 1, 1)              when n = 0
//         = A(m - 1, A(m, n - 1))    otherwise
//
// Each call pushes its arguments, return address, frame pointer and saved
// registers, so the stack fills up as the recursion deepens.

.include "beta.uasm"
.options tty

	CMOVE(stack, SP)
	CMOVE(prompt, R1)       // print the label
	PUSH(R1)
	CALL(print_string, 1)

	CMOVE(3, R1)            // ackermann(3, 3)
	PUSH(R1)                // n
	PUSH(R1)                // m
	CALL(ackermann, 2)

	PUSH(R0)                // print the result
	CALL(print_decimal, 1)
	HALT()

prompt: .text "A(3, 3) = "

// ackermann(m, n), result in R0
ackermann:
	PUSH(LP) PUSH(BP)
	MOVE(SP, BP)
	PUSH(R1) PUSH(R2)
	LD(BP, -12, R1)         // R1 <- m
	LD(BP, -16, R2)         // R2 <- n

	BNE(R1, m_positive)
	ADDC(R2, 1, R0)         // m = 0: A(0, n) = n + 1
	BR(ackermann_return)

m_positive:
	BNE(R2, both_positive)
	CMOVE(1, R0)            // n = 0: A(m, 0) = A(m - 1, 1)
	PUSH(R0)
	SUBC(R1, 1, R0)
	PUSH(R0)
	CALL(ackermann, 2)
	BR(ackermann_return)

both_positive:
	SUBC(R2, 1, R0)         // inner call: A(m, n - 1)
	PUSH(R0)
	PUSH(R1)
	CALL(ackermann, 2)

	PUSH(R0)                // outer call: A(m - 1, inner)
	SUBC(R1, 1, R0)
	PUSH(R0)
	CALL(ackermann, 2)

ackermann_return:
	POP(R2) POP(R1)
	MOVE(BP, SP)
	POP(BP) POP(LP)
	RTN()

${PRINT_STRING}
${PRINT_DECIMAL}
stack: STORAGE(1024)
`,
	},

	loop: {
		icon: LoopIcon,
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: `// Loop counter example
// Print numbers 1 through 5

.include "beta.uasm"
.options tty

	CMOVE(stack, SP)
	CMOVE(1, R1)            // counter = 1

loop:
	CMPEQC(R1, 6, R2)       // if counter == 6, exit
	BT(R2, done)

	// Print counter
	PUSH(R1)
	CALL(print_decimal, 1)

	// Print space
	CMOVE(' ', R0)
	WRCHAR()

	// Increment and loop
	ADDC(R1, 1, R1)
	BR(loop)

done:
	// Print newline
	CMOVE('\\n', R0)
	WRCHAR()
	HALT()

${PRINT_DECIMAL}
stack: STORAGE(64)
`,
	},

	bitwise: {
		icon: BitwiseIcon,
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: `// Bitwise operations
// Test AND, OR, XOR with two values

.include "beta.uasm"
.options tty

	CMOVE(stack, SP)
	CMOVE(12, R1)           // R1 = 12 (binary: 1100)
	CMOVE(10, R2)           // R2 = 10 (binary: 1010)

	// AND operation
	AND(R1, R2, R3)         // R3 = 12 & 10 = 8
	PUSH(R3)
	CALL(print_decimal, 1)

	CMOVE(' ', R0)
	WRCHAR()

	// OR operation
	OR(R1, R2, R3)          // R3 = 12 | 10 = 14
	PUSH(R3)
	CALL(print_decimal, 1)

	CMOVE(' ', R0)
	WRCHAR()

	// XOR operation
	XOR(R1, R2, R3)         // R3 = 12 ^ 10 = 6
	PUSH(R3)
	CALL(print_decimal, 1)

	HALT()

${PRINT_DECIMAL}
stack: STORAGE(64)
`,
	},

	bitmap: {
		icon: BitmapIcon,
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: `// Fill a 32 x 32 grid of pixels for the Bitmap Display tool.
// Tool settings: base address 0x1000, unit 8, width 256, height 256.
// Each word is one pixel, 0x00RRGGBB, in row-major order.

.include "beta.uasm"

	CMOVE(display, R0)      // pixel cursor
	CMOVE(0, R1)            // row

row:
	CMOVE(0, R2)            // column

column:
	SHLC(R1, 19, R3)        // row scaled into the red channel
	SHLC(R2, 3, R4)         // column scaled into the blue channel
	OR(R3, R4, R5)
	ST(R5, 0, R0)

	ADDC(R0, 4, R0)
	ADDC(R2, 1, R2)
	CMPLTC(R2, 32, R6)
	BT(R6, column)

	ADDC(R1, 1, R1)
	CMPLTC(R1, 32, R6)
	BT(R6, row)

	HALT()

. = 0x1000
display: STORAGE(32 * 32)   // 32 rows x 32 columns, one word each
`,
	},

	macros: {
		icon: MacrosIcon,
		name: 'Macros',
		description: 'Define once, use many times with .macro and symbols',
		code: `// Macros are expanded by the assembler, so each use costs no call-and-return
// overhead. Labels inside a { } body are local to each expansion, which is
// why "again" can be reused safely.

.include "beta.uasm"
.options tty

FIRST = 5                   // symbols name constants, like .eqv
SECOND = 3

.macro PRINT(TEXT) {
	CMOVE(TEXT, R1)
	PUSH(R1)
	CALL(print_string, 1)
}

.macro COUNT_TO(LIMIT) {
	CMOVE(0, R1)
again:
	ADDC(R1, 1, R1)
	PUSH(R1)
	CALL(print_decimal, 1)
	CMPEQ(R1, LIMIT, R2)
	BF(R2, again)
}

.macro DONE() HALT()

	CMOVE(stack, SP)
	PRINT(banner)

	CMOVE(FIRST, R9)
	COUNT_TO(R9)
	PRINT(newline)

	CMOVE(SECOND, R9)
	COUNT_TO(R9)
	PRINT(newline)

	DONE()

banner: .text "counting: "
newline: .text "\\n"

${PRINT_STRING}
${PRINT_DECIMAL}
stack: STORAGE(64)
`,
	},

	tinyos: {
		icon: KeyboardIcon,
		name: 'TinyOS',
		description: 'The 6.004 lab kernel, as handed out: implement MapUserAddress (Design Problem 1) to run its processes (CC BY 4.0)',
		code: tinyOs,
	},

	tinyosSolved: {
		icon: KeyboardIcon,
		name: 'TinyOS (solved)',
		description: 'The 6.004 lab kernel with MapUserAddress filled in: clock and keyboard interrupts, segmentation and two processes (CC BY 4.0)',
		code: solveTinyOs(tinyOs),
	},
}
