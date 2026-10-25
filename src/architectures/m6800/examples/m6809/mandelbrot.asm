; Mandelbrot Set
; CPU: Motorola 6809
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; Native 6809 software signed 16x16 multiplication, truncating toward zero.
; SCALE=256, STEP=20. RGB framebuffer at 0x4000.
cx = 64
cy = 68
zx = 72
zy = 76
xx = 80
yy = 84
ma = 88
mb = 92
prod = 96
sign = 100
count = 104
iter = 108
row = 112
col = 116
ptr = 120
color = 124
.text
	ldx #0x4000
	stx <ptr
	ldaa #192
	staa <cy
	ldaa #254
	staa <cy + 1

	clra
	staa <row
row_loop:
	ldaa #0
	staa <cx
	ldaa #254
	staa <cx + 1

	clra
	staa <col
column_loop:
	ldaa #0
	staa <zx
	ldaa #0
	staa <zx + 1
	ldaa #0
	staa <zy
	ldaa #0
	staa <zy + 1

	clra
	staa <iter
iteration_loop:
	ldaa <zx
	staa <ma
	ldaa <zx + 1
	staa <ma + 1
	ldaa <zx
	staa <mb
	ldaa <zx + 1
	staa <mb + 1
	jsr multiply
	ldaa <ma
	staa <xx
	ldaa <ma + 1
	staa <xx + 1
	ldaa <zy
	staa <ma
	ldaa <zy + 1
	staa <ma + 1
	ldaa <zy
	staa <mb
	ldaa <zy + 1
	staa <mb + 1
	jsr multiply
	ldaa <ma
	staa <yy
	ldaa <ma + 1
	staa <yy + 1
	ldaa <xx
	staa <ma
	ldaa <xx + 1
	staa <ma + 1
	ldaa <ma
	adda <yy
	staa <ma
	ldaa <ma + 1
	adca <yy + 1
	staa <ma + 1

	ldaa <ma + 1
	cmpa #4
	bcs iterate
	jmp pixel
iterate:
	ldaa <zx
	staa <ma
	ldaa <zx + 1
	staa <ma + 1
	ldaa <zy
	staa <mb
	ldaa <zy + 1
	staa <mb + 1
	jsr multiply
	ldaa <ma
	staa <ma
	ldaa <ma + 1
	staa <ma + 1

	asl ma
	rol ma + 1
	ldaa <ma
	adda <cy
	staa <ma
	ldaa <ma + 1
	adca <cy + 1
	staa <ma + 1
	ldaa <ma
	staa <zy
	ldaa <ma + 1
	staa <zy + 1
	ldaa <xx
	staa <zx
	ldaa <xx + 1
	staa <zx + 1
	ldaa <zx
	suba <yy
	staa <zx
	ldaa <zx + 1
	sbca <yy + 1
	staa <zx + 1
	ldaa <zx
	adda <cx
	staa <zx
	ldaa <zx + 1
	adca <cx + 1
	staa <zx + 1

	ldaa <iter
	inca
	staa <iter
	cmpa #16
	beq pixel
	jmp iteration_loop
pixel:
	ldx #palette
	ldab <iter
	beq palette_ready
palette_seek:
	leax 1, x
	leax 1, x
	leax 1, x
	leax 1, x
	decb
	bne palette_seek
palette_ready:
	ldaa 0, x
	staa <color
	ldaa 1, x
	staa <color + 1
	ldaa 2, x
	staa <color + 2
	ldx <ptr
	ldaa <color
	staa 0, x
	ldaa <color + 1
	staa 1, x
	ldaa <color + 2
	staa 2, x
	clra
	staa 3, x
	leax 1, x
	leax 1, x
	leax 1, x
	leax 1, x
	stx <ptr
	ldaa #20
	staa <ma
	ldaa #0
	staa <ma + 1
	ldaa <cx
	adda <ma
	staa <cx
	ldaa <cx + 1
	adca <ma + 1
	staa <cx + 1

	ldaa <col
	inca
	staa <col
	cmpa #32
	beq next_row
	jmp column_loop
next_row:
	ldaa #20
	staa <ma
	ldaa #0
	staa <ma + 1
	ldaa <cy
	adda <ma
	staa <cy
	ldaa <cy + 1
	adca <ma + 1
	staa <cy + 1

	ldaa <row
	inca
	staa <row
	cmpa #32
	beq finished
	jmp row_loop
finished:
	clra
	swi

multiply:
	ldaa <ma + 1
	eora <mb + 1
	staa <sign
	ldaa <ma + 1
	bpl positive_a
	ldaa #0
	suba <ma
	staa <ma
	ldaa #0
	sbca <ma + 1
	staa <ma + 1

positive_a:
	ldaa <mb + 1
	bpl positive_b
	ldaa #0
	suba <mb
	staa <mb
	ldaa #0
	sbca <mb + 1
	staa <mb + 1

positive_b:
	clra
	staa <prod
	staa <prod + 1
	staa <prod + 2
	staa <prod + 3
	ldab #16
multiply_bit:
	lsr mb + 1
	ror mb
	bcc multiply_rotate
	ldaa <prod + 2
	adda <ma
	staa <prod + 2
	ldaa <prod + 3
	adca <ma + 1
	staa <prod + 3
	bra rotate_carry
multiply_rotate:
	andcc #254
rotate_carry:
	ror prod + 3
	ror prod + 2
	ror prod + 1
	ror prod
	decb
	bne multiply_bit
	ldaa <prod + 1
	staa <ma
	ldaa <prod + 2
	staa <ma + 1
	ldaa <sign
	bpl multiply_done
	ldaa #0
	suba <ma
	staa <ma
	ldaa #0
	sbca <ma + 1
	staa <ma + 1

multiply_done:
	rts

.data
.org 0x6000
palette:
	.byte 48, 0, 0, 0, 74, 16, 0, 0, 102, 31, 0, 0, 128, 48, 0, 0, 160, 68, 0, 0, 189, 89, 0, 0, 212, 114, 26, 0, 224, 140, 61, 0, 234, 166, 98, 0, 242, 191, 134, 0, 247, 213, 168, 0, 251, 230, 198, 0, 253, 241, 222, 0, 254, 248, 239, 0, 255, 252, 248, 0, 255, 255, 255, 0, 0, 0, 0, 0
