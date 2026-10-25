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
	SWI OS_Exit

; print_decimal(r0): write r0 >= 0 in decimal, leading digits first.
print_decimal
	STMFD sp!, {r0-r3, lr}
	MOV r1, #10
	BL divide               ; r0 <- n / 10, r1 <- n % 10
	CMP r0, #0
	BLNE print_decimal      ; the leading digits, if any
	ADD r0, r1, #'0'
	SWI OS_WriteC
	LDMFD sp!, {r0-r3, pc}

; divide(r0, r1): r0 = r0 / r1 and r1 = r0 % r1, unsigned, by shift and subtract.
divide
	MOV r2, #0              ; quotient
	MOV r3, #1              ; the quotient bit the divisor stands for
up
	CMP r1, r0              ; shift the divisor up past the dividend
	MOVLS r1, r1, LSL #1
	MOVLS r3, r3, LSL #1
	BLS up
down
	CMP r0, r1              ; then back down, subtracting where it fits
	SUBCS r0, r0, r1
	ORRCS r2, r2, r3
	MOVS r3, r3, LSR #1
	MOVNE r1, r1, LSR #1
	BNE down
	MOV r1, r0
	MOV r0, r2
	MOV pc, lr

	END
