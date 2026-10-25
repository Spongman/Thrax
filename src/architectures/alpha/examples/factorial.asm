# Factorial
# Compute 5! and print 120.

.text
_start:
	lda $16, 5($31)
	bsr $26, factorial
	mov $0, $16
	lda $0, 1($31)
	call_pal 0x83
	call_pal 0

factorial:
	lda $0, 1($31)
loop:
	beq $16, done
	mulq $0, $16, $0
	subq $16, 1, $16
	br $31, loop
done:
	ret
