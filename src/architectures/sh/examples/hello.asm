; Hello, THRAX!
; Print a NUL-terminated string through the monitor.

.text
_start:
	mov32 #message, r4
	mov #4, r0
	trapa #0x10
	mov #10, r0
	trapa #0x10

.data
message: .asciz "Hello, THRAX!\n"
