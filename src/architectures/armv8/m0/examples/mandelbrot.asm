@ Mandelbrot Set
@ CPU: Arm Cortex-M0 (ARMv6-M Thumb)
@ FPU: none; signed 8.8 fixed point
@ 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

.thumb
.equ MAXITER, 16

.text
_start:
	ldr r6, =pixels
	ldr r5, =-320	@ ci
row:
	ldr r4, =-512	@ cr
column:
	movs r0, #0	@ zr
	movs r1, #0	@ zi
	movs r7, #0	@ iterations
iterate:
	mov r2, r0
	muls r2, r0
	asrs r2, r2, #8
	mov r3, r1
	muls r3, r1
	asrs r3, r3, #8
	push {r4}
	adds r4, r2, r3
	lsrs r4, r4, #10	@ sum >= 1024 means escaped
	bne escaped
	mov r4, r0
	muls r4, r1
	cmp r4, #0
	bge positive
	adds r4, #255	@ truncate the signed product toward zero
positive:
	asrs r4, r4, #8
	lsls r4, r4, #1
	adds r1, r4, r5
	pop {r4}
	subs r0, r2, r3
	adds r0, r0, r4
	adds r7, #1
	cmp r7, #MAXITER
	bne iterate
	b lookup_palette
escaped:
	pop {r4}
lookup_palette:
	ldr r3, =palette
	lsls r2, r7, #2
	ldr r2, [r3, r2]
plot:
	str r2, [r6]
	adds r6, #4
	adds r4, #20
	cmp r4, #128
	bne column
	adds r5, #20
	ldr r3, =320
	cmp r5, r3
	bne row
	bkpt #0
.ltorg

.data
.balign 4
pixels: .space 4096

palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000
