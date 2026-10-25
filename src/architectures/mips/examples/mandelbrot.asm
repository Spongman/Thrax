# Mandelbrot Set
# CPU: MIPS32 (MARS)
# FPU: coprocessor 1; single precision
# 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

# Open the Bitmap Display tool with base 0x10010000 and 256 x 256. SIZE
# below is the grid in pixels, so set the unit to match: 8 for SIZE 32,
# 4 for SIZE 64. Everything else scales off SIZE on its own.
#
# For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
# z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
# pixel by how many iterations that took. Points that never escape are
# inside the set and stay black.

.eqv SIZE 32
.eqv MAXITER 16

.data
frame:		.space 16384		# room for 64 x 64 pixels, one word each

# Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000

# The view is x in [-2.0, 0.5) and y in [-1.25, 1.25).  One cell is
# span / SIZE across, worked out at run time so SIZE stays the only knob;
# for any power-of-two SIZE that division is exact in binary.
xMin:		.float -2.0
yMin:		.float -1.25
span:		.float 2.5
escape:		.float 4.0
two:		.float 2.0

.text
main:
	la $s2, frame			# cursor into the frame buffer
	li $s3, SIZE
	li $s4, MAXITER

	l.s $f16, span			# step = span / SIZE
	mtc1 $s3, $f2
	cvt.s.w $f2, $f2
	div.s $f16, $f16, $f2

	l.s $f18, escape
	l.s $f20, two
	l.s $f22, xMin
	l.s $f24, yMin

	li $s0, 0			# row
rowLoop:
	# cy = yMin + row * step
	mtc1 $s0, $f2
	cvt.s.w $f2, $f2
	mul.s $f2, $f2, $f16
	add.s $f2, $f2, $f24

	li $s1, 0			# column
columnLoop:
	# cx = xMin + column * step
	mtc1 $s1, $f0
	cvt.s.w $f0, $f0
	mul.s $f0, $f0, $f16
	add.s $f0, $f0, $f22

	mtc1 $zero, $f4			# zx = 0.0
	mtc1 $zero, $f6			# zy = 0.0
	li $t0, 0			# iteration

iterate:
	mul.s $f8, $f4, $f4		# zx^2
	mul.s $f10, $f6, $f6		# zy^2
	add.s $f12, $f8, $f10		# |z|^2

	# c.lt.s sets condition flag 0, so bc1t takes the branch once 4 < |z|^2
	c.lt.s $f18, $f12
	bc1t escaped

	mul.s $f14, $f4, $f6		# zy = 2 * zx * zy + cy
	mul.s $f14, $f14, $f20
	add.s $f6, $f14, $f2

	sub.s $f4, $f8, $f10		# zx = zx^2 - zy^2 + cx
	add.s $f4, $f4, $f0

	addi $t0, $t0, 1
	bne $t0, $s4, iterate

escaped:
	# Colour the pixel by its iteration count and advance the cursor.
	sll $t1, $t0, 2
	la $t2, palette
	add $t2, $t2, $t1
	lw $t3, 0($t2)
	sw $t3, 0($s2)
	addi $s2, $s2, 4

	addi $s1, $s1, 1
	bne $s1, $s3, columnLoop

	addi $s0, $s0, 1
	bne $s0, $s3, rowLoop

	li $v0, 10
	syscall
