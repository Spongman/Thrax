; Factorial
; Compute 5! = 120 recursively with the EIS MUL instruction.

start:	MOV	#5, R0
	JSR	PC, fact
	EMT	1			; print R0
	HALT

; R0 = R0!, recursively.
fact:	CMP	R0, #1
	BGT	1$
	MOV	#1, R0
	RTS	PC
1$:	MOV	R0, -(SP)		; keep n
	DEC	R0
	JSR	PC, fact		; R0 = (n - 1)!
	MUL	(SP)+, R0		; R0:R1 = n * (n - 1)!
	MOV	R1, R0			; the low word
	RTS	PC
	.END	start
