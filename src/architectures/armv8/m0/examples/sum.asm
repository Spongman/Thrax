@ Sum of Numbers
@ Add two numbers and print the sum, 8.

.thumb

.text
_start:
	movs r0, #5
	movs r1, #3
	adds r0, r0, r1
	svc #1
	bkpt #0
