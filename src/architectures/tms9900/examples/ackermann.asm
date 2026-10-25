; Ackermann
; Recursive A(3, 3); prints 61.

.text
_start:
	LI R1, 3
	LI R2, 3
	BL @ackermann
	LI R0, 1
	XOP R1, 15
	LI R0, 10
	XOP R1, 15

ackermann:
	CI R1, 0
	JEQ base
	CI R2, 0
	JEQ zero
	DECT R10
	MOV R11, *R10
	DECT R10
	MOV R1, *R10
	DEC R2
	BL @ackermann
	MOV R1, R2
	MOV *R10, R1
	DEC R1
	BL @ackermann
	INCT R10
	MOV *R10+, R11
	RT
zero:
	DEC R1
	LI R2, 1
	B @ackermann
base:
	MOV R2, R1
	INC R1
	RT
