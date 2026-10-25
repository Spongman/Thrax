; Interactive Input
; Read a signed integer through the THRAX monitor and print it back.

start:	EMT	3			; read an integer into R0
	EMT	1			; print R0 as a signed integer
	HALT
	.END	start
