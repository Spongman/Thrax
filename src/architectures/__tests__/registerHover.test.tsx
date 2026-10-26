import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RegisterView from '../../components/RegisterView'
import { RegisterFormat, variantOf } from '../contracts'
import { activateArchitecture, knownArchitectures } from '../registry'
import { architectureVariants } from './helpers'

describe.each(knownArchitectures())('%s register hover', id => {
	it('distinguishes register identity from matching pointer values across variants', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			try {
				await services.prepare?.(settings)
				const variant = variantOf(definition, settings)
				const profile = services.profile(settings)
				const address = profile.isMappedAddress(0) ? 0 : profile.resetPc
				const context = `${id}/${JSON.stringify(settings)}`
				const candidates = variant.registers.filter(register => register.editable !== false &&
					register.format !== RegisterFormat.FLOAT && register.format !== RegisterFormat.FLAG &&
					address < 2 ** register.bits)
				const first = candidates[0]
				const second = candidates.find(register => register.id !== first.id && register.bank === first.bank)
				expect(second, context).toBeDefined()
				expect(profile.isMappedAddress(address), context).toBe(true)
				const registers = { ...profile.resetRegisters, [first.id]: address, [second!.id]: address }
				const props = { registers, descriptors: variant.registers, banks: [{ id: first.bank, label: 'Registers' }],
					isAddress: profile.isMappedAddress, hoveredAddress: address }
				const named = renderToStaticMarkup(<RegisterView {...props} hoveredRegister={first.id} />)
				expect(named.match(/register-hovered/g), context).toHaveLength(1)
				expect(named, context).not.toContain('address-hovered')
				const pointer = renderToStaticMarkup(<RegisterView {...props} />)
				expect(pointer.match(/address-hovered/g)!.length, context).toBeGreaterThanOrEqual(2)
			} finally { services.dispose() }
		}
	})
})
