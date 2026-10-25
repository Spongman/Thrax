! Mandelbrot Set
! CPU: SPARC V8
! FPU: built in; single precision
! 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

! For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
! z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
! pixel by how many iterations that took. Points that never escape are
! inside the set and stay black. One cell is span / SIZE, exact for power-of-two SIZE.
! SPARC has no integer-to-FP register move, so counters pass through memory.

.equ SIZE, 32
.equ MAXITER, 16

.text
_start:
	set pixels, %g2
	set palette, %g3
	set constants, %g4
	ld [%g4], %f16		! span
	ld [%g4 + 4], %f18	! escape limit for |z|^2
	ld [%g4 + 8], %f20	! 2.0
	ld [%g4 + 12], %f22	! xMin
	ld [%g4 + 16], %f24	! yMin
	mov SIZE, %l1
	st %l1, [%g4 + 20]
	ld [%g4 + 20], %f2
	fitos %f2, %f2
	fdivs %f16, %f2, %f16	! step = span / SIZE
	clr %g6			! row
row:
	st %g6, [%g4 + 20]	! cy = yMin + row * step
	ld [%g4 + 20], %f2
	fitos %f2, %f2
	fmuls %f2, %f16, %f2
	fadds %f2, %f24, %f2
	clr %g7			! column
column:
	st %g7, [%g4 + 20]	! cx = xMin + column * step
	ld [%g4 + 20], %f0
	fitos %f0, %f0
	fmuls %f0, %f16, %f0
	fadds %f0, %f22, %f0
	st %g0, [%g4 + 20]	! zx = zy = 0.0
	ld [%g4 + 20], %f4
	fmovs %f4, %f6
	clr %l5			! iteration
iterate:
	fmuls %f4, %f4, %f8	! zx^2
	fmuls %f6, %f6, %f10	! zy^2
	fadds %f8, %f10, %f12	! |z|^2
	fcmps %f18, %f12	! fcc is L once 4 < |z|^2
	fmuls %f4, %f6, %f14	! zx * zy, which also keeps FBfcc off the FCMPs as V8 requires
	fbl escaped
	nop
	fmuls %f14, %f20, %f14	! zy = 2 * zx * zy + cy
	fadds %f14, %f2, %f6
	fsubs %f8, %f10, %f4	! zx = zx^2 - zy^2 + cx
	fadds %f4, %f0, %f4
	inc %l5
	cmp %l5, MAXITER
	bl iterate
	nop
escaped:
	! Colour the pixel by its iteration count as little-endian RGB bytes.
	sll %l5, 2, %l6
	ld [%g3 + %l6], %l7
	stb %l7, [%g2]
	srl %l7, 8, %l6
	stb %l6, [%g2 + 1]
	srl %l7, 16, %l6
	stb %l6, [%g2 + 2]
	stb %g0, [%g2 + 3]
	add %g2, 4, %g2
	inc %g7
	cmp %g7, SIZE
	bl column
	nop
	inc %g6
	cmp %g6, SIZE
	bl row
	nop
	mov 10, %g1
	ta 0x10

.data
pixels: .space 4096
! Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
palette:
.word 0x000030, 0x00104a, 0x001f66, 0x003080
.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
.word 0x000000
! IEEE single bit patterns: span 2.5, limit 4.0, 2.0, xMin -2.0, yMin -1.25.
constants:
.word 0x40200000, 0x40800000, 0x40000000, 0xc0000000, 0xbfa00000
scratch: .word 0
