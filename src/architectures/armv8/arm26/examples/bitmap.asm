@ Bitmap Display
@ Fill a 32 x 32 grid of pixels. Tool settings: base address 0x00010000, unit 8, width 256, height 256.

	.equ DISPLAY, 0x10000

	.text
_start:
	ldr r0, =DISPLAY        @ pixel cursor; a MOV, as 0x10000 rotates into 8 bits
	mov r1, #0              @ row
row:
	mov r2, #0              @ column
column:
	mov r3, r1, lsl #19     @ row scaled into the red channel
	orr r3, r3, r2, lsl #3  @ column scaled into the blue channel
	str r3, [r0], #4        @ store, then step to the next pixel
	add r2, r2, #1
	cmp r2, #32
	blt column
	add r1, r1, #1
	cmp r1, #32
	blt row
	swi OS_Exit
