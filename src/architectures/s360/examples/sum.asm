* Sum of Numbers
* Add 3 and 5; prints 8.
SUM      CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         LA    1,3                R1 = 3
         A     1,FIVE             add the fullword constant
         SVC   200                print R1
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
FIVE     DC    F'5'
         END   SUM
