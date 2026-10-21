import type { Example } from '../contracts'
import { mandelbrot } from './mandelbrot'

/**
 * Example ARM programs, ported from the MIPS and Beta examples.  Most are GNU
 * as; the last two are armasm.  Console I/O goes through RISC OS-style SWIs
 * the machine answers while the program leaves the SWI vector alone:
 * OS_WriteC (&00), OS_WriteS (&01), OS_Write0 (&02), OS_NewLine (&03),
 * OS_ReadC (&04) and OS_Exit (&11).
 *
 * Calls follow the APCS habit: arguments in r0-r3, the result in r0, return
 * address in lr, and a subroutine that calls another saves lr on a full
 * descending stack (STMFD/LDMFD sp!).
 */

// Subroutines shared by several examples, pasted into each so it stands alone.

const DIVIDE = `@ divide: r0 = r0 / r1 and r1 = r0 % r1, unsigned, by shift and subtract.
@ The ARM2 has no divide instruction.  Uses r2 and r3.
divide:
	mov r2, #0              @ quotient
	mov r3, #1              @ the quotient bit the divisor stands for
1:	cmp r1, r0              @ shift the divisor up past the dividend
	movls r1, r1, lsl #1
	movls r3, r3, lsl #1
	bls 1b
2:	cmp r0, r1              @ then back down, subtracting where it fits
	subcs r0, r0, r1
	orrcs r2, r2, r3
	movs r3, r3, lsr #1
	movne r1, r1, lsr #1
	bne 2b
	mov r1, r0
	mov r0, r2
	mov pc, lr
`

const PRINT_DECIMAL = `@ print_decimal: write r0 >= 0 in decimal, leading digits first.
print_decimal:
	stmfd sp!, {r0-r3, lr}
	mov r1, #10
	bl divide               @ r0 <- n / 10, r1 <- n % 10
	cmp r0, #0
	blne print_decimal      @ the leading digits, if any
	add r0, r1, #'0'
	swi OS_WriteC
	ldmfd sp!, {r0-r3, pc}

${DIVIDE}`

const ARMASM_PRINT_DECIMAL = `; print_decimal: write r0 >= 0 in decimal, leading digits first.
print_decimal
	STMFD sp!, {r0-r3, lr}
	MOV r1, #10
	BL divide               ; r0 <- n / 10, r1 <- n % 10
	CMP r0, #0
	BLNE print_decimal      ; the leading digits, if any
	ADD r0, r1, #'0'
	SWI OS_WriteC
	LDMFD sp!, {r0-r3, pc}

; divide: r0 = r0 / r1 and r1 = r0 % r1, unsigned, by shift and subtract.
divide
	MOV r2, #0              ; quotient
	MOV r3, #1              ; the quotient bit the divisor stands for
up
	CMP r1, r0              ; shift the divisor up past the dividend
	MOVLS r1, r1, LSL #1
	MOVLS r3, r3, LSL #1
	BLS up
down
	CMP r0, r1              ; then back down, subtracting where it fits
	SUBCS r0, r0, r1
	ORRCS r2, r2, r3
	MOVS r3, r3, LSR #1
	MOVNE r1, r1, LSR #1
	BNE down
	MOV r1, r0
	MOV r0, r2
	MOV pc, lr
`

export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot,
	mmio: {
		name: 'Keyboard and Display',
		description: 'Poll the keyboard status, echo each character to the display and stop at a period.',
		tools: ['keyboardDisplay'],
		code: `@ Queue text in the Keyboard / Display tool, ending with a period.
.text
_start:
ldr r1, =KBD_STATUS
poll:
ldr r0, [r1]
tst r0, #1
beq poll
ldr r0, [r1, #KBD_DATA - KBD_STATUS]
str r0, [r1, #TTY_DATA - KBD_STATUS]
swi OS_WriteC
cmp r0, #'.'
bne poll
swi OS_Exit
`,
	},
	prefetch: {
		name: 'Instruction Prefetch',
		description: 'Self-modifying code: a queued instruction stays stale until a branch refills the pipeline',
		code: `@ ARM2/ARM3 retain two prefetched words. Prints 12.
	.text
_start:
	ldr r0, =0xE3A01002     @ encoding of MOV r1,#2
	adr r2, target
	mov r3, #0
	str r0, [r2]           @ target is already in the instruction pipeline
target:
	mov r1, #1             @ first pass executes the prefetched original
	cmp r3, #0
	bne done
	mov r4, r1
	mov r3, #1
	b target               @ refetch the modified instruction
done:
	add r0, r4, #48
	swi OS_WriteC
	add r0, r1, #48
	swi OS_WriteC
	swi OS_Exit
`,
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a line with OS_ReadC into a buffer, then print it with OS_Write0',
		code: `@ Read a line into a buffer, then print it

	.text
_start:
	adr r1, buffer          @ where the next character goes
	mov r2, #63             @ room left, keeping a byte for the zero
read:
	swi OS_ReadC            @ r0 <- next character, waiting for one to be typed
	strb r0, [r1], #1       @ store it and move along
	subs r2, r2, #1
	beq done                @ the buffer is full
	cmp r0, #10
	bne read                @ until the end of the line
done:
	mov r0, #0              @ the terminating zero
	strb r0, [r1]
	adr r0, buffer
	swi OS_Write0
	swi OS_Exit

buffer:	.space 64
`,
	},

	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code with OS_Write0',
		code: `@ Hello, THRAX! through RISC OS's OS_Write0

	.text
	.global _start
_start:
	adr r0, message         @ r0 -> the string, PC-relative
	swi OS_Write0           @ write it
	swi OS_Exit

message:
	.asciz "Hello, THRAX!\\n"
	.align 2
`,
	},

	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: `@ Simple addition example
@ Compute 5 + 3 = 8

	.text
_start:
	mov r1, #5              @ r1 <- 5
	mov r2, #3              @ r2 <- 3
	add r0, r1, r2          @ r0 <- r1 + r2 = 8

	bl print_decimal        @ print the result
	swi OS_NewLine
	swi OS_Exit

${PRINT_DECIMAL}`,
	},

	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
		code: `@ Factorial example
@ Compute 5! = 5 * 4 * 3 * 2 * 1 = 120

	.text
_start:
	mov r1, #5              @ n = 5
	mov r2, #1              @ result = 1
loop:
	cmp r1, #0
	beq done                @ if n == 0, exit loop
	mul r2, r1, r2          @ result = n * result
	sub r1, r1, #1          @ n--
	b loop

done:
	mov r0, r2
	bl print_decimal
	swi OS_Exit

${PRINT_DECIMAL}`,
	},

	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: `@ Fibonacci sequence
@ Compute fib(10)

	.text
_start:
	mov r1, #0              @ fib(0) = 0
	mov r2, #1              @ fib(1) = 1
	mov r3, #2              @ i = 2
loop:
	cmp r3, #10
	bgt done                @ if i > 10, exit
	add r4, r1, r2          @ temp = fib(n-2) + fib(n-1)
	mov r1, r2              @ fib(n-2) = fib(n-1)
	mov r2, r4              @ fib(n-1) = temp
	add r3, r3, #1          @ i++
	b loop

done:
	mov r0, r2
	bl print_decimal
	swi OS_Exit

${PRINT_DECIMAL}`,
	},

	ackermann: {
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: `@ Ackermann function
@ A(m, n) = n + 1                    when m = 0
@         = A(m - 1, 1)              when n = 0
@         = A(m - 1, A(m, n - 1))    otherwise
@
@ Each call saves n and lr on the stack, so it fills up as the recursion
@ deepens: watch sp.

	.text
_start:
	swi OS_WriteS           @ the label, written from just after the SWI
	.asciz "A(3, 3) = "
	.align 2
	mov r0, #3              @ m
	mov r1, #3              @ n
	bl ackermann
	bl print_decimal
	swi OS_Exit

@ ackermann(r0 = m, r1 = n), result in r0
ackermann:
	stmfd sp!, {r1, lr}
	cmp r0, #0
	addeq r0, r1, #1        @ m = 0: A(0, n) = n + 1
	beq 9f
	cmp r1, #0
	bne 1f
	sub r0, r0, #1          @ n = 0: A(m, 0) = A(m - 1, 1)
	mov r1, #1
	bl ackermann
	b 9f
1:	stmfd sp!, {r0}         @ keep m for the outer call
	sub r1, r1, #1          @ inner call: A(m, n - 1)
	bl ackermann
	mov r1, r0
	ldmfd sp!, {r0}
	sub r0, r0, #1          @ outer call: A(m - 1, inner)
	bl ackermann
9:	ldmfd sp!, {r1, pc}

${PRINT_DECIMAL}`,
	},

	loop: {
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: `@ Loop counter example
@ Print numbers 1 through 5

	.text
_start:
	mov r4, #1              @ counter = 1
loop:
	cmp r4, #6
	beq done                @ if counter == 6, exit
	mov r0, r4
	bl print_decimal        @ print counter
	mov r0, #' '
	swi OS_WriteC           @ and a space
	add r4, r4, #1
	b loop

done:
	swi OS_NewLine
	swi OS_Exit

${PRINT_DECIMAL}`,
	},

	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: `@ Bitwise operations
@ Test AND, OR and EOR with two values

	.text
_start:
	mov r4, #12             @ 12 = 0b1100
	mov r5, #10             @ 10 = 0b1010

	and r0, r4, r5          @ 12 & 10 = 8
	bl print_decimal
	mov r0, #' '
	swi OS_WriteC

	orr r0, r4, r5          @ 12 | 10 = 14
	bl print_decimal
	mov r0, #' '
	swi OS_WriteC

	eor r0, r4, r5          @ 12 ^ 10 = 6
	bl print_decimal
	swi OS_Exit

${PRINT_DECIMAL}`,
	},

	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: `@ Fill a 32 x 32 grid of pixels for the Bitmap Display tool.
@ Tool settings: base address 0x00010000, unit 8, width 256, height 256.
@ Each word is one pixel, 0x00RRGGBB, in row-major order.

	.equ DISPLAY, 0x10000

	.text
_start:
	ldr r0, =DISPLAY        @ pixel cursor; a MOV, as 0x10000 rotates into 8 bits
	mov r1, #0              @ row
row:
	mov r2, #0              @ column
column:
	mov r3, r1, lsl #19     @ row scaled into the red channel
	orr r3, r3, r2, lsl #3  @ column scaled into the blue channel
	str r3, [r0], #4        @ store, then step to the next pixel
	add r2, r2, #1
	cmp r2, #32
	blt column
	add r1, r1, #1
	cmp r1, #32
	blt row
	swi OS_Exit
`,
	},

	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and .equ',
		code: `@ Macros are expanded by the assembler, so each use costs no call and
@ return. Local labels like 1: may be defined again and again: 1b means the
@ nearest one back, so each expansion loops on its own.

	.equ FIRST, 5           @ symbols name constants
	.equ SECOND, 3

	.macro print text
	adr r0, \\text
	swi OS_Write0
	.endm

	.macro count_to limit
	mov r4, #0
1:	add r4, r4, #1
	mov r0, r4
	bl print_decimal
	cmp r4, \\limit
	bne 1b
	.endm

	.text
_start:
	print banner
	mov r5, #FIRST
	count_to r5
	print newline
	mov r5, #SECOND
	count_to r5
	print newline
	swi OS_Exit

banner:	.asciz "counting: "
newline:	.asciz "\\n"
	.align 2

${PRINT_DECIMAL}`,
	},

	keyboard: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard Interrupts',
		description: 'Own the vectors: echo keys typed in the Keyboard / Display tool from an IRQ handler, until a full stop',
		code: `@ Interrupt-driven keyboard echo.  The program owns address 0, so it
@ starts at the reset vector in SVC mode with interrupts off.  It turns on
@ the keyboard's interrupt, drops to USR mode and idles; each key raises
@ IRQ, and the handler echoes it to the display and the console.
@ Type in the Keyboard / Display tool; a full stop ends the program.

	.org 0
	b reset                 @ 0x00 reset
	b .                     @ 0x04 undefined instruction
	.word 0                 @ 0x08 SWI: left empty, so the built-in OS answers
	b .                     @ 0x0C prefetch abort
	b .                     @ 0x10 data abort
	b .                     @ 0x14 address exception
	b irq                   @ 0x18 IRQ
	b .                     @ 0x1C FIQ

reset:
	ldr r0, =KBD_STATUS
	mov r1, #2              @ bit 1: interrupt when a key is waiting
	str r1, [r0]
	teqp pc, #0             @ USR mode, IRQ and FIQ enabled
idle:
	add r2, r2, #1          @ count while waiting
	b idle

irq:                        @ IRQ mode: sp and lr are R13_irq and R14_irq
	stmfd sp!, {r0, r1}
	ldr r1, =KBD_DATA
	ldr r0, [r1]            @ take the key, which ends the request
	str r0, [r1, #TTY_DATA - KBD_DATA]
	swi OS_WriteC
	cmp r0, #'.'
	swieq OS_Exit
	ldmfd sp!, {r0, r1}
	subs pc, lr, #4         @ back to USR, flags and all
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
	ADR r0, message         ; r0 -> the string
	SWI OS_Write0
	SWI OS_Exit

message
	DCB "Hello, THRAX!", 10, 0
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
	BL print_decimal
	SWI OS_Exit

${ARMASM_PRINT_DECIMAL}
	END
`,
	},
}

/** ARM3 starts in SVC here because the program supplies the reset vector. */
export const ARM3_EXAMPLES: Readonly<Record<string, Example>> = {
	...EXAMPLES,
	cache: {
		name: 'ARM3 Cache Controls',
		description: 'Read the CPU ID, enable the unified cache, multiply and flush through CP15.',
		code: `.org 0
b start
.org 0x8000
start:
mrc p15, 0, r4, c0, c0, 0
mov r0, #1
mcr p15, 0, r0, c3, c0, 0
mcr p15, 0, r0, c4, c0, 0
mov r0, #0
mcr p15, 0, r0, c5, c0, 0
mov r0, #3
mcr p15, 0, r0, c2, c0, 0
mov r1, #5
mov r2, #1
mul r3, r1, r2
mcr p15, 0, r0, c1, c0, 0
mov r0, r3
add r0, r0, #48
swi OS_WriteC
swi OS_Exit
`
	},
}
