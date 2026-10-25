; Hello, THRAX!
; Print a string stored after the code

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

	ld sp, $FF00        ; the stack grows down from below the devices
	ld hl, message
	call print_string
	halt

message:	db "Hello, THRAX!", 10, 0

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
