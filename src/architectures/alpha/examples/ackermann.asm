# Ackermann
# Compute A(3, 3) by recursion and print 61.

.text
_start:
	lda $16, 3($31)
	lda $17, 3($31)
	bsr $26, ackermann
	mov $0, $16
	lda $0, 1($31)
	call_pal 0x83
	call_pal 0

ackermann:
	beq $16, base
	beq $17, zero
	lda $30, -32($30)
	stq $26, 24($30)
	stq $16, 16($30)
	subq $17, 1, $17
	bsr $26, ackermann
	mov $0, $17
	ldq $16, 16($30)
	subq $16, 1, $16
	bsr $26, ackermann
	ldq $26, 24($30)
	lda $30, 32($30)
	ret
zero:
	subq $16, 1, $16
	lda $17, 1($31)
	br $31, ackermann
base:
	addq $17, 1, $0
	ret
