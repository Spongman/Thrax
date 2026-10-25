# Bitmap Display
# Fill a 32 x 32 grid of pixels. Tool settings: base address 0x10010000, unit 8, width 256, height 256.

.data
display:	.space 4096		# 32 x 32 pixels, one 0x00RRGGBB word each, row-major

.text
main:
	la $t0, display
	li $t7, 32			# rows and columns
	li $t1, 0			# row

row:
	li $t2, 0			# column

column:
	sll $t3, $t1, 19		# row scaled into the red channel
	sll $t4, $t2, 3			# column scaled into the blue channel
	or $t5, $t3, $t4
	sw $t5, 0($t0)

	addi $t0, $t0, 4
	addi $t2, $t2, 1
	bne $t2, $t7, column

	addi $t1, $t1, 1
	bne $t1, $t7, row

	li $v0, 10
	syscall
