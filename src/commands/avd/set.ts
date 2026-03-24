import type { Crust } from '@crustjs/core'
import { CancelledError, NonInteractiveError, select } from '@crustjs/prompts'
import { type InstalledAvd, listInstalledAvds, setAvdProperties } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

function createSetChoice({ device, name, readOnly, target }: InstalledAvd) {
  const hintParts = [device ? `device: ${device}` : undefined, target ? `target: ${target}` : undefined].filter(Boolean)

  return {
    hint: hintParts.length > 0 ? `(${hintParts.join(', ')})` : undefined,
    label: readOnly ? `${name} (read only)` : name,
    value: name,
  }
}

function normalizeAdbeePropertyKey(key: string): string {
  return key.startsWith('adbee.') ? key : `adbee.${key}`
}

function parsePropertyAssignment(assignment: string): { key: string; value: string } {
  const separatorIndex = assignment.indexOf('=')

  if (separatorIndex <= 0) {
    throw new Error('Expected KEY=VALUE, for example "readOnly=1".')
  }

  const key = assignment.slice(0, separatorIndex).trim()
  const value = assignment.slice(separatorIndex + 1)

  if (key.length === 0) {
    throw new Error('Expected KEY=VALUE, for example "readOnly=1".')
  }

  return {
    key: normalizeAdbeePropertyKey(key),
    value,
  }
}

export function createAvdSetCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runListInstalledAvds = dependencies.runListInstalledAvds ?? listInstalledAvds
  const runSelect = dependencies.runSelect ?? select
  const runSetAvdProperties = dependencies.runSetAvdProperties ?? setAvdProperties

  return avdCommand
    .sub('set')
    .meta({ description: 'Set an adbee property on a selected AVD.' })
    .args([{ name: 'assignment', required: true, type: 'string' }] as const)
    .run(async ({ args }) => {
      const { key, value } = parsePropertyAssignment(args.assignment)
      const avds = await runListInstalledAvds()

      if (avds.length === 0) {
        return
      }

      try {
        const avdName = await runSelect({
          choices: avds.map(createSetChoice),
          message: `Select an AVD to set ${key}=${value} on`,
        })

        await runSetAvdProperties(avdName, { [key]: value })

        console.table(
          [
            {
              name: avdName,
              property: key,
              value,
            },
          ],
          ['name', 'property', 'value'],
        )
      } catch (error) {
        if (error instanceof CancelledError) {
          return
        }

        if (error instanceof NonInteractiveError) {
          throw new Error('avd set requires an interactive terminal.')
        }

        throw error
      }
    })
}
