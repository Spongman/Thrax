; Sum of Numbers
; Add 3 and 5; prints 8.

PRINT_INTEGER = 1

	.TEXT
START:	ADDL3	#3, #5, R0		; both addends are short literals
	CHMK	#PRINT_INTEGER
	HALT
