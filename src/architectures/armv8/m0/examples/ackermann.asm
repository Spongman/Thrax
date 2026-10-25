@ Ackermann
@ Compute A(3, 3) by recursion and print 61.

.thumb

.text
_start:
	movs r0, #3
	movs r1, #3
	bl ackermann
	svc #1
	bkpt #0

ackermann:
	cmp r0, #0
	beq base
	cmp r1, #0
	beq zero
	push {r4, lr}
	mov r4, r0
	subs r1, #1
	bl ackermann
	mov r1, r0
	subs r0, r4, #1
	bl ackermann
	pop {r4, pc}
zero:
	subs r0, #1
	movs r1, #1
	b ackermann
base:
	adds r0, r1, #1
	bx lr
