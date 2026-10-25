; Interactive Input
; Read a line into a buffer, waiting for each character, then print it

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

	ld sp, $FF00
	ld hl, buffer
	ld b, 63            ; room for the line, keeping a byte for the zero
read:
	ld a, (READ_WAIT)   ; waits until a character is typed
	ld (hl), a
	inc hl
	cp 10               ; through the newline
	jr z, done
	djnz read
done:
	ld (hl), 0
	ld hl, buffer
	call print_string
	halt                ; interrupts are off, so HALT ends the program

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

buffer:	ds 64
