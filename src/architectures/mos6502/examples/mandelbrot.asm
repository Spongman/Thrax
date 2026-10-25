; Mandelbrot Set
; CPU: MOS 6502 (NMOS), WDC W65C02S (CMOS)
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; $0100 is 1.0.
;
; Open the Bitmap Display tool with base 0x200, unit 8, 256 x 256.
;
; For each pixel, c = cx + i*cy and z starts at 0.  The loop iterates
; z = z^2 + c until |z|^2 reaches 4, and colours the pixel by how many
; iterations that took.  Points that never escape are inside the set and
; stay black.

DISPLAY = $0200
SIZE    = 32
MAXITER = 16
STEP    = 20                ; 2.5 / 32 in 8.8: the view is 2.5 wide and high
X_MIN   = -512              ; -2.0
Y_MIN   = -320              ; -1.25

cx   = $20                  ; each a 2-byte 8.8 number
cy   = $22
zx   = $24
zy   = $26
zx2  = $28
zy2  = $2A
ma   = $30                  ; multiply's operands and result
mb   = $32
prod = $34                  ; 4 bytes
sign = $38
iter = $39
col  = $3A
row  = $3B
ptr  = $3C                  ; 2 bytes: the start of the current row

	lda #<DISPLAY
	sta ptr
	lda #>DISPLAY
	sta ptr + 1
	lda #<Y_MIN
	sta cy
	lda #>Y_MIN
	sta cy + 1
	lda #0
	sta row

row_loop:
	lda #<X_MIN
	sta cx
	lda #>X_MIN
	sta cx + 1
	lda #0
	sta col

column_loop:
	lda #0                  ; z = 0
	sta zx
	sta zx + 1
	sta zy
	sta zy + 1
	sta iter

iterate:
	lda zx                  ; zx2 = zx * zx
	sta ma
	sta mb
	lda zx + 1
	sta ma + 1
	sta mb + 1
	jsr multiply
	lda ma
	sta zx2
	lda ma + 1
	sta zx2 + 1

	lda zy                  ; zy2 = zy * zy
	sta ma
	sta mb
	lda zy + 1
	sta ma + 1
	sta mb + 1
	jsr multiply
	lda ma
	sta zy2
	lda ma + 1
	sta zy2 + 1

	clc                     ; escaped once zx2 + zy2 >= 4.0 ($0400)
	lda zx2
	adc zy2
	lda zx2 + 1
	adc zy2 + 1
	cmp #4
	bcs escaped

	lda zx                  ; zy = 2 * zx * zy + cy
	sta ma
	lda zx + 1
	sta ma + 1
	lda zy
	sta mb
	lda zy + 1
	sta mb + 1
	jsr multiply
	asl ma
	rol ma + 1
	clc
	lda ma
	adc cy
	sta zy
	lda ma + 1
	adc cy + 1
	sta zy + 1

	sec                     ; zx = zx2 - zy2 + cx
	lda zx2
	sbc zy2
	sta zx
	lda zx2 + 1
	sbc zy2 + 1
	sta zx + 1
	clc
	lda zx
	adc cx
	sta zx
	lda zx + 1
	adc cx + 1
	sta zx + 1

	inc iter
	lda iter
	cmp #MAXITER
	beq inside
	jmp iterate             ; too far back for a branch
inside:
	lda #MAXITER            ; palette entry MAXITER is black
	bne plot

escaped:
	lda iter                ; the iteration count is the colour
plot:
	ldy col
	sta (ptr), y

	clc                     ; cx += STEP
	lda cx
	adc #STEP
	sta cx
	lda cx + 1
	adc #0
	sta cx + 1
	inc col
	lda col
	cmp #SIZE
	beq next_row
	jmp column_loop

next_row:

	clc                     ; cy += STEP, and the next row of pixels
	lda cy
	adc #STEP
	sta cy
	lda cy + 1
	adc #0
	sta cy + 1
	clc
	lda ptr
	adc #SIZE
	sta ptr
	bcc same_page
	inc ptr + 1
same_page:
	inc row
	lda row
	cmp #SIZE
	beq finished
	jmp row_loop

finished:
	brk

; multiply: ma = ma * mb >> 8, signed 8.8; clobbers mb, prod, sign and X.
multiply:
	lda ma + 1              ; the result is negative when the signs differ
	eor mb + 1
	sta sign
	bit ma + 1              ; multiply magnitudes
	bpl @a_positive
	sec
	lda #0
	sbc ma
	sta ma
	lda #0
	sbc ma + 1
	sta ma + 1
@a_positive:
	bit mb + 1
	bpl @b_positive
	sec
	lda #0
	sbc mb
	sta mb
	lda #0
	sbc mb + 1
	sta mb + 1
@b_positive:
	lda #0                  ; prod = ma * mb, 16 x 16 bits by shifting right
	sta prod + 2
	sta prod + 3
	ldx #16
@bit:
	lsr mb + 1
	ror mb
	lda prod + 3
	bcc @rotate
	clc
	lda prod + 2
	adc ma
	sta prod + 2
	lda prod + 3
	adc ma + 1
@rotate:
	ror a                   ; the add's carry, or 0, becomes the top bit
	sta prod + 3
	ror prod + 2
	ror prod + 1
	ror prod
	dex
	bne @bit
	lda prod + 1            ; the middle two bytes are the 8.8 product
	sta ma
	lda prod + 2
	sta ma + 1
	bit sign
	bpl @done
	sec
	lda #0
	sbc ma
	sta ma
	lda #0
	sbc ma + 1
	sta ma + 1
@done:
	rts
