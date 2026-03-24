import { constants } from 'node:fs'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const APPLICATION_LABEL_PATTERN = /^\s*application-label:'([^']+)'$/m
const APPLICATION_LABEL_FALLBACK_PATTERN = /^\s*application: label='([^']+)'/m
const LABEL_RESOLUTION_CONCURRENCY = 4
const LAUNCHABLE_ACTIVITY_LABEL_PATTERN = /^\s*launchable-activity: name='[^']+' label='([^']*)'/m
const PACKAGE_LINE_PREFIX = 'package:'

let cachedAaptCommandPromise: Promise<string | null> | null = null

export interface InstalledApp {
  packageName: string
  label?: string
}

export interface ListInstalledAppsOptions {
  all?: boolean
  labels?: boolean
}

function compareApps(left: InstalledApp, right: InstalledApp): number {
  return left.packageName.localeCompare(right.packageName)
}

async function canExecute(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK)

    return true
  } catch {
    return false
  }
}

async function findAaptCommand(): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? '').split(':').filter(Boolean)

  for (const pathEntry of pathEntries) {
    const candidate = join(pathEntry, 'aapt')

    if (await canExecute(candidate)) {
      return candidate
    }
  }

  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Android/sdk'),
    join(homedir(), 'Library/Android/sdk'),
  ]
    .filter((sdkRoot): sdkRoot is string => Boolean(sdkRoot))
    .sort((left, right) => left.localeCompare(right))

  for (const sdkRoot of sdkRoots) {
    const buildToolsDirectory = join(sdkRoot, 'build-tools')
    let versions: string[] = []

    try {
      versions = (await readdir(buildToolsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, {
            numeric: true,
            sensitivity: 'base',
          }),
        )
    } catch {
      continue
    }

    for (const version of versions) {
      const candidate = join(buildToolsDirectory, version, 'aapt')

      if (await canExecute(candidate)) {
        return candidate
      }
    }
  }

  return null
}

async function getAaptCommand(): Promise<string | null> {
  cachedAaptCommandPromise ??= findAaptCommand()

  return cachedAaptCommandPromise
}

async function runCommand(cmd: [string, ...string[]]): Promise<string> {
  const process = Bun.spawn({
    cmd,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `${basename(cmd[0])} exited with code ${exitCode}`)
  }

  return stdout
}

async function resolveAppLabel(aaptCommand: string | null, packageName: string, packagePath: string): Promise<string> {
  if (!aaptCommand) {
    return packageName
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'adbee-'))
  const apkPath = join(temporaryDirectory, basename(packagePath) || `${packageName}.apk`)

  try {
    await runCommand(['adb', 'pull', '-a', packagePath, apkPath])

    return parseResolvedLabel(await runCommand([aaptCommand, 'dump', 'badging', apkPath]), packageName)
  } catch {
    return packageName
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex

      nextIndex += 1
      results[index] = await mapper(items[index] as T)
    }
  })

  await Promise.all(workers)

  return results
}

export async function listInstalledApps(options: ListInstalledAppsOptions = {}): Promise<InstalledApp[]> {
  const packageNames = options.all
    ? parseInstalledPackageNames(await runCommand(['adb', 'shell', 'pm', 'list', 'packages']))
    : parseRunnablePackageNames(
        await runCommand([
          'adb',
          'shell',
          'cmd',
          'package',
          'query-activities',
          '--components',
          '-a',
          'android.intent.action.MAIN',
          '-c',
          'android.intent.category.LAUNCHER',
        ]),
      )

  if (!options.labels) {
    return packageNames.map((packageName) => ({ packageName }))
  }

  const packagePaths = parsePackagePaths(await runCommand(['adb', 'shell', 'pm', 'list', 'packages', '-f']))
  const aaptCommand = await getAaptCommand()
  const apps = await mapWithConcurrency(
    packageNames.filter((packageName) => packagePaths.has(packageName)),
    LABEL_RESOLUTION_CONCURRENCY,
    async (packageName) => ({
      label: await resolveAppLabel(aaptCommand, packageName, packagePaths.get(packageName) as string),
      packageName,
    }),
  )

  return apps.sort(compareApps)
}

export function parseInstalledPackageNames(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith(PACKAGE_LINE_PREFIX))
    .map((value) => value.slice(PACKAGE_LINE_PREFIX.length))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

export function parsePackagePaths(stdout: string): Map<string, string> {
  const packagePaths = new Map<string, string>()

  for (const line of stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (!line.startsWith(PACKAGE_LINE_PREFIX)) {
      continue
    }

    const packageEntry = line.slice(PACKAGE_LINE_PREFIX.length)
    const separatorIndex = packageEntry.lastIndexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const packagePath = packageEntry.slice(0, separatorIndex)
    const packageName = packageEntry.slice(separatorIndex + 1)

    if (packageName && packagePath) {
      packagePaths.set(packageName, packagePath)
    }
  }

  return packagePaths
}

export function parseResolvedLabel(stdout: string, packageName: string): string {
  const launchableLabel = stdout.match(LAUNCHABLE_ACTIVITY_LABEL_PATTERN)?.[1]?.trim()

  if (launchableLabel) {
    return launchableLabel
  }

  const applicationLabel =
    stdout.match(APPLICATION_LABEL_PATTERN)?.[1]?.trim() ??
    stdout.match(APPLICATION_LABEL_FALLBACK_PATTERN)?.[1]?.trim()

  return applicationLabel || packageName
}

export function parseRunnablePackageNames(stdout: string): string[] {
  const packageNames = new Set<string>()

  for (const value of stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('/'))) {
    const packageName = value.split('/', 1)[0]

    if (packageName) {
      packageNames.add(packageName)
    }
  }

  return Array.from(packageNames).sort((left, right) => left.localeCompare(right))
}
