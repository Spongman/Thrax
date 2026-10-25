# Fibonacci
# Compute F(10) iteratively and print 55.

.text
_start:
	clr $16
	lda $1, 1($31)
	lda $2, 10($31)
loop:
	addq $16, $1, $3
	mov $1, $16
	mov $3, $1
	subq $2, 1, $2
	bne $2, loop
	lda $0, 1($31)
	call_pal 0x83
	call_pal 0
