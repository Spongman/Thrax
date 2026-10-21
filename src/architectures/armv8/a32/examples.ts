import type { Example } from '../../contracts'

/**
 * Example AArch32 programs, ported from the 26-bit ARM examples to ARMv8
 * idioms: Linux system calls by `svc #0` with the number in R7 (3 read,
 * 4 write, 1 exit), BX LR and POP {..., PC} returns, MOVW and MOVT for
 * addresses, and UDIV with MLS for decimal digits. Most are GNU as; the last
 * two are armasm. Calls follow the AAPCS: arguments in R0-R3, the result in
 * R0, R4-R11 kept across calls, and the stack 8-byte aligned.
 */

// Subroutines shared by several examples, pasted into each so it stands alone.

const EXIT = `	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0`

const PRINT_CHAR = `@ print_char(r0): write one character.
print_char:
	push {r0, r7}           @ the character, on the stack
	mov r0, #1              @ fd 1: standard output
	mov r1, sp              @ buffer: the low byte of the pushed r0
	mov r2, #1              @ one byte
	mov r7, #4              @ write
	svc #0
	pop {r0, r7}
	bx lr`

const PRINT_UINT = `@ print_uint(r0): write r0 in decimal, unsigned.
print_uint:
	push {r4, r5, r7, lr}
	sub sp, sp, #16         @ room for 10 digits
	add r1, sp, #16         @ r1 walks back from the end of the buffer
	mov r4, #10
1:	udiv r5, r0, r4         @ r5 = r0 / 10
	mls r2, r5, r4, r0      @ r2 = r0 - r5 * 10, the lowest digit
	add r2, r2, #'0'
	strb r2, [r1, #-1]!
	movs r0, r5
	bne 1b
	mov r0, #1              @ fd 1
	add r2, sp, #16
	sub r2, r2, r1          @ length: from r1 to the end
	mov r7, #4              @ write(1, r1, r2)
	svc #0
	add sp, sp, #16
	pop {r4, r5, r7, pc}`

const PRINT_STRING = `@ print_string(r0): write the zero-terminated string at r0.
print_string:
	push {r7, lr}
	mov r1, r0              @ buffer
	mov r2, #0              @ length so far
1:	ldrb r3, [r1, r2]
	cmp r3, #0              @ stop at the terminating zero
	addne r2, r2, #1
	bne 1b
	mov r0, #1              @ fd 1
	mov r7, #4              @ write(1, r1, r2)
	svc #0
	pop {r7, pc}`

export const A32_EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		name: 'Interactive Input',
		description: 'Read a line with the read system call, then write it back',
		code: `@ Read a line into a buffer, then print it.

	.data
buffer:	.space 64

	.text
	.global _start
_start:
	mov r0, #0              @ fd 0: standard input
	ldr r1, =buffer
	mov r2, #64             @ at most 64 bytes
	mov r7, #3              @ read: waits for a line, returns its length
	svc #0

	mov r2, r0              @ write back as many bytes as were read
	mov r0, #1              @ fd 1: standard output
	ldr r1, =buffer
	mov r7, #4              @ write
	svc #0

${EXIT}
`,
	},

	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string from the data section with the write system call',
		code: `@ Data directives and the write system call.

	.data
message:	.ascii "Hello, THRAX!\\n"
	.equ length, . - message

	.text
	.global _start
_start:
	mov r0, #1              @ fd 1: standard output
	movw r1, #:lower16:message  @ the address in two halves,
	movt r1, #:upper16:message  @ with no literal pool
	mov r2, #length         @ byte count
	mov r7, #4              @ write
	svc #0

${EXIT}
`,
	},

	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: `@ Simple addition example
@ Compute 5 + 3 = 8

	.text
	.global _start
_start:
	mov r4, #5              @ r4 = 5
	mov r5, #3              @ r5 = 3
	add r0, r4, r5          @ r0 = r4 + r5 = 8

	bl print_uint           @ print the result
	mov r0, #'\\n'
	bl print_char           @ and a newline

${EXIT}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120 by recursion',
		code: `@ Recursive factorial: 5! = 120

	.text
	.global _start
_start:
	mov r0, #5
	bl factorial
	bl print_uint
${EXIT}

@ factorial(r0): r0! in r0.
factorial:
	cmp r0, #1
	movle r0, #1            @ 0! = 1! = 1
	bxle lr
	push {r0, lr}           @ keep n and the return address
	sub r0, r0, #1
	bl factorial            @ (n - 1)!
	pop {r1, lr}
	mul r0, r0, r1          @ n * (n - 1)!
	bx lr

${PRINT_UINT}
`,
	},

	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: `@ Iterative Fibonacci: F(10) = 55

	.text
	.global _start
_start:
	mov r0, #10             @ n
	mov r1, #0              @ F(0)
	mov r2, #1              @ F(1)
1:	add r3, r1, r2          @ the next number
	mov r1, r2
	mov r2, r3
	subs r0, r0, #1
	bne 1b

	mov r0, r1              @ F(10)
	bl print_uint
${EXIT}

${PRINT_UINT}
`,
	},

	ackermann: {
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: `@ Ackermann's function, which recurses deeply: A(3, 3) = 61.
@   A(0, n) = n + 1
@   A(m, 0) = A(m - 1, 1)
@   A(m, n) = A(m - 1, A(m, n - 1))
@ Watch the Call Stack panel grow and shrink as it runs.

	.data
label:	.asciz "A(3, 3) = "

	.text
	.global _start
_start:
	ldr r0, =label
	bl print_string
	mov r0, #3              @ m
	mov r1, #3              @ n
	bl ackermann
	bl print_uint
${EXIT}

@ ackermann(r0 = m, r1 = n): A(m, n) in r0.
ackermann:
	cmp r0, #0
	addeq r0, r1, #1        @ A(0, n) = n + 1
	bxeq lr
	push {r4, lr}           @ a frame, with r4 to keep m in
	cmp r1, #0
	bne 1f
	sub r0, r0, #1          @ A(m, 0) = A(m - 1, 1)
	mov r1, #1
	bl ackermann
	pop {r4, pc}
1:	mov r4, r0              @ keep m
	sub r1, r1, #1
	bl ackermann            @ A(m, n - 1)
	mov r1, r0
	sub r0, r4, #1
	bl ackermann            @ A(m - 1, A(m, n - 1))
	pop {r4, pc}

${PRINT_STRING}

${PRINT_UINT}
`,
	},

	loop: {
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: `@ Count from 1 to 5, a space after each number.

	.text
	.global _start
_start:
	mov r4, #1              @ the counter, in a register calls keep
loop:
	mov r0, r4
	bl print_uint
	mov r0, #' '
	bl print_char
	add r4, r4, #1
	cmp r4, #5
	ble loop                @ again while r4 <= 5

	mov r0, #'\\n'
	bl print_char
${EXIT}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: `@ Bitwise operations on two values.

	.text
	.global _start
_start:
	mov r4, #12             @ 0b1100
	mov r5, #10             @ 0b1010

	and r0, r4, r5          @ 12 & 10 = 8
	bl print_uint
	mov r0, #' '
	bl print_char

	orr r0, r4, r5          @ 12 | 10 = 14
	bl print_uint
	mov r0, #' '
	bl print_char

	eor r0, r4, r5          @ 12 ^ 10 = 6
	bl print_uint
${EXIT}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	bitfields: {
		name: 'Bit Fields',
		description: 'ARMv8 bit manipulation: UBFX, CLZ, REV, BFI and SXTB',
		code: `@ Instructions ARMv8 has and the ARM2 had not, on r4 = 0x12345678.

	.text
	.global _start
_start:
	movw r4, #0x5678
	movt r4, #0x1234        @ r4 = 0x12345678

	ubfx r0, r4, #8, #8     @ bits 8-15: 0x56 = 86
	bl show
	clz r0, r4              @ leading zeros: 3
	bl show
	rev r0, r4              @ bytes reversed: 0x78563412
	bl show
	mov r0, #0
	bfi r0, r4, #4, #8      @ the low byte, 0x78, into bits 4-11: 0x780
	bl show
	mov r5, #0xF0
	sxtb r0, r5             @ 0xF0 sign-extended is -16...
	rsb r0, r0, #0          @ ...so this is 16
	bl print_uint
	mov r0, #'\\n'
	bl print_char
${EXIT}

@ show(r0): print r0 and a space.
show:
	push {r4, lr}
	bl print_uint
	mov r0, #' '
	bl print_char
	pop {r4, pc}

${PRINT_UINT}

${PRINT_CHAR}
`,
	},

	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: `@ Fill a 32 x 32 grid of pixels for the Bitmap Display tool.
@ Tool settings: base address 0x00420000, unit 8, width 256, height 256.
@ Each word is one pixel, 0x00RRGGBB, in row-major order.

	.data
display:	.space 4096     @ 32 rows x 32 columns x 4 bytes

	.text
	.global _start
_start:
	ldr r0, =display        @ pixel cursor
	mov r1, #0              @ row
row:
	mov r2, #0              @ column
column:
	lsl r3, r1, #19         @ row scaled into the red channel
	orr r3, r3, r2, lsl #3  @ column scaled into the blue channel
	str r3, [r0], #4        @ store the pixel, then step past it
	add r2, r2, #1
	cmp r2, #32
	blt column

	add r1, r1, #1
	cmp r1, #32
	blt row
${EXIT}
`,
	},

	mmio: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the MMIO tool',
		code: `@ Memory-mapped I/O, through the Keyboard and Display tool.
@ Queue characters in the tool while the program runs; each one is
@ echoed to the display. A period ends the program.

	.equ MMIO, 0xFFFF0000
	.equ RECEIVER_CONTROL, 0
	.equ RECEIVER_DATA, 4
	.equ TRANSMITTER_DATA, 12

	.text
	.global _start
_start:
	movw r0, #:lower16:MMIO
	movt r0, #:upper16:MMIO
poll:
	ldr r1, [r0, #RECEIVER_CONTROL]     @ bit 0 is set once a character is ready
	tst r1, #1
	beq poll
	ldr r2, [r0, #RECEIVER_DATA]        @ reading it consumes the character
	str r2, [r0, #TRANSMITTER_DATA]     @ writing it prints to the display
	cmp r2, #'.'
	bne poll
${EXIT}
`,
	},

	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and .equ',
		code: `@ Macros are expanded by the assembler, so each use costs no call.
@ A numeric label such as 1: can be defined again in every
@ expansion: 1b names the nearest one before, 1f the next one after.

	.equ SYS_WRITE, 4
	.equ SYS_EXIT, 1

	.macro print text, length
	mov r0, #1
	ldr r1, =\\text
	mov r2, #\\length
	mov r7, #SYS_WRITE
	svc #0
	.endm

	.macro count_to limit
	mov r4, #1
1:	add r0, r4, #'0'        @ the digit
	bl print_char
	add r4, r4, #1
	cmp r4, #\\limit
	ble 1b
	.endm

	.macro exit status=0
	mov r0, #\\status
	mov r7, #SYS_EXIT
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
		tools: ['bitmap'],
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in 16.16 fixed point, drawn to the Bitmap Display',
		code: `@ Mandelbrot set in 16.16 fixed point, drawn to the Bitmap Display.
@
@ Open the Bitmap Display tool with base 0x00420000, width and height
@ 256, and unit 8 for SIZE 32 (4 for SIZE 64). Each point c iterates
@ z = z * z + c until |z| passes 2 or MAX_ITERATIONS run out. SMULL
@ makes the 64-bit product of two 16.16 numbers; its middle 32 bits are
@ the 16.16 result.

	.equ SIZE, 32
	.equ MAX_ITERATIONS, 16
	.equ ONE, 0x10000               @ 1.0
	.equ STEP, 3 * ONE / SIZE       @ the plane shown is 3.0 across

	.data
display:	.space SIZE * SIZE * 4
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000

	.text
	.global _start
_start:
	ldr r9, =display                @ pixel cursor
	ldr r8, =-3 * ONE / 2           @ ci: the top row is at -1.5i
	mov r10, #0                     @ row
row:
	ldr r6, =-2 * ONE               @ cr: each row starts at -2.0
	mov r11, #0                     @ column
column:
	mov r0, #0                      @ zr
	mov r1, #0                      @ zi
	mov r4, #0                      @ iterations
iterate:
	smull r2, r3, r0, r0
	lsr r2, r2, #16
	orr r2, r2, r3, lsl #16         @ zr * zr
	smull r3, r5, r1, r1
	lsr r3, r3, #16
	orr r3, r3, r5, lsl #16         @ zi * zi
	add r5, r2, r3
	cmp r5, #4 * ONE                @ |z| > 2: escaped
	bgt escaped
	smull r5, r7, r0, r1
	lsr r5, r5, #15
	orr r5, r5, r7, lsl #17         @ 2 * zr * zi
	add r1, r5, r8                  @ zi = 2 zr zi + ci
	sub r0, r2, r3
	add r0, r0, r6                  @ zr = zr^2 - zi^2 + cr
	add r4, r4, #1
	cmp r4, #MAX_ITERATIONS
	blt iterate
escaped:
	ldr r7, =palette
	ldr r5, [r7, r4, lsl #2]
plot:
	str r5, [r9], #4
	add r6, r6, #STEP               @ one step right
	add r11, r11, #1
	cmp r11, #SIZE
	blt column

	add r8, r8, #STEP               @ one step down
	add r10, r10, #1
	cmp r10, #SIZE
	blt row
${EXIT}
`,
	},

	helloArmasm: {
		name: 'Hello, THRAX! (armasm)',
		description: 'The greeting in armasm syntax: AREA, ENTRY, DCB and labels in column 1',
		code: `; Hello, THRAX! in armasm syntax: labels start in column 1, without a
; colon; everything else is indented.

	AREA Hello, CODE, READONLY
	ENTRY
start
	MOV r0, #1              ; fd 1: standard output
	ADR r1, message         ; r1 -> the string, PC-relative
	MOV r2, #14             ; its length
	MOV r7, #4              ; write
	SVC #0
	MOV r0, #0              ; status
	MOV r7, #1              ; exit
	SVC #0

message
	DCB "Hello, THRAX!", 10
	ALIGN

	END
`,
	},

	factorialArmasm: {
		name: 'Factorial (armasm)',
		description: 'Compute 5! = 120 in armasm syntax, with EQU and a literal pool',
		code: `; Factorial in armasm syntax
; Compute N! = 5 * 4 * 3 * 2 * 1 = 120

N	EQU 5

	AREA Factorial, CODE, READONLY
	ENTRY
	MOV r1, #N              ; n
	LDR r2, =1              ; result: a literal, which LDR = turns into a MOV
loop
	CMP r1, #0
	BEQ done                ; if n == 0, exit loop
	MUL r2, r1, r2          ; result = n * result
	SUB r1, r1, #1          ; n--
	B loop

done
	MOV r0, r2
	BL print_uint
	MOV r0, #0              ; status
	MOV r7, #1              ; exit
	SVC #0

; print_uint: write r0 in decimal, unsigned.
print_uint
	PUSH {r4, r5, r7, lr}
	SUB sp, sp, #16         ; room for 10 digits
	ADD r1, sp, #16         ; r1 walks back from the end of the buffer
	MOV r4, #10
digit
	UDIV r5, r0, r4         ; r5 = r0 / 10
	MLS r2, r5, r4, r0      ; r2 = r0 - r5 * 10, the lowest digit
	ADD r2, r2, #'0'
	STRB r2, [r1, #-1]!
	MOVS r0, r5
	BNE digit
	MOV r0, #1              ; fd 1
	ADD r2, sp, #16
	SUB r2, r2, r1          ; length: from r1 to the end
	MOV r7, #4              ; write
	SVC #0
	ADD sp, sp, #16
	POP {r4, r5, r7, pc}

	END
`,
	},
}
