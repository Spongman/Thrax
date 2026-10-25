; Hello, THRAX!
; Educational TRAP #15 task 14 prints a zero-terminated string from A1.

.data
message: .asciz "Hello, THRAX!\n"

.text
main:
	lea message, a1
	moveq #14, d0
	trap #15
	moveq #9, d0
	trap #15
