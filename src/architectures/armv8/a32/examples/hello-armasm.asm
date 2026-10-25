; Hello, THRAX! (armasm)
; Print a string in armasm syntax: labels start in column 1, without a colon.

	AREA Hello, CODE, READONLY
	ENTRY
start
	MOV r0, #1              ; fd 1: standard output
	ADR r1, message         ; r1 -> the string, PC-relative
	MOV r2, #14             ; its length
	MOV r7, #4              ; write
	SVC #0
	MOV r0, #0              ; status
	MOV r7, #1              ; exit
	SVC #0

message
	DCB "Hello, THRAX!", 10
	ALIGN

	END
