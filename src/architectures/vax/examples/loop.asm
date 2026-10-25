; Loop Counter
; Print 1 through 5 with AOBLEQ, which adds one and branches while the count is at most 5.

PRINT_INTEGER = 1
PRINT_CHARACTER = 11

	.TEXT
START:	MOVL	#1, R2
10$:	MOVL	R2, R0
	CHMK	#PRINT_INTEGER
	MOVL	#^A/ /, R0
	CHMK	#PRINT_CHARACTER
	AOBLEQ	#5, R2, 10$
	HALT
