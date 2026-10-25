; Keyboard Interrupts
; Echo typed characters from an IM 1 interrupt handler until a full stop

; Type while the program runs: each character raises the keyboard
; interrupt, and the handler at 38h (IM 1) echoes it. A full stop ends it.

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

	org 0
	jp start

	org $38             ; IM 1 takes every interrupt here
handler:
	push af
	ld a, (INPUT)       ; reading the character acknowledges it
	ld (CONSOLE), a
	ld (last), a
	pop af
	ei                  ; interrupts back on, taken after the RETI
	reti

	org $100
start:
	ld sp, $FF00
	im 1
	ld a, 1             ; enable the keyboard interrupt
	ld (STATUS), a
	ei

wait:
	halt                ; sleep until a character arrives
	ld a, (last)
	cp '.'
	jr nz, wait

	di                  ; with interrupts off, HALT ends the program
	halt

last:	db 0
