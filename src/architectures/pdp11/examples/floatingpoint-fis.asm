; Floating-point Arithmetic
; 22 / 7 * 1000 with the FIS stack instructions, then truncated to an
; integer with EIS shifts; prints 3142.

start:	MOV	k22+2, -(SP)		; F values go low word first onto the stack,
	MOV	k22, -(SP)		; so the high word ends up at the lower address
	MOV	k7+2, -(SP)
	MOV	k7, -(SP)
	FDIV	SP			; (SP)+4 / (SP), leaving the quotient on top
	MOV	k1000+2, -(SP)
	MOV	k1000, -(SP)
	FMUL	SP
	MOV	(SP)+, R0		; high word: sign, exponent, fraction
	MOV	(SP)+, R1		; low word of the fraction
	MOV	R0, R2			; the exponent, excess 128
	ASH	#-7, R2
	BIC	#177400, R2
	SUB	#128.+24., R2		; shift that leaves the integer part
	BIC	#177600, R0		; restore the hidden bit above the fraction
	BIS	#200, R0
	ASHC	R2, R0			; R0:R1 = integer part
	MOV	R1, R0
	EMT	1
	HALT

k22:	.FLT2	22
k7:	.FLT2	7
k1000:	.FLT2	1000
	.END	start
