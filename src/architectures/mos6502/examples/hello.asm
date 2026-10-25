; Hello, THRAX!
; Print a string stored after the code, a byte at a time

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing

	lda #<message
	sta ptr
	lda #>message
	sta ptr + 1
	jsr print_string
	brk

message: .asciiz "Hello, THRAX!\n"

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
