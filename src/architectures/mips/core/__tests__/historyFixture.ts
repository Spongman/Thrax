import { mipsHistorySchema } from '../../history/schema'
import type { EffectStore } from '../effectStore'
import { MipsHistory } from '../history'

/** A history holding one instruction entry at `address`, whose effects `record` pushes. */
export function historyWith(address: number, record: (effects: EffectStore) => void = () => {}, word: number | null = 0): MipsHistory {
	const history = new MipsHistory(mipsHistorySchema)
	history.open(1, 0, address, word, false, address, 'none', 0)
	record(history.effects)
	history.close()
	return history
}
