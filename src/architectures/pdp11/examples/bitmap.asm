; Bitmap Display
; Draw a 32 by 32 RGB gradient: red follows the row, blue the column.

	PIXELS = 40000			; the display's little-endian RGB32 frame

start:	MOV	#PIXELS, R1
	CLR	R3			; row * 8
row:	CLR	R2			; column * 8
column:	MOV	R2, (R1)+		; blue in the low byte, green zero
	MOV	R3, (R1)+		; red, then the unused byte
	ADD	#8., R2
	CMP	R2, #256.
	BLO	column
	ADD	#8., R3
	CMP	R3, #256.
	BLO	row
	HALT
	.END	start
