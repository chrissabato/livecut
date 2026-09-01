'use strict'

const { contextBridge } = require('electron')

const versionArg = process.argv.find((a) => a.startsWith('--livecut-shell-version='))

// Every web-app branch keyed off `window.livecut` is a no-op in a plain browser
// where this is undefined.
contextBridge.exposeInMainWorld('livecut', {
  isDesktop: true,
  version: versionArg ? versionArg.split('=')[1] : '',
  platform: process.platform, // 'darwin' | 'win32'
})
