; Macros
; Define once, use many times with .macro and symbols

; Macros are expanded by the assembler, so each use costs no call-and-return
; overhead. Labels inside a body are local to each expansion, which is
; why "again" can be reused safely. Arguments are values.

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing
count = $20

FIRST  = 5                  ; symbols name constants, like .eqv
SECOND = 3

.macro print_string_at text
	lda #<text
	sta ptr
	lda #>text
	sta ptr + 1
	jsr print_string
.endmacro

.macro count_to limit
	lda #0
	sta count
again:
	inc count
	lda count
	sta num
	lda #0
	sta num + 1
	jsr print_decimal
	lda count
	cmp #limit
	bne again
.endmacro

.macro done
	brk
.endmacro

	print_string_at banner

	count_to FIRST
	print_string_at newline

	count_to SECOND
	print_string_at newline

	done

banner:  .asciiz "counting: "
newline: .asciiz "\n"

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
