@ Mandelbrot Set
@ CPU: Arm AArch32 (A32), with the Floating point setting off
@ FPU: none; signed 16.16 fixed point
@ 32 x 32 pixels, 16 iterations, x in [-2.0, 1.0), y in [-1.5, 1.5)

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

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0
