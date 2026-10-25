@ Mandelbrot Set
@ CPU: Arm AArch32 (A32)
@ FPU: VFPv4-D16 (Floating point setting on); single precision
@ 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

@ Open the Bitmap Display tool with base 0x00420000, width and height
@ 256, and unit 8 for SIZE 32 (4 for SIZE 64). Everything else scales off
@ SIZE on its own.
@
@ For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
@ z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
@ pixel by how many iterations that took. Points that never escape are
@ inside the set and stay black. The arithmetic is the MIPS example's,
@ operation for operation, so the picture is the same to the last pixel.

	.equ SIZE, 32
	.equ MAX_ITERATIONS, 16

	.data
display:	.space SIZE * SIZE * 4
@ Iteration count to colour: index 0 escapes at once, index MAX_ITERATIONS is interior.
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000

@ The view is x in [-2.0, 0.5) and y in [-1.25, 1.25). One cell is
@ span / SIZE across, worked out at run time so SIZE stays the only knob.
constants:
xMin:	.float -2.0
yMin:	.float -1.25
span:	.float 2.5
escape:	.float 4.0
two:	.float 2.0

	.text
	.global _start
_start:
	ldr r9, =display                @ pixel cursor
	ldr r8, =palette
	ldr r0, =constants
	vldmia r0, {s22-s26}            @ xMin, yMin, span, escape, two

	mov r0, #SIZE                   @ step = span / SIZE
	vmov s0, r0
	vcvt.f32.s32 s0, s0
	vdiv.f32 s16, s24, s0

	mov r10, #0                     @ row
row:
	vmov s2, r10                    @ cy = yMin + row * step
	vcvt.f32.s32 s2, s2
	vmul.f32 s2, s2, s16
	vadd.f32 s2, s2, s23

	mov r11, #0                     @ column
column:
	vmov s0, r11                    @ cx = xMin + column * step
	vcvt.f32.s32 s0, s0
	vmul.f32 s0, s0, s16
	vadd.f32 s0, s0, s22

	mov r0, #0
	vmov s4, r0                     @ zx = 0.0
	vmov s6, r0                     @ zy = 0.0
	mov r4, #0                      @ iterations
iterate:
	vmul.f32 s8, s4, s4             @ zx^2
	vmul.f32 s10, s6, s6            @ zy^2
	vadd.f32 s12, s8, s10           @ |z|^2

	@ The comparison lands in FPSCR; VMRS copies it to the APSR for the branch.
	vcmp.f32 s12, s25
	vmrs APSR_nzcv, fpscr
	bgt escaped                     @ 4 < |z|^2

	vmul.f32 s14, s4, s6            @ zy = 2 * zx * zy + cy
	vmul.f32 s14, s14, s26
	vadd.f32 s6, s14, s2

	vsub.f32 s4, s8, s10            @ zx = zx^2 - zy^2 + cx
	vadd.f32 s4, s4, s0

	add r4, r4, #1
	cmp r4, #MAX_ITERATIONS
	blt iterate
escaped:
	@ Colour the pixel by its iteration count and advance the cursor.
	ldr r5, [r8, r4, lsl #2]
	str r5, [r9], #4

	add r11, r11, #1
	cmp r11, #SIZE
	blt column

	add r10, r10, #1
	cmp r10, #SIZE
	blt row

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0
