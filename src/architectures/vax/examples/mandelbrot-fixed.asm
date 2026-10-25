; Mandelbrot Set
; CPU: VAX-11/780, MicroVAX II
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; Fixed point keeps 8 fraction bits: 1.0 is 256 and one cell is 20 (2.5 / 32).
; DIVL2 truncates toward zero after each product, as the reference does.

SIZE = 32
MAXITER = 16

	.TEXT
START:	MOVAL	PIXELS, R10
	MOVL	#-320, R8		; cy = -1.25
	CLRL	R2			; row
ROW:	MOVL	#-512, R9		; cx = -2.0
	CLRL	R3			; column
COLUMN:	CLRL	R4			; zx
	CLRL	R5			; zy
	CLRL	R7			; iteration
ITERATE:
	MULL3	R4, R4, R0		; zx^2
	DIVL2	#256, R0
	MULL3	R5, R5, R1		; zy^2
	DIVL2	#256, R1
	ADDL3	R0, R1, R6		; |z|^2
	CMPL	R6, #1024
	BGEQ	ESCAPED
	MULL2	R4, R5			; zy = 2 * zx * zy + cy
	DIVL2	#256, R5
	ADDL2	R5, R5
	ADDL2	R8, R5
	SUBL3	R1, R0, R4		; zx = zx^2 - zy^2 + cx
	ADDL2	R9, R4
	AOBLSS	#MAXITER, R7, ITERATE
ESCAPED:
	MOVL	PALETTE[R7], (R10)+
	ADDL2	#20, R9
	AOBLSS	#SIZE, R3, COLUMN
	ADDL2	#20, R8
	AOBLSS	#SIZE, R2, ROW
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
