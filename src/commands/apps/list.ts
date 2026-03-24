import type { Crust } from '@crustjs/core'
import { listInstalledApps } from '../../index.ts'

type CommandBuilder = Crust

export function createAppsListCommand(
  appsCommand: CommandBuilder,
  runListInstalledApps: typeof listInstalledApps = listInstalledApps,
) {
  return appsCommand
    .sub('list')
    .meta({ description: 'List runnable app package IDs by default, or every installed package with --all.' })
    .flags({
      all: {
        default: false,
        description: 'Show all installed packages instead of only runnable apps.',
        type: 'boolean',
      },
      labels: {
        default: false,
        description: 'Resolve and show human-readable labels.',
        type: 'boolean',
      },
    })
    .run(async ({ flags }) => {
      const apps = await runListInstalledApps({
        all: flags.all,
        labels: flags.labels,
      })

      if (apps.length === 0) {
        return
      }

      console.table(
        apps.map(({ label, packageName }) =>
          flags.labels ? { label: label ?? packageName, packageName } : { packageName },
        ),
        flags.labels ? ['packageName', 'label'] : ['packageName'],
      )
    })
}
