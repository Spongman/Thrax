! Factorial
! Compute 5!; prints 120.

.text
_start:
	mov 5, %o0
	call factorial
	nop
	mov 1, %g1
	ta 0x10
	mov 10, %g1
	ta 0x10

factorial:
	save %sp, -96, %sp
	mov 1, %l0

multiply:
	smul %l0, %i0, %l0
	subcc %i0, 1, %i0
	bne multiply
	nop
	mov %l0, %i0
	ret
	restore
