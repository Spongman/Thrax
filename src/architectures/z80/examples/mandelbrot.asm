; Mandelbrot Set
; CPU: Zilog Z80
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; Same 8.8 arithmetic, view and MIPS iteration palette as the 6502 port.
; Bitmap: bytes at $C000. Work variables follow it at $C400.

MAXITER equ 16
	di
	ld sp, $FF00
	ld hl, $C000
	ld (cursor), hl
	ld hl, -320
	ld (ci), hl
row:
	ld hl, -512
	ld (cr), hl
column:
	ld hl, 0
	ld (zr), hl
	ld (zi), hl
	xor a
	ld (iterations), a
iterate:
	ld hl, (zr)
	ld d, h
	ld e, l
	call multiply
	ld (zr2), hl
	ld hl, (zi)
	ld d, h
	ld e, l
	call multiply
	ld (zi2), hl
	ld de, (zr2)
	add hl, de
	ld a, h
	cp 4
	jp nc, escaped
	ld hl, (zr)
	ld de, (zi)
	call multiply
	add hl, hl
	ld de, (ci)
	add hl, de
	ld (zi), hl
	ld hl, (zr2)
	ld de, (zi2)
	or a
	sbc hl, de
	ld de, (cr)
	add hl, de
	ld (zr), hl
	ld a, (iterations)
	inc a
	ld (iterations), a
	cp MAXITER
	jp nz, iterate
	ld a, MAXITER
	jr plot
escaped:
	ld a, (iterations)
plot:
	ld hl, (cursor)
	ld (hl), a
	inc hl
	ld (cursor), hl
	ld hl, (cr)
	ld de, 20
	add hl, de
	ld (cr), hl
	ld de, 128
	or a
	sbc hl, de
	jp nz, column
	ld hl, (ci)
	ld de, 20
	add hl, de
	ld (ci), hl
	ld de, 320
	or a
	sbc hl, de
	jp nz, row
	halt

; HL * DE -> HL in signed 8.8, truncating toward zero. Clobbers AF/BC/DE.
multiply:
	ld a, h
	xor d
	ld (product_sign), a
	bit 7, h
	jr z, a_positive
	xor a
	sub l
	ld l, a
	sbc a, a
	sub h
	ld h, a
a_positive:
	bit 7, d
	jr z, b_positive
	xor a
	sub e
	ld e, a
	sbc a, a
	sub d
	ld d, a
b_positive:
	ld b, h
	ld c, l
	ld hl, 0
	ld a, 16
multiply_bit:
	add hl, hl
	rl e
	rl d
	jr nc, no_add
	add hl, bc
	jr nc, no_add
	inc de
no_add:
	dec a
	jr nz, multiply_bit
	ld l, h                  ; middle two bytes of DE:HL
	ld h, e
	ld a, (product_sign)
	bit 7, a
	ret z
	xor a
	sub l
	ld l, a
	sbc a, a
	sub h
	ld h, a
	ret

	org $C400
cr: dw 0
ci: dw 0
zr: dw 0
zi: dw 0
zr2: dw 0
zi2: dw 0
cursor: dw 0
iterations: db 0
product_sign: db 0
