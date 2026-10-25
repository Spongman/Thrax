; Loop Counter
; Print numbers 1 through 5

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing
counter = $20

	lda #1                  ; counter = 1
	sta counter

loop:
	lda counter             ; if counter == 6, exit
	cmp #6
	beq done

	; Print counter
	sta num
	lda #0
	sta num + 1
	jsr print_decimal

	; Print space
	lda #' '
	sta OUT

	; Increment and loop
	inc counter
	jmp loop

done:
	; Print newline
	lda #'\n'
	sta OUT
	brk

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
