; Ackermann
; Recursive A(3, 3) on the hardware stack; prints 61.

start:	MOV	#3, R0			; m
	MOV	#3, R1			; n
	JSR	PC, ack
	MOV	R1, R0
	EMT	1
	HALT

; R1 = A(R0, R1); R0 is preserved.
ack:	TST	R0
	BNE	1$
	INC	R1			; A(0, n) = n + 1
	RTS	PC
1$:	MOV	R0, -(SP)
	TST	R1
	BNE	2$
	MOV	#1, R1			; A(m, 0) = A(m - 1, 1)
	BR	3$
2$:	DEC	R1			; A(m, n) = A(m - 1, A(m, n - 1))
	JSR	PC, ack
3$:	DEC	R0
	JSR	PC, ack
	MOV	(SP)+, R0
	RTS	PC
	.END	start
