import { cpuHistorySchema } from '../../core/configuredCpu'
export const historySchema = cpuHistorySchema({ registers: 5, wide: false, instructionBytes: 3 })
