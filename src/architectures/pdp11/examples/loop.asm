; Loop Counter
; Print 1 through 5.

start:	MOV	#1, R4
loop:	MOV	R4, R0
	EMT	1			; print the count
	MOV	#40, R0		; a space
	EMT	4
	INC	R4
	CMP	R4, #6
	BLT	loop
	HALT
	.END	start
