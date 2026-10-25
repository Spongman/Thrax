* Fibonacci
* Compute F(10); prints 55.
FIB      CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         SR    2,2                F(0)
         LA    3,1                F(1)
         LA    4,10               ten steps
NEXT     LR    5,2                R5 = F(i) + F(i+1)
         AR    5,3
         LR    2,3
         LR    3,5
         BCT   4,NEXT
         LR    1,2                R1 = F(10)
         SVC   200
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
         END   FIB
