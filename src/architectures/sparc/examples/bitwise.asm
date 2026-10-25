! Bitwise Operations
! AND, OR and XOR of 12 and 10 produce 8, 14 and 6.

.text
_start:
	mov 12, %l0
	mov 10, %l1
	and %l0, %l1, %o0
	mov 1, %g1
	ta 0x10
	mov 32, %o0
	mov 11, %g1
	ta 0x10
	or %l0, %l1, %o0
	mov 1, %g1
	ta 0x10
	mov 32, %o0
	mov 11, %g1
	ta 0x10
	xor %l0, %l1, %o0
	mov 1, %g1
	ta 0x10
	mov 10, %g1
	ta 0x10
