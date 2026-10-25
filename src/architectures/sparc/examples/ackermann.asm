! Ackermann
! Recursive A(3, 3) with an explicit software stack; prints 61.

.text
_start:
	mov 3, %o0
	mov 3, %o1
	call ackermann
	nop
	mov 1, %g1
	ta 0x10
	mov 10, %g1
	ta 0x10

ackermann:
	cmp %o0, 0
	be base
	nop
	cmp %o1, 0
	be zero
	nop
	sub %sp, 16, %sp
	st %o7, [%sp + 12]
	st %o0, [%sp + 8]
	dec %o1
	call ackermann
	nop
	mov %o0, %o1
	ld [%sp + 8], %o0
	dec %o0
	call ackermann
	nop
	ld [%sp + 12], %o7
	add %sp, 16, %sp
	retl
	nop
zero:
	dec %o0
	mov 1, %o1
	ba ackermann
	nop
base:
	add %o1, 1, %o0
	retl
	nop
