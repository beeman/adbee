import type { Crust } from '@crustjs/core'
import { CancelledError, NonInteractiveError, select } from '@crustjs/prompts'
import { listRunningAvds, type RunningAvd, stopRunningAvd } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

function createStopChoice({ name, serial }: RunningAvd) {
  return {
    hint: `(serial: ${serial})`,
    label: name,
    value: serial,
  }
}

export function createAvdStopCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runListRunningAvds = dependencies.runListRunningAvds ?? listRunningAvds
  const runSelect = dependencies.runSelect ?? select
  const runStopRunningAvd = dependencies.runStopRunningAvd ?? stopRunningAvd

  return avdCommand
    .sub('stop')
    .meta({ description: 'Stop a running Android Virtual Device.' })
    .args([{ name: 'name', type: 'string' }] as const)
    .run(async ({ args }) => {
      const runningAvds = await runListRunningAvds()

      try {
        const runningAvd = await (async () => {
          if (args.name) {
            const matchingRunningAvds = runningAvds.filter(({ name }) => name === args.name)

            if (matchingRunningAvds.length === 0) {
              throw new Error(`AVD is not running: ${args.name}`)
            }

            if (matchingRunningAvds.length === 1) {
              return matchingRunningAvds[0]
            }

            const selectedSerial = await runSelect({
              choices: matchingRunningAvds.map(createStopChoice),
              message: `Select a running ${args.name} instance to stop`,
            })

            return matchingRunningAvds.find(({ serial }) => serial === selectedSerial)
          }

          if (runningAvds.length === 0) {
            return undefined
          }

          const selectedSerial = await runSelect({
            choices: runningAvds.map(createStopChoice),
            message: 'Select a running AVD to stop',
          })

          return runningAvds.find(({ serial }) => serial === selectedSerial)
        })()

        if (!runningAvd) {
          return
        }

        await runStopRunningAvd(runningAvd.serial)

        console.log(`Stopped AVD: ${runningAvd.name} (${runningAvd.serial})`)
      } catch (error) {
        if (error instanceof CancelledError) {
          return
        }

        if (error instanceof NonInteractiveError) {
          throw new Error('avd stop requires an interactive terminal or an explicit running AVD name.')
        }

        throw error
      }
    })
}
