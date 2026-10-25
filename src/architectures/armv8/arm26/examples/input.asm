@ Interactive Input
@ Read a line with OS_ReadC into a buffer, then print it with OS_Write0.

	.text
_start:
	adr r1, buffer          @ where the next character goes
	mov r2, #63             @ room left, keeping a byte for the zero
read:
	swi OS_ReadC            @ r0 <- next character, waiting for one to be typed
	strb r0, [r1], #1       @ store it and move along
	subs r2, r2, #1
	beq done                @ the buffer is full
	cmp r0, #10
	bne read                @ until the end of the line
done:
	mov r0, #0              @ the terminating zero
	strb r0, [r1]
	adr r0, buffer
	swi OS_Write0
	swi OS_Exit

buffer:	.space 64
