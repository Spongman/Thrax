@ Loop Counter
@ Print the integers 1 through 5.

.thumb

.text
_start:
	movs r4, #1
loop:
	mov r0, r4
	svc #1
	movs r0, #10
	svc #11
	adds r4, #1
	cmp r4, #6
	bne loop
	bkpt #0
