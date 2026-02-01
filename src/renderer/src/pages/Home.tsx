import { useEffect } from 'react'

export const Home = (): React.JSX.Element => {
  useEffect(() => {
    const handleCaptureScreen = async (): Promise<void> => {
      try {
        const sources: Array<{
          id: string
          name: string
          displayId?: string
          bounds?: { x: number; y: number; width: number; height: number }
          scaleFactor?: number
        }> = await window.electron.ipcRenderer.invoke('get-screen-sources')

        if (!sources || sources.length === 0) {
          console.warn('No screen sources found. Check permissions.')
          return
        }

        const capturedScreens: Array<{ displayId: string; dataUrl: string }> = []

                for (const src of sources) {
          try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: src.id,
                  maxWidth: 4000,
                  maxHeight: 4000
                }
              } as unknown as MediaTrackConstraints
            })
            const video = document.createElement('video')
            video.srcObject = mediaStream
                    ;(video as HTMLVideoElement).playsInline = true
                    ;(video as HTMLVideoElement).muted = true
                    await new Promise<void>((resolve) => {
                      video.onloadedmetadata = () => resolve()
                    })
                    await (video as HTMLVideoElement).play()
                    await new Promise<void>((resolve) => {
                      const v = video as HTMLVideoElement & {
                        requestVideoFrameCallback?: (cb: () => void) => void
                      }
                      if (typeof v.requestVideoFrameCallback === 'function') {
                        v.requestVideoFrameCallback(() => resolve())
                      } else {
                        setTimeout(() => resolve(), 160)
                      }
                    })

            // Create individual canvas for this screen
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(video, 0, 0)
              capturedScreens.push({
                displayId: src.displayId || '',
                dataUrl: canvas.toDataURL('image/png')
              })
            }
            mediaStream.getTracks().forEach((t) => t.stop())
          } catch (e) {
            console.error('Failed to capture source', src, e)
          }
        }

        window.electron.ipcRenderer.send('screen-captured', capturedScreens)
      } catch (e) {
        console.error('Failed to capture screen in Home:', e)
      }
    }

    // Remove listener to avoid duplicates if any (though usually clean on unmount)
    window.electron.ipcRenderer.removeAllListeners('capture-screen-request')
    window.electron.ipcRenderer.on('capture-screen-request', handleCaptureScreen)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('capture-screen-request')
    }
  }, [])

  const startScreenshot = async (): Promise<void> => {
    const status = await window.electron.ipcRenderer.invoke('check-screen-access')
    console.log('Screen access status:', status)

    if (status === 'denied' || status === 'restricted') {
      const confirm = window.confirm(
        'Screen recording permission is required to take screenshots.\n\nPlease enable it in System Settings -> Privacy & Security -> Screen Recording.'
      )
      if (confirm) {
        window.electron.ipcRenderer.send('open-screen-security-settings')
      }
      return
    }

    window.electron.ipcRenderer.send('start-screenshot')
  }

  return (
    <div className="home-container">
      <h1>Screenshot Tool</h1>
      <button
        onClick={startScreenshot}
        style={{ padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
      >
        Capture Screen
      </button>
    </div>
  )
}
