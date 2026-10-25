; Ackermann
; Recursive A(3, 3) through CALLS and RET; prints 61.

PRINT_INTEGER = 1

	.TEXT
START:	PUSHL	#3			; n
	PUSHL	#3			; m
	CALLS	#2, ACKERMANN
	CHMK	#PRINT_INTEGER
	HALT

; R0 <- A(m, n) for m at 4(AP) and n at 8(AP). Each call has its own frame.
	.ENTRY	ACKERMANN, ^M<R2>
	MOVL	4(AP), R2		; m
	BNEQ	10$
	ADDL3	#1, 8(AP), R0		; A(0, n) = n + 1
	RET
10$:	DECL	R2			; m - 1
	TSTL	8(AP)
	BNEQ	20$
	PUSHL	#1			; A(m, 0) = A(m - 1, 1)
	PUSHL	R2
	CALLS	#2, ACKERMANN
	RET
20$:	SUBL3	#1, 8(AP), -(SP)	; A(m, n) = A(m - 1, A(m, n - 1))
	PUSHL	4(AP)
	CALLS	#2, ACKERMANN
	PUSHL	R0
	PUSHL	R2
	CALLS	#2, ACKERMANN
	RET
