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

let screenshotWindows: BrowserWindow[] = []
const currentScreenshotData: Map<string, string> = new Map()
let mainWindow: BrowserWindow | null = null

function createScreenshotWindows(): void {
  if (screenshotWindows.length > 0) return

  const displays = screen.getAllDisplays()

  displays.forEach((display) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'under-window',
      visualEffectState: 'active',
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: false,
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    // Keep fully hidden until renderer tells us content is ready
    win.setOpacity(0)

    win.setIgnoreMouseEvents(false)

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/screenshot`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'screenshot' })
    }

    win.webContents.on('did-finish-load', () => {
      // Find matching image for this display
      const displayId = String(display.id)
      const dataUrl = currentScreenshotData.get(displayId)

      if (dataUrl) {
        win.webContents.send('init-screenshot', {
          dataUrl,
          bounds: display.bounds
        })
        // Do NOT show here. Wait until renderer finishes drawing to avoid black flash.
      }
    })

    win.on('closed', () => {
      // Remove from array
      screenshotWindows = screenshotWindows.filter((w) => w !== win)
      if (screenshotWindows.length === 0) {
        currentScreenshotData.clear()
      }
    })

    screenshotWindows.push(win)
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
  mainWindow = new BrowserWindow({
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

  const win = mainWindow

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
}

function closeAllScreenshotWindows(): void {
  screenshotWindows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.close()
    }
  })
  screenshotWindows = []
  currentScreenshotData.clear()
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

      const displays = screen.getAllDisplays()
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      return sources.map((source) => {
        const displayId = (source as unknown as { display_id?: string }).display_id
        const matched = displays.find((d) => String(d.id) === String(displayId))
        return {
          id: source.id,
          name: source.name,
          displayId,
          bounds: matched ? matched.bounds : undefined,
          scaleFactor: matched ? matched.scaleFactor : undefined
        }
      })
    } catch (error) {
      console.error('Failed to get sources:', error)
      return []
    }
  })

  ipcMain.on('start-screenshot', () => {
    // Do not hide the main window to avoid UX of minimization.
    // Directly request renderer to capture; screenshot windows are created afterwards.
    mainWindow?.webContents.send('capture-screen-request')
  })

  ipcMain.on(
    'screen-captured',
    (_event, capturedScreens: Array<{ displayId: string; dataUrl: string }>) => {
      currentScreenshotData.clear()
      capturedScreens.forEach((screen) => {
        currentScreenshotData.set(screen.displayId, screen.dataUrl)
      })

      createScreenshotWindows()
      if (mainWindow) {
        mainWindow.show()
      }
    }
  )

  ipcMain.on('close-screenshot', () => {
    closeAllScreenshotWindows()
  })

  ipcMain.on('show-screenshot-window', () => {
    screenshotWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.show()
        win.focus()
      }
    })
  })

  ipcMain.on('screenshot-rendered', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (w && !w.isDestroyed()) {
      w.setOpacity(1)
      w.show()
      w.focus()
    }
  })

  ipcMain.on('pin-screenshot', (_event, { imageDataUrl, bounds }) => {
    console.log('Main: Received pin-screenshot request', {
      hasImage: !!imageDataUrl,
      imageLength: imageDataUrl?.length,
      bounds
    })
    createPinWindow(imageDataUrl, bounds)

    // Close all screenshot windows
    closeAllScreenshotWindows()
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
    closeAllScreenshotWindows()

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
