@ Keyboard and Display
@ Echo each character queued in the Keyboard and Display tool, until a period.

	.text
_start:
	ldr r1, =KBD_STATUS
poll:
	ldr r0, [r1]
	tst r0, #1
	beq poll
	ldr r0, [r1, #KBD_DATA - KBD_STATUS]
	str r0, [r1, #TTY_DATA - KBD_STATUS]
	swi OS_WriteC
	cmp r0, #'.'
	bne poll
	swi OS_Exit
