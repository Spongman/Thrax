* Hello, THRAX!
* Write a message to the console with WTO (SVC 35). The text is an
* EBCDIC constant; the console translates it.
HELLO    CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         ST    13,SAVE+4          chain the save areas
         LA    13,SAVE
         LA    1,MESSAGE          R1 -> WTO parameter list
         SVC   35                 write to operator
         L     13,SAVE+4          restore and return to the monitor
         LM    14,12,12(13)
         SR    15,15              return code 0
         BR    14
SAVE     DS    18F
MESSAGE  DC    AL2(MSGEND-MESSAGE),AL2(0)  length and MCS flags
         DC    C'Hello, THRAX!'
MSGEND   EQU   *
         END   HELLO
