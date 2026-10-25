; Factorial
; Compute 5! = 120 in 16 bits

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing
factor = $15                ; multiplier, and the loop counter n
bits   = $16
mcand  = $17                ; 2 bytes

	lda #1                  ; result = 1
	sta num
	lda #0
	sta num + 1
	lda #5                  ; n = 5
	sta factor

loop:
	jsr multiply            ; result = result * n
	dec factor              ; n--
	bne loop                ; until n == 0

	jsr print_decimal
	brk

; multiply: num = num * factor, 16 x 8 bits by shifting and adding.
multiply:
	lda num
	sta mcand
	lda num + 1
	sta mcand + 1
	lda #0
	sta num
	sta num + 1
	lda factor
	sta bits
@next:
	lsr bits                ; the factor's low bit says whether to add
	bcc @shift
	clc
	lda num
	adc mcand
	sta num
	lda num + 1
	adc mcand + 1
	sta num + 1
@shift:
	asl mcand               ; the multiplicand doubles for the next bit
	rol mcand + 1
	lda bits
	bne @next
	rts

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
