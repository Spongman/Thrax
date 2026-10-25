; Fibonacci
; Compute F(10); prints 55.

.text
_start:
	CLR R1
	LI R2, 1
	LI R4, 10
loop:
	MOV R1, R3
	A R2, R3
	MOV R2, R1
	MOV R3, R2
	DEC R4
	JNE loop
	LI R0, 1
	XOP R1, 15
	LI R0, 10
	XOP R1, 15
