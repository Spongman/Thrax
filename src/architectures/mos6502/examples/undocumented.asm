; NMOS Undocumented Instructions
; Compound loads, stores and arithmetic produce 42; JAM stops until reset or rewind

; NMOS only: these bytes have different meanings on W65C02S.

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired
ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing
	lda #21
	sta num
	lax num                 ; A = X = 21
	sax $30                 ; store A AND X = 21
	slo num                 ; memory = 42, A = 21 OR 42 = 63
	dcp $30                 ; memory = 20, compare sets carry
	isc $30                 ; memory = 21, A = 63 - 21 = 42
	sta num
	lda #0
	sta num + 1
	jsr print_decimal
	jam                     ; NMOS KIL, not a CMOS instruction

; print_decimal: write the 16-bit number at num in decimal; clears num.
; Each pass divides num by 10, bit by bit, and pushes the remainder.
print_decimal:
	ldx #0                  ; digits pushed
@divide:
	lda #0
	sta rem
	ldy #16
@bit:
	asl num                 ; shift the next bit of num into rem
	rol num + 1
	rol rem
	lda rem
	sec
	sbc #10
	bcc @smaller            ; rem < 10: this quotient bit is 0
	sta rem
	inc num                 ; quotient bit 1
@smaller:
	dey
	bne @bit
	lda rem
	pha                     ; the last digit, printed first once all are found
	inx
	lda num
	ora num + 1
	bne @divide
@print:
	pla
	ora #'0'
	sta OUT
	dex
	bne @print
	rts
