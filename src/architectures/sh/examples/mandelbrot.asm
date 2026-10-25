; Mandelbrot Set
; CPU: Hitachi SH-1, SH-2
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

.equ MAXITER, 16

.text
_start:
	mov32 #pixels, r8
	mov32 #palette, r9
	mov32 #-320, r10
	mov #0, r12
row:
	mov32 #-512, r11
	mov #0, r13
column:
	mov #0, r1
	mov #0, r2
	mov #0, r6
iterate:
	muls.w r1, r1
	sts macl, r3
	shlr8 r3
	muls.w r2, r2
	sts macl, r4
	shlr8 r4
	mov r3, r7
	add r4, r7
	mov32 #1024, r0
	cmp/ge r0, r7
	bt escaped
	muls.w r1, r2
	sts macl, r5
	cmp/pz r5
	bt positive
	mov32 #255, r0
	add r0, r5
positive:
	mov #8, r0
shift:
	shar r5
	add #-1, r0
	cmp/eq #0, r0
	bf shift
	shll r5
	mov r5, r2
	add r10, r2
	mov r3, r1
	sub r4, r1
	add r11, r1
	add #1, r6
	mov #MAXITER, r0
	cmp/ge r0, r6
	bt escaped
	bra iterate
	nop
escaped:
	mov r6, r0
	shll2 r0
	mov.l @(r0, r9), r14
	mov r14, r0
	mov.b r0, @r8
	shlr8 r0
	mov.b r0, @(1, r8)
	shlr8 r0
	mov.b r0, @(2, r8)
	mov #0, r0
	mov.b r0, @(3, r8)
	add #4, r8
	add #20, r11
	add #1, r13
	mov #32, r0
	cmp/ge r0, r13
	bt nextrow
	bra column
	nop
nextrow:
	add #20, r10
	add #1, r12
	cmp/ge r0, r12
	bt done
	bra row
	nop
done:
	mov #10, r0
	trapa #0x10

.data
pixels: .space 4096
palette:
.long 0x000030, 0x00104a, 0x001f66, 0x003080
.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
.long 0x000000
