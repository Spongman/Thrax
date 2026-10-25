; Mandelbrot Set
; CPU: Motorola MC68020
; FPU: Motorola MC68881 or MC68882; single precision
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; Same palette as the MIPS port. FPCR selects single-precision rounding, so every result
; rounds to a 24-bit mantissa exactly as MIPS add.s/mul.s do. Points that
; never escape |z|^2 > 4 within MAXITER iterations stay black.
.equ SIZE, 32
.equ MAXITER, 16

.text
main:
	fmove.l #$40, fpcr	; single precision, round to nearest
	lea pixels, a0
	fmove.s #2.5, fp7
	fdiv.l #SIZE, fp7	; step = span / SIZE, exact
	moveq #0, d7		; row
row:
	fmove.l d7, fp6
	fmul.x fp7, fp6
	fadd.s #-1.25, fp6	; cy = yMin + row * step
	moveq #0, d6		; column
column:
	fmove.l d6, fp5
	fmul.x fp7, fp5
	fadd.s #-2.0, fp5	; cx = xMin + column * step
	fmovecr.x #$0f, fp0	; zx = 0.0
	fmove.x fp0, fp1	; zy = 0.0
	moveq #0, d5		; iteration
iterate:
	fmove.x fp0, fp2
	fmul.x fp0, fp2		; zx^2
	fmove.x fp1, fp3
	fmul.x fp1, fp3		; zy^2
	fmove.x fp2, fp4
	fadd.x fp3, fp4		; |z|^2
	fcmp.s #4.0, fp4
	fbogt escaped		; 4 < |z|^2
	fmul.x fp0, fp1		; zy = 2 * zx * zy + cy
	fadd.x fp1, fp1
	fadd.x fp6, fp1
	fmove.x fp2, fp0	; zx = zx^2 - zy^2 + cx
	fsub.x fp3, fp0
	fadd.x fp5, fp0
	addq.l #1, d5
	cmpi.l #MAXITER, d5
	blt iterate
escaped:
	lea palette, a1
	move.l d5, d4
	lsl.l #2, d4
	move.l 0(a1,d4.l), (a0)+
	addq.l #1, d6
	cmpi.l #SIZE, d6
	bne column
	addq.l #1, d7
	cmpi.l #SIZE, d7
	bne row
	moveq #9, d0
	trap #15

.data
pixels: .space 4096
; Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
palette:
	.long 0x000030, 0x00104a, 0x001f66, 0x003080
	.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.long 0x000000
