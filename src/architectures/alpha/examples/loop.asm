# Loop Counter
# Print the integers 1 through 5.

.text
_start:
	lda $1, 1($31)
loop:
	mov $1, $16
	lda $0, 1($31)
	call_pal 0x83
	lda $16, 32($31)
	lda $0, 11($31)
	call_pal 0x83
	addq $1, 1, $1
	cmplt $1, 6, $2
	bne $2, loop
	call_pal 0
