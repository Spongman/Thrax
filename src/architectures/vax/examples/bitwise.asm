; Bitwise Operations
; AND, OR and XOR of 12 and 10 produce 8, 14 and 6.
; The VAX has no AND: BIC clears the bits set in the complemented mask.

PRINT_INTEGER = 1
PRINT_CHARACTER = 11

	.TEXT
START:	MOVL	#12, R2
	MOVL	#10, R3
	MCOML	R3, R1
	BICL3	R1, R2, R0		; 12 AND 10
	BSBB	SHOW
	BISL3	R3, R2, R0		; 12 OR 10
	BSBB	SHOW
	XORL3	R3, R2, R0		; 12 XOR 10
	CHMK	#PRINT_INTEGER
	HALT

; Print R0 and a space.
SHOW:	CHMK	#PRINT_INTEGER
	MOVL	#^A/ /, R0
	CHMK	#PRINT_CHARACTER
	RSB
