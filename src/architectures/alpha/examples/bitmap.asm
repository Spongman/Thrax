# Bitmap Display
# Draw a 32 by 32 red and blue gradient.

.text
_start:
	ldah $9, 1($31)
	clr $12
row:
	clr $13
pixel:
	sll $12, 19, $5
	sll $13, 3, $6
	bis $5, $6, $5
	stl $5, 0($9)
	addq $9, 4, $9
	addq $13, 1, $13
	cmplt $13, 32, $6
	bne $6, pixel
	addq $12, 1, $12
	cmplt $12, 32, $6
	bne $6, row
	call_pal 0

.data
pixels: .space 4096
