# Bitmap Display
# Draw a 32 by 32 red and blue gradient.

.text
_start:
	li t0, 0x10000
	li t1, 0
	li t6, 32
row:
	li t2, 0
pixel:
	slli t3, t1, 19
	slli t4, t2, 3
	or t5, t3, t4
	sw t5, 0(t0)
	addi t0, t0, 4
	addi t2, t2, 1
	blt t2, t6, pixel
	addi t1, t1, 1
	blt t1, t6, row
	ebreak
