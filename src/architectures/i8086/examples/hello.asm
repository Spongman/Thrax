; Hello, THRAX!
; Print a NUL-terminated string through the monitor.

.text
	mov bx, message
	mov ax, 3
	int 0x80
	hlt

.data
message: .asciz "Hello, THRAX!\n"
