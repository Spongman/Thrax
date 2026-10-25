; Interactive Input
; Read a signed integer through the console monitor and echo it.

PRINT_INTEGER = 1
READ_INTEGER = 5

	.TEXT
START:	CHMK	#READ_INTEGER		; R0 <- the integer typed at the console
	CHMK	#PRINT_INTEGER		; print R0
	HALT
