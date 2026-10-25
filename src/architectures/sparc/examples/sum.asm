! Sum of Numbers
! Add 3 and 5; prints 8.

.text
_start:
	mov 3, %o0
	add %o0, 5, %o0
	mov 1, %g1
	ta 0x10
	mov 10, %g1
	ta 0x10
