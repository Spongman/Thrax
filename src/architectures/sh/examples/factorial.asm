; Factorial
; Compute 5!; prints 120.

.text
_start:
	mov #5, r4
	bsr factorial
	nop
	mov #1, r0
	trapa #0x10
	mov #10, r0
	trapa #0x10

factorial:
	mov r4, r1
	mov #1, r4
loop:
	mulu.w r1, r4
	sts macl, r4
	add #-1, r1
	tst r1, r1
	bf loop
	rts
	nop
