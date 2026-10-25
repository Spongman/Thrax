; Ackermann
; Deep recursion: compute A(3, 3) = 61

; A(m, n) = n + 1                    when m = 0
;         = A(m - 1, 1)              when n = 0
;         = A(m - 1, A(m, n - 1))    otherwise
;
; Each call pushes its return address and the arguments it keeps, so the
; stack fills up as the recursion deepens.

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

	ld sp, $FF00
	ld hl, prompt       ; print the label
	call print_string

	ld b, 3             ; ackermann(3, 3)
	ld c, 3
	call ackermann

	ld l, a             ; print the result
	ld h, 0
	call print_decimal
	halt

prompt:	db "A(3, 3) = ", 0

; ackermann: A <- A(B, C), keeping BC.
ackermann:
	ld a, b
	or a
	jr nz, .m_positive
	ld a, c             ; m = 0: A(0, n) = n + 1
	inc a
	ret

.m_positive:
	ld a, c
	or a
	jr nz, .both_positive
	push bc             ; n = 0: A(m, 0) = A(m - 1, 1)
	dec b
	ld c, 1
	call ackermann
	pop bc
	ret

.both_positive:
	push bc
	dec c               ; inner call: A(m, n - 1)
	call ackermann
	dec b               ; outer call: A(m - 1, inner)
	ld c, a
	call ackermann
	pop bc
	ret

; print_string: write the zero-terminated string at HL.
print_string:
	push af
	push hl
.next:
	ld a, (hl)
	or a                ; stop at the terminating zero
	jr z, .done
	ld (CONSOLE), a
	inc hl
	jr .next
.done:
	pop hl
	pop af
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
