import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArchitectureVariant, Example } from '../../architectures/contracts'
import { variantOf } from '../../architectures/contracts'
import { activateArchitecture, knownArchitectures } from '../../architectures/registry'
import { CORE_EXAMPLE_IDS, EXAMPLE_NAMES, exampleName } from '../../core/exampleCatalog'
import ExamplesMenu, { exampleIcon, exampleItems } from '../ExamplesMenu'

describe('shared examples menu', () => {
	it('gives equivalent programs the same names, order and SVG presentation', () => {
		const examples: Record<string, Example> = {
			factorial: {
				name: 'CPU-specific factorial title',
				description: 'Multiply with this CPU.',
				code: 'factorial code'
			},
			hello: { name: 'CPU-specific greeting', description: 'Print on this CPU.', code: 'hello code' },
			sum: { name: 'Addition', description: 'Add on this CPU.', code: 'sum code' }
		}
		expect(exampleItems(examples).map((example) => [example.id, example.name])).toEqual([
			['hello', 'Hello, THRAX!'],
			['sum', 'Sum of Numbers'],
			['factorial', 'Factorial']
		])
		const markup = renderToStaticMarkup(<ExamplesMenu examples={examples} onLoad={() => {}} />)
		expect(markup.match(/role="menuitem"/g)).toHaveLength(3)
		expect(markup.match(/<svg class="toggle-icon"/g)).toHaveLength(3)
		expect(markup.match(/class="item-name"/g)).toHaveLength(3)
		expect(markup.match(/class="item-desc"/g)).toHaveLength(3)
		expect(markup).not.toContain('CPU-specific')
	})

	it('keeps special examples data-only and gives them the standard fallback glyph', () => {
		const [example] = exampleItems({
			specialty: { name: 'Special CPU Feature', description: 'A specific instruction.', code: 'special code' }
		})
		expect(example.name).toBe('Special CPU Feature')
		expect(example.code).toBe('special code')
		expect(renderToStaticMarkup(example.icon())).toContain('<svg')
		expect(exampleIcon('helloArmasm')).toBe(exampleIcon('hello'))
	})

	it.each(['constructor', 'toString', '__proto__'])('renders an unfamiliar topic named %s with its own title', (id) => {
		const examples = Object.fromEntries([[id, { name: 'Custom Topic', description: 'Custom program.', code: 'custom code' }]])
		const [example] = exampleItems(examples)
		expect(example.name).toBe('Custom Topic')
		expect(example.icon).toBe(exampleIcon('specialty'))
		const markup = renderToStaticMarkup(<ExamplesMenu examples={examples} onLoad={() => {}} />)
		expect(markup).toContain('Custom Topic')
		expect(markup).toContain('<svg class="toggle-icon"')
	})

	it.each(knownArchitectures())(
		'%s and its CPU variants provide the common topics through the shared view',
		async (id) => {
			const { definition } = await activateArchitecture(id)
			const defaults = definition.settings.defaults
			const variants = new Set<ArchitectureVariant>([variantOf(definition, defaults)])
			for (const field of definition.settings.fields) {
				if (field.control.kind !== 'choice') continue
				for (const option of field.control.options)
					variants.add(variantOf(definition, { ...defaults, [field.key]: option.value }))
			}
			for (const variant of variants) {
				for (const key of CORE_EXAMPLE_IDS) expect(variant.examples[key], `${id}: ${key}`).toBeDefined()
				if (variant.examples.hello || variant.examples.input) {
					expect(variant.examples.hello, `${id}: greeting`).toBeDefined()
					expect(variant.examples.input, `${id}: interactive input`).toBeDefined()
				}
				for (const [key, example] of Object.entries(variant.examples)) {
					expect(example, `${id}: ${key}`).not.toHaveProperty('icon')
					if (key in EXAMPLE_NAMES) expect(example.name, `${id}: ${key}`).toBe(exampleName(key, example.name))
					expect(example.code.trim(), `${id}: ${key}`).not.toBe('')
				}
				const markup = renderToStaticMarkup(<ExamplesMenu examples={variant.examples} onLoad={() => {}} />)
				expect(markup.match(/<svg class="toggle-icon"/g)).toHaveLength(Object.keys(variant.examples).length)
			}
		}
	)
})
