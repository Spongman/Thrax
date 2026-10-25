@ Fibonacci
@ Compute F(10) iteratively and print 55.

.thumb

.text
_start:
	movs r0, #0
	movs r1, #1
	movs r2, #10
loop:
	adds r3, r0, r1
	mov r0, r1
	mov r1, r3
	subs r2, #1
	bne loop
	svc #1
	bkpt #0
