import type { Crust } from '@crustjs/core'
import {
  CancelledError,
  confirm,
  filter,
  input,
  type multiselect,
  NonInteractiveError,
  type select,
} from '@crustjs/prompts'
import {
  type AvailableAvdDevice,
  createOrUpdateAvd,
  DEFAULT_DATA_SIZE,
  DEFAULT_DEVICE,
  DEFAULT_RAM_MB,
  DEFAULT_SDCARD_SIZE,
  DEFAULT_SYSTEM_IMAGE,
  DEFAULT_VM_HEAP_MB,
  type deleteInstalledAvds,
  deriveDefaultAvdName,
  filterLatestPixelAvdDevices,
  type getAvailableAvdDeviceDetails,
  type installLatestAvdPackages,
  type listAvailableAvdDevices,
  listInstalledAvds,
  type listInstalledPlatforms,
  listInstalledSystemImages,
  listKnownAvdDevices,
  type listRunningAvds,
  resolveAndroidSdkRoot,
  resolveAvailableAvdName,
  type setAvdProperties,
  startAvd,
  type stopRunningAvd,
} from '../../avd.ts'

type CommandBuilder = Crust

export interface CreateAvdCommandDependencies {
  runConfirm?: typeof confirm
  runCreateOrUpdateAvd?: typeof createOrUpdateAvd
  runDeleteInstalledAvds?: typeof deleteInstalledAvds
  runFilter?: typeof filter
  runGetAvailableAvdDeviceDetails?: typeof getAvailableAvdDeviceDetails
  runInput?: typeof input
  runInstallLatestAvdPackages?: typeof installLatestAvdPackages
  runListAvailableAvdDevices?: typeof listAvailableAvdDevices
  runListInstalledAvds?: typeof listInstalledAvds
  runListInstalledPlatforms?: typeof listInstalledPlatforms
  runListInstalledSystemImages?: typeof listInstalledSystemImages
  runListRunningAvds?: typeof listRunningAvds
  runMultiselect?: typeof multiselect
  runResolveAndroidSdkRoot?: typeof resolveAndroidSdkRoot
  runSelect?: typeof select
  runSetAvdProperties?: typeof setAvdProperties
  runStartAvd?: typeof startAvd
  runStopRunningAvd?: typeof stopRunningAvd
}

function getDefaultSystemImage(installedSystemImages: readonly string[]): string {
  if (installedSystemImages.includes(DEFAULT_SYSTEM_IMAGE)) {
    return DEFAULT_SYSTEM_IMAGE
  }

  return installedSystemImages[0] ?? DEFAULT_SYSTEM_IMAGE
}

function createDeviceChoice({ device, name, oem }: AvailableAvdDevice) {
  const hintParts = [device !== name ? `device: ${device}` : undefined, oem ? `oem: ${oem}` : undefined].filter(Boolean)

  return {
    hint: hintParts.length > 0 ? `(${hintParts.join(', ')})` : undefined,
    label: name ?? device,
    value: device,
  }
}

function getDefaultAvailableAvdDevice(devices: readonly AvailableAvdDevice[]): string {
  if (devices.some(({ device }) => device === DEFAULT_DEVICE)) {
    return DEFAULT_DEVICE
  }

  return devices.find(({ device }) => device.endsWith('_pro_xl'))?.device ?? devices[0]?.device ?? DEFAULT_DEVICE
}

export function createAvdCreateCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runConfirm = dependencies.runConfirm ?? confirm
  const runCreateOrUpdateAvd = dependencies.runCreateOrUpdateAvd ?? createOrUpdateAvd
  const runFilter = dependencies.runFilter ?? filter
  const runInput = dependencies.runInput ?? input
  const runListAvailableAvdDevices = dependencies.runListAvailableAvdDevices ?? listKnownAvdDevices
  const runListInstalledAvds = dependencies.runListInstalledAvds ?? listInstalledAvds
  const runListInstalledSystemImages = dependencies.runListInstalledSystemImages ?? listInstalledSystemImages
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot
  const runStartAvd = dependencies.runStartAvd ?? startAvd

  return avdCommand
    .sub('create')
    .meta({ description: 'Create an Android Virtual Device.' })
    .flags({
      'data-size': {
        default: DEFAULT_DATA_SIZE,
        description: 'Data partition size.',
        type: 'string',
      },
      device: {
        description: 'AVD device ID.',
        type: 'string',
      },
      name: {
        description: 'AVD name.',
        type: 'string',
      },
      'ram-mb': {
        default: DEFAULT_RAM_MB,
        description: 'RAM size in MB.',
        type: 'number',
      },
      'sdcard-size': {
        default: DEFAULT_SDCARD_SIZE,
        description: 'SD card size.',
        type: 'string',
      },
      start: {
        default: false,
        description: 'Start the AVD after creating it.',
        type: 'boolean',
      },
      'system-image': {
        description: 'System image package ID.',
        type: 'string',
      },
      'vm-heap-mb': {
        default: DEFAULT_VM_HEAP_MB,
        description: 'VM heap size in MB.',
        type: 'number',
      },
    })
    .run(async ({ flags }) => {
      try {
        const sdkRoot = runResolveAndroidSdkRoot()
        const availableAvdDevices = flags.device
          ? []
          : filterLatestPixelAvdDevices(await runListAvailableAvdDevices(sdkRoot))
        const installedSystemImages = await runListInstalledSystemImages(sdkRoot)
        const existingAvdNames = (await runListInstalledAvds()).map(({ name }) => name)
        const defaultDevice = getDefaultAvailableAvdDevice(availableAvdDevices)
        const device =
          flags.device ??
          (availableAvdDevices.length === 0
            ? defaultDevice
            : await runFilter({
                choices: availableAvdDevices.map(createDeviceChoice),
                default: defaultDevice,
                message: 'Select an AVD device',
                placeholder: 'Type a device id or name',
              }))
        const defaultSystemImage = getDefaultSystemImage(installedSystemImages)
        const systemImage =
          flags['system-image'] ??
          (installedSystemImages.length === 0
            ? defaultSystemImage
            : await runFilter({
                choices: installedSystemImages,
                default: defaultSystemImage,
                message: 'Select an installed system image',
              }))
        const defaultName = resolveAvailableAvdName(deriveDefaultAvdName(device, systemImage), existingAvdNames)
        const requestedName =
          flags.name ??
          (await runInput({
            default: defaultName,
            message: 'AVD name',
          }))
        const name = resolveAvailableAvdName(requestedName, existingAvdNames)
        const result = await runCreateOrUpdateAvd({
          dataSize: flags['data-size'],
          device,
          name,
          ramMb: flags['ram-mb'],
          sdcardSize: flags['sdcard-size'],
          sdkRoot,
          systemImage,
          vmHeapMb: flags['vm-heap-mb'],
        })

        console.log('')
        console.log(`Created AVD: ${result.avdName}`)
        console.log('Launch with:')
        console.log(`"${result.emulatorPath}" @"${result.avdName}"`)

        const shouldStart =
          flags.start ||
          (await runConfirm({
            default: false,
            message: `Start ${result.avdName} now?`,
          }))

        if (shouldStart) {
          await runStartAvd(result.emulatorPath, result.avdName)
        }
      } catch (error) {
        if (error instanceof CancelledError) {
          return
        }

        if (error instanceof NonInteractiveError) {
          throw new Error('avd create requires an interactive terminal or resolvable defaults.')
        }

        throw error
      }
    })
}
