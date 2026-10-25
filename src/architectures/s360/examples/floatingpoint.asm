* Floating-point Arithmetic
* Hexadecimal floating point: 1000 * 22 / 7 truncated to an integer
* prints 3142, then 0.1 + 0.2 is compared with 0.3 in long format.
* The S/360 has no float/integer conversion instructions: adding an
* unnormalized zero with characteristic X'4E' (16**14) shifts the
* integer part into the right half of the register.
FLOAT    CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         LD    0,=D'1000'
         MD    0,=D'22'
         DD    0,=D'7'            3142.857...
         AW    0,MAGIC            unnormalized add truncates to 3142
         STD   0,WORK
         L     1,WORK+4           the integer is the right half
         SVC   200
         LA    1,C' '
         SVC   202
         LD    2,=D'0.1'
         AD    2,=D'0.2'
         CD    2,=D'0.3'
         LA    1,EQUAL
         LA    0,L'EQUAL
         BE    REPORT
         LA    1,UNEQUAL
         LA    0,L'UNEQUAL
REPORT   SVC   203                write R0 bytes at R1
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
MAGIC    DC    0D,X'4E00000000000000'
WORK     DS    D
EQUAL    DC    C'0.1 + 0.2 = 0.3'
UNEQUAL  DC    C'0.1 + 0.2 <> 0.3'
         LTORG
         END   FLOAT
