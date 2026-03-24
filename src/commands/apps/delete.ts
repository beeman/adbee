import type { Crust } from '@crustjs/core'
import { CancelledError, confirm, multiselect, NonInteractiveError } from '@crustjs/prompts'
import { deleteInstalledApps, type InstalledApp, listInstalledApps } from '../../index.ts'

type CommandBuilder = Crust
const STOP_DELETE_FLOW_VALUE = '__adbee_stop_delete_flow__'

function createDeleteChoice({ label, packageName }: InstalledApp, includeLabels: boolean) {
  if (!includeLabels) {
    return packageName
  }

  return {
    hint: label && label !== packageName ? `(package: ${packageName})` : undefined,
    label: label ?? packageName,
    value: packageName,
  }
}

function formatSelectedApp({ label, packageName }: InstalledApp, includeLabels: boolean): string {
  if (!includeLabels || !label || label === packageName) {
    return packageName
  }

  return `${label} (package: ${packageName})`
}

function createStopDeleteChoice() {
  return {
    hint: '(exit without deleting anything)',
    label: 'Stop delete flow',
    value: STOP_DELETE_FLOW_VALUE,
  }
}

export function createAppsDeleteCommand(
  appsCommand: CommandBuilder,
  runListInstalledApps: typeof listInstalledApps = listInstalledApps,
  runDeleteInstalledApps: typeof deleteInstalledApps = deleteInstalledApps,
  runConfirm: typeof confirm = confirm,
  runMultiselect: typeof multiselect = multiselect,
) {
  return appsCommand
    .sub('delete')
    .meta({ description: 'Interactively uninstall apps from the connected device.' })
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

      try {
        const packageNames = await runMultiselect({
          choices: [...apps.map((app) => createDeleteChoice(app, flags.labels)), createStopDeleteChoice()],
          message: 'Select apps to delete from the connected device',
        })

        if (packageNames.length === 0) {
          return
        }

        if (packageNames.includes(STOP_DELETE_FLOW_VALUE)) {
          return
        }

        const selectedPackageNames = new Set(packageNames)
        const selectedApps = apps.filter(({ packageName }) => selectedPackageNames.has(packageName))
        const confirmed = await runConfirm({
          default: false,
          message: `Are you sure you want to delete ${selectedApps
            .map((app) => formatSelectedApp(app, flags.labels))
            .join(', ')}?`,
        })

        if (!confirmed) {
          return
        }

        await runDeleteInstalledApps(packageNames)

        console.table(
          selectedApps.map(({ label, packageName }) =>
            flags.labels ? { label: label ?? packageName, packageName } : { packageName },
          ),
          flags.labels ? ['packageName', 'label'] : ['packageName'],
        )
      } catch (error) {
        if (error instanceof CancelledError) {
          return
        }

        if (error instanceof NonInteractiveError) {
          throw new Error('apps delete requires an interactive terminal.')
        }

        throw error
      }
    })
}
