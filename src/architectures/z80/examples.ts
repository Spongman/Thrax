import type { Example } from '../contracts'
import { mandelbrot } from './mandelbrot'

/**
 * Example Z80 programs, ported from the MIPS and Beta examples.
 *
 * The console is the device page at $FF00: a byte written to $FF00 prints, and
 * the same registers answer on I/O ports 0 to 7. Subroutines take their
 * arguments in registers, return results in A or HL, and keep every register
 * they do not return in.
 */

const DEVICES = `CONSOLE   equ $FF00     ; write: print a character
INPUT     equ $FF01     ; read: the next typed character, 0 when none
STATUS    equ $FF02     ; read: bit 0 input ready; write: interrupt enables
EXIT      equ $FF03     ; write: end the program with an exit code
TIMER     equ $FF04     ; write: timer period in units of 256 T-states
READ_WAIT equ $FF05     ; read: the next typed character, waiting for one
`

// Subroutines shared by several examples, pasted into each so it stands alone.

const PRINT_STRING = `; print_string: write the zero-terminated string at HL.
print_string:
	push af
	push hl
.next:
	ld a,(hl)
	or a                ; stop at the terminating zero
	jr z,.done
	ld (CONSOLE),a
	inc hl
	jr .next
.done:
	pop hl
	pop af
	ret
`

const PRINT_DECIMAL = `; print_decimal: write HL as an unsigned decimal number.
print_decimal:
	push af
	push bc
	push hl
	ld b,0              ; digits pushed, least significant first
.divide:
	call div10
	push af
	inc b
	ld a,h
	or l
	jr nz,.divide
.print:
	pop af              ; most significant first
	add a,'0'
	ld (CONSOLE),a
	djnz .print
	pop hl
	pop bc
	pop af
	ret

; div10: HL <- HL / 10 and A <- HL mod 10, a bit at a time.
div10:
	push bc
	ld b,16
	xor a
.bit:
	add hl,hl           ; the next bit of HL into A
	rla
	cp 10
	jr c,.next
	sub 10              ; it goes: that quotient bit is 1
	inc l
.next:
	djnz .bit
	pop bc
	ret
`

export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot,
	mmio: {
		name: 'Keyboard and Display',
		description: 'Poll the keyboard status, echo each character to the display and stop at a period.',
		tools: ['keyboardDisplay'],
		code: `; Queue text in the Keyboard / Display tool, ending with a period.
${DEVICES}
org $100
poll:
ld a,(STATUS)
and 1
jr z,poll
ld a,(INPUT)
ld (CONSOLE),a
cp '.'
jr nz,poll
halt
`,
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a line into a buffer, waiting for each character, then print it',
		code: `; Read a line into a buffer, then print it

${DEVICES}
	ld sp,$FF00
	ld hl,buffer
	ld b,63             ; room for the line, keeping a byte for the zero
read:
	ld a,(READ_WAIT)    ; waits until a character is typed
	ld (hl),a
	inc hl
	cp 10               ; through the newline
	jr z,done
	djnz read
done:
	ld (hl),0
	ld hl,buffer
	call print_string
	halt                ; interrupts are off, so HALT ends the program

${PRINT_STRING}
buffer:	ds 64
`,
	},

	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code',
		code: `; DB data and a print-string subroutine

${DEVICES}
	ld sp,$FF00         ; the stack grows down from below the devices
	ld hl,message
	call print_string
	halt

message:	db "Hello, THRAX!",10,0

${PRINT_STRING}`,
	},

	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: `; Simple addition example
; Compute 5 + 3 = 8

${DEVICES}
	ld sp,$FF00

	; Load values
	ld a,5
	ld b,3

	; Add them
	add a,b             ; A <- A + B = 8

	; Print result
	ld l,a
	ld h,0
	call print_decimal

	; Print newline, through an I/O port this time
	ld a,10
	out (0),a

	halt

${PRINT_DECIMAL}`,
	},

	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
		code: `; Factorial example
; Compute 5! = 5 * 4 * 3 * 2 * 1 = 120

${DEVICES}
	ld sp,$FF00
	ld b,5              ; n = 5
	ld hl,1             ; result = 1

loop:
	; result = result * n, adding result to itself n times
	push bc
	ld d,h
	ld e,l
	ld hl,0
multiply:
	add hl,de
	djnz multiply
	pop bc
	djnz loop           ; n--, until n == 0

	; Print result
	call print_decimal
	halt

${PRINT_DECIMAL}`,
	},

	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: `; Fibonacci sequence
; Compute fib(10)

${DEVICES}
	ld sp,$FF00
	ld hl,0             ; fib(0) = 0
	ld de,1             ; fib(1) = 1
	ld b,9              ; nine steps reach fib(10)

loop:
	add hl,de           ; HL <- fib(n-2) + fib(n-1)
	ex de,hl            ; DE <- the new one, HL <- fib(n-1)
	djnz loop

	; Print result
	ex de,hl
	call print_decimal
	halt

${PRINT_DECIMAL}`,
	},

	ackermann: {
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: `; Ackermann function
; A(m, n) = n + 1                    when m = 0
;         = A(m - 1, 1)              when n = 0
;         = A(m - 1, A(m, n - 1))    otherwise
;
; Each call pushes its return address and the arguments it keeps, so the
; stack fills up as the recursion deepens.

${DEVICES}
	ld sp,$FF00
	ld hl,prompt        ; print the label
	call print_string

	ld b,3              ; ackermann(3, 3)
	ld c,3
	call ackermann

	ld l,a              ; print the result
	ld h,0
	call print_decimal
	halt

prompt:	db "A(3, 3) = ",0

; ackermann: A <- A(B, C), keeping BC.
ackermann:
	ld a,b
	or a
	jr nz,.m_positive
	ld a,c              ; m = 0: A(0, n) = n + 1
	inc a
	ret

.m_positive:
	ld a,c
	or a
	jr nz,.both_positive
	push bc             ; n = 0: A(m, 0) = A(m - 1, 1)
	dec b
	ld c,1
	call ackermann
	pop bc
	ret

.both_positive:
	push bc
	dec c               ; inner call: A(m, n - 1)
	call ackermann
	dec b               ; outer call: A(m - 1, inner)
	ld c,a
	call ackermann
	pop bc
	ret

${PRINT_STRING}
${PRINT_DECIMAL}`,
	},

	loop: {
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: `; Loop counter example
; Print numbers 1 through 5

${DEVICES}
	ld sp,$FF00
	ld b,1              ; counter = 1

loop:
	ld a,b              ; if counter == 6, exit
	cp 6
	jr z,done

	; Print counter
	ld l,b
	ld h,0
	call print_decimal

	; Print space, through an I/O port
	ld a,' '
	out (0),a

	; Increment and loop
	inc b
	jr loop

done:
	; Print newline
	ld a,10
	ld (CONSOLE),a
	halt

${PRINT_DECIMAL}`,
	},

	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: `; Bitwise operations
; Test AND, OR, XOR with two values

${DEVICES}
	ld sp,$FF00
	ld b,%1100          ; B = 12
	ld c,%1010          ; C = 10

	; AND operation
	ld a,b
	and c               ; A = 12 & 10 = 8
	call print_a

	ld a,' '
	ld (CONSOLE),a

	; OR operation
	ld a,b
	or c                ; A = 12 | 10 = 14
	call print_a

	ld a,' '
	ld (CONSOLE),a

	; XOR operation
	ld a,b
	xor c               ; A = 12 ^ 10 = 6
	call print_a

	halt

; print_a: write A in decimal.
print_a:
	push hl
	ld l,a
	ld h,0
	call print_decimal
	pop hl
	ret

${PRINT_DECIMAL}`,
	},

	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw colour bands for the Bitmap Display tool',
		code: `; Fill a 32 x 32 grid of pixels for the Bitmap Display tool.
; Tool settings: base address 0xC000, unit 8, width 256, height 256.
; Each pixel is a byte whose low four bits pick one of 16 colours.

FRAME equ $C000

	ld hl,FRAME         ; pixel cursor
	ld d,0              ; row

row:
	ld e,0              ; column

column:
	ld a,d              ; row + column picks the colour: diagonal bands
	add a,e
	and $0F
	ld (hl),a
	inc hl

	inc e
	ld a,e
	cp 32
	jr nz,column

	inc d
	ld a,d
	cp 32
	jr nz,row

	halt
`,
	},

	macros: {
		name: 'Macros',
		description: 'Define once, use many times with MACRO and EQU',
		code: `; Macros are expanded by the assembler, so each use costs no call-and-return
; overhead. Labels starting with a dot inside a macro are local to each
; expansion, which is why ".again" can be reused safely.

${DEVICES}
FIRST  equ 5            ; EQU names constants
SECOND equ 3

print macro text
	ld hl,text
	call print_string
	endm

count_to macro limit
	ld b,0
.again:
	inc b
	ld l,b
	ld h,0
	call print_decimal
	ld a,b
	cp limit
	jr nz,.again
	endm

finish macro
	halt
	endm

	ld sp,$FF00
	print banner

	count_to FIRST
	print newline

	count_to SECOND
	print newline

	finish

banner:		db "counting: ",0
newline:	db 10,0

${PRINT_STRING}
${PRINT_DECIMAL}`,
	},

	keyboard: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard Interrupts',
		description: 'Echo typed characters from an IM 1 interrupt handler until a full stop',
		code: `; Type while the program runs: each character raises the keyboard
; interrupt, and the handler at 38h (IM 1) echoes it. A full stop ends it.

${DEVICES}
	org 0
	jp start

	org $38             ; IM 1 takes every interrupt here
handler:
	push af
	ld a,(INPUT)        ; reading the character acknowledges it
	ld (CONSOLE),a
	ld (last),a
	pop af
	ei                  ; interrupts back on, taken after the RETI
	reti

	org $100
start:
	ld sp,$FF00
	im 1
	ld a,1              ; enable the keyboard interrupt
	ld (STATUS),a
	ei

wait:
	halt                ; sleep until a character arrives
	ld a,(last)
	cp '.'
	jr nz,wait

	di                  ; with interrupts off, HALT ends the program
	halt

last:	db 0
`,
	},

	timer: {
		name: 'Timer Interrupts',
		description: 'Count timer ticks in an IM 2 handler found through a vector table',
		code: `; The timer interrupts every 10 x 256 T-states. In IM 2 the CPU reads the
; handler's address from the table at I * 256 plus the byte the device puts
; on the bus, which is FFh for the timer.

${DEVICES}
VECTORS equ $2000

	org 0
	jp start

	org $100
start:
	ld sp,$FF00
	ld a,HIGH(VECTORS)
	ld i,a
	im 2
	ld a,10             ; a tick every 10 x 256 T-states
	ld (TIMER),a
	ld a,2              ; enable the timer interrupt
	ld (STATUS),a
	ei

wait:
	halt                ; sleep until the next tick
	ld a,(ticks)
	cp 5
	jr nz,wait

	di
	ld a,10
	ld (CONSOLE),a
	halt

; tick: count and print each tick.
tick:
	push af
	ld a,(ticks)
	inc a
	ld (ticks),a
	add a,'0'
	ld (CONSOLE),a
	pop af
	ei
	reti

ticks:	db 0

	org VECTORS + $FF   ; the timer's entry in the table
	dw tick
`,
	},
}
