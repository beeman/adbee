import type { Crust } from '@crustjs/core'
import { listInstalledApps } from '../index.ts'
import { createAppsListCommand } from './apps/list.ts'

type CommandBuilder = Crust

export function createAppsCommand(
  app: CommandBuilder,
  runListInstalledApps: typeof listInstalledApps = listInstalledApps,
) {
  const appsCommand = app.sub('apps').meta({ description: 'Application commands.' })

  return appsCommand.command(createAppsListCommand(appsCommand, runListInstalledApps))
}
