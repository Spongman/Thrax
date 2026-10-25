* Bitmap Display
* Draw a 32 by 32 RGB gradient. The display is device memory at
* X'10000' holding little-endian pixels: blue, green, red, unused.
BITMAP   CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         L     2,=A(FRAME)        R2 -> first pixel
         SR    4,4                row
ROW      SR    5,5                column
PIXEL    LR    1,5
         SLL   1,3                blue = column * 8
         STC   1,0(,2)
         MVI   1(2),0             green
         LR    1,4
         SLL   1,3                red = row * 8
         STC   1,2(,2)
         MVI   3(2),0
         LA    2,4(,2)            next pixel
         LA    5,1(,5)
         CH    5,=H'32'
         BL    PIXEL
         LA    4,1(,4)
         CH    4,=H'32'
         BL    ROW
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
FRAME    EQU   X'10000'
         LTORG
         END   BITMAP
