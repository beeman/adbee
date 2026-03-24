import { expect, test } from 'bun:test'
import {
  CancelledError,
  type ConfirmOptions,
  type confirm,
  type MultiselectOptions,
  type multiselect,
  NonInteractiveError,
} from '@crustjs/prompts'
import { createApp } from '../src/app.ts'
import {
  deleteInstalledApps,
  type InstalledApp,
  type ListInstalledAppsOptions,
  parseInstalledPackageNames,
  parsePackagePaths,
  parseResolvedLabel,
  parseRunnablePackageNames,
} from '../src/index.ts'

const TEST_PACKAGE_MANIFEST = {
  description: 'Convenience CLI for Android Debug Bridge (adb).',
  version: '0.0.0',
}
const STOP_DELETE_FLOW_VALUE = '__adbee_stop_delete_flow__'

interface ExecutionResult {
  errors: string[]
  exitCode: number | undefined
  logs: string[]
  tables: Array<Array<Record<string, string>>>
}

async function executeCli(
  argv: string[],
  runListInstalledApps: (options?: ListInstalledAppsOptions) => Promise<InstalledApp[]>,
  runDeleteInstalledApps: typeof deleteInstalledApps = async () => {},
  runConfirm: typeof confirm = async () => true,
  runMultiselect: typeof multiselect = async () => [],
): Promise<ExecutionResult> {
  const errors: string[] = []
  const logs: string[] = []
  const tables: Array<Array<Record<string, string>>> = []
  const originalError = console.error
  const originalExitCode = process.exitCode ?? 0
  const originalLog = console.log
  const originalTable = console.table

  process.exitCode = undefined
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  console.table = (tabularData: unknown) => {
    tables.push(tabularData as Array<Record<string, string>>)
  }

  try {
    await createApp(
      TEST_PACKAGE_MANIFEST,
      runListInstalledApps,
      runDeleteInstalledApps,
      runConfirm,
      runMultiselect,
    ).execute({
      argv,
    })

    return {
      errors,
      exitCode: process.exitCode,
      logs,
      tables,
    }
  } finally {
    console.error = originalError
    console.log = originalLog
    console.table = originalTable
    process.exitCode = originalExitCode
  }
}

test('parseInstalledPackageNames extracts and sorts package IDs', () => {
  expect(
    parseInstalledPackageNames(`
      package:z.last
      package:a.first
    `),
  ).toEqual(['a.first', 'z.last'])
})

test('parsePackagePaths extracts package IDs and APK paths', () => {
  expect(
    parsePackagePaths(`
      package:/data/app/~~abc123==/Chrome.apk=com.android.chrome
      package:/system/app/Settings.apk=com.android.settings
    `),
  ).toEqual(
    new Map([
      ['com.android.chrome', '/data/app/~~abc123==/Chrome.apk'],
      ['com.android.settings', '/system/app/Settings.apk'],
    ]),
  )
})

test('parseRunnablePackageNames deduplicates and sorts runnable packages', () => {
  expect(
    parseRunnablePackageNames(`
      com.android.settings/.Settings
      host.exp.exponent/.experience.HomeActivity
      com.android.settings/.SubSettings
    `),
  ).toEqual(['com.android.settings', 'host.exp.exponent'])
})

test('parseResolvedLabel prefers launchable labels and falls back to application labels', () => {
  expect(
    parseResolvedLabel(
      `
        application-label:'App'
        launchable-activity: name='com.example.MainActivity' label='Launchable App' icon=''
      `,
      'com.example.app',
    ),
  ).toBe('Launchable App')
  expect(
    parseResolvedLabel(
      `
        application-label:'Application Only'
      `,
      'com.example.app',
    ),
  ).toBe('Application Only')
})

test('apps list prints package IDs in a table by default', async () => {
  const result = await executeCli(['apps', 'list'], async () => [
    {
      packageName: 'com.android.chrome',
    },
    {
      packageName: 'com.android.settings',
    },
  ])

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([[{ packageName: 'com.android.chrome' }, { packageName: 'com.android.settings' }]])
})

test('apps list prints labels only when requested', async () => {
  const result = await executeCli(['apps', 'list', '--labels'], async () => [
    {
      label: 'Chrome',
      packageName: 'com.android.chrome',
    },
  ])

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        label: 'Chrome',
        packageName: 'com.android.chrome',
      },
    ],
  ])
})

test('apps list passes flags through to the data layer', async () => {
  let receivedOptions: ListInstalledAppsOptions | undefined

  const result = await executeCli(['apps', 'list', '--all', '--labels'], async (options?: ListInstalledAppsOptions) => {
    receivedOptions = options

    return []
  })

  expect(receivedOptions).toEqual({ all: true, labels: true })
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})

test('apps list surfaces adb failures', async () => {
  const result = await executeCli(['apps', 'list'], async () => {
    throw new Error('adb: no devices/emulators found')
  })

  expect(result.errors).toEqual(['Error: adb: no devices/emulators found'])
  expect(result.exitCode).toBe(1)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})

test('deleteInstalledApps attempts every uninstall and reports all failures together', async () => {
  const commands: string[][] = []
  await expect(
    deleteInstalledApps(['com.android.chrome', 'com.android.contacts', 'com.android.settings'], async (cmd) => {
      commands.push(cmd)

      const packageName = cmd[2]

      if (packageName === 'com.android.chrome') {
        return 'Success'
      }

      throw new Error(`Failure [${packageName}]`)
    }),
  ).rejects.toThrow(
    'Some apps could not be uninstalled:\n- Failed to uninstall "com.android.contacts": Failure [com.android.contacts]\n- Failed to uninstall "com.android.settings": Failure [com.android.settings]',
  )

  expect(commands).toEqual([
    ['adb', 'uninstall', 'com.android.chrome'],
    ['adb', 'uninstall', 'com.android.contacts'],
    ['adb', 'uninstall', 'com.android.settings'],
  ])
})

test('apps delete prompts with package IDs by default and deletes the selected apps', async () => {
  let receivedConfirmOptions: ConfirmOptions | undefined
  let receivedChoices: MultiselectOptions<string>['choices'] | undefined
  let receivedPackageNames: readonly string[] | undefined

  const result = await executeCli(
    ['apps', 'delete'],
    async () => [
      {
        packageName: 'com.android.chrome',
      },
      {
        packageName: 'com.android.settings',
      },
    ],
    async (packageNames) => {
      receivedPackageNames = packageNames
    },
    async (options) => {
      receivedConfirmOptions = options

      return true
    },
    async <T>(options: MultiselectOptions<T>) => {
      receivedChoices = options.choices as MultiselectOptions<string>['choices']

      return ['com.android.settings'] as unknown as T[]
    },
  )

  expect(receivedChoices).toEqual([
    'com.android.chrome',
    'com.android.settings',
    {
      hint: '(exit without deleting anything)',
      label: 'Stop delete flow',
      value: STOP_DELETE_FLOW_VALUE,
    },
  ])
  expect(receivedConfirmOptions).toEqual({
    default: false,
    message: 'Are you sure you want to delete com.android.settings?',
  })
  expect(receivedPackageNames).toEqual(['com.android.settings'])
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([[{ packageName: 'com.android.settings' }]])
})

test('apps delete passes flags through to the list layer and shows labels in the prompt', async () => {
  let receivedConfirmOptions: ConfirmOptions | undefined
  let receivedChoices: MultiselectOptions<string>['choices'] | undefined
  let receivedOptions: ListInstalledAppsOptions | undefined
  let receivedPackageNames: readonly string[] | undefined

  const result = await executeCli(
    ['apps', 'delete', '--all', '--labels'],
    async (options?: ListInstalledAppsOptions) => {
      receivedOptions = options

      return [
        {
          label: 'Chrome',
          packageName: 'com.android.chrome',
        },
        {
          label: 'Settings',
          packageName: 'com.android.settings',
        },
      ]
    },
    async (packageNames) => {
      receivedPackageNames = packageNames
    },
    async (options) => {
      receivedConfirmOptions = options

      return true
    },
    async <T>(options: MultiselectOptions<T>) => {
      receivedChoices = options.choices as MultiselectOptions<string>['choices']

      return ['com.android.chrome'] as unknown as T[]
    },
  )

  expect(receivedChoices).toEqual([
    {
      hint: '(package: com.android.chrome)',
      label: 'Chrome',
      value: 'com.android.chrome',
    },
    {
      hint: '(package: com.android.settings)',
      label: 'Settings',
      value: 'com.android.settings',
    },
    {
      hint: '(exit without deleting anything)',
      label: 'Stop delete flow',
      value: STOP_DELETE_FLOW_VALUE,
    },
  ])
  expect(receivedConfirmOptions).toEqual({
    default: false,
    message: 'Are you sure you want to delete Chrome (package: com.android.chrome)?',
  })
  expect(receivedOptions).toEqual({ all: true, labels: true })
  expect(receivedPackageNames).toEqual(['com.android.chrome'])
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        label: 'Chrome',
        packageName: 'com.android.chrome',
      },
    ],
  ])
})

test('apps delete does nothing when no packages are selected', async () => {
  let confirmCalls = 0
  let deleteCalls = 0

  const result = await executeCli(
    ['apps', 'delete'],
    async () => [
      {
        packageName: 'com.android.chrome',
      },
    ],
    async () => {
      deleteCalls += 1
    },
    async () => {
      confirmCalls += 1

      return true
    },
    async () => [],
  )

  expect(confirmCalls).toBe(0)
  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})

test('apps delete exits when the stop option is selected', async () => {
  let confirmCalls = 0
  let deleteCalls = 0

  const result = await executeCli(
    ['apps', 'delete'],
    async () => [
      {
        packageName: 'com.android.chrome',
      },
    ],
    async () => {
      deleteCalls += 1
    },
    async () => {
      confirmCalls += 1

      return true
    },
    async <T>() => [STOP_DELETE_FLOW_VALUE] as unknown as T[],
  )

  expect(confirmCalls).toBe(0)
  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})

test('apps delete ignores prompt cancellation', async () => {
  let deleteCalls = 0

  const result = await executeCli(
    ['apps', 'delete'],
    async () => [
      {
        packageName: 'com.android.chrome',
      },
    ],
    async () => {
      deleteCalls += 1
    },
    async () => true,
    async () => {
      throw new CancelledError()
    },
  )

  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})

test('apps delete does nothing when the confirmation is declined', async () => {
  let deleteCalls = 0

  const result = await executeCli(
    ['apps', 'delete'],
    async () => [
      {
        packageName: 'com.android.chrome',
      },
    ],
    async () => {
      deleteCalls += 1
    },
    async () => false,
    async <T>() => ['com.android.chrome'] as unknown as T[],
  )

  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})

test('apps delete requires an interactive terminal', async () => {
  const result = await executeCli(
    ['apps', 'delete'],
    async () => [
      {
        packageName: 'com.android.chrome',
      },
    ],
    async () => {},
    async () => {
      throw new NonInteractiveError()
    },
    async <T>() => ['com.android.chrome'] as unknown as T[],
  )

  expect(result.errors).toEqual(['Error: apps delete requires an interactive terminal.'])
  expect(result.exitCode).toBe(1)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})

test('apps delete surfaces uninstall failures', async () => {
  const result = await executeCli(
    ['apps', 'delete'],
    async () => [
      {
        packageName: 'com.android.chrome',
      },
    ],
    async () => {
      throw new Error('adb: uninstall failed')
    },
    async () => true,
    async <T>() => ['com.android.chrome'] as unknown as T[],
  )

  expect(result.errors).toEqual(['Error: adb: uninstall failed'])
  expect(result.exitCode).toBe(1)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([])
})
