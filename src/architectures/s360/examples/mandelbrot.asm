* Mandelbrot Set
* CPU: System/360 Model 30, Model 50/65, System/370
* FPU: none; signed 8.8 fixed point
* 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)
*
* For each pixel, c = cx + i * cy and z starts at 0. The loop iterates
* z = z^2 + c until |z|^2 reaches the escape radius of 4, and colours
* the pixel by how many iterations that took. Values are scaled by 256:
* M forms a 64-bit product in an even/odd pair and D by 256 truncates
* it toward zero.
MANDEL   CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         L     2,=A(FRAME)        R2 -> first pixel
         SR    3,3                row
ROW      LR    6,3                cy = row * 20 - 320
         MH    6,=H'20'
         SH    6,=H'320'
         SR    4,4                column
COLUMN   LR    5,4                cx = column * 20 - 512
         MH    5,=H'20'
         SH    5,=H'512'
         SR    7,7                x = 0
         SR    8,8                y = 0
         SR    9,9                iteration
ITERATE  LR    1,7                xx = x * x / 256
         MR    0,7
         D     0,=F'256'
         LR    10,1
         LR    1,8                yy = y * y / 256
         MR    0,8
         D     0,=F'256'
         LR    11,1
         LR    1,10               escape once xx + yy >= 4.0
         AR    1,11
         C     1,=F'1024'
         BNL   ESCAPED
         LR    1,7                y = 2 * (x * y / 256) + cy
         MR    0,8
         D     0,=F'256'
         AR    1,1
         AR    1,6
         LR    8,1
         LR    7,10               x = xx - yy + cx
         SR    7,11
         AR    7,5
         LA    9,1(,9)
         CH    9,=H'16'
         BL    ITERATE
ESCAPED  LR    1,9                colour by iteration count
         SLL   1,2
         L     1,PALETTE(1)
         ST    1,0(,2)
         LA    2,4(,2)            next pixel
         LA    4,1(,4)
         CH    4,=H'32'
         BL    COLUMN
         LA    3,1(,3)
         CH    3,=H'32'
         BL    ROW
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
FRAME    EQU   X'10000'           the display: little-endian RGB pixels
         LTORG
* Iteration count to colour, each word in the display's byte order
* (blue, green, red, unused); index 16 is the interior.
PALETTE  DS    0F
         DC    X'30000000,4A100000,661F0000,80300000'
         DC    X'A0440000,BD590000,D4721A00,E08C3D00'
         DC    X'EAA66200,F2BF8600,F7D5A800,FBE6C600'
         DC    X'FDF1DE00,FEF8EF00,FFFCF800,FFFFFF00'
         DC    X'00000000'
         END   MANDEL
