; Loop Counter
; Print 1 through 5, counting down the iterations with SOB.

start:	MOV	#1, R4
	MOV	#5, R5			; iterations left
loop:	MOV	R4, R0
	EMT	1			; print the count
	MOV	#40, R0		; a space
	EMT	4
	INC	R4
	SOB	R5, loop
	HALT
	.END	start
