import { Crust } from '@crustjs/core'
import { helpPlugin, versionPlugin } from '@crustjs/plugins'
import { createAppsCommand } from './commands/apps.ts'
import { listInstalledApps } from './index.ts'

interface AppMetadata {
  description: string
  version: string
}

export function createApp(metadata: AppMetadata, runListInstalledApps: typeof listInstalledApps = listInstalledApps) {
  const app = new Crust('adbee')
    .meta({ description: metadata.description })
    .use(versionPlugin(metadata.version))
    .use(helpPlugin())

  return app.command(createAppsCommand(app, runListInstalledApps))
}
