* Bitwise Operations
* AND, OR and XOR of 12 and 10 produce 8, 14 and 6.
BITS     CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         LA    2,12
         LA    3,10
         LR    1,2
         NR    1,3                12 AND 10
         BAL   14,PRINT
         LR    1,2
         OR    1,3                12 OR 10
         BAL   14,PRINT
         LR    1,2
         XR    1,3                12 XOR 10
         BAL   14,PRINT
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
*
* PRINT: write R1 and a blank; R1 is changed.
PRINT    SVC   200
         LA    1,C' '
         SVC   202
         BR    14
         END   BITS
