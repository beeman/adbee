import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CancelledError,
  type ConfirmOptions,
  type FilterOptions,
  type InputOptions,
  type MultiselectOptions,
  NonInteractiveError,
  type SelectOptions,
} from '@crustjs/prompts'
import { createApp } from '../src/app.ts'
import {
  type AvailableAvdDevice,
  type AvailableAvdDeviceDetails,
  buildAvdConfig,
  type CreateAvdOptions,
  createOrUpdateAvd,
  DEFAULT_DATA_SIZE,
  DEFAULT_DEVICE,
  DEFAULT_RAM_MB,
  DEFAULT_SDCARD_SIZE,
  DEFAULT_SYSTEM_IMAGE,
  DEFAULT_VM_HEAP_MB,
  deleteInstalledAvds,
  deriveDefaultAvdName,
  filterLatestPixelAvdDevices,
  getAvailableAvdDeviceDetails,
  listAvailableAvdDevices,
  listInstalledAvds,
  listInstalledPlatforms,
  listInstalledSystemImages,
  listKnownAvdDevices,
  resolveAndroidSdkRoot,
  resolveAvailableAvdName,
  setAvdProperties,
  type startAvd,
  systemImagePackageToDirectory,
} from '../src/avd.ts'
import type { CreateAvdCommandDependencies } from '../src/commands/avd.ts'

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

async function createTemporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function executeCli(
  argv: string[],
  avdDependencies: CreateAvdCommandDependencies = {},
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
      async () => [],
      async () => {},
      async () => true,
      async () => [],
      avdDependencies,
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

test('resolveAndroidSdkRoot prefers ANDROID_SDK_ROOT, then ANDROID_HOME, then the default path', () => {
  expect(
    resolveAndroidSdkRoot(
      {
        ANDROID_HOME: '/sdk/from-home',
        ANDROID_SDK_ROOT: '/sdk/from-root',
      },
      '/Users/example',
    ),
  ).toBe('/sdk/from-root')
  expect(
    resolveAndroidSdkRoot(
      {
        ANDROID_HOME: '/sdk/from-home',
      },
      '/Users/example',
    ),
  ).toBe('/sdk/from-home')
  expect(resolveAndroidSdkRoot({}, '/Users/example')).toBe('/Users/example/Library/Android/sdk')
})

test('listInstalledSystemImages discovers installed packages and sorts them alphabetically', async () => {
  const rootDirectory = await createTemporaryDirectory('adbee-avd-images-')

  try {
    await mkdir(join(rootDirectory, 'system-images', 'android-36', 'google_apis_playstore', 'arm64-v8a'), {
      recursive: true,
    })
    await mkdir(join(rootDirectory, 'system-images', 'android-35', 'google_apis', 'x86_64'), {
      recursive: true,
    })

    expect(await listInstalledSystemImages(rootDirectory)).toEqual([
      'system-images;android-35;google_apis;x86_64',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
    ])
  } finally {
    await rm(rootDirectory, { force: true, recursive: true })
  }
})

test('listInstalledPlatforms discovers installed SDK platforms and sorts them alphabetically', async () => {
  const rootDirectory = await createTemporaryDirectory('adbee-platforms-')

  try {
    await mkdir(join(rootDirectory, 'platforms', 'android-36'), { recursive: true })
    await mkdir(join(rootDirectory, 'platforms', 'android-34'), { recursive: true })
    await mkdir(join(rootDirectory, 'platforms', 'android-CinnamonBun'), { recursive: true })

    expect(await listInstalledPlatforms(rootDirectory)).toEqual(['android-34', 'android-36', 'android-CinnamonBun'])
  } finally {
    await rm(rootDirectory, { force: true, recursive: true })
  }
})

test('listInstalledAvds discovers installed AVDs and sorts them alphabetically', async () => {
  const homeDirectory = await createTemporaryDirectory('adbee-avd-list-')

  try {
    await mkdir(join(homeDirectory, '.android', 'avd', 'Zed.avd'), { recursive: true })
    await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
    await Bun.write(
      join(homeDirectory, '.android', 'avd', 'Zed.avd', 'config.ini'),
      'hw.device.name=pixel_9_pro_xl\ntarget=android-36\n',
    )
    await Bun.write(
      join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini'),
      'adbee.readOnly=1\nhw.device.name=pixel_8_pro\ntarget=android-35\n',
    )

    expect(await listInstalledAvds(homeDirectory)).toEqual([
      {
        device: 'pixel_8_pro',
        name: 'Alpha',
        readOnly: true,
        target: 'android-35',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Zed',
        target: 'android-36',
      },
    ])
  } finally {
    await rm(homeDirectory, { force: true, recursive: true })
  }
})

test('listAvailableAvdDevices parses and sorts available device definitions', async () => {
  const devices = await listAvailableAvdDevices(
    '/sdk',
    async () => `
Available devices definitions:
id: 49 or "pixel_9_pro_xl"
    Name: Pixel 9 Pro XL
    OEM : Google
---------
id: 10 or "Galaxy Nexus"
    Name: Galaxy Nexus
    OEM : Google
---------
id: 11 or "desktop_large"
    Name: Large Desktop
    OEM : Google
    Tag : android-desktop
---------
`,
  )

  expect(devices).toEqual([
    {
      device: 'desktop_large',
      name: 'Large Desktop',
      oem: 'Google',
      tag: 'android-desktop',
    },
    {
      device: 'Galaxy Nexus',
      name: 'Galaxy Nexus',
      oem: 'Google',
      tag: undefined,
    },
    {
      device: 'pixel_9_pro_xl',
      name: 'Pixel 9 Pro XL',
      oem: 'Google',
      tag: undefined,
    },
  ])
})

test('listKnownAvdDevices falls back to Android Studio definitions when they are newer than the SDK jars', async () => {
  const studioJarPath = '/Users/example/Applications/Android Studio.app/Contents/plugins/android/lib/sdklib.jar'
  const sdkJarPath = '/sdk/cmdline-tools/latest/lib/sdklib/tools.sdklib.jar'
  const emptyDevicesXml = `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
</d:devices>
`
  const devices = await listKnownAvdDevices('/sdk', {
    getHomeDirectory: () => '/Users/example',
    pathExists: async (filePath) => filePath === sdkJarPath || filePath === studioJarPath,
    runCommand: async (cmd) => {
      const jarPath = cmd[2]
      const entryPath = cmd[3]

      if (entryPath !== 'com/android/sdklib/devices/nexus.xml') {
        return emptyDevicesXml
      }

      if (jarPath === sdkJarPath) {
        return `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
  <d:device>
    <d:name>Pixel 9 Pro XL</d:name>
    <d:id>pixel_9_pro_xl</d:id>
    <d:manufacturer>Google</d:manufacturer>
  </d:device>
</d:devices>
`
      }

      return `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
  <d:device>
    <d:name>Pixel 10</d:name>
    <d:id>pixel_10</d:id>
    <d:manufacturer>Google</d:manufacturer>
  </d:device>
  <d:device>
    <d:name>Pixel 10 Pro XL</d:name>
    <d:id>pixel_10_pro_xl</d:id>
    <d:manufacturer>Google</d:manufacturer>
  </d:device>
</d:devices>
`
    },
  })

  expect(devices).toEqual([
    {
      device: 'pixel_10',
      name: 'Pixel 10',
      oem: 'Google',
      tag: undefined,
    },
    {
      device: 'pixel_10_pro_xl',
      name: 'Pixel 10 Pro XL',
      oem: 'Google',
      tag: undefined,
    },
    {
      device: 'pixel_9_pro_xl',
      name: 'Pixel 9 Pro XL',
      oem: 'Google',
      tag: undefined,
    },
  ])
})

test('getAvailableAvdDeviceDetails reads device metadata from the SDK definitions', async () => {
  const details = await getAvailableAvdDeviceDetails('pixel_9_pro_xl', '/sdk', {
    pathExists: async (filePath) => filePath === '/sdk/cmdline-tools/latest/lib/sdklib/tools.sdklib.jar',
    runCommand: async (cmd) => {
      const entryPath = cmd[3]

      if (entryPath !== 'com/android/sdklib/devices/nexus.xml') {
        return ''
      }

      return `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
  <d:device>
    <d:name>Pixel 9 Pro XL</d:name>
    <d:id>pixel_9_pro_xl</d:id>
    <d:manufacturer>Google</d:manufacturer>
    <d:playstore-enabled>true</d:playstore-enabled>
    <d:hardware>
      <d:screen>
        <d:diagonal-length>6.8</d:diagonal-length>
        <d:pixel-density>xxhdpi</d:pixel-density>
        <d:screen-ratio>long</d:screen-ratio>
        <d:dimensions>
          <d:x-dimension>1344</d:x-dimension>
          <d:y-dimension>2992</d:y-dimension>
        </d:dimensions>
      </d:screen>
    </d:hardware>
    <d:software>
      <d:api-level>35-</d:api-level>
    </d:software>
  </d:device>
</d:devices>
`
    },
  })

  expect(details).toEqual({
    apiLevel: '35-',
    density: 'xxhdpi',
    device: 'pixel_9_pro_xl',
    diagonalLength: '6.8',
    name: 'Pixel 9 Pro XL',
    oem: 'Google',
    playStore: true,
    resolution: '1344x2992',
    screenRatio: 'long',
    tag: undefined,
  })
})

test('getAvailableAvdDeviceDetails falls back to Android Studio definitions when the SDK jars are stale', async () => {
  const studioJarPath = '/Users/example/Applications/Android Studio.app/Contents/plugins/android/lib/sdklib.jar'
  const sdkJarPath = '/sdk/cmdline-tools/latest/lib/sdklib/tools.sdklib.jar'
  const emptyDevicesXml = `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
</d:devices>
`
  const details = await getAvailableAvdDeviceDetails('pixel_10_pro_xl', '/sdk', {
    getHomeDirectory: () => '/Users/example',
    pathExists: async (filePath) => filePath === sdkJarPath || filePath === studioJarPath,
    runCommand: async (cmd) => {
      const jarPath = cmd[2]
      const entryPath = cmd[3]

      if (entryPath !== 'com/android/sdklib/devices/nexus.xml') {
        return emptyDevicesXml
      }

      if (jarPath === sdkJarPath) {
        return `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
  <d:device>
    <d:name>Pixel 9 Pro XL</d:name>
    <d:id>pixel_9_pro_xl</d:id>
    <d:manufacturer>Google</d:manufacturer>
  </d:device>
</d:devices>
`
      }

      return `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
  <d:device>
    <d:name>Pixel 10 Pro XL</d:name>
    <d:id>pixel_10_pro_xl</d:id>
    <d:manufacturer>Google</d:manufacturer>
    <d:playstore-enabled>true</d:playstore-enabled>
    <d:hardware>
      <d:screen>
        <d:diagonal-length>6.8</d:diagonal-length>
        <d:pixel-density>480dpi</d:pixel-density>
        <d:screen-ratio>long</d:screen-ratio>
        <d:dimensions>
          <d:x-dimension>1344</d:x-dimension>
          <d:y-dimension>2992</d:y-dimension>
        </d:dimensions>
      </d:screen>
    </d:hardware>
    <d:software>
      <d:api-level>36.1-</d:api-level>
    </d:software>
  </d:device>
</d:devices>
`
    },
  })

  expect(details).toEqual({
    apiLevel: '36.1-',
    density: '480dpi',
    device: 'pixel_10_pro_xl',
    diagonalLength: '6.8',
    name: 'Pixel 10 Pro XL',
    oem: 'Google',
    playStore: true,
    resolution: '1344x2992',
    screenRatio: 'long',
    tag: undefined,
  })
})

test('filterLatestPixelAvdDevices keeps only the latest numeric Pixel generation', () => {
  expect(
    filterLatestPixelAvdDevices([
      {
        device: 'Galaxy Nexus',
        name: 'Galaxy Nexus',
      },
      {
        device: 'pixel_10',
        name: 'Pixel 10',
      },
      {
        device: 'pixel_10_pro_xl',
        name: 'Pixel 10 Pro XL',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Pixel 9 Pro XL',
      },
    ]),
  ).toEqual([
    {
      device: 'pixel_10',
      name: 'Pixel 10',
    },
    {
      device: 'pixel_10_pro_xl',
      name: 'Pixel 10 Pro XL',
    },
  ])
})

test('setAvdProperties writes sorted adbee properties into the AVD config', async () => {
  const homeDirectory = await createTemporaryDirectory('adbee-avd-set-')
  const configPath = join(homeDirectory, '.android', 'avd', 'Alpha.avd', 'config.ini')

  try {
    await mkdir(join(homeDirectory, '.android', 'avd', 'Alpha.avd'), { recursive: true })
    await Bun.write(configPath, 'hw.device.name=pixel_8_pro\nz.last=value\n')

    await setAvdProperties(
      'Alpha',
      {
        'adbee.readOnly': '1',
      },
      {
        getHomeDirectory: () => homeDirectory,
      },
    )

    expect(await Bun.file(configPath).text()).toBe('adbee.readOnly=1\nhw.device.name=pixel_8_pro\nz.last=value\n')
  } finally {
    await rm(homeDirectory, { force: true, recursive: true })
  }
})

test('systemImagePackageToDirectory converts a package name into an SDK directory', () => {
  expect(systemImagePackageToDirectory('/sdk', DEFAULT_SYSTEM_IMAGE)).toBe(
    '/sdk/system-images/android-36/google_apis_playstore/arm64-v8a',
  )
})

test('deriveDefaultAvdName keeps the shell script naming convention', () => {
  expect(deriveDefaultAvdName(DEFAULT_DEVICE, DEFAULT_SYSTEM_IMAGE)).toBe('Pixel_9_Pro_XL_Play_36')
  expect(
    deriveDefaultAvdName(DEFAULT_DEVICE, 'system-images;android-CinnamonBun;google_apis_playstore_ps16k;arm64-v8a'),
  ).toBe('Pixel_9_Pro_XL_Play_Ps16k_CinnamonBun')
})

test('resolveAvailableAvdName appends a five-digit suffix and retries collisions', () => {
  const randomNumbers = [1, 1, 39283]

  expect(
    resolveAvailableAvdName(
      'Some_Existing_Name',
      ['Some_Existing_Name', 'Some_Existing_Name_00001'],
      () => randomNumbers.shift() ?? 0,
    ),
  ).toBe('Some_Existing_Name_39283')
})

test('buildAvdConfig preserves existing keys, overwrites managed keys, and sorts the output', () => {
  expect(
    buildAvdConfig(
      `
        hw.ramSize=1024
        z.last=value
        avd.ini.displayname=Old Name
      `,
      {
        dataSize: DEFAULT_DATA_SIZE,
        device: DEFAULT_DEVICE,
        name: 'Pixel_9_Pro_XL_Play_36',
        ramMb: DEFAULT_RAM_MB,
        sdcardSize: DEFAULT_SDCARD_SIZE,
        sdkRoot: '/sdk',
        systemImage: DEFAULT_SYSTEM_IMAGE,
        vmHeapMb: DEFAULT_VM_HEAP_MB,
      },
    ),
  ).toBe(
    [
      'abi.type=arm64-v8a',
      'avd.ini.displayname=Pixel 9 Pro XL Play 36',
      'disk.dataPartition.size=32G',
      'fastboot.forceChosenSnapshotBoot=no',
      'fastboot.forceColdBoot=no',
      'fastboot.forceFastBoot=yes',
      'hw.audioInput=yes',
      'hw.camera.back=virtualscene',
      'hw.camera.front=emulated',
      'hw.cpu.arch=arm64',
      'hw.cpu.ncore=4',
      'hw.gpu.enabled=yes',
      'hw.gpu.mode=auto',
      'hw.keyboard=yes',
      'hw.ramSize=8192',
      'hw.sdCard=yes',
      'image.sysdir.1=system-images/android-36/google_apis_playstore/arm64-v8a/',
      'PlayStore.enabled=true',
      'runtime.network.latency=none',
      'runtime.network.speed=full',
      'sdcard.size=512M',
      'showDeviceFrame=yes',
      'skin.dynamic=yes',
      'tag.display=Google Play',
      'tag.displaynames=Google Play',
      'tag.id=google_apis_playstore',
      'tag.ids=google_apis_playstore',
      'target=android-36',
      'userdata.useQcow2=no',
      'vm.heapSize=576',
      'z.last=value',
      '',
    ].join('\n'),
  )
})

test('deleteInstalledAvds attempts every delete and reports all failures together', async () => {
  const commands: string[][] = []

  await expect(
    deleteInstalledAvds(['Alpha', 'Bravo', 'Zed'], '/sdk', async (cmd) => {
      commands.push(cmd)

      const avdName = cmd[4]

      if (avdName === 'Alpha') {
        return ''
      }

      throw new Error(`Failure [${avdName}]`)
    }),
  ).rejects.toThrow(
    'Some AVDs could not be deleted:\n- Failed to delete "Bravo": Failure [Bravo]\n- Failed to delete "Zed": Failure [Zed]',
  )

  expect(commands).toEqual([
    ['/sdk/cmdline-tools/latest/bin/avdmanager', 'delete', 'avd', '--name', 'Alpha'],
    ['/sdk/cmdline-tools/latest/bin/avdmanager', 'delete', 'avd', '--name', 'Bravo'],
    ['/sdk/cmdline-tools/latest/bin/avdmanager', 'delete', 'avd', '--name', 'Zed'],
  ])
})

test('createOrUpdateAvd installs a missing system image, creates the AVD, and writes the managed config', async () => {
  const rootDirectory = await createTemporaryDirectory('adbee-avd-create-')
  const homeDirectory = join(rootDirectory, 'home')
  const sdkRoot = join(rootDirectory, 'sdk')
  const commands: Array<{ cmd: string[]; stdin?: string }> = []

  try {
    await mkdir(homeDirectory, { recursive: true })
    await mkdir(join(sdkRoot, 'cmdline-tools', 'latest', 'bin'), { recursive: true })
    await mkdir(join(sdkRoot, 'emulator'), { recursive: true })

    const result = await createOrUpdateAvd(
      {
        sdkRoot,
        systemImage: DEFAULT_SYSTEM_IMAGE,
      },
      {
        getHomeDirectory: () => homeDirectory,
        runCommand: async (cmd, options = {}) => {
          commands.push({ cmd, stdin: options.stdin })

          if (cmd[0].endsWith('/sdkmanager')) {
            await mkdir(systemImagePackageToDirectory(sdkRoot, cmd[2] as string), { recursive: true })
          }

          if (cmd[0].endsWith('/avdmanager')) {
            const avdName = cmd[cmd.indexOf('--name') + 1] as string
            const avdDirectory = join(homeDirectory, '.android', 'avd', `${avdName}.avd`)

            await mkdir(avdDirectory, { recursive: true })
            await Bun.write(join(avdDirectory, 'config.ini'), 'z.keep=value\n')
          }

          return ''
        },
      },
    )

    expect(result).toEqual({
      avdName: 'Pixel_9_Pro_XL_Play_36',
      created: true,
      emulatorPath: join(sdkRoot, 'emulator', 'emulator'),
      sdkRoot,
      systemImage: DEFAULT_SYSTEM_IMAGE,
    })
    expect(commands).toEqual([
      {
        cmd: [join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'), '--install', DEFAULT_SYSTEM_IMAGE],
        stdin: undefined,
      },
      {
        cmd: [join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager'), 'list', 'device'],
        stdin: undefined,
      },
      {
        cmd: [
          join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
          'create',
          'avd',
          '--abi',
          'arm64-v8a',
          '--device',
          DEFAULT_DEVICE,
          '--force',
          '--name',
          'Pixel_9_Pro_XL_Play_36',
          '--package',
          DEFAULT_SYSTEM_IMAGE,
          '--sdcard',
          DEFAULT_SDCARD_SIZE,
        ],
        stdin: 'no\n',
      },
    ])
    expect(
      await Bun.file(join(homeDirectory, '.android', 'avd', 'Pixel_9_Pro_XL_Play_36.avd', 'config.ini')).text(),
    ).toContain('hw.ramSize=8192')
    expect(
      await Bun.file(join(homeDirectory, '.android', 'avd', 'Pixel_9_Pro_XL_Play_36.avd', 'config.ini')).text(),
    ).toContain('z.keep=value')
  } finally {
    await rm(rootDirectory, { force: true, recursive: true })
  }
})

test('createOrUpdateAvd updates an existing AVD without recreating it', async () => {
  const rootDirectory = await createTemporaryDirectory('adbee-avd-update-')
  const homeDirectory = join(rootDirectory, 'home')
  const sdkRoot = join(rootDirectory, 'sdk')
  const avdDirectory = join(homeDirectory, '.android', 'avd', 'Pixel_9_Pro_XL_Play_36.avd')
  const commands: string[][] = []

  try {
    await mkdir(systemImagePackageToDirectory(sdkRoot, DEFAULT_SYSTEM_IMAGE), { recursive: true })
    await mkdir(avdDirectory, { recursive: true })
    await Bun.write(join(avdDirectory, 'config.ini'), 'hw.ramSize=1024\nz.keep=value\n')

    const result = await createOrUpdateAvd(
      {
        dataSize: '64G',
        name: 'Pixel_9_Pro_XL_Play_36',
        sdkRoot,
        systemImage: DEFAULT_SYSTEM_IMAGE,
      },
      {
        getHomeDirectory: () => homeDirectory,
        runCommand: async (cmd) => {
          commands.push(cmd)

          return ''
        },
      },
    )

    expect(result.created).toBe(false)
    expect(commands).toEqual([])
    expect(await Bun.file(join(avdDirectory, 'config.ini')).text()).toContain('disk.dataPartition.size=64G')
    expect(await Bun.file(join(avdDirectory, 'config.ini')).text()).toContain('z.keep=value')
  } finally {
    await rm(rootDirectory, { force: true, recursive: true })
  }
})

test('createOrUpdateAvd falls back to the nearest creatable Pixel profile for newer Studio-only devices', async () => {
  const rootDirectory = await createTemporaryDirectory('adbee-avd-fallback-')
  const homeDirectory = join(rootDirectory, 'home')
  const sdkRoot = join(rootDirectory, 'sdk')
  const studioJarPath = join(
    homeDirectory,
    'Applications',
    'Android Studio.app',
    'Contents',
    'plugins',
    'android',
    'lib',
    'sdklib.jar',
  )
  let receivedCreateDevice: string | undefined

  try {
    await mkdir(join(homeDirectory, 'Applications', 'Android Studio.app', 'Contents', 'plugins', 'android', 'lib'), {
      recursive: true,
    })
    await mkdir(join(sdkRoot, 'cmdline-tools', 'latest', 'bin'), { recursive: true })
    await mkdir(join(sdkRoot, 'emulator'), { recursive: true })
    await mkdir(systemImagePackageToDirectory(sdkRoot, DEFAULT_SYSTEM_IMAGE), { recursive: true })
    await Bun.write(studioJarPath, '')

    const result = await createOrUpdateAvd(
      {
        device: 'pixel_10_pro_xl',
        name: 'Pixel_10_Pro_XL_Play_36',
        sdkRoot,
        systemImage: DEFAULT_SYSTEM_IMAGE,
      },
      {
        getHomeDirectory: () => homeDirectory,
        runCommand: async (cmd, options = {}) => {
          if (cmd[0] === 'unzip') {
            const jarPath = cmd[2]
            const entryPath = cmd[3]

            if (entryPath !== 'com/android/sdklib/devices/nexus.xml') {
              return `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
</d:devices>
`
            }

            if (jarPath !== studioJarPath) {
              return ''
            }

            return `
<?xml version="1.0"?>
<d:devices xmlns:d="http://schemas.android.com/sdk/devices/7">
  <d:device>
    <d:name>Pixel 10 Pro XL</d:name>
    <d:id>pixel_10_pro_xl</d:id>
    <d:manufacturer>Google</d:manufacturer>
    <d:playstore-enabled>true</d:playstore-enabled>
    <d:hardware>
      <d:screen>
        <d:pixel-density>480dpi</d:pixel-density>
        <d:dimensions>
          <d:x-dimension>1344</d:x-dimension>
          <d:y-dimension>2992</d:y-dimension>
        </d:dimensions>
      </d:screen>
    </d:hardware>
  </d:device>
</d:devices>
`
          }

          if (cmd[0].endsWith('/avdmanager') && cmd[1] === 'list') {
            return `
Available devices definitions:
id: 49 or "pixel_9_pro_xl"
    Name: Pixel 9 Pro XL
    OEM : Google
---------
`
          }

          if (cmd[0].endsWith('/avdmanager') && cmd[1] === 'create') {
            receivedCreateDevice = cmd[cmd.indexOf('--device') + 1]

            const avdName = cmd[cmd.indexOf('--name') + 1] as string
            const avdDirectory = join(homeDirectory, '.android', 'avd', `${avdName}.avd`)

            await mkdir(avdDirectory, { recursive: true })
            await Bun.write(
              join(avdDirectory, 'config.ini'),
              [
                'PlayStore.enabled=false',
                'hw.device.hash2=MD5:legacy',
                'hw.device.name=pixel_9_pro_xl',
                'hw.lcd.density=320',
                'hw.lcd.height=2400',
                'hw.lcd.width=1080',
                'skin.path=/tmp/fallback-skin',
                'z.keep=value',
                '',
              ].join('\n'),
            )

            return options.stdin ?? ''
          }

          return ''
        },
      },
    )

    expect(result).toEqual({
      avdName: 'Pixel_10_Pro_XL_Play_36',
      created: true,
      emulatorPath: join(sdkRoot, 'emulator', 'emulator'),
      sdkRoot,
      systemImage: DEFAULT_SYSTEM_IMAGE,
    })
    expect(receivedCreateDevice).toBe('pixel_9_pro_xl')

    const config = await Bun.file(
      join(homeDirectory, '.android', 'avd', 'Pixel_10_Pro_XL_Play_36.avd', 'config.ini'),
    ).text()

    expect(config).toContain('PlayStore.enabled=true')
    expect(config).toContain('hw.device.manufacturer=Google')
    expect(config).toContain('hw.device.name=pixel_10_pro_xl')
    expect(config).toContain('hw.lcd.density=480')
    expect(config).toContain('hw.lcd.height=2992')
    expect(config).toContain('hw.lcd.width=1344')
    expect(config).toContain('z.keep=value')
    expect(config).not.toContain('hw.device.hash2=MD5:legacy')
    expect(config).not.toContain('skin.path=/tmp/fallback-skin')
  } finally {
    await rm(rootDirectory, { force: true, recursive: true })
  }
})

test('avd create prompts for the system image and name, then uses the default sizing values', async () => {
  let receivedConfirmOptions: ConfirmOptions | undefined
  let receivedCreateOptions: CreateAvdOptions | undefined
  let receivedDeviceFilterOptions: FilterOptions<string> | undefined
  let receivedSystemImageFilterOptions: FilterOptions<string> | undefined
  let receivedInputOptions: InputOptions | undefined
  let startCalls = 0

  const result = await executeCli(['avd', 'create'], {
    runConfirm: async (options) => {
      receivedConfirmOptions = options

      return false
    },
    runCreateOrUpdateAvd: async (options: CreateAvdOptions = {}) => {
      receivedCreateOptions = options

      return {
        avdName: options.name ?? '',
        created: true,
        emulatorPath: '/sdk/emulator/emulator',
        sdkRoot: options.sdkRoot ?? '/sdk',
        systemImage: options.systemImage ?? DEFAULT_SYSTEM_IMAGE,
      }
    },
    runFilter: async <T>(options: FilterOptions<T>) => {
      if (options.message === 'Select an AVD device') {
        receivedDeviceFilterOptions = options as FilterOptions<string>

        return (options.default ?? 'pixel_10_pro_xl') as T
      }

      receivedSystemImageFilterOptions = options as FilterOptions<string>

      return DEFAULT_SYSTEM_IMAGE as T
    },
    runInput: async (options: InputOptions) => {
      receivedInputOptions = options

      return options.default ?? ''
    },
    runListAvailableAvdDevices: async () =>
      [
        {
          device: 'Galaxy Nexus',
          name: 'Galaxy Nexus',
          oem: 'Google',
        },
        {
          device: 'pixel_10',
          name: 'Pixel 10',
          oem: 'Google',
        },
        {
          device: 'pixel_10_pro_xl',
          name: 'Pixel 10 Pro XL',
          oem: 'Google',
        },
        {
          device: 'pixel_9_pro_xl',
          name: 'Pixel 9 Pro XL',
          oem: 'Google',
        },
      ] satisfies AvailableAvdDevice[],
    runListInstalledAvds: async () => [],
    runListInstalledSystemImages: async () => [DEFAULT_SYSTEM_IMAGE, 'system-images;android-35;google_apis;x86_64'],
    runResolveAndroidSdkRoot: () => '/sdk',
    runStartAvd: async () => {
      startCalls += 1
    },
  })

  expect(receivedDeviceFilterOptions).toEqual({
    choices: [
      {
        hint: '(device: pixel_10, oem: Google)',
        label: 'Pixel 10',
        value: 'pixel_10',
      },
      {
        hint: '(device: pixel_10_pro_xl, oem: Google)',
        label: 'Pixel 10 Pro XL',
        value: 'pixel_10_pro_xl',
      },
    ],
    default: 'pixel_10_pro_xl',
    message: 'Select an AVD device',
    placeholder: 'Type a device id or name',
  })
  expect(receivedSystemImageFilterOptions).toEqual({
    choices: [DEFAULT_SYSTEM_IMAGE, 'system-images;android-35;google_apis;x86_64'],
    default: DEFAULT_SYSTEM_IMAGE,
    message: 'Select an installed system image',
  })
  expect(receivedInputOptions).toEqual({
    default: 'Pixel_10_Pro_XL_Play_36',
    message: 'AVD name',
  })
  expect(receivedConfirmOptions).toEqual({
    default: false,
    message: 'Start Pixel_10_Pro_XL_Play_36 now?',
  })
  expect(receivedCreateOptions).toEqual({
    dataSize: DEFAULT_DATA_SIZE,
    device: 'pixel_10_pro_xl',
    name: 'Pixel_10_Pro_XL_Play_36',
    ramMb: DEFAULT_RAM_MB,
    sdcardSize: DEFAULT_SDCARD_SIZE,
    sdkRoot: '/sdk',
    systemImage: DEFAULT_SYSTEM_IMAGE,
    vmHeapMb: DEFAULT_VM_HEAP_MB,
  })
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([
    '',
    'Created AVD: Pixel_10_Pro_XL_Play_36',
    'Launch with:',
    '"/sdk/emulator/emulator" @"Pixel_10_Pro_XL_Play_36"',
  ])
  expect(startCalls).toBe(0)
  expect(result.tables).toEqual([])
})

test('avd create bypasses prompts when flags are provided', async () => {
  let confirmCalls = 0
  let createCalls = 0
  let filterCalls = 0
  let inputCalls = 0
  let listAvailableAvdDeviceCalls = 0
  let receivedCreateOptions: CreateAvdOptions | undefined
  let startCalls = 0

  const result = await executeCli(
    [
      'avd',
      'create',
      '--data-size',
      '64G',
      '--device',
      'pixel_8_pro',
      '--name',
      'Custom_AVD',
      '--ram-mb',
      '4096',
      '--sdcard-size',
      '1G',
      '--start',
      '--system-image',
      'system-images;android-35;google_apis;x86_64',
      '--vm-heap-mb',
      '512',
    ],
    {
      runConfirm: async () => {
        confirmCalls += 1

        return false
      },
      runCreateOrUpdateAvd: async (options: CreateAvdOptions = {}) => {
        createCalls += 1
        receivedCreateOptions = options

        return {
          avdName: options.name ?? '',
          created: true,
          emulatorPath: '/sdk/emulator/emulator',
          sdkRoot: options.sdkRoot ?? '/sdk',
          systemImage: options.systemImage ?? '',
        }
      },
      runFilter: async <T>() => {
        filterCalls += 1

        return DEFAULT_SYSTEM_IMAGE as T
      },
      runInput: async (options: InputOptions) => {
        inputCalls += 1

        return options.default ?? ''
      },
      runListAvailableAvdDevices: async () => {
        listAvailableAvdDeviceCalls += 1

        return []
      },
      runListInstalledAvds: async () => [],
      runResolveAndroidSdkRoot: () => '/sdk',
      runStartAvd: async () => {
        startCalls += 1
      },
    },
  )

  expect(confirmCalls).toBe(0)
  expect(createCalls).toBe(1)
  expect(filterCalls).toBe(0)
  expect(inputCalls).toBe(0)
  expect(listAvailableAvdDeviceCalls).toBe(0)
  expect(receivedCreateOptions).toEqual({
    dataSize: '64G',
    device: 'pixel_8_pro',
    name: 'Custom_AVD',
    ramMb: 4096,
    sdcardSize: '1G',
    sdkRoot: '/sdk',
    systemImage: 'system-images;android-35;google_apis;x86_64',
    vmHeapMb: 512,
  })
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(startCalls).toBe(1)
  expect(result.tables).toEqual([])
})

test('avd create appends a five-digit suffix when the requested name already exists', async () => {
  let receivedConfirmOptions: ConfirmOptions | undefined
  let receivedCreateOptions: CreateAvdOptions | undefined

  const result = await executeCli(
    [
      'avd',
      'create',
      '--device',
      DEFAULT_DEVICE,
      '--name',
      'Some_Existing_Name',
      '--system-image',
      DEFAULT_SYSTEM_IMAGE,
    ],
    {
      runConfirm: async (options) => {
        receivedConfirmOptions = options

        return false
      },
      runCreateOrUpdateAvd: async (options: CreateAvdOptions = {}) => {
        receivedCreateOptions = options

        return {
          avdName: options.name ?? '',
          created: true,
          emulatorPath: '/sdk/emulator/emulator',
          sdkRoot: options.sdkRoot ?? '/sdk',
          systemImage: options.systemImage ?? DEFAULT_SYSTEM_IMAGE,
        }
      },
      runListInstalledAvds: async () => [
        {
          name: 'Some_Existing_Name',
        },
      ],
      runResolveAndroidSdkRoot: () => '/sdk',
    },
  )

  expect(receivedCreateOptions?.name).toMatch(/^Some_Existing_Name_\d{5}$/)
  expect(receivedConfirmOptions?.message).toMatch(/^Start Some_Existing_Name_\d{5} now\?$/)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs[1]).toMatch(/^Created AVD: Some_Existing_Name_\d{5}$/)
  expect(result.logs[3]).toMatch(/^"\/sdk\/emulator\/emulator" @"Some_Existing_Name_\d{5}"$/)
  expect(result.tables).toEqual([])
})

test('avd create starts the AVD when the confirmation is accepted', async () => {
  let receivedStartArguments: Parameters<typeof startAvd> | undefined

  const result = await executeCli(['avd', 'create'], {
    runConfirm: async () => true,
    runCreateOrUpdateAvd: async () => ({
      avdName: 'Pixel_9_Pro_XL_Play_36',
      created: true,
      emulatorPath: '/sdk/emulator/emulator',
      sdkRoot: '/sdk',
      systemImage: DEFAULT_SYSTEM_IMAGE,
    }),
    runFilter: async <T>(options: FilterOptions<T>) => options.default as T,
    runInput: async (options: InputOptions) => options.default ?? '',
    runListAvailableAvdDevices: async () =>
      [
        {
          device: DEFAULT_DEVICE,
          name: 'Pixel 9 Pro XL',
        },
      ] satisfies AvailableAvdDevice[],
    runListInstalledAvds: async () => [],
    runListInstalledSystemImages: async () => [DEFAULT_SYSTEM_IMAGE],
    runResolveAndroidSdkRoot: () => '/sdk',
    runStartAvd: async (...args) => {
      receivedStartArguments = args
    },
  })

  expect(receivedStartArguments).toEqual(['/sdk/emulator/emulator', 'Pixel_9_Pro_XL_Play_36'])
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([])
})

test('avd set prompts for an AVD and writes an adbee property', async () => {
  let receivedProperties: Record<string, string> | undefined
  let receivedSelectOptions: SelectOptions<string> | undefined
  let receivedAvdName: string | undefined

  const result = await executeCli(['avd', 'set', 'readOnly=1'], {
    runListInstalledAvds: async () => [
      {
        device: 'pixel_8_pro',
        name: 'Alpha',
        target: 'android-35',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Zed',
        readOnly: true,
        target: 'android-36',
      },
    ],
    runSelect: async <T>(options: SelectOptions<T>) => {
      receivedSelectOptions = options as SelectOptions<string>

      return 'Zed' as T
    },
    runSetAvdProperties: async (avdName, properties) => {
      receivedAvdName = avdName
      receivedProperties = properties
    },
  })

  expect(receivedSelectOptions).toEqual({
    choices: [
      {
        hint: '(device: pixel_8_pro, target: android-35)',
        label: 'Alpha',
        value: 'Alpha',
      },
      {
        hint: '(device: pixel_9_pro_xl, target: android-36)',
        label: 'Zed (read only)',
        value: 'Zed',
      },
    ],
    message: 'Select an AVD to set adbee.readOnly=1 on',
  })
  expect(receivedAvdName).toBe('Zed')
  expect(receivedProperties).toEqual({
    'adbee.readOnly': '1',
  })
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([
    [
      {
        name: 'Zed',
        property: 'adbee.readOnly',
        value: '1',
      },
    ],
  ])
})

test('avd set requires KEY=VALUE assignment syntax', async () => {
  const result = await executeCli(['avd', 'set', 'readOnly'], {})

  expect(result.errors).toEqual(['Error: Expected KEY=VALUE, for example "readOnly=1".'])
  expect(result.exitCode).toBe(1)
  expect(result.tables).toEqual([])
})

test('avd delete hides read-only AVDs by default and deletes the selected entries', async () => {
  let receivedConfirmOptions: ConfirmOptions | undefined
  let receivedChoices: MultiselectOptions<string>['choices'] | undefined
  let receivedDeletedAvdNames: readonly string[] | undefined
  let receivedSdkRoot: string | undefined

  const result = await executeCli(['avd', 'delete'], {
    runConfirm: async (options) => {
      receivedConfirmOptions = options

      return true
    },
    runDeleteInstalledAvds: async (avdNames, sdkRoot) => {
      receivedDeletedAvdNames = avdNames
      receivedSdkRoot = sdkRoot
    },
    runListInstalledAvds: async () => [
      {
        device: 'pixel_8_pro',
        name: 'Alpha',
        readOnly: true,
        target: 'android-35',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Zed',
        target: 'android-36',
      },
      {
        device: 'pixel_tablet',
        name: 'Zoom',
        target: 'android-35',
      },
    ],
    runMultiselect: async <T>(options: MultiselectOptions<T>) => {
      receivedChoices = options.choices as MultiselectOptions<string>['choices']

      return ['Zed'] as unknown as T[]
    },
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(receivedChoices).toEqual([
    {
      hint: '(device: pixel_9_pro_xl, target: android-36)',
      label: 'Zed',
      value: 'Zed',
    },
    {
      hint: '(device: pixel_tablet, target: android-35)',
      label: 'Zoom',
      value: 'Zoom',
    },
    {
      hint: '(exit without deleting anything)',
      label: 'Stop delete flow',
      value: '__adbee_stop_delete_flow__',
    },
  ])
  expect(receivedConfirmOptions).toEqual({
    default: false,
    message: 'Are you sure you want to delete Zed?',
  })
  expect(receivedDeletedAvdNames).toEqual(['Zed'])
  expect(receivedSdkRoot).toBe('/sdk')
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        device: 'pixel_9_pro_xl',
        name: 'Zed',
        target: 'android-36',
      },
    ],
  ])
})

test('avd delete shows read-only AVDs with --all and refuses to delete them', async () => {
  let deleteCalls = 0
  let receivedChoices: MultiselectOptions<string>['choices'] | undefined

  const result = await executeCli(['avd', 'delete', '--all'], {
    runDeleteInstalledAvds: async () => {
      deleteCalls += 1
    },
    runListInstalledAvds: async () => [
      {
        device: 'pixel_8_pro',
        name: 'Alpha',
        readOnly: true,
        target: 'android-35',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Zed',
        target: 'android-36',
      },
    ],
    runMultiselect: async <T>(options: MultiselectOptions<T>) => {
      receivedChoices = options.choices as MultiselectOptions<string>['choices']

      return ['Alpha'] as unknown as T[]
    },
  })

  expect(receivedChoices).toEqual([
    {
      hint: '(device: pixel_8_pro, target: android-35, read only)',
      label: 'Alpha (read only)',
      value: 'Alpha',
    },
    {
      hint: '(device: pixel_9_pro_xl, target: android-36)',
      label: 'Zed',
      value: 'Zed',
    },
    {
      hint: '(exit without deleting anything)',
      label: 'Stop delete flow',
      value: '__adbee_stop_delete_flow__',
    },
  ])
  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual(['Error: Cannot delete read-only AVDs: Alpha'])
  expect(result.exitCode).toBe(1)
  expect(result.tables).toEqual([])
})

test('avd delete does nothing when read-only AVDs are hidden by default', async () => {
  let confirmCalls = 0
  let deleteCalls = 0
  let multiselectCalls = 0

  const result = await executeCli(['avd', 'delete'], {
    runConfirm: async () => {
      confirmCalls += 1

      return true
    },
    runDeleteInstalledAvds: async () => {
      deleteCalls += 1
    },
    runListInstalledAvds: async () => [
      {
        name: 'Alpha',
        readOnly: true,
      },
    ],
    runMultiselect: async () => {
      multiselectCalls += 1

      return []
    },
  })

  expect(confirmCalls).toBe(0)
  expect(deleteCalls).toBe(0)
  expect(multiselectCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([])
})

test('avd delete does nothing when no AVDs are selected', async () => {
  let confirmCalls = 0
  let deleteCalls = 0

  const result = await executeCli(['avd', 'delete'], {
    runConfirm: async () => {
      confirmCalls += 1

      return true
    },
    runDeleteInstalledAvds: async () => {
      deleteCalls += 1
    },
    runListInstalledAvds: async () => [
      {
        name: 'Alpha',
      },
    ],
    runMultiselect: async () => [],
  })

  expect(confirmCalls).toBe(0)
  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([])
})

test('avd delete exits when the stop option is selected', async () => {
  let confirmCalls = 0
  let deleteCalls = 0

  const result = await executeCli(['avd', 'delete'], {
    runConfirm: async () => {
      confirmCalls += 1

      return true
    },
    runDeleteInstalledAvds: async () => {
      deleteCalls += 1
    },
    runListInstalledAvds: async () => [
      {
        name: 'Alpha',
      },
    ],
    runMultiselect: async <T>() => ['__adbee_stop_delete_flow__'] as unknown as T[],
  })

  expect(confirmCalls).toBe(0)
  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([])
})

test('avd delete ignores prompt cancellation', async () => {
  let deleteCalls = 0

  const result = await executeCli(['avd', 'delete'], {
    runDeleteInstalledAvds: async () => {
      deleteCalls += 1
    },
    runListInstalledAvds: async () => [
      {
        name: 'Alpha',
      },
    ],
    runMultiselect: async () => {
      throw new CancelledError()
    },
  })

  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([])
})

test('avd delete does nothing when the confirmation is declined', async () => {
  let deleteCalls = 0

  const result = await executeCli(['avd', 'delete'], {
    runConfirm: async () => false,
    runDeleteInstalledAvds: async () => {
      deleteCalls += 1
    },
    runListInstalledAvds: async () => [
      {
        name: 'Alpha',
      },
    ],
    runMultiselect: async <T>() => ['Alpha'] as unknown as T[],
  })

  expect(deleteCalls).toBe(0)
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([])
})

test('avd delete requires an interactive terminal', async () => {
  const result = await executeCli(['avd', 'delete'], {
    runListInstalledAvds: async () => [
      {
        name: 'Alpha',
      },
    ],
    runMultiselect: async () => {
      throw new NonInteractiveError()
    },
  })

  expect(result.errors).toEqual(['Error: avd delete requires an interactive terminal.'])
  expect(result.exitCode).toBe(1)
  expect(result.tables).toEqual([])
})

test('avd delete surfaces delete failures', async () => {
  const result = await executeCli(['avd', 'delete'], {
    runConfirm: async () => true,
    runDeleteInstalledAvds: async () => {
      throw new Error('avdmanager: delete failed')
    },
    runListInstalledAvds: async () => [
      {
        name: 'Alpha',
      },
    ],
    runMultiselect: async <T>() => ['Alpha'] as unknown as T[],
  })

  expect(result.errors).toEqual(['Error: avdmanager: delete failed'])
  expect(result.exitCode).toBe(1)
  expect(result.tables).toEqual([])
})

test('avd devices prints only the latest Pixel generation by default', async () => {
  const result = await executeCli(['avd', 'devices'], {
    runListAvailableAvdDevices: async () =>
      [
        {
          device: 'pixel_10',
          name: 'Pixel 10',
        },
        {
          device: 'pixel_10_pro_xl',
          name: 'Pixel 10 Pro XL',
        },
        {
          device: 'pixel_9_pro_xl',
          name: 'Pixel 9 Pro XL',
        },
        {
          device: 'pixel_tablet',
          name: 'Pixel Tablet',
        },
      ] satisfies AvailableAvdDevice[],
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        device: 'pixel_10',
        name: 'Pixel 10',
      },
      {
        device: 'pixel_10_pro_xl',
        name: 'Pixel 10 Pro XL',
      },
    ],
  ])
})

test('avd devices --all prints all available device definitions', async () => {
  const result = await executeCli(['avd', 'devices', '--all'], {
    runListAvailableAvdDevices: async () =>
      [
        {
          device: 'Galaxy Nexus',
          name: 'Galaxy Nexus',
        },
        {
          device: 'pixel_10',
          name: 'Pixel 10',
        },
        {
          device: 'pixel_9_pro_xl',
          name: 'Pixel 9 Pro XL',
        },
      ] satisfies AvailableAvdDevice[],
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        device: 'Galaxy Nexus',
        name: 'Galaxy Nexus',
      },
      {
        device: 'pixel_10',
        name: 'Pixel 10',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Pixel 9 Pro XL',
      },
    ],
  ])
})

test('avd device prints details for the provided device id', async () => {
  const result = await executeCli(['avd', 'device', 'pixel_9_pro_xl'], {
    runGetAvailableAvdDeviceDetails: async () =>
      ({
        apiLevel: '35-',
        density: 'xxhdpi',
        device: 'pixel_9_pro_xl',
        diagonalLength: '6.8',
        name: 'Pixel 9 Pro XL',
        oem: 'Google',
        playStore: true,
        resolution: '1344x2992',
        screenRatio: 'long',
      }) satisfies AvailableAvdDeviceDetails,
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        apiLevel: '35-',
        density: 'xxhdpi',
        device: 'pixel_9_pro_xl',
        diagonalLength: '6.8',
        name: 'Pixel 9 Pro XL',
        oem: 'Google',
        playStore: 'true',
        resolution: '1344x2992',
        screenRatio: 'long',
        tag: '',
      },
    ],
  ])
})

test('avd device prompts only across the latest Pixel generation by default', async () => {
  let receivedFilterOptions: FilterOptions<string> | undefined

  const result = await executeCli(['avd', 'device'], {
    runFilter: async <T>(options: FilterOptions<T>) => {
      receivedFilterOptions = options as FilterOptions<string>

      return 'pixel_10_pro_xl' as T
    },
    runGetAvailableAvdDeviceDetails: async () =>
      ({
        device: 'pixel_10_pro_xl',
        name: 'Pixel 10 Pro XL',
        resolution: '1400x3000',
      }) satisfies AvailableAvdDeviceDetails,
    runListAvailableAvdDevices: async () =>
      [
        {
          device: 'Galaxy Nexus',
          name: 'Galaxy Nexus',
          oem: 'Google',
        },
        {
          device: 'pixel_10',
          name: 'Pixel 10',
          oem: 'Google',
        },
        {
          device: 'pixel_10_pro_xl',
          name: 'Pixel 10 Pro XL',
          oem: 'Google',
        },
        {
          device: 'pixel_9_pro_xl',
          name: 'Pixel 9 Pro XL',
          oem: 'Google',
        },
      ] satisfies AvailableAvdDevice[],
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(receivedFilterOptions).toEqual({
    choices: [
      {
        hint: '(device: pixel_10, oem: Google)',
        label: 'Pixel 10',
        value: 'pixel_10',
      },
      {
        hint: '(device: pixel_10_pro_xl, oem: Google)',
        label: 'Pixel 10 Pro XL',
        value: 'pixel_10_pro_xl',
      },
    ],
    message: 'Select an AVD device',
    placeholder: 'Type a device id or name',
  })
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([
    [
      {
        apiLevel: '',
        density: '',
        device: 'pixel_10_pro_xl',
        diagonalLength: '',
        name: 'Pixel 10 Pro XL',
        oem: '',
        playStore: '',
        resolution: '1400x3000',
        screenRatio: '',
        tag: '',
      },
    ],
  ])
})

test('avd device --all prompts across all available devices', async () => {
  let receivedFilterOptions: FilterOptions<string> | undefined

  const result = await executeCli(['avd', 'device', '--all'], {
    runFilter: async <T>(options: FilterOptions<T>) => {
      receivedFilterOptions = options as FilterOptions<string>

      return 'pixel_9_pro_xl' as T
    },
    runGetAvailableAvdDeviceDetails: async () =>
      ({
        device: 'pixel_9_pro_xl',
        name: 'Pixel 9 Pro XL',
        resolution: '1344x2992',
      }) satisfies AvailableAvdDeviceDetails,
    runListAvailableAvdDevices: async () =>
      [
        {
          device: 'Galaxy Nexus',
          name: 'Galaxy Nexus',
          oem: 'Google',
        },
        {
          device: 'pixel_10',
          name: 'Pixel 10',
          oem: 'Google',
        },
        {
          device: 'pixel_9_pro_xl',
          name: 'Pixel 9 Pro XL',
          oem: 'Google',
        },
      ] satisfies AvailableAvdDevice[],
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(receivedFilterOptions).toEqual({
    choices: [
      {
        hint: '(oem: Google)',
        label: 'Galaxy Nexus',
        value: 'Galaxy Nexus',
      },
      {
        hint: '(device: pixel_10, oem: Google)',
        label: 'Pixel 10',
        value: 'pixel_10',
      },
      {
        hint: '(device: pixel_9_pro_xl, oem: Google)',
        label: 'Pixel 9 Pro XL',
        value: 'pixel_9_pro_xl',
      },
    ],
    message: 'Select an AVD device',
    placeholder: 'Type a device id or name',
  })
  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.tables).toEqual([
    [
      {
        apiLevel: '',
        density: '',
        device: 'pixel_9_pro_xl',
        diagonalLength: '',
        name: 'Pixel 9 Pro XL',
        oem: '',
        playStore: '',
        resolution: '1344x2992',
        screenRatio: '',
        tag: '',
      },
    ],
  ])
})

test('avd images prints installed system images', async () => {
  const result = await executeCli(['avd', 'images'], {
    runListInstalledSystemImages: async () => [
      'system-images;android-35;google_apis;x86_64',
      'system-images;android-36;google_apis_playstore;arm64-v8a',
    ],
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        systemImage: 'system-images;android-35;google_apis;x86_64',
      },
      {
        systemImage: 'system-images;android-36;google_apis_playstore;arm64-v8a',
      },
    ],
  ])
})

test('avd platforms prints installed SDK platforms', async () => {
  const result = await executeCli(['avd', 'platforms'], {
    runListInstalledPlatforms: async () => ['android-34', 'android-36', 'android-CinnamonBun'],
    runResolveAndroidSdkRoot: () => '/sdk',
  })

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        platform: 'android-34',
      },
      {
        platform: 'android-36',
      },
      {
        platform: 'android-CinnamonBun',
      },
    ],
  ])
})

test('avd list prints installed AVDs', async () => {
  const result = await executeCli(['avd', 'list'], {
    runListInstalledAvds: async () => [
      {
        device: 'pixel_8_pro',
        name: 'Alpha',
        target: 'android-35',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Zed',
        target: 'android-36',
      },
    ],
  })

  expect(result.errors).toEqual([])
  expect(result.exitCode ?? 0).toBe(0)
  expect(result.logs).toEqual([])
  expect(result.tables).toEqual([
    [
      {
        device: 'pixel_8_pro',
        name: 'Alpha',
        target: 'android-35',
      },
      {
        device: 'pixel_9_pro_xl',
        name: 'Zed',
        target: 'android-36',
      },
    ],
  ])
})
