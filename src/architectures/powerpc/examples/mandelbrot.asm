# Mandelbrot Set
# CPU: PowerPC (32-bit)
# FPU: built in; single precision
# 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

# Escape radius 4. Separate FMULS/FADDS, not fused FMADDS, round
# each step exactly like the MIPS single-precision version. Pixels are
# little-endian RGB words at the data base.

.equ SIZE, 32
.equ MAXITER, 16

.text
_start:
	lis r20, 1			# pixel cursor
	lis r26, 1
	ori r26, r26, palette & 65535
	lis r9, 1
	ori r9, r9, constants & 65535
	lfs f22, 0(r9)			# xMin
	lfs f2, 4(r9)			# cy = yMin
	lfs f16, 8(r9)			# span
	lfs f3, 12(r9)			# SIZE as a single
	fdivs f16, f16, f3		# step = span / SIZE, exact for a power of two
	lfs f18, 16(r9)			# escape radius squared
	lfs f19, 20(r9)			# 0.0
	li r23, 0
row:
	fmr f0, f22			# cx = xMin; adding step stays exact
	li r24, 0
column:
	fmr f4, f19			# zx = 0
	fmr f6, f19			# zy = 0
	li r25, 0
iterate:
	fmuls f8, f4, f4		# zx^2
	fmuls f10, f6, f6		# zy^2
	fadds f12, f8, f10		# |z|^2
	fcmpu cr0, f12, f18
	bgt escaped			# 4 < |z|^2
	fmuls f14, f4, f6		# zy = 2 * zx * zy + cy
	fadds f14, f14, f14
	fadds f6, f14, f2
	fsubs f4, f8, f10		# zx = zx^2 - zy^2 + cx
	fadds f4, f4, f0
	addi r25, r25, 1
	cmpwi r25, MAXITER
	blt iterate
escaped:
	slwi r8, r25, 2
	lwzx r7, r26, r8
	stb r7, 0(r20)
	srwi r8, r7, 8
	stb r8, 1(r20)
	srwi r8, r7, 16
	stb r8, 2(r20)
	li r8, 0
	stb r8, 3(r20)
	addi r20, r20, 4
	fadds f0, f0, f16
	addi r24, r24, 1
	cmpwi r24, SIZE
	blt column
	fadds f2, f2, f16
	addi r23, r23, 1
	cmpwi r23, SIZE
	blt row
	li r0, 10
	sc

.data
pixels: .space 4096

palette:
	.long 0x000030, 0x00104a, 0x001f66, 0x003080
	.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.long 0x000000

constants:
	.long 0xc0000000		# -2.0
	.long 0xbfa00000		# -1.25
	.long 0x40200000		# 2.5
	.long 0x42000000		# 32.0
	.long 0x40800000		# 4.0
	.long 0			# 0.0
