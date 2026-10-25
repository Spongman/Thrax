; Factorial (armasm)
; Compute 5! = 120 with EQU and a literal pool, in armasm syntax.

N	EQU 5

	AREA Factorial, CODE, READONLY
	ENTRY
	MOV r1, #N              ; n
	LDR r2, =1              ; result: a literal, which LDR = turns into a MOV
loop
	CMP r1, #0
	BEQ done                ; if n == 0, exit loop
	MUL r2, r1, r2          ; result = n * result
	SUB r1, r1, #1          ; n--
	B loop

done
	MOV r0, r2
	BL print_decimal
	MOV r0, #0              ; status
	MOV r7, #1              ; exit
	SVC #0

; print_decimal(r0): write r0 in decimal, unsigned.
print_decimal
	PUSH {r4, r5, r7, lr}
	SUB sp, sp, #16         ; room for 10 digits
	ADD r1, sp, #16         ; r1 walks back from the end of the buffer
	MOV r4, #10
digit
	UDIV r5, r0, r4         ; r5 = r0 / 10
	MLS r2, r5, r4, r0      ; r2 = r0 - r5 * 10, the lowest digit
	ADD r2, r2, #'0'
	STRB r2, [r1, #-1]!
	MOVS r0, r5
	BNE digit
	MOV r0, #1              ; fd 1
	ADD r2, sp, #16
	SUB r2, r2, r1          ; length: from r1 to the end
	MOV r7, #4              ; write
	SVC #0
	ADD sp, sp, #16
	POP {r4, r5, r7, pc}

	END
