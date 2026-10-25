; Macros
; Define once, use many times with MACRO and EQU

; Macros are expanded by the assembler, so each use costs no call-and-return
; overhead. Labels starting with a dot inside a macro are local to each
; expansion, which is why ".again" can be reused safely.

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

FIRST  equ 5            ; EQU names constants
SECOND equ 3

print macro text
	ld hl, text
	call print_string
	endm

count_to macro limit
	ld b, 0
.again:
	inc b
	ld l, b
	ld h, 0
	call print_decimal
	ld a, b
	cp limit
	jr nz, .again
	endm

finish macro
	halt
	endm

	ld sp, $FF00
	print banner

	count_to FIRST
	print newline

	count_to SECOND
	print newline

	finish

banner:		db "counting: ", 0
newline:	db 10, 0

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
