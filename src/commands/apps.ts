import type { Crust } from '@crustjs/core'
import { confirm, multiselect } from '@crustjs/prompts'
import { deleteInstalledApps, listInstalledApps } from '../index.ts'
import { createAppsDeleteCommand } from './apps/delete.ts'
import { createAppsListCommand } from './apps/list.ts'

type CommandBuilder = Crust

export function createAppsCommand(
  app: CommandBuilder,
  runListInstalledApps: typeof listInstalledApps = listInstalledApps,
  runDeleteInstalledApps: typeof deleteInstalledApps = deleteInstalledApps,
  runConfirm: typeof confirm = confirm,
  runMultiselect: typeof multiselect = multiselect,
) {
  const appsCommand = app.sub('apps').meta({ description: 'Application commands.' })

  return appsCommand
    .command(
      createAppsDeleteCommand(appsCommand, runListInstalledApps, runDeleteInstalledApps, runConfirm, runMultiselect),
    )
    .command(createAppsListCommand(appsCommand, runListInstalledApps))
}
