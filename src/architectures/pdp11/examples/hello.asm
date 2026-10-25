; Hello, THRAX!
; Print a NUL-terminated string through the console DL11, polling its ready bit.

	XCSR = 177564			; transmitter status: bit 7 is ready
	XBUF = 177566			; transmitter buffer

start:	MOV	#message, R1
1$:	MOVB	(R1)+, R0		; next character; zero ends the string
	BEQ	3$
2$:	TSTB	@#XCSR			; wait until the transmitter is ready
	BPL	2$
	MOVB	R0, @#XBUF
	BR	1$
3$:	HALT

message: .ASCIZ	/Hello, THRAX!/<12>
	.END	start
