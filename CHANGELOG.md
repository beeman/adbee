# adbee

## 0.1.1

### Patch Changes

- 201db01: Add commands to start installed AVDs and stop running emulators.
- 8bc259c: Ignore orphaned ghost AVD directories when listing installed emulators.
- 201db01: Only treat system image directories with package metadata as installed.

## 0.1.0

### Minor Changes

- 6f0bcb7: Add an interactive `apps delete` command with labels-aware selection, confirmation, and an explicit exit option.
- fb8c0a1: Add a Crust-based `apps list` command with runnable-app defaults, `--all`, `--labels`, and a local `dev` script.
- 21a5696: Add interactive AVD management commands for listing, inspecting, creating, updating metadata, and deleting Android Virtual Devices.
