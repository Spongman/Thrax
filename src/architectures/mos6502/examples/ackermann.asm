; Ackermann
; Deep recursion: compute A(3, 3) = 61

; A(m, n) = n + 1                    when m = 0
;         = A(m - 1, 1)              when n = 0
;         = A(m - 1, A(m, n - 1))    otherwise
;
; Each call pushes its return address and m on the hardware stack, so page 1
; fills up as the recursion deepens. A(3, 3) goes 63 calls deep.

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing

	lda #<prompt
	sta ptr
	lda #>prompt
	sta ptr + 1
	jsr print_string

	ldx #3                  ; ackermann(3, 3)
	ldy #3
	jsr ackermann

	sta num                 ; print the result
	lda #0
	sta num + 1
	jsr print_decimal
	brk

prompt: .asciiz "A(3, 3) = "

; ackermann: A <- A(X, Y), keeping X; Y is lost.
ackermann:
	cpx #0
	bne @m_positive
	iny                     ; m = 0: A(0, n) = n + 1
	tya
	rts

@m_positive:
	txa                     ; keep m across the calls
	pha
	cpy #0
	bne @both_positive
	dex                     ; n = 0: A(m, 0) = A(m - 1, 1)
	ldy #1
	jsr ackermann
	jmp @return

@both_positive:
	dey                     ; inner call: A(m, n - 1)
	jsr ackermann
	tay                     ; outer call: A(m - 1, inner)
	dex
	jsr ackermann

@return:
	tay                     ; restore m, keeping the result
	pla
	tax
	tya
	rts

; print_string: write the zero-terminated string at (ptr), up to 255 characters.
print_string:
	ldy #0
@next:
	lda (ptr), y
	beq @done
	sta OUT
	iny
	bne @next
@done:
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
