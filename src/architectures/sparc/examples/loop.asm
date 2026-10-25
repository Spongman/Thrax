! Loop Counter
! Print 1 through 5.

.text
_start:
	mov 1, %o0
loop:
	mov 1, %g1
	ta 0x10
	mov %o0, %l0
	mov 32, %o0
	mov 11, %g1
	ta 0x10
	mov %l0, %o0
	cmp %o0, 5
	bl loop
	inc %o0
	mov 10, %g1
	ta 0x10
