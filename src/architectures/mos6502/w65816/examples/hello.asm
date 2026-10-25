; Hello, THRAX!
; Print a zero-terminated string through the COP monitor

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	ldx.w #message
	cop #3
	stp
.data
message: .asciz "Hello, THRAX!\n"
