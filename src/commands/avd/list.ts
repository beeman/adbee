import type { Crust } from '@crustjs/core'
import { listInstalledAvds } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

export function createAvdListCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runListInstalledAvds = dependencies.runListInstalledAvds ?? listInstalledAvds

  return avdCommand
    .sub('list')
    .meta({ description: 'List installed Android Virtual Devices.' })
    .run(async () => {
      const avds = await runListInstalledAvds()

      if (avds.length === 0) {
        return
      }

      console.table(
        avds.map(({ device, name, target }) => ({
          device: device ?? '',
          name,
          target: target ?? '',
        })),
        ['device', 'name', 'target'],
      )
    })
}
