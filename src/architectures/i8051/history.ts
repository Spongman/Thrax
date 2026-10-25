import { cpuHistorySchema } from '../../core/configuredCpu'
export const historySchema = cpuHistorySchema({ registers: 13, wide: false, instructionBytes: 3 })
