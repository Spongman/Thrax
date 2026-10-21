/** Architecture-owned source programs; the shared menu owns names and icons. */
import { mandelbrot } from './mandelbrot'

export const EXAMPLES = {
	mandelbrot,
	ackermann: {
		name: 'Ackermann',
		description: 'Nested Thumb calls and stack frames compute and print A(3, 3) = 61.',
		code: `.thumb
.text
_start:
movs r0, #3
movs r1, #3
bl ack
svc #1
bkpt #0
ack:
cmp r0, #0
beq base
cmp r1, #0
beq zero
push {r4, lr}
mov r4, r0
subs r1, #1
bl ack
mov r1, r0
subs r0, r4, #1
bl ack
pop {r4, pc}
zero:
subs r0, #1
movs r1, #1
b ack
base:
adds r0, r1, #1
bx lr
`,
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a message with the Cortex-M0 teaching console.',
		code: `.syntax unified
.cpu cortex-m0
.thumb
.text
_start:
ldr r0, =message
svc #4
bkpt #0
.ltorg
.data
message: .asciz "Hello, THRAX!\\n"
`,
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3 using Thumb integer arithmetic.',
		code: `.thumb
.text
_start:
movs r0, #5
movs r1, #3
adds r0, r0, r1
svc #1
bkpt #0
`,
	},
	factorial: {
		name: 'Factorial',
		description: 'Calculate 5! using multiplication and a conditional loop.',
		code: `.thumb
.text
_start:
movs r0, #1
movs r1, #5
multiply:
muls r0, r1
subs r1, #1
bne multiply
svc #1
bkpt #0
`,
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Find Fibonacci number 10 by keeping the previous two values.',
		code: `.thumb
.text
_start:
movs r0, #0
movs r1, #1
movs r2, #10
next:
adds r3, r0, r1
mov r0, r1
mov r1, r3
subs r2, #1
bne next
svc #1
bkpt #0
`,
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print the integers from 1 through 5 with a conditional branch.',
		code: `.thumb
.text
_start:
movs r4, #1
count:
mov r0, r4
svc #1
movs r0, #10
svc #11
adds r4, #1
cmp r4, #6
bne count
bkpt #0
`,
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Compare the AND, OR and XOR of 12 and 10.',
		code: `.thumb
.text
_start:
movs r0, #12
movs r1, #10
mov r2, r0
ands r2, r1
mov r3, r0
orrs r3, r1
mov r4, r0
eors r4, r1
mov r0, r2
svc #1
movs r0, #10
svc #11
mov r0, r3
svc #1
movs r0, #10
svc #11
mov r0, r4
svc #1
bkpt #0
`,
	},
	input: {
		name: 'Interactive Input',
		description: 'Read and echo a signed integer with the teaching console.',
		code: `.thumb
.text
_start:
svc #5
svc #1
bkpt #0
`,
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient using Thumb stores and shifts.',
		code: `.thumb
.text
_start:
ldr r0, =pixels
movs r1, #0
movs r2, #32
ldr r6, =0x00080000
row:
movs r3, #0
movs r4, #32
paint:
mov r5, r1
orrs r5, r3
str r5, [r0]
adds r0, #4
adds r3, #8
subs r4, #1
bne paint
adds r1, r1, r6
subs r2, #1
bne row
bkpt #0
.ltorg
.data
.balign 4
pixels: .space 4096
`,
	},
}
