@ Bitwise Operations
@ Print the AND, OR and XOR of 12 and 10: 8, 14 and 6.

.thumb

.text
_start:
	movs r0, #12
	movs r1, #10
	mov r2, r0
	ands r2, r1
	mov r3, r0
	orrs r3, r1
	mov r4, r0
	eors r4, r1
	mov r0, r2
	svc #1
	movs r0, #10
	svc #11
	mov r0, r3
	svc #1
	movs r0, #10
	svc #11
	mov r0, r4
	svc #1
	bkpt #0
