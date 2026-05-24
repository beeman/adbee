import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { arch, homedir } from 'node:os'
import { basename, join } from 'node:path'

const FORMAT_NAME_SEGMENT_OVERRIDES = {
  api: 'API',
  apis: 'APIs',
  atd: 'ATD',
  tv: 'TV',
  xl: 'XL',
} as const
const AVAILABLE_AVD_DEVICE_DEFINITION_JAR_ENTRIES = [
  'com/android/sdklib/devices/automotive.xml',
  'com/android/sdklib/devices/desktop.xml',
  'com/android/sdklib/devices/devices.xml',
  'com/android/sdklib/devices/nexus.xml',
  'com/android/sdklib/devices/tv.xml',
  'com/android/sdklib/devices/wear.xml',
  'com/android/sdklib/devices/xr.xml',
] as const
const TAG_DISPLAY_OVERRIDES = {
  google_apis: 'Google APIs',
  google_apis_playstore: 'Google Play',
} as const
const PREFERRED_SYSTEM_IMAGE_TAGS = [
  'google_apis_playstore',
  'google_apis',
  'google_apis_playstore_ps16k',
  'google_apis_ps16k',
] as const

export const DEFAULT_DATA_SIZE = '32G'
export const DEFAULT_DEVICE = 'pixel_9_pro_xl'
export const DEFAULT_RAM_MB = 8192
export const DEFAULT_SDCARD_SIZE = '512M'
export const DEFAULT_SYSTEM_IMAGE = 'system-images;android-36;google_apis_playstore;arm64-v8a'
export const DEFAULT_SYSTEM_IMAGE_TAG = 'google_apis_playstore'
export const DEFAULT_VM_HEAP_MB = 576

interface DirectoryEntry {
  isDirectory(): boolean
  name: string
}

export interface CreateAvdOptions {
  dataSize?: string
  device?: string
  name?: string
  ramMb?: number
  sdkRoot?: string
  sdcardSize?: string
  systemImage?: string
  vmHeapMb?: number
}

export interface CreateAvdResult {
  avdName: string
  created: boolean
  emulatorPath: string
  sdkRoot: string
  systemImage: string
}

export interface AvailableAvdDevice {
  device: string
  name?: string
  oem?: string
  tag?: string
}

export interface AvailableAvdDeviceDetails extends AvailableAvdDevice {
  apiLevel?: string
  density?: string
  diagonalLength?: string
  playStore?: boolean
  resolution?: string
  screenRatio?: string
}

export interface InstalledAvd {
  device?: string
  name: string
  readOnly?: boolean
  target?: string
}

export interface InstallAvdPackagesOptions {
  abi?: string
  platform?: string
  sdkRoot?: string
  systemImage?: string
  tag?: string
}

export interface InstallAvdPackagesDependencies {
  runCommand?: CommandRunner
}

export interface InstallAvdPackagesResult {
  installedPackages: string[]
  platform: string
  systemImage: string
}

export interface RunningAvd {
  name: string
  serial: string
}

export interface RunCommandOptions {
  stdin?: string
}

export type CommandRunner = (cmd: [string, ...string[]], options?: RunCommandOptions) => Promise<string>
export type DirectoryReader = (directoryPath: string) => Promise<readonly DirectoryEntry[]>
export type FileReader = (filePath: string) => Promise<string>
export type FileWriter = (filePath: string, contents: string) => Promise<void>
export type HomeDirectoryResolver = () => string
export type PathChecker = (filePath: string) => Promise<boolean>

export interface CreateAvdDependencies {
  getHomeDirectory?: HomeDirectoryResolver
  pathExists?: PathChecker
  readDirectory?: DirectoryReader
  readTextFile?: FileReader
  runCommand?: CommandRunner
  writeTextFile?: FileWriter
}

interface ResolvedCreateAvdOptions {
  dataSize: string
  device: string
  name: string
  ramMb: number
  sdkRoot: string
  sdcardSize: string
  systemImage: string
  vmHeapMb: number
}

interface ParsedSystemImagePackage {
  abi: string
  platform: string
  tagId: string
}

interface BuildAvdConfigOverrides {
  deleteKeys?: readonly string[]
  deviceDetails?: AvailableAvdDeviceDetails
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1).toLowerCase()}`
}

function createAvdConfigValues(
  options: ResolvedCreateAvdOptions,
  deviceDetails?: AvailableAvdDeviceDetails,
): Record<string, string> {
  const { abi, platform, tagId } = parseSystemImagePackage(options.systemImage)
  const tagDisplay = getTagDisplay(tagId)
  const values = {
    'abi.type': abi,
    'avd.ini.displayname': options.name.replaceAll('_', ' '),
    'disk.dataPartition.size': options.dataSize,
    'fastboot.forceChosenSnapshotBoot': 'no',
    'fastboot.forceColdBoot': 'no',
    'fastboot.forceFastBoot': 'yes',
    'hw.audioInput': 'yes',
    'hw.camera.back': 'virtualscene',
    'hw.camera.front': 'emulated',
    'hw.cpu.arch': getCpuArchitecture(abi),
    'hw.cpu.ncore': '4',
    'hw.gpu.enabled': 'yes',
    'hw.gpu.mode': 'auto',
    'hw.keyboard': 'yes',
    'hw.ramSize': String(options.ramMb),
    'hw.sdCard': 'yes',
    'image.sysdir.1': `${systemImagePackageToRelativeDirectory(options.systemImage)}/`,
    'PlayStore.enabled': String(tagId.includes('play')),
    'runtime.network.latency': 'none',
    'runtime.network.speed': 'full',
    'sdcard.size': options.sdcardSize,
    showDeviceFrame: 'yes',
    'skin.dynamic': 'yes',
    'tag.display': tagDisplay,
    'tag.displaynames': tagDisplay,
    'tag.id': tagId,
    'tag.ids': tagId,
    target: platform,
    'userdata.useQcow2': 'no',
    'vm.heapSize': String(options.vmHeapMb),
  }

  if (deviceDetails) {
    Object.assign(values, createAvdDeviceConfigValues(deviceDetails))
  }

  return values
}

function createAvdDeviceConfigValues(deviceDetails: AvailableAvdDeviceDetails): Record<string, string> {
  const values: Record<string, string> = {
    'hw.device.name': deviceDetails.device,
  }
  const density = parseAvdDeviceDensity(deviceDetails.density)
  const resolution = parseAvdDeviceResolution(deviceDetails.resolution)

  if (density) {
    values['hw.lcd.density'] = density
  }

  if (deviceDetails.oem) {
    values['hw.device.manufacturer'] = deviceDetails.oem
  }

  if (deviceDetails.playStore !== undefined) {
    values['PlayStore.enabled'] = String(deviceDetails.playStore)
  }

  if (resolution) {
    values['hw.lcd.height'] = resolution.height
    values['hw.lcd.width'] = resolution.width
  }

  return values
}

async function defaultReadDirectory(directoryPath: string): Promise<readonly DirectoryEntry[]> {
  return readdir(directoryPath, { withFileTypes: true })
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return Bun.file(filePath).text()
}

async function defaultWriteTextFile(filePath: string, contents: string): Promise<void> {
  await Bun.write(filePath, contents)
}

function parseConfigValues(contents: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const separatorIndex = line.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 1)

    if (key) {
      values[key] = value
    }
  }

  return values
}

function extractXmlTagValue(contents: string, tagName: string): string | undefined {
  const match = contents.match(new RegExp(`<d:${tagName}>([\\s\\S]*?)<\\/d:${tagName}>`))

  if (!match?.[1]) {
    return undefined
  }

  return match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&quot;', '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAvailableAvdDevices(contents: string): AvailableAvdDevice[] {
  return contents
    .split(/^---------\s*$/m)
    .map((section) => section.trim())
    .filter(Boolean)
    .flatMap((section) => {
      const deviceMatch = section.match(/^id:\s+\d+\s+or\s+"([^"]+)"$/m)

      if (!deviceMatch?.[1]) {
        return []
      }

      const nameMatch = section.match(/^\s*Name:\s*(.+)$/m)
      const oemMatch = section.match(/^\s*OEM\s*:\s*(.+)$/m)
      const tagMatch = section.match(/^\s*Tag\s*:\s*(.+)$/m)

      return [
        {
          device: deviceMatch[1],
          name: nameMatch?.[1],
          oem: oemMatch?.[1],
          tag: tagMatch?.[1],
        },
      ]
    })
    .sort((left, right) => left.device.localeCompare(right.device))
}

function parseAvailableAvdDeviceDetails(contents: string): AvailableAvdDeviceDetails[] {
  return Array.from(contents.matchAll(/<d:device\b([^>]*)>([\s\S]*?)<\/d:device>/g))
    .flatMap(([, _attributes = '', deviceContents = '']) => {
      const name = extractXmlTagValue(deviceContents, 'name')

      if (!name) {
        return []
      }

      const device = extractXmlTagValue(deviceContents, 'id') ?? name
      const xDimension = extractXmlTagValue(deviceContents, 'x-dimension')
      const yDimension = extractXmlTagValue(deviceContents, 'y-dimension')

      return [
        {
          apiLevel: extractXmlTagValue(deviceContents, 'api-level'),
          density: extractXmlTagValue(deviceContents, 'pixel-density'),
          device,
          diagonalLength: extractXmlTagValue(deviceContents, 'diagonal-length'),
          name,
          oem: extractXmlTagValue(deviceContents, 'manufacturer'),
          playStore: extractXmlTagValue(deviceContents, 'playstore-enabled') === 'true' ? true : undefined,
          resolution: xDimension && yDimension ? `${xDimension}x${yDimension}` : undefined,
          screenRatio: extractXmlTagValue(deviceContents, 'screen-ratio'),
          tag: extractXmlTagValue(deviceContents, 'tag-id'),
        },
      ]
    })
    .sort((left, right) => left.device.localeCompare(right.device))
}

function parseAvdDeviceDensity(density: string | undefined): string | undefined {
  if (!density) {
    return undefined
  }

  const numericDensityMatch = density.match(/(\d+)/)

  if (numericDensityMatch?.[1]) {
    return numericDensityMatch[1]
  }

  const normalizedDensity = density.trim().toLowerCase()

  return {
    hdpi: '240',
    ldpi: '120',
    mdpi: '160',
    tvdpi: '213',
    xhdpi: '320',
    xxhdpi: '480',
    xxxhdpi: '640',
  }[normalizedDensity]
}

function parseAvdDeviceResolution(resolution: string | undefined): { height: string; width: string } | undefined {
  if (!resolution) {
    return undefined
  }

  const resolutionMatch = resolution.match(/^(\d+)x(\d+)$/)

  if (!resolutionMatch?.[1] || !resolutionMatch[2]) {
    return undefined
  }

  return {
    height: resolutionMatch[2],
    width: resolutionMatch[1],
  }
}

function parsePixelDeviceGeneration(device: string): number | undefined {
  const match = device.match(/^pixel_(\d+)/)

  if (!match?.[1]) {
    return undefined
  }

  return Number.parseInt(match[1], 10)
}

function formatDeviceName(device: string): string {
  return device
    .split('_')
    .filter(Boolean)
    .map((segment) => formatNameSegment(segment))
    .join('_')
}

function formatNameSegment(segment: string): string {
  const lowered = segment.toLowerCase()
  const override = FORMAT_NAME_SEGMENT_OVERRIDES[lowered as keyof typeof FORMAT_NAME_SEGMENT_OVERRIDES]

  if (override) {
    return override
  }

  const numericSuffixMatch = lowered.match(/^(\d+)([a-z]+)$/)

  if (numericSuffixMatch) {
    const [, numericPrefix, letterSuffix] = numericSuffixMatch

    if (numericPrefix && letterSuffix) {
      return `${numericPrefix}${letterSuffix.toUpperCase()}`
    }
  }

  return capitalize(segment)
}

function resolveCreatableAvdDevice(
  requestedDevice: string,
  availableDevices: readonly AvailableAvdDevice[],
): string | undefined {
  if (availableDevices.some(({ device }) => device === requestedDevice)) {
    return requestedDevice
  }

  return resolvePixelAvdDeviceFallback(requestedDevice, availableDevices)
}

function resolvePixelAvdDeviceFallback(
  requestedDevice: string,
  availableDevices: readonly AvailableAvdDevice[],
): string | undefined {
  const requestedMatch = requestedDevice.match(/^pixel_(\d+)(.*)$/)

  if (!requestedMatch?.[1]) {
    return undefined
  }

  const [, , suffix = ''] = requestedMatch
  const availablePixelDevices = availableDevices
    .map(({ device }) => ({
      device,
      generation: parsePixelDeviceGeneration(device),
    }))
    .filter(({ generation }) => generation !== undefined)
    .sort((left, right) => (right.generation as number) - (left.generation as number))

  const latestPixelGeneration = availablePixelDevices[0]?.generation

  if (latestPixelGeneration === undefined) {
    return undefined
  }

  const sameFamilyDevice = `pixel_${latestPixelGeneration}${suffix}`

  if (availablePixelDevices.some(({ device }) => device === sameFamilyDevice)) {
    return sameFamilyDevice
  }

  return availablePixelDevices.find(({ device }) => device.endsWith(suffix))?.device
}

function formatTagName(tagId: string): string {
  if (tagId === 'google_apis_playstore') {
    return 'Play'
  }

  if (tagId === 'google_apis_playstore_ps16k') {
    return 'Play_Ps16k'
  }

  return tagId
    .split(/[_-]/)
    .filter(Boolean)
    .map((segment) => formatNameSegment(segment))
    .join('_')
}

function getCpuArchitecture(abi: string): string {
  if (abi.startsWith('arm64')) {
    return 'arm64'
  }

  if (abi.startsWith('armeabi')) {
    return 'arm'
  }

  return abi.split('-', 1)[0] ?? abi
}

function getDefaultPathExists(mode: number = constants.F_OK): PathChecker {
  return async (filePath: string) => {
    try {
      await access(filePath, mode)

      return true
    } catch {
      return false
    }
  }
}

function getTagDisplay(tagId: string): string {
  const override = TAG_DISPLAY_OVERRIDES[tagId as keyof typeof TAG_DISPLAY_OVERRIDES]

  if (override) {
    return override
  }

  return tagId
    .split(/[_-]/)
    .filter(Boolean)
    .map((segment) => {
      const lowered = segment.toLowerCase()

      if (lowered === 'api') {
        return 'API'
      }

      if (lowered === 'apis') {
        return 'APIs'
      }

      if (lowered === 'atd') {
        return 'ATD'
      }

      if (lowered === 'playstore') {
        return 'Play Store'
      }

      return capitalize(segment)
    })
    .join(' ')
}

function getToolPaths(sdkRoot: string) {
  return {
    avdmanager: join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    emulator: join(sdkRoot, 'emulator', 'emulator'),
    sdkmanager: join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'),
  }
}

function getAvdDeviceDefinitionJarPaths(sdkRoot: string): string[] {
  return [
    join(sdkRoot, 'cmdline-tools', 'latest', 'lib', 'sdklib', 'sdklib.core.jar'),
    join(sdkRoot, 'cmdline-tools', 'latest', 'lib', 'sdklib', 'tools.sdklib.jar'),
  ]
}

function getAndroidStudioAvdDeviceDefinitionJarPaths(homeDirectory: string): string[] {
  return [
    '/Applications/Android Studio.app/Contents/plugins/android/lib/sdklib.jar',
    join(homeDirectory, 'Applications', 'Android Studio.app', 'Contents', 'plugins', 'android', 'lib', 'sdklib.jar'),
  ]
}

function getKnownAvdDeviceDefinitionJarPaths(sdkRoot: string, homeDirectory: string): string[] {
  return [...getAndroidStudioAvdDeviceDefinitionJarPaths(homeDirectory), ...getAvdDeviceDefinitionJarPaths(sdkRoot)]
}

function getAvdConfigPath(homeDirectory: string, avdName: string): string {
  return join(homeDirectory, '.android', 'avd', `${avdName}.avd`, 'config.ini')
}

async function listDirectoryNames(directoryPath: string, readDirectory: DirectoryReader): Promise<string[]> {
  try {
    return (await readDirectory(directoryPath))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

async function listEntryNames(directoryPath: string, readDirectory: DirectoryReader): Promise<string[]> {
  try {
    return (await readDirectory(directoryPath))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

async function isInstalledSystemImageDirectory(directoryPath: string, pathExists: PathChecker): Promise<boolean> {
  return pathExists(join(directoryPath, 'source.properties'))
}

async function runCommand(cmd: [string, ...string[]], options: RunCommandOptions = {}): Promise<string> {
  const process = Bun.spawn({
    cmd,
    stderr: 'pipe',
    stdin: options.stdin === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
  })

  if (options.stdin !== undefined) {
    const stdin = process.stdin

    if (!stdin) {
      throw new Error(`Failed to write to ${basename(cmd[0])} stdin.`)
    }

    stdin.write(options.stdin)
    stdin.end()
  }

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

function resolveCreateAvdOptions(
  options: CreateAvdOptions,
  homeDirectoryResolver: HomeDirectoryResolver,
): ResolvedCreateAvdOptions {
  return {
    dataSize: options.dataSize ?? DEFAULT_DATA_SIZE,
    device: options.device ?? DEFAULT_DEVICE,
    name:
      options.name ??
      deriveDefaultAvdName(options.device ?? DEFAULT_DEVICE, options.systemImage ?? DEFAULT_SYSTEM_IMAGE),
    ramMb: options.ramMb ?? DEFAULT_RAM_MB,
    sdcardSize: options.sdcardSize ?? DEFAULT_SDCARD_SIZE,
    sdkRoot: options.sdkRoot ?? resolveAndroidSdkRoot(process.env, homeDirectoryResolver()),
    systemImage: options.systemImage ?? DEFAULT_SYSTEM_IMAGE,
    vmHeapMb: options.vmHeapMb ?? DEFAULT_VM_HEAP_MB,
  }
}

export function buildAvdConfig(
  existingConfig: string,
  options: CreateAvdOptions,
  overrides: BuildAvdConfigOverrides = {},
): string {
  const resolvedOptions = resolveCreateAvdOptions(options, homedir)
  const mergedValues = parseConfigValues(existingConfig)

  for (const key of overrides.deleteKeys ?? []) {
    delete mergedValues[key]
  }

  Object.assign(mergedValues, createAvdConfigValues(resolvedOptions, overrides.deviceDetails))

  return `${Object.keys(mergedValues)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}=${mergedValues[key]}`)
    .join('\n')}\n`
}

function serializeConfigValues(values: Record<string, string>): string {
  return `${Object.keys(values)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}=${values[key]}`)
    .join('\n')}\n`
}

function formatRandomAvdNameSuffix(randomNumber: number): string {
  return String(Math.abs(Math.trunc(randomNumber)) % 100000).padStart(5, '0')
}

function compareStableAndroidPlatforms(left: string, right: string): number {
  const leftParts = parseStableAndroidPlatform(left) ?? []
  const rightParts = parseStableAndroidPlatform(right) ?? []
  const partCount = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return left.localeCompare(right)
}

function getDefaultSystemImageAbi(hostArchitecture: string = arch()): string {
  return hostArchitecture === 'arm64' ? 'arm64-v8a' : 'x86_64'
}

function getSystemImageTagRank(tag: string): number {
  const rank = PREFERRED_SYSTEM_IMAGE_TAGS.indexOf(tag as (typeof PREFERRED_SYSTEM_IMAGE_TAGS)[number])

  return rank === -1 ? PREFERRED_SYSTEM_IMAGE_TAGS.length : rank
}

function normalizeAndroidPlatform(platform: string): string {
  return platform.startsWith('android-') ? platform : `android-${platform}`
}

function parseSdkmanagerPackagePaths(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+\|/)[0]?.trim())
    .filter((packagePath): packagePath is string => Boolean(packagePath?.includes(';')))
}

function parseStableAndroidPlatform(platform: string): number[] | undefined {
  const match = /^android-(\d+(?:\.\d+)*)$/.exec(platform)

  return match?.[1]?.split('.').map(Number)
}

function resolveLatestStableSystemImage(
  systemImages: readonly string[],
  options: InstallAvdPackagesOptions = {},
): string {
  const abi = options.abi ?? getDefaultSystemImageAbi()
  const platform = options.platform ? normalizeAndroidPlatform(options.platform) : undefined
  const parsedSystemImages = systemImages.map((systemImage) => ({
    ...parseSystemImagePackage(systemImage),
    systemImage,
  }))
  const candidates = parsedSystemImages
    .filter((systemImage) => systemImage.abi === abi)
    .filter((systemImage) => !platform || systemImage.platform === platform)
    .filter((systemImage) => parseStableAndroidPlatform(systemImage.platform))
    .filter((systemImage) =>
      options.tag
        ? systemImage.tagId === options.tag
        : getSystemImageTagRank(systemImage.tagId) < PREFERRED_SYSTEM_IMAGE_TAGS.length,
    )
    .sort(
      (left, right) =>
        compareStableAndroidPlatforms(right.platform, left.platform) ||
        getSystemImageTagRank(left.tagId) - getSystemImageTagRank(right.tagId) ||
        left.systemImage.localeCompare(right.systemImage),
    )

  if (candidates[0]) {
    return candidates[0].systemImage
  }

  const filters = [
    `ABI "${abi}"`,
    platform ? `platform "${platform}"` : undefined,
    options.tag ? `tag "${options.tag}"` : undefined,
  ].filter(Boolean)

  throw new Error(`No latest stable system image package found for ${filters.join(', ')}.`)
}

export async function createOrUpdateAvd(
  options: CreateAvdOptions = {},
  dependencies: CreateAvdDependencies = {},
): Promise<CreateAvdResult> {
  const getHomeDirectory = dependencies.getHomeDirectory ?? homedir
  const pathExists = dependencies.pathExists ?? getDefaultPathExists()
  const readTextFile = dependencies.readTextFile ?? defaultReadTextFile
  const runCommandDependency = dependencies.runCommand ?? runCommand
  const writeTextFile = dependencies.writeTextFile ?? defaultWriteTextFile
  const resolvedOptions = resolveCreateAvdOptions(options, getHomeDirectory)
  const toolPaths = getToolPaths(resolvedOptions.sdkRoot)
  const { abi } = parseSystemImagePackage(resolvedOptions.systemImage)
  const systemImageDirectory = systemImagePackageToDirectory(resolvedOptions.sdkRoot, resolvedOptions.systemImage)
  let configOverrides: BuildAvdConfigOverrides = {}

  if (!(await isInstalledSystemImageDirectory(systemImageDirectory, pathExists))) {
    await runCommandDependency([toolPaths.sdkmanager, '--install', resolvedOptions.systemImage])
  }

  if (!(await isInstalledSystemImageDirectory(systemImageDirectory, pathExists))) {
    throw new Error(`System image is not installed: ${resolvedOptions.systemImage}`)
  }

  const avdDirectory = join(getHomeDirectory(), '.android', 'avd', `${resolvedOptions.name}.avd`)
  const avdConfigPath = join(avdDirectory, 'config.ini')
  let created = false

  if (!(await pathExists(avdDirectory))) {
    const availableAvdDevices = await listAvailableAvdDevices(resolvedOptions.sdkRoot, runCommandDependency)
    const requestedDeviceDetails = await getAvailableAvdDeviceDetails(resolvedOptions.device, resolvedOptions.sdkRoot, {
      getHomeDirectory,
      pathExists,
      runCommand: runCommandDependency,
    }).catch(() => undefined)
    const createdDevice =
      resolveCreatableAvdDevice(resolvedOptions.device, availableAvdDevices) ?? resolvedOptions.device

    configOverrides = {
      deleteKeys: createdDevice === resolvedOptions.device ? [] : ['hw.device.hash2', 'skin.name', 'skin.path'],
      deviceDetails: requestedDeviceDetails,
    }

    await runCommandDependency(
      [
        toolPaths.avdmanager,
        'create',
        'avd',
        '--abi',
        abi,
        '--device',
        createdDevice,
        '--force',
        '--name',
        resolvedOptions.name,
        '--package',
        resolvedOptions.systemImage,
        '--sdcard',
        resolvedOptions.sdcardSize,
      ],
      { stdin: 'no\n' },
    )
    created = true
  }

  if (!(await pathExists(avdDirectory))) {
    throw new Error(`AVD directory does not exist: ${avdDirectory}`)
  }

  const existingConfig = (await pathExists(avdConfigPath)) ? await readTextFile(avdConfigPath) : ''

  await writeTextFile(avdConfigPath, buildAvdConfig(existingConfig, resolvedOptions, configOverrides))

  return {
    avdName: resolvedOptions.name,
    created,
    emulatorPath: toolPaths.emulator,
    sdkRoot: resolvedOptions.sdkRoot,
    systemImage: resolvedOptions.systemImage,
  }
}

export async function deleteInstalledAvds(
  avdNames: readonly string[],
  sdkRoot: string = resolveAndroidSdkRoot(),
  runDeleteCommand: CommandRunner = runCommand,
): Promise<void> {
  const { avdmanager } = getToolPaths(sdkRoot)
  const results = await Promise.allSettled(
    avdNames.map((avdName) => runDeleteCommand([avdmanager, 'delete', 'avd', '--name', avdName])),
  )
  const failures = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return []
    }

    const message = result.reason instanceof Error ? result.reason.message : String(result.reason)

    return [`Failed to delete "${avdNames[index]}": ${message}`]
  })

  if (failures.length === 1) {
    throw new Error(failures[0] as string)
  }

  if (failures.length > 1) {
    throw new Error(`Some AVDs could not be deleted:\n- ${failures.join('\n- ')}`)
  }
}

export function deriveDefaultAvdName(
  device: string = DEFAULT_DEVICE,
  systemImage: string = DEFAULT_SYSTEM_IMAGE,
): string {
  const { platform, tagId } = parseSystemImagePackage(systemImage)
  const apiLevel = platform.startsWith('android-') ? platform.slice('android-'.length) : platform

  return [formatDeviceName(device), formatTagName(tagId), apiLevel].filter(Boolean).join('_')
}

export function resolveAvailableAvdName(
  name: string,
  existingAvdNames: readonly string[],
  randomNumberFactory: () => number = () => Math.floor(Math.random() * 100000),
): string {
  if (!existingAvdNames.includes(name)) {
    return name
  }

  const existingNameSet = new Set(existingAvdNames)
  let candidateName = name

  do {
    candidateName = `${name}_${formatRandomAvdNameSuffix(randomNumberFactory())}`
  } while (existingNameSet.has(candidateName))

  return candidateName
}

export async function installLatestAvdPackages(
  options: InstallAvdPackagesOptions = {},
  dependencies: InstallAvdPackagesDependencies = {},
): Promise<InstallAvdPackagesResult> {
  const runCommandDependency = dependencies.runCommand ?? runCommand
  const sdkRoot = options.sdkRoot ?? resolveAndroidSdkRoot()
  const resolvedSystemImage =
    options.systemImage ??
    resolveLatestStableSystemImage(await listAvailableSystemImages(sdkRoot, runCommandDependency), options)
  const { platform } = parseSystemImagePackage(resolvedSystemImage)
  const installedPackages = [`platforms;${platform}`, resolvedSystemImage].sort((left, right) =>
    left.localeCompare(right),
  )
  const { sdkmanager } = getToolPaths(sdkRoot)

  await runCommandDependency([sdkmanager, '--install', ...installedPackages])

  return {
    installedPackages,
    platform,
    systemImage: resolvedSystemImage,
  }
}

export async function listInstalledAvds(
  homeDirectory: string = homedir(),
  readDirectory: DirectoryReader = defaultReadDirectory,
  readTextFile: FileReader = defaultReadTextFile,
): Promise<InstalledAvd[]> {
  const avdRootDirectory = join(homeDirectory, '.android', 'avd')
  const avdEntryNames = await listEntryNames(avdRootDirectory, readDirectory)
  const registeredAvdNames = new Set(
    avdEntryNames.filter((name) => name.endsWith('.ini')).map((name) => name.slice(0, -'.ini'.length)),
  )
  const avdDirectoryNames = avdEntryNames.filter(
    (name) => name.endsWith('.avd') && registeredAvdNames.has(name.slice(0, -'.avd'.length)),
  )

  return Promise.all(
    avdDirectoryNames.map(async (directoryName) => {
      const configPath = join(avdRootDirectory, directoryName, 'config.ini')
      const name = directoryName.slice(0, -'.avd'.length)
      let configValues: Record<string, string> = {}

      try {
        configValues = parseConfigValues(await readTextFile(configPath))
      } catch {
        configValues = {}
      }

      return {
        device: configValues['hw.device.name'],
        name,
        readOnly: configValues['adbee.readOnly'] === '1' ? true : undefined,
        target: configValues.target,
      }
    }),
  )
}

function parseRunningAvdName(contents: string): string | undefined {
  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && value !== 'OK')
}

function parseRunningAvdSerials(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((line) => {
      if (line.startsWith('List of devices attached')) {
        return []
      }

      const [serial, state] = line.split(/\s+/, 3)

      if (!serial?.startsWith('emulator-') || state !== 'device') {
        return []
      }

      return [serial]
    })
    .sort((left, right) => left.localeCompare(right))
}

export async function getAvailableAvdDeviceDetails(
  device: string,
  sdkRoot: string,
  dependencies: CreateAvdDependencies = {},
): Promise<AvailableAvdDeviceDetails | undefined> {
  const details = await listAvailableAvdDeviceDetails(sdkRoot, dependencies)

  return details.find(({ device: availableDevice }) => availableDevice === device)
}

async function listAvailableAvdDeviceDetails(
  sdkRoot: string,
  dependencies: CreateAvdDependencies = {},
): Promise<AvailableAvdDeviceDetails[]> {
  const getHomeDirectory = dependencies.getHomeDirectory ?? homedir
  const pathExists = dependencies.pathExists ?? getDefaultPathExists()
  const runCommandDependency = dependencies.runCommand ?? runCommand
  const detailsByDevice = new Map<string, AvailableAvdDeviceDetails>()
  let foundJar = false

  for (const jarPath of getKnownAvdDeviceDefinitionJarPaths(sdkRoot, getHomeDirectory())) {
    if (!(await pathExists(jarPath))) {
      continue
    }

    foundJar = true

    for (const entryPath of AVAILABLE_AVD_DEVICE_DEFINITION_JAR_ENTRIES) {
      for (const details of parseAvailableAvdDeviceDetails(
        await runCommandDependency(['unzip', '-p', jarPath, entryPath]),
      )) {
        detailsByDevice.set(details.device, details)
      }
    }
  }

  if (!foundJar) {
    throw new Error(`AVD device definition jar does not exist under ${sdkRoot}`)
  }

  return [...detailsByDevice.values()].sort((left, right) => left.device.localeCompare(right.device))
}

export function filterLatestPixelAvdDevices(devices: readonly AvailableAvdDevice[]): AvailableAvdDevice[] {
  const latestPixelGeneration = devices.reduce<number | undefined>((latestGeneration, { device }) => {
    const generation = parsePixelDeviceGeneration(device)

    if (generation === undefined) {
      return latestGeneration
    }

    return latestGeneration === undefined ? generation : Math.max(latestGeneration, generation)
  }, undefined)

  if (latestPixelGeneration === undefined) {
    return [...devices].sort((left, right) => left.device.localeCompare(right.device))
  }

  return devices
    .filter(({ device }) => parsePixelDeviceGeneration(device) === latestPixelGeneration)
    .sort((left, right) => left.device.localeCompare(right.device))
}

export async function listAvailableAvdDevices(
  sdkRoot: string,
  runListCommand: CommandRunner = runCommand,
): Promise<AvailableAvdDevice[]> {
  const { avdmanager } = getToolPaths(sdkRoot)

  return parseAvailableAvdDevices(await runListCommand([avdmanager, 'list', 'device']))
}

export async function listKnownAvdDevices(
  sdkRoot: string,
  dependencies: CreateAvdDependencies = {},
): Promise<AvailableAvdDevice[]> {
  const runCommandDependency = dependencies.runCommand ?? runCommand

  try {
    const details = await listAvailableAvdDeviceDetails(sdkRoot, dependencies)

    if (details.length > 0) {
      return details
        .map(({ device, name, oem, tag }) => ({
          device,
          name,
          oem,
          tag,
        }))
        .sort((left, right) => left.device.localeCompare(right.device))
    }
  } catch {
    // Fall back to avdmanager when the local XML catalogs are unavailable.
  }

  return listAvailableAvdDevices(sdkRoot, runCommandDependency)
}

export async function listInstalledPlatforms(
  sdkRoot: string,
  readDirectory: DirectoryReader = defaultReadDirectory,
): Promise<string[]> {
  return listDirectoryNames(join(sdkRoot, 'platforms'), readDirectory)
}

export async function listAvailableSystemImages(
  sdkRoot: string,
  runListCommand: CommandRunner = runCommand,
): Promise<string[]> {
  const { sdkmanager } = getToolPaths(sdkRoot)

  return parseSdkmanagerPackagePaths(await runListCommand([sdkmanager, '--list']))
    .filter((packagePath) => packagePath.startsWith('system-images;'))
    .sort((left, right) => left.localeCompare(right))
}

export async function listRunningAvds(runAdbCommand: CommandRunner = runCommand): Promise<RunningAvd[]> {
  const serials = parseRunningAvdSerials(await runAdbCommand(['adb', 'devices']))
  const runningAvds = await Promise.all(
    serials.map(async (serial) => ({
      name: parseRunningAvdName(await runAdbCommand(['adb', '-s', serial, 'emu', 'avd', 'name'])) ?? serial,
      serial,
    })),
  )

  return runningAvds.sort(
    (left, right) => left.name.localeCompare(right.name) || left.serial.localeCompare(right.serial),
  )
}

export function resolveEmulatorPath(sdkRoot: string = resolveAndroidSdkRoot()): string {
  return getToolPaths(sdkRoot).emulator
}

export async function startAvd(emulatorPath: string, avdName: string): Promise<void> {
  const process = Bun.spawn({
    cmd: [emulatorPath, `@${avdName}`],
    detached: true,
    stderr: 'ignore',
    stdin: 'ignore',
    stdout: 'ignore',
  })

  process.unref()
}

export async function stopRunningAvd(serial: string, runAdbCommand: CommandRunner = runCommand): Promise<void> {
  await runAdbCommand(['adb', '-s', serial, 'emu', 'kill'])
}

export async function setAvdProperties(
  avdName: string,
  properties: Record<string, string>,
  dependencies: CreateAvdDependencies = {},
): Promise<void> {
  const getHomeDirectory = dependencies.getHomeDirectory ?? homedir
  const pathExists = dependencies.pathExists ?? getDefaultPathExists()
  const readTextFile = dependencies.readTextFile ?? defaultReadTextFile
  const writeTextFile = dependencies.writeTextFile ?? defaultWriteTextFile
  const configPath = getAvdConfigPath(getHomeDirectory(), avdName)

  if (!(await pathExists(configPath))) {
    throw new Error(`AVD config does not exist: ${configPath}`)
  }

  const configValues = parseConfigValues(await readTextFile(configPath))

  Object.assign(configValues, properties)

  await writeTextFile(configPath, serializeConfigValues(configValues))
}

export async function listInstalledSystemImages(
  sdkRoot: string,
  readDirectory: DirectoryReader = defaultReadDirectory,
  pathExists: PathChecker = getDefaultPathExists(),
): Promise<string[]> {
  const systemImagesDirectory = join(sdkRoot, 'system-images')
  const packages: string[] = []
  const platforms = await listDirectoryNames(systemImagesDirectory, readDirectory)

  for (const platform of platforms) {
    const platformDirectory = join(systemImagesDirectory, platform)
    const tags = await listDirectoryNames(platformDirectory, readDirectory)

    for (const tag of tags) {
      const tagDirectory = join(platformDirectory, tag)
      const abis = await listDirectoryNames(tagDirectory, readDirectory)

      for (const abi of abis) {
        if (await isInstalledSystemImageDirectory(join(tagDirectory, abi), pathExists)) {
          packages.push(['system-images', platform, tag, abi].join(';'))
        }
      }
    }
  }

  return packages.sort((left, right) => left.localeCompare(right))
}

export function parseSystemImagePackage(systemImage: string): ParsedSystemImagePackage {
  const [category, platform, tagId, abi] = systemImage.split(';')

  if (category !== 'system-images' || !platform || !tagId || !abi) {
    throw new Error(`Invalid system image package: ${systemImage}`)
  }

  return {
    abi,
    platform,
    tagId,
  }
}

export function resolveAndroidSdkRoot(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  return environment.ANDROID_SDK_ROOT ?? environment.ANDROID_HOME ?? join(homeDirectory, 'Library', 'Android', 'sdk')
}

export function systemImagePackageToDirectory(sdkRoot: string, systemImage: string): string {
  return join(sdkRoot, ...systemImage.split(';'))
}

export function systemImagePackageToRelativeDirectory(systemImage: string): string {
  return systemImage.split(';').join('/')
}
