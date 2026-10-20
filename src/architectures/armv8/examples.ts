import type { Example } from '../contracts'

/**
 * Example AArch64 programs in GNU as syntax, ported from the MIPS and Beta
 * examples. They run as Linux user programs: `svc #0` with the system call
 * number in X8 (63 read, 64 write, 93 exit), and calls follow AAPCS64, with
 * arguments in X0-X7, the result in X0, and X19-X28 kept across calls.
 */

// Subroutines shared by several examples, pasted into each so it stands alone.

const EXIT = `	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0`

const PRINT_CHAR = `// print_char(w0): write one character.
print_char:
	strb w0, [sp, #-16]!    // the character, on a 16-byte aligned stack
	mov x0, #1              // fd 1: standard output
	mov x1, sp              // buffer
	mov x2, #1              // one byte
	mov x8, #64             // write
	svc #0
	add sp, sp, #16
	ret`

const PRINT_UINT = `// print_uint(x0): write x0 in decimal, all 64 bits of it.
print_uint:
	sub sp, sp, #32         // room for 20 digits
	add x1, sp, #32         // x1 walks back from the end of the buffer
	mov x2, #10
1:	udiv x3, x0, x2         // x3 = x0 / 10
	msub x4, x3, x2, x0     // x4 = x0 - x3 * 10, the lowest digit
	add w4, w4, #'0'
	strb w4, [x1, #-1]!
	mov x0, x3
	cbnz x0, 1b
	mov x0, #1              // fd 1
	add x2, sp, #32
	sub x2, x2, x1          // length: from x1 to the end
	mov x8, #64             // write(1, x1, x2)
	svc #0
	add sp, sp, #32
	ret`

const PRINT_STRING = `// print_string(x0): write the zero-terminated string at x0.
print_string:
	mov x1, x0              // buffer
	mov x2, #0              // length so far
1:	ldrb w3, [x1, x2]
	cbz w3, 2f              // stop at the terminating zero
	add x2, x2, #1
	b 1b
2:	mov x0, #1              // fd 1
	mov x8, #64             // write(1, x1, x2)
	svc #0
	ret`

export const EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		name: 'Interactive Input',
		description: 'Read a line with the read system call, then write it back',
		code: `// Read a line into a buffer, then print it.

	.data
buffer:	.space 64

	.text
	.global _start
_start:
	mov x0, #0              // fd 0: standard input
	ldr x1, =buffer
	mov x2, #64             // at most 64 bytes
	mov x8, #63             // read: waits for a line, returns its length
	svc #0

	mov x2, x0              // write back as many bytes as were read
	mov x0, #1              // fd 1: standard output
	ldr x1, =buffer
	mov x8, #64             // write
	svc #0

${EXIT}
`,
	},

	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string from the data section with the write system call',
		code: `// Data directives and the write system call.

	.data
message:	.ascii "Hello, THRAX!\\n"
	.equ length, . - message

	.text
	.global _start
_start:
	mov x0, #1              // fd 1: standard output
	adrp x1, message        // the page holding message...
	add x1, x1, :lo12:message   // ...and its offset in it
	mov x2, #length         // byte count
	mov x8, #64             // write
	svc #0

${EXIT}
`,
	},

	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: `// Simple addition example
// Compute 5 + 3 = 8

	.text
	.global _start
_start:
	mov x19, #5             // x19 = 5
	mov x20, #3             // x20 = 3
	add x0, x19, x20        // x0 = x19 + x20 = 8

	bl print_uint           // print the result
	mov w0, #'\\n'
	bl print_char           // and a newline

${EXIT}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120 by recursion',
		code: `// Recursive factorial: 5! = 120

	.text
	.global _start
_start:
	mov x0, #5
	bl factorial
	bl print_uint
${EXIT}

// factorial(x0): x0! in x0.
factorial:
	cmp x0, #1
	b.gt 1f
	mov x0, #1              // 0! = 1! = 1
	ret
1:	stp x0, x30, [sp, #-16]!    // keep n and the return address
	sub x0, x0, #1
	bl factorial            // (n - 1)!
	ldp x1, x30, [sp], #16
	mul x0, x0, x1          // n * (n - 1)!
	ret

${PRINT_UINT}
`,
	},

	bigFactorial: {
		name: 'Factorial (64-bit)',
		description: 'Compute 20!, which needs all 64 bits of a register',
		code: `// 20! = 2432902008176640000 needs 62 bits, so it fits only in an
// X register. Step through and watch X19 in the Registers panel.

	.data
label:	.asciz "20! = "

	.text
	.global _start
_start:
	mov x19, #1             // the product
	mov x20, #1             // the next factor
1:	mul x19, x19, x20
	add x20, x20, #1
	cmp x20, #20
	b.le 1b

	ldr x0, =label
	bl print_string
	mov x0, x19
	bl print_uint
	mov w0, #'\\n'
	bl print_char
${EXIT}

${PRINT_STRING}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: `// Iterative Fibonacci: F(10) = 55

	.text
	.global _start
_start:
	mov x0, #10             // n
	mov x1, #0              // F(0)
	mov x2, #1              // F(1)
1:	add x3, x1, x2          // the next number
	mov x1, x2
	mov x2, x3
	subs x0, x0, #1
	b.ne 1b

	mov x0, x1              // F(10)
	bl print_uint
${EXIT}

${PRINT_UINT}
`,
	},

	ackermann: {
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: `// Ackermann's function, which recurses deeply: A(3, 3) = 61.
//   A(0, n) = n + 1
//   A(m, 0) = A(m - 1, 1)
//   A(m, n) = A(m - 1, A(m, n - 1))
// Watch the Call Stack panel grow and shrink as it runs.

	.data
label:	.asciz "A(3, 3) = "

	.text
	.global _start
_start:
	ldr x0, =label
	bl print_string
	mov x0, #3              // m
	mov x1, #3              // n
	bl ackermann
	bl print_uint
${EXIT}

// ackermann(x0 = m, x1 = n): A(m, n) in x0.
ackermann:
	cbnz x0, 1f
	add x0, x1, #1          // A(0, n) = n + 1
	ret
1:	stp x29, x30, [sp, #-32]!   // a frame, with a slot for m
	mov x29, sp
	cbnz x1, 2f
	sub x0, x0, #1          // A(m, 0) = A(m - 1, 1)
	mov x1, #1
	bl ackermann
	b 3f
2:	str x0, [sp, #16]       // keep m
	sub x1, x1, #1
	bl ackermann            // A(m, n - 1)
	mov x1, x0
	ldr x0, [sp, #16]
	sub x0, x0, #1
	bl ackermann            // A(m - 1, A(m, n - 1))
3:	ldp x29, x30, [sp], #32
	ret

${PRINT_STRING}

${PRINT_UINT}
`,
	},

	loop: {
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: `// Count from 1 to 5, a space after each number.

	.text
	.global _start
_start:
	mov x19, #1             // the counter, in a register calls keep
loop:
	mov x0, x19
	bl print_uint
	mov w0, #' '
	bl print_char
	add x19, x19, #1
	cmp x19, #5
	b.le loop               // again while x19 <= 5

	mov w0, #'\\n'
	bl print_char
${EXIT}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: `// Bitwise operations on two values.

	.text
	.global _start
_start:
	mov x19, #12            // 0b1100
	mov x20, #10            // 0b1010

	and x0, x19, x20        // 12 & 10 = 8
	bl print_uint
	mov w0, #' '
	bl print_char

	orr x0, x19, x20        // 12 | 10 = 14
	bl print_uint
	mov w0, #' '
	bl print_char

	eor x0, x19, x20        // 12 ^ 10 = 6
	bl print_uint
${EXIT}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: `// Fill a 32 x 32 grid of pixels for the Bitmap Display tool.
// Tool settings: base address 0x00420000, unit 8, width 256, height 256.
// Each word is one pixel, 0x00RRGGBB, in row-major order.

	.data
display:	.space 4096     // 32 rows x 32 columns x 4 bytes

	.text
	.global _start
_start:
	ldr x0, =display        // pixel cursor
	mov x1, #0              // row
row:
	mov x2, #0              // column
column:
	lsl w3, w1, #19         // row scaled into the red channel
	orr w3, w3, w2, lsl #3  // column scaled into the blue channel
	str w3, [x0], #4        // store the pixel, then step past it
	add x2, x2, #1
	cmp x2, #32
	b.lt column

	add x1, x1, #1
	cmp x1, #32
	b.lt row
${EXIT}
`,
	},

	mmio: {
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the MMIO tool',
		code: `// Memory-mapped I/O, through the Keyboard and Display tool.
// Queue characters in the tool while the program runs; each one is
// echoed to the display. A period ends the program.

	.equ MMIO, 0xFFFF0000
	.equ RECEIVER_CONTROL, 0
	.equ RECEIVER_DATA, 4
	.equ TRANSMITTER_DATA, 12

	.text
	.global _start
_start:
	mov x0, #MMIO
poll:
	ldr w1, [x0, #RECEIVER_CONTROL]     // bit 0 is set once a character is ready
	tbz w1, #0, poll
	ldr w2, [x0, #RECEIVER_DATA]        // reading it consumes the character
	str w2, [x0, #TRANSMITTER_DATA]     // writing it prints to the display
	cmp w2, #'.'
	b.ne poll
${EXIT}
`,
	},

	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and .equ',
		code: `// Macros are expanded by the assembler, so each use costs no call.
// A numeric label such as 1: can be defined again in every
// expansion: 1b names the nearest one before, 1f the next one after.

	.equ SYS_WRITE, 64
	.equ SYS_EXIT, 93

	.macro print text, length
	mov x0, #1
	ldr x1, =\\text
	mov x2, #\\length
	mov x8, #SYS_WRITE
	svc #0
	.endm

	.macro count_to limit
	mov x19, #1
1:	add w0, w19, #'0'       // the digit
	bl print_char
	add x19, x19, #1
	cmp x19, #\\limit
	b.le 1b
	.endm

	.macro exit status=0
	mov x0, #\\status
	mov x8, #SYS_EXIT
	svc #0
	.endm

	.data
banner:		.ascii "counting: "
newline:	.ascii "\\n"

	.text
	.global _start
_start:
	print banner, 10

	count_to 5
	print newline, 1

	count_to 3
	print newline, 1

	exit

${PRINT_CHAR}
`,
	},

	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in 16.16 fixed point, drawn to the Bitmap Display',
		code: `// Mandelbrot set in 16.16 fixed point, drawn to the Bitmap Display.
//
// Open the Bitmap Display tool with base 0x00420000, width and height
// 256, and unit 8 for SIZE 32 (4 for SIZE 64). Each point c iterates
// z = z * z + c until |z| passes 2 or MAX_ITERATIONS run out; 64-bit
// registers hold the products of two 16.16 numbers without overflow.

	.equ SIZE, 32
	.equ MAX_ITERATIONS, 32
	.equ ONE, 0x10000               // 1.0
	.equ STEP, 3 * ONE / SIZE       // the plane shown is 3.0 across

	.data
display:	.space SIZE * SIZE * 4

	.text
	.global _start
_start:
	ldr x9, =display                // pixel cursor
	mov x13, #STEP
	ldr x15, =-3 * ONE / 2          // ci: the top row is at -1.5i
	mov x10, #0                     // row
row:
	mov x14, #-2 * ONE              // cr: each row starts at -2.0
	mov x11, #0                     // column
column:
	mov x0, #0                      // zr
	mov x1, #0                      // zi
	mov x4, #0                      // iterations
iterate:
	mul x2, x0, x0
	asr x2, x2, #16                 // zr * zr
	mul x3, x1, x1
	asr x3, x3, #16                 // zi * zi
	add x5, x2, x3
	cmp x5, #4 * ONE                // |z| > 2: escaped
	b.gt escaped
	mul x5, x0, x1
	asr x5, x5, #15                 // 2 * zr * zi
	add x1, x5, x15                 // zi = 2 zr zi + ci
	sub x0, x2, x3
	add x0, x0, x14                 // zr = zr^2 - zi^2 + cr
	add x4, x4, #1
	cmp x4, #MAX_ITERATIONS
	b.lt iterate
	mov w5, #0                      // inside the set: black
	b plot
escaped:
	lsl w5, w4, #19                 // iterations into red
	orr w5, w5, w4, lsl #3          // and blue
plot:
	str w5, [x9], #4
	add x14, x14, x13               // one step right
	add x11, x11, #1
	cmp x11, #SIZE
	b.lt column

	add x15, x15, x13               // one step down
	add x10, x10, #1
	cmp x10, #SIZE
	b.lt row
${EXIT}
`,
	},
}
