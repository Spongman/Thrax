import { instructionLinks } from '../../core/instructionHelp'

/** IBM System/360 Principles of Operation, A22-6821-7 (December 1967). */
export const reference = 'https://bitsavers.org/pdf/ibm/360/princOps/A22-6821-7_360PrincOpsDec67.pdf'
/** IBM System/370 Principles of Operation, GA22-7000-4 (September 1975), for the System/370 additions. */
export const reference370 = 'https://bitsavers.org/pdf/ibm/370/princOps/GA22-7000-4_370_Principles_Of_Operation_Sep75.pdf'

/** PDF page index (not the printed page) of each description; extended branch mnemonics share BC/BCR's. */
const pages360: Record<number, string> = {
	28: 'lr l lh ltr',
	29: 'lcr lpr lnr lm',
	30: 'ar a ah alr al',
	31: 'sr s sh slr sl',
	32: 'cr c ch mr m mh',
	33: 'dr d cvb',
	34: 'cvd st sth stm sla',
	35: 'sra slda',
	36: 'srda',
	39: 'ap sp zap',
	40: 'cp mp dp',
	41: 'pack unpk',
	42: 'mvo',
	47: 'ler le ldr ld lter ltdr lcer lcdr lper lpdr',
	48: 'lner lndr aer ae adr ad',
	49: 'aur au awr aw ser se sdr sd',
	50: 'sur su swr sw cer ce cdr cd',
	51: 'her hdr mer me mdr md',
	52: 'der de ddr dd',
	53: 'ste std',
	61: 'mvi mvc',
	62: 'mvn mvz clr cl cli clc',
	63: 'nr n ni nc or o oi oc xr x xi xc',
	64: 'tm ic stc la',
	66: 'tr trt ed',
	69: 'edmk sll srl sldl',
	70: 'srdl',
	74: 'bc bcr b nop bh bl be bnh bnl bne bo bp bm bz bnp bnm bnz bno br nopr bhr blr ber bnhr bnlr bner bor bpr bmr bzr bnpr bnmr bnzr bnor',
	75: 'bal balr bct bctr bxh',
	76: 'bxle',
	77: 'ex',
	83: 'spm',
	84: 'svc ts',
}
const pages370: Record<number, string> = {
	126: 'clcl clm',
	130: 'icm',
	133: 'mvcl',
	141: 'stcm',
	153: 'srp',
	160: 'axr',
	166: 'lrer lrdr',
	167: 'mxr mxdr mxd',
	169: 'sxr',
}
const table = (pages: Record<number, string>) => Object.fromEntries(Object.entries(pages).flatMap(([page, names]) => names.split(' ').map(name => [name, Number(page)])))
const link360 = instructionLinks(reference, table(pages360)), link370 = instructionLinks(reference370, table(pages370))

export const instructionLink = (mnemonic: string) => link370(mnemonic) ?? link360(mnemonic)
