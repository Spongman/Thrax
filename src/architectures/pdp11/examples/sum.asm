; Sum of Numbers
; Add 3 and 5; prints 8.

start:	MOV	#3, R1
	ADD	#5, R1
	MOV	R1, R0
	EMT	1			; print R0
	HALT
	.END	start
