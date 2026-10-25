@ Factorial
@ Compute 5! and print 120.

.thumb

.text
_start:
	movs r0, #1
	movs r1, #5
loop:
	muls r0, r1
	subs r1, #1
	bne loop
	svc #1
	bkpt #0
