# Bitwise Operations
# Print the AND, OR and XOR of 12 and 10: 8, 14 and 6.

.text
_start:
	lda $1, 12($31)
	lda $2, 10($31)
	and $1, $2, $16
	lda $0, 1($31)
	call_pal 0x83
	lda $16, 32($31)
	lda $0, 11($31)
	call_pal 0x83
	bis $1, $2, $16
	lda $0, 1($31)
	call_pal 0x83
	lda $16, 32($31)
	lda $0, 11($31)
	call_pal 0x83
	xor $1, $2, $16
	lda $0, 1($31)
	call_pal 0x83
	call_pal 0
