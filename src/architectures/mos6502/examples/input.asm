; Interactive Input
; Read a line into a buffer, then print it

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing

	ldx #0
read:
	cpx #63                 ; keep the last byte for the zero
	beq done
	lda IN                  ; waits until a character is typed
	sta buffer, x
	inx
	cmp #10                 ; through the end of the line
	bne read
done:
	lda #0
	sta buffer, x
	lda #<buffer
	sta ptr
	lda #>buffer
	sta ptr + 1
	jsr print_string
	brk

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

buffer: .res 64
