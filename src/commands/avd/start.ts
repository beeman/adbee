import type { Crust } from '@crustjs/core'
import { CancelledError, NonInteractiveError, select } from '@crustjs/prompts'
import {
  type InstalledAvd,
  listInstalledAvds,
  resolveAndroidSdkRoot,
  resolveEmulatorPath,
  startAvd,
} from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

function createStartChoice({ device, name, readOnly, target }: InstalledAvd) {
  const hintParts = [
    device ? `device: ${device}` : undefined,
    target ? `target: ${target}` : undefined,
    readOnly ? 'read only' : undefined,
  ].filter(Boolean)

  return {
    hint: hintParts.length > 0 ? `(${hintParts.join(', ')})` : undefined,
    label: readOnly ? `${name} (read only)` : name,
    value: name,
  }
}

export function createAvdStartCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runListInstalledAvds = dependencies.runListInstalledAvds ?? listInstalledAvds
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot
  const runSelect = dependencies.runSelect ?? select
  const runStartAvd = dependencies.runStartAvd ?? startAvd

  return avdCommand
    .sub('start')
    .meta({ description: 'Start an installed Android Virtual Device.' })
    .args([{ name: 'name', type: 'string' }] as const)
    .run(async ({ args }) => {
      const avds = await runListInstalledAvds()

      try {
        const avdName =
          args.name ??
          (await (async () => {
            if (avds.length === 0) {
              return undefined
            }

            return runSelect({
              choices: avds.map(createStartChoice),
              message: 'Select an AVD to start',
            })
          })())

        if (!avdName) {
          return
        }

        if (!avds.some(({ name }) => name === avdName)) {
          throw new Error(`Unknown AVD: ${avdName}`)
        }

        await runStartAvd(resolveEmulatorPath(runResolveAndroidSdkRoot()), avdName)

        console.log(`Started AVD: ${avdName}`)
      } catch (error) {
        if (error instanceof CancelledError) {
          return
        }

        if (error instanceof NonInteractiveError) {
          throw new Error('avd start requires an interactive terminal or an explicit AVD name.')
        }

        throw error
      }
    })
}
