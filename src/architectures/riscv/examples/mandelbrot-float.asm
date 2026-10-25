# Mandelbrot Set
# CPU: RISC-V RV32IM, RV32IMC
# FPU: F extension, or F and D extensions; single precision
# 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

# For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
# z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
# pixel by how many iterations that took. Points that never escape are
# inside the set and stay black.

.equ SIZE, 32
.equ MAXITER, 16

.text
_start:
	la s2, pixels		# cursor into the frame buffer
	li s3, SIZE
	li s4, MAXITER

	la t0, constants
	flw fs0, 8(t0)		# step = span / SIZE
	fcvt.s.w ft0, s3
	fdiv.s fs0, fs0, ft0
	flw fs1, 12(t0)		# escape radius
	flw fs2, 16(t0)		# 2.0
	flw fs3, 0(t0)		# xMin
	flw fs4, 4(t0)		# yMin

	li s0, 0		# row
row:
	# cy = yMin + row * step
	fcvt.s.w fa1, s0
	fmul.s fa1, fa1, fs0
	fadd.s fa1, fa1, fs4

	li s1, 0		# column
column:
	# cx = xMin + column * step
	fcvt.s.w fa0, s1
	fmul.s fa0, fa0, fs0
	fadd.s fa0, fa0, fs3

	fmv.w.x ft0, zero	# zx = 0.0
	fmv.w.x ft1, zero	# zy = 0.0
	li t0, 0		# iteration
iterate:
	fmul.s ft2, ft0, ft0	# zx^2
	fmul.s ft3, ft1, ft1	# zy^2
	fadd.s ft4, ft2, ft3	# |z|^2
	flt.s t1, fs1, ft4	# escaped once 4 < |z|^2
	bnez t1, escaped

	fmul.s ft5, ft0, ft1	# zy = 2 * zx * zy + cy
	fmul.s ft5, ft5, fs2
	fadd.s ft1, ft5, fa1

	fsub.s ft0, ft2, ft3	# zx = zx^2 - zy^2 + cx
	fadd.s ft0, ft0, fa0

	addi t0, t0, 1
	bne t0, s4, iterate

escaped:
	# Colour the pixel by its iteration count and advance the cursor.
	slli t1, t0, 2
	la t2, palette
	add t2, t2, t1
	lw t3, 0(t2)
	sw t3, 0(s2)
	addi s2, s2, 4

	addi s1, s1, 1
	bne s1, s3, column

	addi s0, s0, 1
	bne s0, s3, row
	ebreak

.data
pixels: .space 4096

# Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000

# The view is x in [-2.0, 0.5) and y in [-1.25, 1.25); span / SIZE is exact in binary.
constants:
	.float -2.0, -1.25, 2.5, 4.0, 2.0
