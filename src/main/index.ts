import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  dialog,
  clipboard,
  nativeImage,
  screen,
  systemPreferences
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'

let screenshotWindow: BrowserWindow | null = null

function createScreenshotWindow(): void {
  if (screenshotWindow) return

  const primaryDisplay = screen.getPrimaryDisplay()

  // For simplicity, we just cover the primary display or all displays.
  // Handling multiple displays properly requires one window per display or a giant window.
  // We will start with primary display.

  const { width, height } = primaryDisplay.bounds

  screenshotWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  screenshotWindow.setIgnoreMouseEvents(false)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    screenshotWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/screenshot`)
  } else {
    screenshotWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'screenshot' })
  }

  screenshotWindow.on('closed', () => {
    screenshotWindow = null
  })
}

const pinImages = new Map<string, string>()

function createPinWindow(
  imageDataUrl: string,
  bounds: { x: number; y: number; width: number; height: number }
): void {
  const pinId = Date.now().toString() + Math.random().toString(36).substring(2)
  pinImages.set(pinId, imageDataUrl)

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/pin?id=${pinId}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: `pin?id=${pinId}`
    })
  }

  win.on('closed', () => {
    pinImages.delete(pinId)
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 360,
    height: 240,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('check-screen-access', () => {
    if (process.platform !== 'darwin') return 'granted'
    return systemPreferences.getMediaAccessStatus('screen')
  })

  ipcMain.on('open-screen-security-settings', () => {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  })

  ipcMain.handle('get-screen-sources', async () => {
    try {
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen')
        console.log('Main: Screen access status:', status)
        if (status === 'denied') {
          console.warn('Main: Screen access denied')
          return []
        }
      }

      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      return sources.map((source) => ({
        id: source.id,
        name: source.name
      }))
    } catch (error) {
      console.error('Failed to get sources:', error)
      return []
    }
  })

  ipcMain.on('start-screenshot', () => {
    createScreenshotWindow()
  })

  ipcMain.on('close-screenshot', () => {
    if (screenshotWindow) {
      screenshotWindow.close()
    }
  })

  ipcMain.on('pin-screenshot', (_event, { imageDataUrl, bounds }) => {
    console.log('Main: Received pin-screenshot request', {
      hasImage: !!imageDataUrl,
      imageLength: imageDataUrl?.length,
      bounds
    })
    createPinWindow(imageDataUrl, bounds)
    if (screenshotWindow) {
      console.log('Main: Closing screenshot window')
      screenshotWindow.close()
      // Force cleanup just in case
      screenshotWindow = null
    } else {
      console.warn('Main: Screenshot window is null, cannot close')
    }
  })

  ipcMain.handle('save-file', async (_event, buffer) => {
    const { filePath } = await dialog.showSaveDialog({
      buttonLabel: 'Save image',
      defaultPath: `screenshot-${Date.now()}.png`
    })
    if (filePath) {
      fs.writeFileSync(filePath, Buffer.from(buffer))
      return filePath
    }
    return null
  })

  ipcMain.on('save-file-request', async (_event, buffer) => {
    if (screenshotWindow) {
      screenshotWindow.close()
      screenshotWindow = null
    }
    const { filePath } = await dialog.showSaveDialog({
      buttonLabel: 'Save image',
      defaultPath: `screenshot-${Date.now()}.png`
    })
    if (filePath) {
      fs.writeFileSync(filePath, Buffer.from(buffer))
    }
  })
  ipcMain.on('copy-to-clipboard', (_event, buffer) => {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(buffer)))
  })

  ipcMain.on('create-pin-window', (_event, { imageDataUrl, bounds }) => {
    createPinWindow(imageDataUrl, bounds)
  })

  ipcMain.handle('get-pin-image', (_event, pinId) => {
    return pinImages.get(pinId)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
