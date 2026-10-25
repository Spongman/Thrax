; Fibonacci
; Compute F(10); prints 55.

start:	CLR	R1			; F(n)
	MOV	#1, R2			; F(n+1)
	MOV	#10., R4
loop:	MOV	R1, R3
	ADD	R2, R3
	MOV	R2, R1
	MOV	R3, R2
	DEC	R4
	BNE	loop
	MOV	R1, R0
	EMT	1
	HALT
	.END	start
