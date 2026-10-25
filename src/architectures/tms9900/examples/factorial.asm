; Factorial
; Compute 5!; prints 120.

.text
_start:
	LI R1, 5
	BL @factorial
	LI R0, 1
	XOP R1, 15
	LI R0, 10
	XOP R1, 15

factorial:
	MOV R1, R4
	LI R1, 1
loop:
	CI R4, 0
	JEQ done
	MOV R1, R2
	MPY R4, R2
	MOV R3, R1
	DEC R4
	JMP loop
done:
	RT
