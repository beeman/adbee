import type { Crust } from '@crustjs/core'
import { listInstalledSystemImages, resolveAndroidSdkRoot } from '../../avd.ts'
import type { CreateAvdCommandDependencies } from './create.ts'

type CommandBuilder = Crust

export function createAvdImagesCommand(avdCommand: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const runListInstalledSystemImages = dependencies.runListInstalledSystemImages ?? listInstalledSystemImages
  const runResolveAndroidSdkRoot = dependencies.runResolveAndroidSdkRoot ?? resolveAndroidSdkRoot

  return avdCommand
    .sub('images')
    .meta({ description: 'List installed system image packages.' })
    .run(async () => {
      const systemImages = await runListInstalledSystemImages(runResolveAndroidSdkRoot())

      if (systemImages.length === 0) {
        return
      }

      console.table(
        systemImages.map((systemImage) => ({ systemImage })),
        ['systemImage'],
      )
    })
}
