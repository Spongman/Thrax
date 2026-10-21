import { createArchitectureServices } from '../../core/architectureServices'
import { assembleMips } from './assembler'
import { MipsSimulator } from './core/simulator'
import { BotIcon, DigitalLabIcon, ScavengerIcon, XRayIcon } from '../../components/icons'
import { describeToken } from './editor/debugDataTips'
import { EXAMPLES } from './examples'
import { mipsHistorySchema } from './history/schema'
import { manifest } from './manifest'
import { MipsMachine } from './machine'
import { mipsProfile } from './profile'
import { MEMORY_CONFIGURATIONS } from './memoryConfigurations'
import { MipsAssembly, mipsDisassembly } from './program'
import { MIPS_REGISTER_BANKS, MIPS_REGISTERS } from './registers'
import { MIPS_SETTINGS, splitProgramArguments, type MipsSettings } from './settings'
import { createMipsTools } from './tools'
import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, PanelContribution } from '../contracts'

const panels = () => import('./panels')

/** The MARS tools no other target has a device or a datapath for. */
const PANELS: readonly PanelContribution[] = [
	{
		id: 'xray', icon: XRayIcon, title: 'X-Ray', menuTitle: 'MIPS X-Ray Datapath', group: 'tool', dock: 'bottom',
		description: 'The datapath, control unit, ALU control and register bank, with the instruction at the pc animated through them.',
		load: async () => ({ default: (await panels()).XrayPanel }),
	},
	{
		id: 'marsBot', icon: BotIcon, title: 'Mars Bot', group: 'tool', dock: 'bottom',
		description: 'A bot driven by five memory-mapped registers: its heading, where it has reached, and the trail behind it.',
		load: async () => ({ default: (await panels()).MarsBotPanel }),
	},
	{
		id: 'scavengerHunt', icon: ScavengerIcon, title: 'Scavenger Hunt', group: 'tool', dock: 'bottom',
		description: 'Each player’s position, energy and score, the locations still to visit, and the writes that broke the rules.',
		load: async () => ({ default: (await panels()).ScavengerHuntPanel }),
	},
	{
		id: 'digitalLab', icon: DigitalLabIcon, title: 'Digital Lab', menuTitle: 'Digital Lab Simulator', group: 'tool', dock: 'bottom',
		description: 'Two seven-segment displays, a hexadecimal keypad, and a counter that raises a timer interrupt.',
		load: async () => ({ default: (await panels()).DigitalLabPanel }),
	},
]

/** Only this module's own assemblies can be loaded into its machines. */
function mipsAssembly(program: AssembledProgram): MipsAssembly {
	if (!(program instanceof MipsAssembly)) throw new Error('Not a MIPS program')
	return program
}

const definition: ArchitectureDefinition<ArchitectureServices<MipsSettings>> = {
	id: manifest.id,
	name: manifest.name,
	language: 'mips',
	registers: MIPS_REGISTERS,
	registerBanks: MIPS_REGISTER_BANKS,
	examples: EXAMPLES,
	settings: MIPS_SETTINGS,
	multipleEntries: true,
	panels: PANELS,
	createServices(): ArchitectureServices<MipsSettings> {
		return createArchitectureServices<MipsSettings>(({ check }) => {
			return {
				disassembly: mipsDisassembly,
				describeToken,
				assemble({ files, entries }, settings) {
					const { delayedBranching, extendedAssembler, warningsAreErrors } = settings
					const layout = MEMORY_CONFIGURATIONS[settings.memoryConfiguration]
					const result = assembleMips(files, entries, { delayedBranching, extendedAssembler, warningsAreErrors, memory: layout })
					return new MipsAssembly(result, layout)
				},
				createMachine(program, settings, options) {
					const { layout, machineCode, program: assembled } = mipsAssembly(program)
					const simulator = new MipsSimulator(machineCode, assembled, layout, {
						historySchema: mipsHistorySchema,
						startAtMain: settings.startAtMain,
						// The field is one line of text; the simulator wants the words of it.
						programArguments: settings.programArguments ? splitProgramArguments(settings.programArgumentsText) : undefined,
					})
					simulator.delayedBranching = settings.delayedBranching
					// Off, stores into text and fetches outside it fault.
					simulator.selfModifyingCode = settings.selfModifyingCode
					// How far back the workspace is willing to let the program be rewound.
					simulator.maxHistorySize = options.historyLimit
					simulator.configure({ speed: options.speed })
					const next = new MipsMachine(simulator)
					return next
				},
				createTools: createMipsTools,
				profile: (settings) => mipsProfile(settings.memoryConfiguration),
				exportWords: (program) => mipsAssembly(program).machineCode,
				async installEditor(monaco, host) {
					const { installEditor } = await import('./editor')
					check()
					const contribution = installEditor(monaco, host)
					return contribution
				},
			}
		})
	},
}

export default definition
