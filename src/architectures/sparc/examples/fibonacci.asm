! Fibonacci
! Compute F(10); prints 55.

.text
_start:
	clr %o0
	mov 1, %o1
	mov 10, %o2
loop:
	add %o0, %o1, %o3
	mov %o1, %o0
	mov %o3, %o1
	subcc %o2, 1, %o2
	bne loop
	nop
	mov 1, %g1
	ta 0x10
	mov 10, %g1
	ta 0x10
