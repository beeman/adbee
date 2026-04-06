import type { Crust } from '@crustjs/core'
import { type CreateAvdCommandDependencies, createAvdCreateCommand } from './avd/create.ts'
import { createAvdDeleteCommand } from './avd/delete.ts'
import { createAvdDeviceCommand } from './avd/device.ts'
import { createAvdDevicesCommand } from './avd/devices.ts'
import { createAvdImagesCommand } from './avd/images.ts'
import { createAvdListCommand } from './avd/list.ts'
import { createAvdPlatformsCommand } from './avd/platforms.ts'
import { createAvdSetCommand } from './avd/set.ts'
import { createAvdStartCommand } from './avd/start.ts'
import { createAvdStopCommand } from './avd/stop.ts'

type CommandBuilder = Crust

export type { CreateAvdCommandDependencies } from './avd/create.ts'

export function createAvdCommand(app: CommandBuilder, dependencies: CreateAvdCommandDependencies = {}) {
  const avdCommand = app.sub('avd').meta({ description: 'Android Virtual Device commands.' })

  return avdCommand
    .command(createAvdCreateCommand(avdCommand, dependencies))
    .command(createAvdDeleteCommand(avdCommand, dependencies))
    .command(createAvdDeviceCommand(avdCommand, dependencies))
    .command(createAvdDevicesCommand(avdCommand, dependencies))
    .command(createAvdImagesCommand(avdCommand, dependencies))
    .command(createAvdListCommand(avdCommand, dependencies))
    .command(createAvdPlatformsCommand(avdCommand, dependencies))
    .command(createAvdSetCommand(avdCommand, dependencies))
    .command(createAvdStartCommand(avdCommand, dependencies))
    .command(createAvdStopCommand(avdCommand, dependencies))
}
