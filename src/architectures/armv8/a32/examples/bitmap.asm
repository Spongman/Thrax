@ Bitmap Display
@ Fill a 32 x 32 grid of pixels. Tool settings: base address 0x00420000, unit 8, width 256, height 256.

	.data
display:	.space 4096     @ 32 x 32 pixels, one 0x00RRGGBB word each, row-major

	.text
	.global _start
_start:
	ldr r0, =display        @ pixel cursor
	mov r1, #0              @ row
row:
	mov r2, #0              @ column
column:
	lsl r3, r1, #19         @ row scaled into the red channel
	orr r3, r3, r2, lsl #3  @ column scaled into the blue channel
	str r3, [r0], #4        @ store the pixel, then step past it
	add r2, r2, #1
	cmp r2, #32
	blt column

	add r1, r1, #1
	cmp r1, #32
	blt row

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0
