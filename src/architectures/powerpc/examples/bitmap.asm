# Bitmap Display
# Draw a 32 by 32 red and blue gradient.

.text
_start:
	lis r20, 1
	li r23, 0
row:
	li r24, 0
pixel:
	slwi r7, r23, 19
	slwi r8, r24, 3
	or r7, r7, r8
	stb r7, 0(r20)
	srwi r8, r7, 8
	stb r8, 1(r20)
	srwi r8, r7, 16
	stb r8, 2(r20)
	li r8, 0
	stb r8, 3(r20)
	addi r20, r20, 4
	addi r24, r24, 1
	cmpwi r24, 32
	blt pixel
	addi r23, r23, 1
	cmpwi r23, 32
	blt row
	li r0, 10
	sc

.data
pixels: .space 4096
