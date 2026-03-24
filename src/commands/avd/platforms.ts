import type { Crust } from '@crustjs/core'
import { listInstalledPlatforms, resolveAndroidSdkRoot } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

export function createAvdPlatformsCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runListInstalledPlatforms = dependencies.runListInstalledPlatforms ?? listInstalledPlatforms
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot

  return avdCommand
    .sub('platforms')
    .meta({ description: 'List installed Android SDK platforms.' })
    .run(async () => {
      const platforms = await runListInstalledPlatforms(runResolveAndroidSdkRoot())

      if (platforms.length === 0) {
        return
      }

      console.table(
        platforms.map((platform) => ({ platform })),
        ['platform'],
      )
    })
}
