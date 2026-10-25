; Factorial
; Compute 5! (5 factorial) = 120

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

	ld sp, $FF00
	ld b, 5             ; n = 5
	ld hl, 1            ; result = 1

loop:
	; result = result * n, adding result to itself n times
	push bc
	ld d, h
	ld e, l
	ld hl, 0
multiply:
	add hl, de
	djnz multiply
	pop bc
	djnz loop           ; n--, until n == 0

	; Print result
	call print_decimal
	halt

; print_decimal: write HL as an unsigned decimal number.
print_decimal:
	push af
	push bc
	push hl
	ld b, 0             ; digits pushed, least significant first
.divide:
	call div10
	push af
	inc b
	ld a, h
	or l
	jr nz, .divide
.print:
	pop af              ; most significant first
	add a, '0'
	ld (CONSOLE), a
	djnz .print
	pop hl
	pop bc
	pop af
	ret

; div10: HL <- HL / 10 and A <- HL mod 10, a bit at a time.
div10:
	push bc
	ld b, 16
	xor a
.bit:
	add hl, hl          ; the next bit of HL into A
	rla
	cp 10
	jr c, .next
	sub 10              ; it goes: that quotient bit is 1
	inc l
.next:
	djnz .bit
	pop bc
	ret
