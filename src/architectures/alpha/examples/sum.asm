# Sum of Numbers
# Add two numbers and print the sum, 8.

.text
_start:
	lda $1, 3($31)
	addq $1, 5, $16
	lda $0, 1($31)
	call_pal 0x83
	call_pal 0
