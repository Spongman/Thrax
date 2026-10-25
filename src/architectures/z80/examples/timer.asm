; Timer Interrupts
; Count timer ticks in an IM 2 handler found through a vector table

; The timer interrupts every 10 x 256 T-states. In IM 2 the CPU reads the
; handler's address from the table at I * 256 plus the byte the device puts
; on the bus, which is FFh for the timer.

CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one

VECTORS equ $2000

	org 0
	jp start

	org $100
start:
	ld sp, $FF00
	ld a, HIGH(VECTORS)
	ld i, a
	im 2
	ld a, 10            ; a tick every 10 x 256 T-states
	ld (TIMER), a
	ld a, 2             ; enable the timer interrupt
	ld (STATUS), a
	ei

wait:
	halt                ; sleep until the next tick
	ld a, (ticks)
	cp 5
	jr nz, wait

	di
	ld a, 10
	ld (CONSOLE), a
	halt

; tick: count and print each tick.
tick:
	push af
	ld a, (ticks)
	inc a
	ld (ticks), a
	add a, '0'
	ld (CONSOLE), a
	pop af
	ei
	reti

ticks:	db 0

	org VECTORS + $FF   ; the timer's entry in the table
	dw tick
