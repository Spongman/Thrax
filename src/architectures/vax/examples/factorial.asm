; Factorial
; Compute 5! in a procedure called with CALLS; prints 120.

PRINT_INTEGER = 1

	.TEXT
START:	PUSHL	#5
	CALLS	#1, FACTORIAL		; R0 <- 5!
	CHMK	#PRINT_INTEGER
	HALT

; R0 <- n! for the longword argument n at 4(AP). The entry mask saves R2.
	.ENTRY	FACTORIAL, ^M<R2>
	MOVL	4(AP), R2
	MOVL	#1, R0
10$:	MULL2	R2, R0
	SOBGTR	R2, 10$
	RET
