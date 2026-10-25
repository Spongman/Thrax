@ Keyboard and Display
@ Echo each character queued in the Keyboard and Display tool, until a period.

	.equ MMIO, 0xFFFF0000
	.equ RECEIVER_CONTROL, 0
	.equ RECEIVER_DATA, 4
	.equ TRANSMITTER_DATA, 12

	.text
	.global _start
_start:
	movw r0, #:lower16:MMIO
	movt r0, #:upper16:MMIO
poll:
	ldr r1, [r0, #RECEIVER_CONTROL]     @ bit 0 is set once a character is ready
	tst r1, #1
	beq poll
	ldr r2, [r0, #RECEIVER_DATA]        @ reading it consumes the character
	str r2, [r0, #TRANSMITTER_DATA]     @ writing it prints to the display
	cmp r2, #'.'
	bne poll

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0
