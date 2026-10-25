// Mandelbrot Set
// CPU: Arm AArch64 (A64)
// FPU: scalar FP (Floating point setting on); single precision
// 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

// Open the Bitmap Display tool with base 0x00420000, width and height
// 256, and unit 8 for SIZE 32 (4 for SIZE 64). Everything else scales
// off SIZE on its own.
//
// For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
// z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
// pixel by how many iterations that took. Points that never escape are
// inside the set and stay black. The arithmetic is the MIPS example's,
// operation for operation, so the two draw the same picture.

	.equ SIZE, 32
	.equ MAX_ITERATIONS, 16

	.data
display:	.space SIZE * SIZE * 4
// Iteration count to colour: index 0 escapes at once, index MAX_ITERATIONS is interior.
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000

// The view is x in [-2.0, 0.5) and y in [-1.25, 1.25). One cell is
// span / SIZE across, worked out at run time so SIZE stays the only knob;
// for any power-of-two SIZE that division is exact in binary.
xMin:	.float -2.0
yMin:	.float -1.25
span:	.float 2.5

	.text
	.global _start
_start:
	ldr x9, =display                // pixel cursor
	ldr x7, =palette
	mov w10, #SIZE
	mov w11, #MAX_ITERATIONS

	ldr x0, =xMin
	ldp s22, s24, [x0]              // xMin, yMin
	ldr s16, [x0, #8]               // span
	scvtf s1, w10
	fdiv s16, s16, s1               // step = span / SIZE
	fmov s18, #4.0                  // escape radius squared
	fmov s20, #2.0

	mov w12, #0                     // row
row:
	scvtf s2, w12                   // cy = yMin + row * step
	fmul s2, s2, s16
	fadd s2, s2, s24

	mov w13, #0                     // column
column:
	scvtf s0, w13                   // cx = xMin + column * step
	fmul s0, s0, s16
	fadd s0, s0, s22

	fmov s4, wzr                    // zx = 0.0
	fmov s6, wzr                    // zy = 0.0
	mov w4, #0                      // iteration
iterate:
	fmul s8, s4, s4                 // zx^2
	fmul s10, s6, s6                // zy^2
	fadd s12, s8, s10               // |z|^2
	fcmp s12, s18                   // escaped once 4 < |z|^2
	b.gt escaped

	fmul s14, s4, s6                // zy = 2 * zx * zy + cy
	fmul s14, s14, s20
	fadd s6, s14, s2

	fsub s4, s8, s10                // zx = zx^2 - zy^2 + cx
	fadd s4, s4, s0

	add w4, w4, #1
	cmp w4, w11
	b.ne iterate

escaped:
	ldr w5, [x7, x4, lsl #2]        // colour by iteration count
	str w5, [x9], #4

	add w13, w13, #1
	cmp w13, w10
	b.ne column

	add w12, w12, #1
	cmp w12, w10
	b.ne row

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0
