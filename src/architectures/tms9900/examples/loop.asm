; Loop Counter
; Print 1 through 5.

.text
_start:
	LI R4, 1
loop:
	MOV R4, R1
	LI R0, 1
	XOP R1, 15
	LI R1, 32
	LI R0, 11
	XOP R1, 15
	INC R4
	CI R4, 6
	JLT loop
	LI R0, 10
	XOP R1, 15
