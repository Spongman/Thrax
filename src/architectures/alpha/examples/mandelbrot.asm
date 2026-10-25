# Mandelbrot Set
# CPU: DEC Alpha
# FPU: built in; IEEE S_floating (single precision)
# 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

# The Bitmap Display reads one longword per pixel from 0x10000.
#
# For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
# z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
# pixel by how many iterations that took. Points that never escape are
# inside the set and stay black.

.equ SIZE, 32
.equ MAXITER, 16

.text
_start:
	ldah $9, 1($31)			# cursor into the frame buffer
	ldah $15, 1($31)
	lda $15, palette - 65536($15)	# palette, then the constants

	lda $11, SIZE($31)		# step = span / SIZE
	stq $11, scratch - palette($15)
	ldt $f2, scratch - palette($15)
	cvtqs $f2, $f2
	lds $f16, span - palette($15)
	divs $f16, $f2, $f16

	lds $f18, escape - palette($15)
	lds $f20, two - palette($15)
	lds $f22, xMin - palette($15)
	lds $f24, yMin - palette($15)

	clr $12				# row
row:
	# cy = yMin + row * step
	stq $12, scratch - palette($15)
	ldt $f3, scratch - palette($15)
	cvtqs $f3, $f3
	muls $f3, $f16, $f3
	adds $f3, $f24, $f3

	clr $13				# column
column:
	# cx = xMin + column * step
	stq $13, scratch - palette($15)
	ldt $f1, scratch - palette($15)
	cvtqs $f1, $f1
	muls $f1, $f16, $f1
	adds $f1, $f22, $f1

	fclr $f4			# zx = 0.0
	fclr $f6			# zy = 0.0
	clr $14				# iteration

iterate:
	muls $f4, $f4, $f8		# zx^2
	muls $f6, $f6, $f10		# zy^2
	adds $f8, $f10, $f12		# |z|^2

	# cmptlt writes 2.0 once 4 < |z|^2
	cmptlt $f18, $f12, $f5
	fbne $f5, escaped

	muls $f4, $f6, $f14		# zy = 2 * zx * zy + cy
	muls $f14, $f20, $f14
	adds $f14, $f3, $f6

	subs $f8, $f10, $f4		# zx = zx^2 - zy^2 + cx
	adds $f4, $f1, $f4

	addq $14, 1, $14
	cmplt $14, MAXITER, $6
	bne $6, iterate

escaped:
	# Colour the pixel by its iteration count and advance the cursor.
	s4addq $14, $15, $6
	ldl $5, 0($6)
	stl $5, 0($9)
	addq $9, 4, $9

	addq $13, 1, $13
	cmplt $13, SIZE, $6
	bne $6, column

	addq $12, 1, $12
	cmplt $12, SIZE, $6
	bne $6, row

	call_pal 0

.data
pixels: .space 4096

# Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
palette:
	.long 0x000030, 0x00104a, 0x001f66, 0x003080
	.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.long 0x000000

# The view is x in [-2.0, 0.5) and y in [-1.25, 1.25), as S_floating bits.
xMin:	.long 0xc0000000		# -2.0
yMin:	.long 0xbfa00000		# -1.25
span:	.long 0x40200000		# 2.5
escape:	.long 0x40800000		# 4.0
two:	.long 0x40000000		# 2.0
	.align 8
scratch: .quad 0
