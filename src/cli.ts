#!/usr/bin/env bun

import { createApp } from './app.ts'

interface PackageManifest {
  description: string
  version: string
}

function isPackageManifest(value: unknown): value is PackageManifest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const manifest = value as Record<string, unknown>

  return typeof manifest.description === 'string' && typeof manifest.version === 'string'
}

async function main() {
  const packageManifest = await Bun.file(new URL('../package.json', import.meta.url)).json()

  if (!isPackageManifest(packageManifest)) {
    console.error('Invalid package.json: "description" and "version" fields are required and must be strings.')
    process.exitCode = 1

    return
  }

  await createApp(packageManifest).execute()
}

void main()
