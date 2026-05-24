import type { Crust } from '@crustjs/core'
import { installLatestAvdPackages, resolveAndroidSdkRoot } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

export function createAvdInstallCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runInstallLatestAvdPackages = dependencies.runInstallLatestAvdPackages ?? installLatestAvdPackages
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot

  return avdCommand
    .sub('install')
    .meta({ description: 'Install the latest stable Android SDK platform and system image.' })
    .flags({
      abi: {
        description: 'System image ABI.',
        type: 'string',
      },
      platform: {
        description: 'Android platform ID or API level.',
        type: 'string',
      },
      'system-image': {
        description: 'Exact system image package ID.',
        type: 'string',
      },
      tag: {
        description: 'System image tag.',
        type: 'string',
      },
    })
    .run(async ({ flags }) => {
      const result = await runInstallLatestAvdPackages({
        abi: flags.abi,
        platform: flags.platform,
        sdkRoot: runResolveAndroidSdkRoot(),
        systemImage: flags['system-image'],
        tag: flags.tag,
      })

      console.log('Installed Android SDK packages:')

      for (const packagePath of result.installedPackages) {
        console.log(packagePath)
      }
    })
}
