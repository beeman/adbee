import type { Crust } from '@crustjs/core'
import { CancelledError, confirm, multiselect, NonInteractiveError } from '@crustjs/prompts'
import { deleteInstalledAvds, type InstalledAvd, listInstalledAvds, resolveAndroidSdkRoot } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust
const STOP_DELETE_FLOW_VALUE = '__adbee_stop_delete_flow__'

function createDeleteChoice({ device, name, readOnly, target }: InstalledAvd) {
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

function createStopDeleteChoice() {
  return {
    hint: '(exit without deleting anything)',
    label: 'Stop delete flow',
    value: STOP_DELETE_FLOW_VALUE,
  }
}

export function createAvdDeleteCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runConfirm = dependencies.runConfirm ?? confirm
  const runDeleteInstalledAvds = dependencies.runDeleteInstalledAvds ?? deleteInstalledAvds
  const runListInstalledAvds = dependencies.runListInstalledAvds ?? listInstalledAvds
  const runMultiselect = dependencies.runMultiselect ?? multiselect
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot

  return avdCommand
    .sub('delete')
    .meta({ description: 'Interactively delete Android Virtual Devices.' })
    .flags({
      all: {
        default: false,
        description: 'Show read-only AVDs in addition to deletable ones.',
        type: 'boolean',
      },
    })
    .run(async ({ flags }) => {
      const avds = await runListInstalledAvds()
      const visibleAvds = flags.all ? avds : avds.filter(({ readOnly }) => !readOnly)

      if (visibleAvds.length === 0) {
        return
      }

      try {
        const avdNames = await runMultiselect({
          choices: [...visibleAvds.map(createDeleteChoice), createStopDeleteChoice()],
          message: 'Select AVDs to delete',
        })

        if (avdNames.length === 0) {
          return
        }

        if (avdNames.includes(STOP_DELETE_FLOW_VALUE)) {
          return
        }

        const selectedAvdNames = new Set(avdNames)
        const selectedAvds = visibleAvds.filter(({ name }) => selectedAvdNames.has(name))
        const readOnlyAvds = selectedAvds.filter(({ readOnly }) => readOnly)

        if (readOnlyAvds.length > 0) {
          throw new Error(`Cannot delete read-only AVDs: ${readOnlyAvds.map(({ name }) => name).join(', ')}`)
        }

        const confirmed = await runConfirm({
          default: false,
          message: `Are you sure you want to delete ${selectedAvds.map(({ name }) => name).join(', ')}?`,
        })

        if (!confirmed) {
          return
        }

        await runDeleteInstalledAvds(avdNames, runResolveAndroidSdkRoot())

        console.table(
          selectedAvds.map(({ device, name, target }) => ({
            device: device ?? '',
            name,
            target: target ?? '',
          })),
          ['device', 'name', 'target'],
        )
      } catch (error) {
        if (error instanceof CancelledError) {
          return
        }

        if (error instanceof NonInteractiveError) {
          throw new Error('avd delete requires an interactive terminal.')
        }

        throw error
      }
    })
}
