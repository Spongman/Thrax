; Keyboard and Display
; Echo queued keystrokes through the I/O page

; Memory-mapped I/O, through the Keyboard and Display tool or the console.
; Queue characters while the program runs; each one is echoed to the
; display. A period ends the program.

OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired

poll:
	lda STATUS              ; bit 0 is set once a character is ready
	and #1
	beq poll

	lda IN                  ; reading it consumes the character
	sta OUT                 ; writing it prints to the display
	cmp #'.'
	bne poll

	brk
