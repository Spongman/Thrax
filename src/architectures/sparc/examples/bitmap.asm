! Bitmap Display
! Draw a 32 by 32 RGB gradient.

.text
_start:
	set pixels, %g2
	clr %g6
row:
	clr %g7
pixel:
	sll %g6, 19, %l0
	sll %g7, 3, %l1
	or %l0, %l1, %l0
	stb %l0, [%g2]
	srl %l0, 8, %l1
	stb %l1, [%g2 + 1]
	srl %l0, 16, %l1
	stb %l1, [%g2 + 2]
	stb %g0, [%g2 + 3]
	add %g2, 4, %g2
	inc %g7
	cmp %g7, 32
	bl pixel
	nop
	inc %g6
	cmp %g6, 32
	bl row
	nop
	mov 10, %g1
	ta 0x10

.data
pixels: .space 4096
