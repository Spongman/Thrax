; Floating-point Arithmetic
; 1000 * 22 / 7 in D precision truncates to 3142, and 0.1 + 0.2 against 0.3
; in F precision: rounding half away from zero makes the sum exactly 0.3,
; unlike IEEE binary32, so this prints 1.

start:	SETD				; double precision
	SETI				; 16-bit integers
	LDCIF	#22., AC0		; an integer immediate
	DIVF	#7, AC0			; a floating immediate: one word of F
	MULF	#1000, AC0
	STCFI	AC0, R0			; truncates toward zero
	EMT	1
	MOV	#40, R0			; a space
	EMT	4
	SETF				; single precision
	LDF	tenth, AC1
	ADDF	fifth, AC1
	CLR	R0
	CMPF	sum, AC1		; FZ is set when 0.1 + 0.2 = 0.3
	CFCC
	BNE	1$
	INC	R0
1$:	EMT	1
	HALT

tenth:	.FLT2	0.1
fifth:	.FLT2	0.2
sum:	.FLT2	0.3
	.END	start
