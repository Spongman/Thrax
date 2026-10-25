; Fibonacci
; Compute the 10th Fibonacci number with 16-bit additions

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing
previous = $20              ; 2 bytes: fib(n - 2)
current  = $22              ; 2 bytes: fib(n - 1)

	lda #0                  ; fib(0) = 0
	sta previous
	sta previous + 1
	sta current + 1
	lda #1                  ; fib(1) = 1
	sta current
	ldx #2                  ; i = 2

loop:
	clc                     ; num = previous + current, low byte then high
	lda previous
	adc current
	sta num
	lda previous + 1
	adc current + 1
	sta num + 1
	lda current             ; previous = current
	sta previous
	lda current + 1
	sta previous + 1
	lda num                 ; current = num
	sta current
	lda num + 1
	sta current + 1
	inx                     ; i++
	cpx #11                 ; while i <= 10
	bne loop

	jsr print_decimal       ; num is fib(10)
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
