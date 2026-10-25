; Interrupts
; Timer and keyboard IRQs: a dot per tick, typed keys echoed, five ticks then exit

; The timer raises an IRQ every PERIOD cycles; the handler prints a dot per
; tick and echoes any key typed meanwhile. The main program waits for five
; ticks, then exits through $F003. The IRQ vector at $FFFE points at the
; handler, so BRK would enter it too.

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired
EXIT   = $F003              ; write the exit code to halt
ENABLE = $F004              ; bit 0: keyboard IRQ, bit 1: timer IRQ
PERIOD = $F005              ; 2 bytes: cycles between timer ticks

ticks = $10
TICKS = 5

	lda #0
	sta ticks
	lda #<2000              ; a tick every 2000 cycles
	sta PERIOD
	lda #>2000
	sta PERIOD + 1
	lda #%11                ; keyboard and timer IRQs
	sta ENABLE
	cli                     ; let IRQs in

wait:
	lda ticks
	cmp #TICKS
	bne wait

	sei
	lda #0
	sta ENABLE
	lda #'\n'
	sta OUT
	lda #0
	sta EXIT

irq:
	pha
	lda STATUS
	and #2                  ; the timer fired?
	beq @keys
	sta STATUS              ; any write acknowledges it
	inc ticks
	lda #'.'
	sta OUT
@keys:
	lda STATUS
	and #1                  ; a key is ready?
	beq @done
	lda IN
	sta OUT
@done:
	pla
	rti

.org $FFFE
.word irq
