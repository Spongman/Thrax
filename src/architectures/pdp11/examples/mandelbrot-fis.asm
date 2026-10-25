; Mandelbrot Set
; CPU: PDP-11/40
; FPU: KE11-F FIS; single precision (F format)
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; FIS has no accumulators: FADD, FSUB, FMUL and FDIV SP take A from (SP)
; and B from 4(SP), leave B op A at 4(SP) and pop A. An F value is pushed
; low word first so its high word sits at the lower address. Any register
; can point at the operands, so R1 adds each step to cx or cy in place.
; DEC F rounds every add and multiply once, so the picture matches the
; binary32 ports.

	PIXELS = 40000
	MAXITER = 16.

start:	MOV	#PIXELS, R5
	MOV	yMin, cy
	MOV	yMin+2, cy+2
	CLR	R3			; row
row:	MOV	xMin, cx
	MOV	xMin+2, cx+2
	CLR	R2			; column
column:	CLR	zx
	CLR	zx+2
	CLR	zy
	CLR	zy+2
	CLR	R4			; iteration
iterate:
	MOV	zx+2, -(SP)		; zx^2
	MOV	zx, -(SP)
	MOV	zx+2, -(SP)
	MOV	zx, -(SP)
	FMUL	SP
	MOV	(SP), xx
	MOV	2(SP), xx+2
	MOV	zy+2, -(SP)		; zy^2
	MOV	zy, -(SP)
	MOV	zy+2, -(SP)
	MOV	zy, -(SP)
	FMUL	SP
	MOV	(SP), yy
	MOV	2(SP), yy+2
	FADD	SP			; |z|^2
	MOV	four+2, -(SP)
	MOV	four, -(SP)
	FSUB	SP			; |z|^2 - 4
	MOV	(SP)+, R0		; high word: sign and exponent
	TST	(SP)+
	TST	R0
	BGT	colour			; escaped once 4 < |z|^2
	MOV	cy+2, -(SP)		; zy = 2 * zx * zy + cy
	MOV	cy, -(SP)
	MOV	zx+2, -(SP)
	MOV	zx, -(SP)
	MOV	zy+2, -(SP)
	MOV	zy, -(SP)
	FMUL	SP
	MOV	2(SP), -(SP)		; duplicate zx * zy and double it
	MOV	2(SP), -(SP)
	FADD	SP
	FADD	SP
	MOV	(SP)+, zy
	MOV	(SP)+, zy+2
	MOV	cx+2, -(SP)		; zx = zx^2 - zy^2 + cx
	MOV	cx, -(SP)
	MOV	xx+2, -(SP)
	MOV	xx, -(SP)
	MOV	yy+2, -(SP)
	MOV	yy, -(SP)
	FSUB	SP
	FADD	SP
	MOV	(SP)+, zx
	MOV	(SP)+, zx+2
	INC	R4
	CMP	R4, #MAXITER
	BLT	iterate
colour:	ASL	R4			; four bytes per palette entry
	ASL	R4
	MOV	palette(R4), (R5)+	; little-endian RGB32
	MOV	palette+2(R4), (R5)+
	MOV	#dx, R1			; cx += dx in place
	FADD	R1
	INC	R2
	CMP	R2, #32.
	BLT	column
	MOV	#dy, R1			; cy += dy in place
	FADD	R1
	INC	R3
	CMP	R3, #32.
	BLT	row
	HALT

xMin:	.FLT2	-2.0
yMin:	.FLT2	-1.25
four:	.FLT2	4
; Each step is the A operand of an FADD whose B operand, 4 bytes on, is cx or cy.
dx:	.FLT2	0.078125		; 2.5 / 32
cx:	.FLT2	0
dy:	.FLT2	0.078125
cy:	.FLT2	0
zx:	.FLT2	0
zy:	.FLT2	0
xx:	.FLT2	0
yy:	.FLT2	0
; Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
; Each entry is the RGB value as two words, low word first.
palette:
	.WORD	60, 0, 10112, 0, 17546, 0, 30200, 0	; 000030, 00104a, 001f66, 003080
	.WORD	42240, 0, 54675, 0, 71324, 32, 106340, 75	; 0044a0, 0059bd, 1a72d4, 3d8ce0
	.WORD	123352, 142, 137762, 206, 152767, 250, 163373, 306	; 62a6ea, 86bff2, a8d5f7, c6e6fb
	.WORD	170775, 336, 174376, 357, 176377, 370, 177777, 377	; def1fd, eff8fe, f8fcff, ffffff
	.WORD	0, 0	; 000000
	.END	start
