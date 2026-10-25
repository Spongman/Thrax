import { cpuHistorySchema } from '../../core/configuredCpu'

export const historySchema = cpuHistorySchema({ registers: 14, wide: false, instructionBytes: 15 })
