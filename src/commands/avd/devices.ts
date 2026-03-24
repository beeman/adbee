import type { Crust } from '@crustjs/core'
import { filterLatestPixelAvdDevices, listAvailableAvdDevices, resolveAndroidSdkRoot } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

export function createAvdDevicesCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runListAvailableAvdDevices = dependencies.runListAvailableAvdDevices ?? listAvailableAvdDevices
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot

  return avdCommand
    .sub('devices')
    .meta({ description: 'List available AVD device definitions.' })
    .flags({
      all: {
        default: false,
        description: 'Show all available AVD device definitions instead of only the latest Pixel generation.',
        type: 'boolean',
      },
    })
    .run(async ({ flags }) => {
      const devices = await runListAvailableAvdDevices(runResolveAndroidSdkRoot())
      const visibleDevices = flags.all ? devices : filterLatestPixelAvdDevices(devices)

      if (visibleDevices.length === 0) {
        return
      }

      console.table(
        visibleDevices.map(({ device, name }) => ({
          device,
          name: name ?? '',
        })),
        ['device', 'name'],
      )
    })
}
