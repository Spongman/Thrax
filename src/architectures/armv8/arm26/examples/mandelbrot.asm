@ Mandelbrot Set
@ CPU: Acorn ARM2 (26-bit), ARM3 (26-bit, 4 KB cache and CP15)
@ FPU: none; signed 8.8 fixed point
@ 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

@ The bitmap is at 0x10000. Same view and precision as the 6502 port.
@ All MUL destinations differ from Rm, including on ARM2.

	.equ MAXITER, 16

	.text
_start:
	ldr r9, =0x10000
	ldr r8, =-320           @ imaginary coordinate
	mov r10, #0             @ row
row:
	ldr r6, =-512           @ real coordinate
	mov r11, #0             @ column
column:
	mov r0, #0              @ zr
	mov r1, #0              @ zi
	mov r4, #0              @ iterations
iterate:
	mul r2, r0, r0
	mov r2, r2, asr #8
	mul r3, r1, r1
	mov r3, r3, asr #8
	add r5, r2, r3
	cmp r5, #1024
	bge escaped
	mul r5, r0, r1
	cmp r5, #0
	addlt r5, r5, #255      @ truncate the signed product toward zero
	mov r5, r5, asr #8
	add r1, r8, r5, lsl #1
	sub r0, r2, r3
	add r0, r0, r6
	add r4, r4, #1
	cmp r4, #MAXITER
	blt iterate
escaped:
	ldr r7, =palette
	ldr r5, [r7, r4, lsl #2]
plot:
	str r5, [r9], #4
	add r6, r6, #20
	add r11, r11, #1
	cmp r11, #32
	blt column
	add r8, r8, #20
	add r10, r10, #1
	cmp r10, #32
	blt row
	swi OS_Exit

	.data
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000
