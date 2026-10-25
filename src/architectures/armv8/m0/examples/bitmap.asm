@ Bitmap Display
@ Draw a 32 by 32 red and blue gradient.

.thumb

.text
_start:
	ldr r0, =pixels
	movs r1, #0
	movs r2, #32
	ldr r6, =0x00080000
row:
	movs r3, #0
	movs r4, #32
paint:
	mov r5, r1
	orrs r5, r3
	str r5, [r0]
	adds r0, #4
	adds r3, #8
	subs r4, #1
	bne paint
	adds r1, r1, r6
	subs r2, #1
	bne row
	bkpt #0
.ltorg

.data
.balign 4
pixels: .space 4096
