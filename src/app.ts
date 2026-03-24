import { Crust } from '@crustjs/core'
import { helpPlugin, versionPlugin } from '@crustjs/plugins'
import { confirm, multiselect } from '@crustjs/prompts'
import { createAppsCommand } from './commands/apps.ts'
import { type CreateAvdCommandDependencies, createAvdCommand } from './commands/avd.ts'
import { deleteInstalledApps, listInstalledApps } from './index.ts'

interface AppMetadata {
  description: string
  version: string
}

export function createApp(
  metadata: AppMetadata,
  runListInstalledApps: typeof listInstalledApps = listInstalledApps,
  runDeleteInstalledApps: typeof deleteInstalledApps = deleteInstalledApps,
  runConfirm: typeof confirm = confirm,
  runMultiselect: typeof multiselect = multiselect,
  avdDependencies: CreateAvdCommandDependencies = {},
) {
  const app = new Crust('adbee')
    .meta({ description: metadata.description })
    .use(versionPlugin(metadata.version))
    .use(helpPlugin())

  return app
    .command(createAppsCommand(app, runListInstalledApps, runDeleteInstalledApps, runConfirm, runMultiselect))
    .command(createAvdCommand(app, avdDependencies))
}
