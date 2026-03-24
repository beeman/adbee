import { expect, test } from 'bun:test'
import { createApp } from '../src/app.ts'
import {
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

interface ExecutionResult {
  errors: string[]
  exitCode: number | undefined
  logs: string[]
  tables: Array<Array<Record<string, string>>>
}

async function executeCli(
  argv: string[],
  runListInstalledApps: (options?: ListInstalledAppsOptions) => Promise<InstalledApp[]>,
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
    await createApp(TEST_PACKAGE_MANIFEST, runListInstalledApps).execute({
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
