! Hello, THRAX!
! Print a NUL-terminated string through the monitor.

.text
_start:
	set greeting, %o0
	mov 4, %g1
	ta 0x10
	mov 10, %g1
	ta 0x10

.data
greeting: .asciz "Hello, THRAX!\n"
