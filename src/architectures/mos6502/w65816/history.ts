import { cpuHistorySchema } from '../../../core/configuredCpu'

export const historySchema = cpuHistorySchema({ registers: 9, wide: false, instructionBytes: 4 })
