; Mandelbrot Set
; CPU: PDP-11/45, 11/70, LSI-11/23
; FPU: FP11; single precision (F format)
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; DEC F has the 24-bit significand of IEEE binary32 and rounds every add and
; multiply once, so the picture matches the binary32 ports. AC0 holds zx and
; AC1 zy; only AC0-AC3 can be named as an accumulator operand, so AC4 keeps
; zx^2 as a plain floating destination.

	PIXELS = 40000
	MAXITER = 16.

start:	SETF				; single precision
	SETI				; 16-bit integers
	MOV	#PIXELS, R5
	CLR	R3			; row
row:	LDCIF	R3, AC0			; cy = yMin + row * step
	MULF	step, AC0
	ADDF	yMin, AC0
	STF	AC0, cy
	CLR	R2			; column
column:	LDCIF	R2, AC0			; cx = xMin + column * step
	MULF	step, AC0
	ADDF	xMin, AC0
	STF	AC0, cx
	CLRF	AC0			; zx
	CLRF	AC1			; zy
	CLR	R4			; iteration
iterate:
	LDF	AC0, AC2		; zx^2
	MULF	AC0, AC2
	LDF	AC1, AC3		; zy^2
	MULF	AC1, AC3
	STF	AC2, AC4
	ADDF	AC3, AC2		; |z|^2
	CMPF	#4, AC2			; FN is set once 4 < |z|^2
	CFCC
	BMI	colour
	LDF	AC0, AC2		; zy = 2 * zx * zy + cy
	MULF	AC1, AC2
	ADDF	AC2, AC2
	ADDF	cy, AC2
	LDF	AC4, AC0		; zx = zx^2 - zy^2 + cx
	SUBF	AC3, AC0
	ADDF	cx, AC0
	LDF	AC2, AC1
	INC	R4
	CMP	R4, #MAXITER
	BLT	iterate
colour:	ASL	R4			; four bytes per palette entry
	ASL	R4
	MOV	palette(R4), (R5)+	; little-endian RGB32
	MOV	palette+2(R4), (R5)+
	INC	R2
	CMP	R2, #32.
	BLT	column
	INC	R3
	CMP	R3, #32.
	BLT	row
	HALT

step:	.FLT2	0.078125		; 2.5 / 32
xMin:	.FLT2	-2.0
yMin:	.FLT2	-1.25
cx:	.FLT2	0
cy:	.FLT2	0
; Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
; Each entry is the RGB value as two words, low word first.
palette:
	.WORD	60, 0, 10112, 0, 17546, 0, 30200, 0	; 000030, 00104a, 001f66, 003080
	.WORD	42240, 0, 54675, 0, 71324, 32, 106340, 75	; 0044a0, 0059bd, 1a72d4, 3d8ce0
	.WORD	123352, 142, 137762, 206, 152767, 250, 163373, 306	; 62a6ea, 86bff2, a8d5f7, c6e6fb
	.WORD	170775, 336, 174376, 357, 176377, 370, 177777, 377	; def1fd, eff8fe, f8fcff, ffffff
	.WORD	0, 0	; 000000
	.END	start
