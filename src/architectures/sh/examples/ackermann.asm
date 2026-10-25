; Ackermann
; Recursive A(3, 3) saving PR and arguments on the stack; prints 61.

.text
_start:
	mov #3, r4
	mov #3, r5
	bsr ackermann
	nop
	mov #1, r0
	trapa #0x10
	mov #10, r0
	trapa #0x10

ackermann:
	tst r4, r4
	bt base
	tst r5, r5
	bt zero
	sts.l pr, @-r15
	mov.l r4, @-r15
	add #-1, r5
	bsr ackermann
	nop
	mov r4, r5
	mov.l @r15+, r4
	add #-1, r4
	bsr ackermann
	nop
	lds.l @r15+, pr
	rts
	nop
zero:
	add #-1, r4
	mov #1, r5
	bra ackermann
	nop
base:
	mov r5, r4
	rts
	add #1, r4
