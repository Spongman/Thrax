; Keyboard and Display
; Poll the keyboard status, echo each character to the display and stop at a period

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

org $100
poll:
	ld a, (STATUS)
	and 1
	jr z, poll
	ld a, (INPUT)
	ld (CONSOLE), a
	cp '.'
	jr nz, poll
	halt
