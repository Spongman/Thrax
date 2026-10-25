; Mandelbrot Set
; CPU: VAX-11/780, MicroVAX II
; FPU: built in (VAX-11/780) or 78132 (MicroVAX II); F_floating
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
; z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
; pixel by how many iterations that took. Points that never escape are
; inside the set and stay black. One cell is span / SIZE, exact for
; power-of-two SIZE. Short literals hold 2.0 and 4.0; the other constants
; are F_floating immediates.

SIZE = 32
MAXITER = 16

	.TEXT
START:	MOVAL	PIXELS, R10
	CLRL	R8			; row
ROW:	CVTLF	R8, R2			; cy = yMin + row * step
	MULF2	#0.078125, R2
	ADDF2	#-1.25, R2
	CLRL	R9			; column
COLUMN:	CVTLF	R9, R3			; cx = xMin + column * step
	MULF2	#0.078125, R3
	SUBF2	#2, R3
	CLRF	R4			; zx
	CLRF	R5			; zy
	CLRL	R7			; iteration
ITERATE:
	MULF3	R4, R4, R0		; zx^2
	MULF3	R5, R5, R1		; zy^2
	ADDF3	R0, R1, R6		; |z|^2
	CMPF	R6, #4
	BGTR	ESCAPED
	MULF2	R4, R5			; zy = 2 * zx * zy + cy
	MULF2	#2, R5
	ADDF2	R2, R5
	SUBF3	R1, R0, R4		; zx = zx^2 - zy^2 + cx
	ADDF2	R3, R4
	AOBLSS	#MAXITER, R7, ITERATE
ESCAPED:
	MOVL	PALETTE[R7], (R10)+	; index mode scales the count by four
	AOBLSS	#SIZE, R9, COLUMN
	AOBLSS	#SIZE, R8, ROW
	HALT

	.DATA
PIXELS:	.BLKL	SIZE * SIZE
; Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
PALETTE:
	.LONG	^X000030, ^X00104A, ^X001F66, ^X003080
	.LONG	^X0044A0, ^X0059BD, ^X1A72D4, ^X3D8CE0
	.LONG	^X62A6EA, ^X86BFF2, ^XA8D5F7, ^XC6E6FB
	.LONG	^XDEF1FD, ^XEFF8FE, ^XF8FCFF, ^XFFFFFF
	.LONG	^X000000
