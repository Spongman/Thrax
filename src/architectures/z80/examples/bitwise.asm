; Bitwise Operations
; Demonstrate AND, OR, XOR operations

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

	ld sp, $FF00
	ld b, %1100         ; B = 12
	ld c, %1010         ; C = 10

	; AND operation
	ld a, b
	and c               ; A = 12 & 10 = 8
	call print_a

	ld a, ' '
	ld (CONSOLE), a

	; OR operation
	ld a, b
	or c                ; A = 12 | 10 = 14
	call print_a

	ld a, ' '
	ld (CONSOLE), a

	; XOR operation
	ld a, b
	xor c               ; A = 12 ^ 10 = 6
	call print_a

	halt

; print_a: write A in decimal.
print_a:
	push hl
	ld l, a
	ld h, 0
	call print_decimal
	pop hl
	ret

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
