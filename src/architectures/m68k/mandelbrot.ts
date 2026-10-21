import type { Example } from '../contracts'

export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'Signed word multiplication draws the 32 by 32 Mandelbrot view in 8.8 fixed point.',
	tools: ['bitmap'],
	code: `; Same view as the 6502 port. MULS.W produces a signed long product.
.equ MAXITER, 16
.text
_start:
	lea pixels,a0
	move.l #-320,d7         ; ci
row:
	move.l #-512,d6         ; cr
column:
	moveq #0,d0             ; zr
	moveq #0,d1             ; zi
	moveq #0,d5             ; iterations
iterate:
	move.w d0,d2
	muls.w d0,d2
	asr.l #8,d2
	move.w d1,d3
	muls.w d1,d3
	asr.l #8,d3
	move.l d2,d4
	add.l d3,d4
	cmpi.l #1024,d4
	bge escaped
	move.w d0,d4
	muls.w d1,d4
	tst.l d4
	bpl positive
	addi.l #255,d4          ; truncate the signed product toward zero
positive:
	asr.l #8,d4
	add.l d4,d4
	add.l d7,d4
	move.l d4,d1
	move.l d2,d0
	sub.l d3,d0
	add.l d6,d0
	addq.l #1,d5
	cmpi.l #MAXITER,d5
	blt iterate
escaped:
	lea palette,a1
	move.l d5,d4
	lsl.l #2,d4
	adda.l d4,a1
	move.l (a1),d4
plot:
	move.l d4,(a0)+
	addi.l #20,d6
	cmpi.l #128,d6
	bne column
	addi.l #20,d7
	cmpi.l #320,d7
	bne row
	moveq #9,d0
	trap #15
.data
pixels: .space 4096
palette:
	.long 0x000030, 0x00104a, 0x001f66, 0x003080
	.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.long 0x000000
`,
}
