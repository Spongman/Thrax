; Hello, THRAX!
; Print a NUL-terminated string through the monitor.

.text
_start:
	LI R1, message
	LI R0, 4
	XOP R1, 15
	LI R0, 10
	XOP R1, 15

.data
message: .asciz "Hello, THRAX!\n"
