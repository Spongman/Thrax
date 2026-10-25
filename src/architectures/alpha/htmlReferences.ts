import { instructionLinks } from '../../core/instructionHelp'

/** HTML destinations checked against https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM (2026-10-24). */
export const htmlReference = 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM'
export const htmlInstructionLink = instructionLinks('', Object.fromEntries([
	['addl addq clr mull mulq negl negq s4addl s4addq s4subl s4subq s8addl s8addq s8subl s8subq subl subq umulh', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#arith_table'],
	['adds addt cvtqs cvtqt cvtst cvttq cvtts divs divt fabs fclr fneg muls mult subs subt', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM#arith_instruct_descriptions'],
	['and bic bis eqv not ornot sll sra srl xor', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#log_shft_table'],
	['beq bge bgt blbc blbs ble blt bne br bsr jmp jsr jsr_coroutine ret', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#control_table'],
	['call_pal excb mb nop trapb wmb', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#special_table'],
	['cmoveq cmovge cmovgt cmovlbc cmovlbs cmovle cmovlt cmovne mov', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#move_table'],
	['cmpbge extbl extll extql extwl insbl insll insql inswl mskbl mskll mskql mskwl zap zapnot', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#byte_manip_table'],
	['cmpeq cmple cmplt cmpule cmpult', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#relation_table'],
	['cmpteq cmptle cmptlt cmptun', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM#relational_instruct_descriptions'],
	['cpys cpyse cpysn fcmoveq fcmovge fcmovgt fcmovle fcmovlt fcmovne fmov', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM#move_instruct_descriptions'],
	['fbeq fbge fbgt fble fblt fbne', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM#control_instruct_descriptions'],
	['fnop mf_fpcr mt_fpcr', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM#fcr_tbl'],
	['lda ldah ldbu ldl ldq ldq_u ldwu', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#load_table'],
	['lds ldt sts stt', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM#load_n_store_descriptions'],
	['stb stl stq stq_u stw', 'https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#store_table'],
].flatMap(([names, target]) => names.split(' ').map(name => [name, target]))))
