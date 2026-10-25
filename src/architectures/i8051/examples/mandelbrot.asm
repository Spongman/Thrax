; Mandelbrot Set
; CPU: Intel 8051 (MCS-51)
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; SCALE=256, STEP=20; XDATA framebuffer offset 0.
; Four real MUL AB products implement signed Q8 multiplication, truncated to zero.
cx = 32
cy = 36
zx = 40
zy = 44
xx = 48
yy = 52
ma = 56
mb = 60
prod = 64
sign = 68
iter = 72
row = 76
col = 80
ptr = 84
color = 88
.text
	mov ptr, #0
	mov ptr + 1, #0
	mov cy, #192
	mov cy + 1, #254

	mov row, #0
row_loop:
	mov cx, #0
	mov cx + 1, #254

	mov col, #0
column_loop:
	mov zx, #0
	mov zx + 1, #0
	mov zy, #0
	mov zy + 1, #0

	mov iter, #0
iteration_loop:
	mov ma, zx
	mov ma + 1, zx + 1
	mov mb, zx
	mov mb + 1, zx + 1
	lcall multiply
	mov xx, ma
	mov xx + 1, ma + 1
	mov ma, zy
	mov ma + 1, zy + 1
	mov mb, zy
	mov mb + 1, zy + 1
	lcall multiply
	mov yy, ma
	mov yy + 1, ma + 1
	mov ma, xx
	mov ma + 1, xx + 1
	mov a, ma
	add a, yy
	mov ma, a
	mov a, ma + 1
	addc a, yy + 1
	mov ma + 1, a

	clr c
	mov a, ma + 1
	subb a, #4
	jc iterate
	ljmp pixel
iterate:
	mov ma, zx
	mov ma + 1, zx + 1
	mov mb, zy
	mov mb + 1, zy + 1
	lcall multiply
	mov ma, ma
	mov ma + 1, ma + 1

	clr c
	mov a, ma
	rlc a
	mov ma, a
	mov a, ma + 1
	rlc a
	mov ma + 1, a
	mov a, ma
	add a, cy
	mov ma, a
	mov a, ma + 1
	addc a, cy + 1
	mov ma + 1, a
	mov zy, ma
	mov zy + 1, ma + 1
	mov zx, xx
	mov zx + 1, xx + 1
	clr c
	mov a, zx
	subb a, yy
	mov zx, a
	mov a, zx + 1
	subb a, yy + 1
	mov zx + 1, a
	mov a, zx
	add a, cx
	mov zx, a
	mov a, zx + 1
	addc a, cx + 1
	mov zx + 1, a

	inc iter
	mov a, iter
	cjne a, #16, again
	sjmp pixel
again:
	ljmp iteration_loop
pixel:
	mov dptr, #palette
	mov a, iter
	rl a
	rl a
	mov r0, a
	movc a, @a+dptr
	mov color, a
	mov a, r0
	inc a
	movc a, @a+dptr
	mov color + 1, a
	mov a, r0
	add a, #2
	movc a, @a+dptr
	mov color + 2, a
	mov dpl, ptr
	mov dph, ptr + 1
	mov a, color
	movx @dptr, a
	inc dptr
	mov a, color + 1
	movx @dptr, a
	inc dptr
	mov a, color + 2
	movx @dptr, a
	inc dptr
	clr a
	movx @dptr, a
	inc dptr
	mov ptr, dpl
	mov ptr + 1, dph
	mov ma, #20
	mov ma + 1, #0
	mov a, cx
	add a, ma
	mov cx, a
	mov a, cx + 1
	addc a, ma + 1
	mov cx + 1, a

	inc col
	mov a, col
	cjne a, #32, another_column
	sjmp next_row
another_column:
	ljmp column_loop
next_row:
	mov ma, #20
	mov ma + 1, #0
	mov a, cy
	add a, ma
	mov cy, a
	mov a, cy + 1
	addc a, ma + 1
	mov cy + 1, a

	inc row
	mov a, row
	cjne a, #32, another_row
	sjmp finished
another_row:
	ljmp row_loop
finished:
	mov a, #0
	lcall 0xff00

multiply:
	mov a, ma + 1
	xrl a, mb + 1
	mov sign, a
	mov a, ma + 1
	jnb 0xe7, positive_a
	clr c
	clr a
	subb a, ma
	mov ma, a
	clr a
	subb a, ma + 1
	mov ma + 1, a

positive_a:
	mov a, mb + 1
	jnb 0xe7, positive_b
	clr c
	clr a
	subb a, mb
	mov mb, a
	clr a
	subb a, mb + 1
	mov mb + 1, a

positive_b:
	mov a, ma
	mov b, mb
	mul ab
	mov prod + 1, b
	mov prod + 2, #0
	mov a, ma + 1
	mov b, mb
	mul ab
	add a, prod + 1
	mov prod + 1, a
	mov a, b
	addc a, prod + 2
	mov prod + 2, a
	mov a, ma
	mov b, mb + 1
	mul ab
	add a, prod + 1
	mov prod + 1, a
	mov a, b
	addc a, prod + 2
	mov prod + 2, a
	mov a, ma + 1
	mov b, mb + 1
	mul ab
	add a, prod + 2
	mov prod + 2, a
	mov ma, prod + 1
	mov ma + 1, prod + 2
	mov a, sign
	jnb 0xe7, multiply_done
	clr c
	clr a
	subb a, ma
	mov ma, a
	clr a
	subb a, ma + 1
	mov ma + 1, a

multiply_done:
	ret
.text
.org 0x8000
palette:
	.byte 48, 0, 0, 0, 74, 16, 0, 0, 102, 31, 0, 0, 128, 48, 0, 0, 160, 68, 0, 0, 189, 89, 0, 0, 212, 114, 26, 0, 224, 140, 61, 0, 234, 166, 98, 0, 242, 191, 134, 0, 247, 213, 168, 0, 251, 230, 198, 0, 253, 241, 222, 0, 254, 248, 239, 0, 255, 252, 248, 0, 255, 255, 255, 0, 0, 0, 0, 0
