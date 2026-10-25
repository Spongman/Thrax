// Bitmap Display
// Fill a 32 x 32 grid of pixels. Tool settings: base address 0x00420000, unit 8, width 256, height 256.

	.data
display:	.space 4096     // 32 x 32 pixels, one 0x00RRGGBB word each, row-major

	.text
	.global _start
_start:
	ldr x0, =display        // pixel cursor
	mov x1, #0              // row
row:
	mov x2, #0              // column
column:
	lsl w3, w1, #19         // row scaled into the red channel
	orr w3, w3, w2, lsl #3  // column scaled into the blue channel
	str w3, [x0], #4        // store the pixel, then step past it
	add x2, x2, #1
	cmp x2, #32
	b.lt column

	add x1, x1, #1
	cmp x1, #32
	b.lt row

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0
