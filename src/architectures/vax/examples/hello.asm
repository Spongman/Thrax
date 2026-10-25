; Hello, THRAX!
; Print a NUL-terminated string through the console transmit buffer.

TXCS = 34			; console transmit status; bit 7 is READY
TXDB = 35			; console transmit data buffer

	.TEXT
START:	MOVAB	GREETING, R2
10$:	MOVZBL	(R2)+, R0		; next character, or the NUL
	BEQL	30$
20$:	MFPR	#TXCS, R1		; wait until the transmitter is ready
	BBC	#7, R1, 20$
	MTPR	R0, #TXDB
	BRB	10$
30$:	HALT

	.DATA
GREETING:
	.ASCIZ	/Hello, THRAX!/<10>
