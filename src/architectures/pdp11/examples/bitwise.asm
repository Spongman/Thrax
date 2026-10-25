; Bitwise Operations
; AND, OR and XOR of 12 and 10 produce 8, 14 and 6.
; The PDP-11/20 has no XOR, so it is (a OR b) AND NOT (a AND b).

start:	MOV	#12., R4
	MOV	#10., R5
	MOV	R4, R0			; AND is BIC of the complement
	MOV	R5, R1
	COM	R1
	BIC	R1, R0
	MOV	R0, R2			; keep a AND b
	EMT	1
	MOV	#40, R0		; a space
	EMT	4
	MOV	R4, R3			; OR is BIS
	BIS	R5, R3
	MOV	R3, R0
	EMT	1
	MOV	#40, R0		; a space
	EMT	4
	MOV	R3, R0			; XOR clears the common bits from the OR
	BIC	R2, R0
	EMT	1
	HALT
	.END	start
