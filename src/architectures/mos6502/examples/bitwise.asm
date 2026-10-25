; Bitwise Operations
; Demonstrate AND, ORA and EOR

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing
first  = $20
second = $21

	lda #12                 ; first = 12 (binary: 1100)
	sta first
	lda #%1010              ; second = 10 (binary: 1010)
	sta second

	; AND operation
	lda first
	and second              ; A = 12 & 10 = 8
	jsr print_byte

	lda #' '
	sta OUT

	; OR operation
	lda first
	ora second              ; A = 12 | 10 = 14
	jsr print_byte

	lda #' '
	sta OUT

	; XOR operation
	lda first
	eor second              ; A = 12 ^ 10 = 6
	jsr print_byte

	brk

; print_byte: print A in decimal.
print_byte:
	sta num
	lda #0
	sta num + 1
	jmp print_decimal       ; its RTS returns for us

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
