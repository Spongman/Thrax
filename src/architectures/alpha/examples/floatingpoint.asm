# Floating-point Arithmetic
# Compute sqrt(81) * 5 = 45 with IEEE T_floating instructions; prints 45.

.text
_start:
	ldah $1, 1($31)
	lda $1, input - 65536($1)
	ldt $f1, 0($1)			# quadword integers load unchanged
	ldt $f2, 8($1)
	cvtqt $f1, $f1			# 81.0
	cvtqt $f2, $f2			# 5.0
	sqrtt $f1, $f1			# 9.0 (FIX extension)
	mult $f1, $f2, $f3		# 45.0
	cvttq/c $f3, $f3		# truncate to a quadword integer
	stt $f3, 16($1)
	ldq $16, 16($1)
	lda $0, 1($31)
	call_pal 0x83
	call_pal 0

.data
input: .quad 81
factor: .quad 5
answer: .quad 0
