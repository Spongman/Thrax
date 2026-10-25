; Factorial
; Compute 5! = 120 with a shift-and-add multiply, since the PDP-11/20 has no MUL.

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
	MOV	(SP)+, R1
	JSR	PC, mul
	RTS	PC

; R0 = R0 * R1, unsigned, low 16 bits.
mul:	MOV	R2, -(SP)
	CLR	R2			; product
1$:	TST	R1
	BEQ	2$
	CLC
	ROR	R1			; next multiplier bit into C
	BCC	3$
	ADD	R0, R2
3$:	ASL	R0
	BR	1$
2$:	MOV	R2, R0
	MOV	(SP)+, R2
	RTS	PC
	.END	start
