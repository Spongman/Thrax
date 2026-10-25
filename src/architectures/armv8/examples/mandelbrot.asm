// Mandelbrot Set
// CPU: Arm AArch64 (A64), with the Floating point setting off
// FPU: none; signed 16.16 fixed point
// 32 x 32 pixels, 16 iterations, x in [-2.0, 1.0), y in [-1.5, 1.5)

// Open the Bitmap Display tool with base 0x00420000, width and height
// 256, and unit 8 for SIZE 32 (4 for SIZE 64). Each point c iterates
// z = z * z + c until |z| passes 2 or MAX_ITERATIONS run out; 64-bit
// registers hold the products of two 16.16 numbers without overflow.

	.equ SIZE, 32
	.equ MAX_ITERATIONS, 16
	.equ ONE, 0x10000               // 1.0
	.equ STEP, 3 * ONE / SIZE       // the plane shown is 3.0 across

	.data
display:	.space SIZE * SIZE * 4
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000

	.text
	.global _start
_start:
	ldr x9, =display                // pixel cursor
	mov x13, #STEP
	ldr x15, =-3 * ONE / 2          // ci: the top row is at -1.5i
	mov x10, #0                     // row
row:
	mov x14, #-2 * ONE              // cr: each row starts at -2.0
	mov x11, #0                     // column
column:
	mov x0, #0                      // zr
	mov x1, #0                      // zi
	mov x4, #0                      // iterations
iterate:
	mul x2, x0, x0
	asr x2, x2, #16                 // zr * zr
	mul x3, x1, x1
	asr x3, x3, #16                 // zi * zi
	add x5, x2, x3
	cmp x5, #4 * ONE                // |z| > 2: escaped
	b.gt escaped
	mul x5, x0, x1
	asr x5, x5, #15                 // 2 * zr * zi
	add x1, x5, x15                 // zi = 2 zr zi + ci
	sub x0, x2, x3
	add x0, x0, x14                 // zr = zr^2 - zi^2 + cr
	add x4, x4, #1
	cmp x4, #MAX_ITERATIONS
	b.lt iterate
escaped:
	ldr x7, =palette
	ldr w5, [x7, x4, lsl #2]
plot:
	str w5, [x9], #4
	add x14, x14, x13               // one step right
	add x11, x11, #1
	cmp x11, #SIZE
	b.lt column

	add x15, x15, x13               // one step down
	add x10, x10, #1
	cmp x10, #SIZE
	b.lt row

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0
