; Bitmap Display
; Draw a 32 by 32 RGB gradient, one longword per pixel.

	.TEXT
START:	MOVAL	PIXELS, R2
	CLRL	R3			; row
10$:	CLRL	R4			; column
20$:	ASHL	#19, R3, R0		; red from the row
	ASHL	#3, R4, R1		; blue from the column
	BISL3	R1, R0, (R2)+
	AOBLSS	#32, R4, 20$
	AOBLSS	#32, R3, 10$
	HALT

	.DATA
PIXELS:	.BLKL	1024
