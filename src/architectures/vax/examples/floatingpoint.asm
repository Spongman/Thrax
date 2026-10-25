; Floating-point Arithmetic
; F_floating, D_floating and G_floating in the VAX's own formats, which round ties away
; from zero and have no infinities or NaNs. Floating values live in general
; registers; a D_floating or G_floating value takes a pair such as R6/R7.
; 0.1 + 0.2 equals 0.3 in F and in D, whose 56-bit fraction is wider than
; IEEE double; G_floating has the IEEE double's 53 bits and the sum lands above.

PRINT_INTEGER = 1
PRINT_STRING = 4
PRINT_CHARACTER = 11

	.TEXT
START:	; 1000 * 22 / 7 in F_floating; CVTFL truncates 3142.857
	CVTLF	#22, R6
	DIVF2	#7, R6			; 7 is the floating short literal 7.0
	MULF2	#1000, R6		; 1000 needs an F_floating immediate
	CVTFL	R6, R0
	MOVAB	FIRST, R1
	BSBW	REPORT

	; 22 / 7 * 10^6 in D_floating; CVTRDL rounds 3142857.14
	MOVD	#22, R6
	DIVD2	#7, R6
	MULD2	#1000000, R6
	CVTRDL	R6, R0
	MOVAB	SECOND, R1
	BSBW	REPORT

	; 0.1 + 0.2 against 0.3 in F_floating, D_floating and G_floating
	ADDF3	#0.1, #0.2, R6
	MOVAB	F_GREATER, R1		; MOVAB sets N and Z, so it goes before the compare
	CMPF	R6, #0.3
	BGTR	10$
	MOVAB	F_NOT_GREATER, R1
10$:	BSBW	SAY
	ADDD3	#0.1, #0.2, R6
	MOVAB	D_GREATER, R1
	CMPD	R6, #0.3
	BGTR	20$
	MOVAB	D_NOT_GREATER, R1
20$:	BSBW	SAY
	ADDG3	#0.1, #0.2, R6
	MOVAB	G_GREATER, R1
	CMPG	R6, #0.3
	BGTR	30$
	MOVAB	G_NOT_GREATER, R1
30$:	BSBW	SAY
	HALT

; Print the string at R1, the integer in R0, then a newline.
REPORT:	PUSHL	R0
	BSBB	SAY
	MOVL	(SP)+, R0
	CHMK	#PRINT_INTEGER
	MOVL	#10, R0
	CHMK	#PRINT_CHARACTER
	RSB

; Print the string at R1.
SAY:	MOVL	R1, R0
	CHMK	#PRINT_STRING
	RSB

	.DATA
FIRST:	.ASCIZ	"1000 * 22 / 7 = "
SECOND:	.ASCIZ	"22 / 7 * 10^6 = "
F_GREATER:	.ASCIZ	"F: 0.1 + 0.2 > 0.3"<10>
F_NOT_GREATER:	.ASCIZ	"F: 0.1 + 0.2 <= 0.3"<10>
D_GREATER:	.ASCIZ	"D: 0.1 + 0.2 > 0.3"<10>
D_NOT_GREATER:	.ASCIZ	"D: 0.1 + 0.2 <= 0.3"<10>
G_GREATER:	.ASCIZ	"G: 0.1 + 0.2 > 0.3"<10>
G_NOT_GREATER:	.ASCIZ	"G: 0.1 + 0.2 <= 0.3"<10>
