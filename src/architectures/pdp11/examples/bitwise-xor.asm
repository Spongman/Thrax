; Bitwise Operations
; AND, OR and XOR of 12 and 10 produce 8, 14 and 6.

start:	MOV	#12., R4
	MOV	#10., R5
	MOV	R4, R0			; AND is BIC of the complement
	MOV	R5, R1
	COM	R1
	BIC	R1, R0
	EMT	1
	MOV	#40, R0		; a space
	EMT	4
	MOV	R4, R0			; OR is BIS
	BIS	R5, R0
	EMT	1
	MOV	#40, R0		; a space
	EMT	4
	MOV	R4, R0
	XOR	R5, R0			; XOR takes its source from a register
	EMT	1
	HALT
	.END	start
