; Mandelbrot Set
; CPU: PDP-11/20, 11/40, 11/45, 11/70, LSI-11/23
; FPU: none; signed 8.8 fixed point with a shift-and-add multiply
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
; z = z^2 + c until |z|^2 reaches the escape radius of 4, and colours the
; pixel by how many iterations that took. The PDP-11/20 has no MUL, so FMUL
; multiplies magnitudes and restores the sign, truncating toward zero.

	PIXELS = 40000
	MAXITER = 16.

start:	MOV	#PIXELS, R5
	MOV	#-320., cy		; y = -1.25 in 8.8
row:	MOV	#-512., cx		; x = -2.0
column:	CLR	R2			; zx
	CLR	R3			; zy
	CLR	R4			; iteration
iterate:
	MOV	R2, R0			; zx^2
	MOV	R2, R1
	JSR	PC, fmul
	MOV	R0, xx
	MOV	R3, R0			; zy^2
	MOV	R3, R1
	JSR	PC, fmul
	MOV	R0, yy
	ADD	xx, R0			; |z|^2
	CMP	R0, #1024.
	BGE	colour
	MOV	R2, R0			; zy = 2 * zx * zy + cy
	MOV	R3, R1
	JSR	PC, fmul
	ASL	R0
	ADD	cy, R0
	MOV	R0, R3
	MOV	xx, R2			; zx = zx^2 - zy^2 + cx
	SUB	yy, R2
	ADD	cx, R2
	INC	R4
	CMP	R4, #MAXITER
	BLT	iterate
colour:	ASL	R4			; four bytes per palette entry
	ASL	R4
	MOV	palette(R4), (R5)+	; little-endian RGB32
	MOV	palette+2(R4), (R5)+
	ADD	#20., cx		; one cell is 2.5 / 32 = 20 / 256
	CMP	cx, #128.
	BLT	column
	ADD	#20., cy
	CMP	cy, #320.
	BLT	row
	HALT

; R0 = R0 * R1 / 256, signed and truncated toward zero; R1 is lost.
fmul:	MOV	R2, -(SP)
	MOV	R3, -(SP)
	CLR	-(SP)			; sign of the product
	TST	R0
	BPL	1$
	NEG	R0
	COM	(SP)
1$:	TST	R1
	BPL	2$
	NEG	R1
	COM	(SP)
2$:	CLR	R2			; product high word
	MOV	R1, R3			; multiplier, shifted out as the low word fills
	MOV	#16., -(SP)
3$:	CLC
	BIT	#1, R3
	BEQ	4$
	ADD	R0, R2			; carry out lands in C
4$:	ROR	R2
	ROR	R3
	DEC	(SP)
	BNE	3$
	TST	(SP)+
	SWAB	R3			; (R2:R3) / 256 is R2 low byte : R3 high byte
	BIC	#177400, R3
	SWAB	R2
	BIC	#377, R2
	BIS	R2, R3
	MOV	R3, R0
	TST	(SP)+
	BEQ	5$
	NEG	R0
5$:	MOV	(SP)+, R3
	MOV	(SP)+, R2
	RTS	PC

cx:	.WORD	0
cy:	.WORD	0
xx:	.WORD	0
yy:	.WORD	0
; Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
; Each entry is the RGB value as two words, low word first.
palette:
	.WORD	60, 0, 10112, 0, 17546, 0, 30200, 0	; 000030, 00104a, 001f66, 003080
	.WORD	42240, 0, 54675, 0, 71324, 32, 106340, 75	; 0044a0, 0059bd, 1a72d4, 3d8ce0
	.WORD	123352, 142, 137762, 206, 152767, 250, 163373, 306	; 62a6ea, 86bff2, a8d5f7, c6e6fb
	.WORD	170775, 336, 174376, 357, 176377, 370, 177777, 377	; def1fd, eff8fe, f8fcff, ffffff
	.WORD	0, 0	; 000000
	.END	start
