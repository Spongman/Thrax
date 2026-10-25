; Bitwise Operations
; AND, OR and XOR of 12 and 10 produce 8, 14 and 6.

.text
_start:
	LI R4, 12
	LI R5, 10
	MOV R4, R1
	ANDI R1, 10
	LI R0, 1
	XOP R1, 15
	LI R1, 32
	LI R0, 11
	XOP R1, 15
	MOV R4, R1
	SOC R5, R1
	LI R0, 1
	XOP R1, 15
	LI R1, 32
	LI R0, 11
	XOP R1, 15
	MOV R4, R1
	XOR R5, R1
	LI R0, 1
	XOP R1, 15
	LI R0, 10
	XOP R1, 15
