; Bitmap Display
; Draw colour bands for the Bitmap Display tool

; Tool settings: base address 0x200, unit 8, width 256, height 256.
; Each byte is one pixel whose low four bits pick one of 16 colours,
; in row-major order: pixel (row, column) is at $0200 + 32 * row + column.

DISPLAY = $0200
ptr     = $10               ; 2 bytes: the start of the current row
sum     = $12

	lda #<DISPLAY
	sta ptr
	lda #>DISPLAY
	sta ptr + 1
	ldx #0                  ; row

row:
	ldy #0                  ; column

column:
	stx sum                 ; colour = (row + column) / 4: diagonal bands
	tya
	clc
	adc sum
	lsr
	lsr
	and #15
	sta (ptr), y

	iny
	cpy #32
	bne column

	clc                     ; the next row starts 32 bytes on
	lda ptr
	adc #32
	sta ptr
	bcc same_page
	inc ptr + 1
same_page:
	inx
	cpx #32
	bne row

	brk
