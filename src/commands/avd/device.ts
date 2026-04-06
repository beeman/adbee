import type { Crust } from '@crustjs/core'
import { CancelledError, filter, NonInteractiveError } from '@crustjs/prompts'
import {
  type AvailableAvdDevice,
  filterLatestPixelAvdDevices,
  getAvailableAvdDeviceDetails,
  listKnownAvdDevices,
  resolveAndroidSdkRoot,
} from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

function createDeviceChoice({ device, name, oem }: AvailableAvdDevice) {
  const hintParts = [device !== name ? `device: ${device}` : undefined, oem ? `oem: ${oem}` : undefined].filter(Boolean)

  return {
    hint: hintParts.length > 0 ? `(${hintParts.join(', ')})` : undefined,
    label: name ?? device,
    value: device,
  }
}

export function createAvdDeviceCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runFilter = dependencies.runFilter ?? filter
  const runGetAvailableAvdDeviceDetails = dependencies.runGetAvailableAvdDeviceDetails ?? getAvailableAvdDeviceDetails
  const runListAvailableAvdDevices = dependencies.runListAvailableAvdDevices ?? listKnownAvdDevices
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot

  return avdCommand
    .sub('device')
    .meta({ description: 'Show details for an available AVD device definition.' })
    .flags({
      all: {
        default: false,
        description: 'Show all available AVD device definitions instead of only the latest Pixel generation.',
        type: 'boolean',
      },
    })
    .args([{ name: 'device', type: 'string' }] as const)
    .run(async ({ args, flags }) => {
      const sdkRoot = runResolveAndroidSdkRoot()

      try {
        const selectedDevice =
          args.device ??
          (await (async () => {
            const devices = await runListAvailableAvdDevices(sdkRoot)
            const visibleDevices = flags.all ? devices : filterLatestPixelAvdDevices(devices)

            if (visibleDevices.length === 0) {
              return undefined
            }

            return runFilter({
              choices: visibleDevices.map(createDeviceChoice),
              message: 'Select an AVD device',
              placeholder: 'Type a device id or name',
            })
          })())

        if (!selectedDevice) {
          return
        }

        const deviceDetails = await runGetAvailableAvdDeviceDetails(selectedDevice, sdkRoot)

        if (!deviceDetails) {
          throw new Error(`Unknown AVD device: ${selectedDevice}`)
        }

        console.table(
          [
            {
              apiLevel: deviceDetails.apiLevel ?? '',
              density: deviceDetails.density ?? '',
              device: deviceDetails.device,
              diagonalLength: deviceDetails.diagonalLength ?? '',
              name: deviceDetails.name ?? '',
              oem: deviceDetails.oem ?? '',
              playStore: deviceDetails.playStore === undefined ? '' : String(deviceDetails.playStore),
              resolution: deviceDetails.resolution ?? '',
              screenRatio: deviceDetails.screenRatio ?? '',
              tag: deviceDetails.tag ?? '',
            },
          ],
          [
            'apiLevel',
            'density',
            'device',
            'diagonalLength',
            'name',
            'oem',
            'playStore',
            'resolution',
            'screenRatio',
            'tag',
          ],
        )
      } catch (error) {
        if (error instanceof CancelledError) {
          return
        }

        if (error instanceof NonInteractiveError) {
          throw new Error('avd device requires an interactive terminal or an explicit device id.')
        }

        throw error
      }
    })
}
