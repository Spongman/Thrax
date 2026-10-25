; Bitmap Display
; Draw a 32 by 32 RGB gradient.

.text
_start:
	LI R8, pixels
	CLR R6
row:
	CLR R7
pixel:
	MOV R7, R3
	SLA R3, 3
	SWPB R3
	MOVB R3, *R8+
	CLR R3
	MOVB R3, *R8+
	MOV R6, R3
	SLA R3, 3
	SWPB R3
	MOVB R3, *R8+
	CLR R3
	MOVB R3, *R8+
	INC R7
	CI R7, 32
	JLT pixel
	INC R6
	CI R6, 32
	JLT row
	LI R0, 10
	XOP R1, 15

.data
pixels: .space 4096
