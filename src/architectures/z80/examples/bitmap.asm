; Bitmap Display
; Draw colour bands for the Bitmap Display tool

; Tool settings: base address 0xC000, unit 8, width 256, height 256.
; Each pixel is a byte whose low four bits pick one of 16 colours.

FRAME equ $C000

	ld hl, FRAME         ; pixel cursor
	ld d, 0              ; row

row:
	ld e, 0              ; column

column:
	ld a, d              ; row + column picks the colour: diagonal bands
	add a, e
	and $0F
	ld (hl), a
	inc hl

	inc e
	ld a, e
	cp 32
	jr nz, column

	inc d
	ld a, d
	cp 32
	jr nz, row

	halt
