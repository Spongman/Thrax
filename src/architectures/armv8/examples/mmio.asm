// Keyboard and Display
// Echo each character queued in the Keyboard and Display tool, until a period.

	.equ MMIO, 0xFFFF0000
	.equ RECEIVER_CONTROL, 0
	.equ RECEIVER_DATA, 4
	.equ TRANSMITTER_DATA, 12

	.text
	.global _start
_start:
	mov x0, #MMIO
poll:
	ldr w1, [x0, #RECEIVER_CONTROL]     // bit 0 is set once a character is ready
	tbz w1, #0, poll
	ldr w2, [x0, #RECEIVER_DATA]        // reading it consumes the character
	str w2, [x0, #TRANSMITTER_DATA]     // writing it prints to the display
	cmp w2, #'.'
	b.ne poll

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0
