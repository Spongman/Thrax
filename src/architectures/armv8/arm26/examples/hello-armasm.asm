; Hello, THRAX! (armasm)
; Print a string in armasm syntax: labels start in column 1, without a colon.

	AREA Hello, CODE, READONLY
	ENTRY
start
	ADR r0, message         ; r0 -> the string
	SWI OS_Write0
	SWI OS_Exit

message
	DCB "Hello, THRAX!", 10, 0
	ALIGN

	END
