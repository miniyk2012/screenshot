import React, { useEffect, useRef, useState } from 'react'

export const Screenshot = (): React.JSX.Element => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  )
  const [isSelecting, setIsSelecting] = useState(false)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [displayBounds, setDisplayBounds] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [scale, setScale] = useState<{ sx: number; sy: number }>({ sx: 1, sy: 1 })

  useEffect(() => {
    // Clear default body styles for transparent window
    document.body.style.background = 'transparent'
    document.body.style.backgroundImage = 'none'

    const handleInitScreenshot = (
      _event: unknown,
      payload: { dataUrl: string; bounds: { x: number; y: number; width: number; height: number } }
    ): void => {
      const { dataUrl, bounds } = payload
      setCapturedImage(dataUrl)
      setDisplayBounds(bounds)

      if (canvasRef.current) {
        const canvas = canvasRef.current
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const img = new Image()
          img.onload = (): void => {
            ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight)
            const sx = img.naturalWidth / window.innerWidth
            const sy = img.naturalHeight / window.innerHeight
            setScale({ sx, sy })
            window.electron.ipcRenderer.send('screenshot-rendered')
          }
          img.src = dataUrl
        }
      }
    }

    window.electron.ipcRenderer.on('init-screenshot', handleInitScreenshot)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('init-screenshot')
    }
  }, [])

  // Multi-screen capture is performed in the initial effect above

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!capturedImage) return
    // If clicking on toolbar buttons, don't start selection
    if ((e.target as HTMLElement).tagName === 'BUTTON') return

    setIsSelecting(true)
    setStartPos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!isSelecting || !startPos) return
    const currentX = e.clientX
    const currentY = e.clientY

    const x = Math.min(startPos.x, currentX)
    const y = Math.min(startPos.y, currentY)
    const w = Math.abs(currentX - startPos.x)
    const h = Math.abs(currentY - startPos.y)

    setSelection({ x, y, w, h })
  }

  const handleMouseUp = (): void => {
    setIsSelecting(false)
  }

  const handleCancel = (): void => {
    setSelection(null)
    window.electron.ipcRenderer.send('close-screenshot')
  }

  const getCroppedBlob = async (): Promise<Blob> => {
    const canvas = document.createElement('canvas')
    // Handle high DPI if needed, but here we work with logical pixels from canvasRef
    // Actually, capturedImage is from canvasRef which is window.innerWidth x window.innerHeight
    // So pixel coordinates match.

    canvas.width = selection!.w
    canvas.height = selection!.h
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.src = capturedImage!
    await new Promise((r) => (img.onload = r))

    // Draw cropped area
    const sx = Math.round(selection!.x * scale.sx)
    const sy = Math.round(selection!.y * scale.sy)
    const sw = Math.round(selection!.w * scale.sx)
    const sh = Math.round(selection!.h * scale.sy)
    ctx!.drawImage(img, sx, sy, sw, sh, 0, 0, selection!.w, selection!.h)

    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!)))
  }

  const getCroppedBase64 = async (): Promise<string> => {
    const blob = await getCroppedBlob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
  }

  const handleSave = async (): Promise<void> => {
    if (!selection || !capturedImage) return
    const blob = await getCroppedBlob()
    const buffer = await blob.arrayBuffer()
    window.electron.ipcRenderer.send('save-file-request', new Uint8Array(buffer))
  }

  const handleClipboard = async (): Promise<void> => {
    if (!selection || !capturedImage) return
    const blob = await getCroppedBlob()
    const buffer = await blob.arrayBuffer()
    window.electron.ipcRenderer.send('copy-to-clipboard', new Uint8Array(buffer))
    window.electron.ipcRenderer.send('close-screenshot')
  }

  const handleMove = async (): Promise<void> => {
    console.log('Renderer: handleMove called')
    if (!selection || !capturedImage) {
      console.warn('Renderer: Missing selection or capturedImage', {
        selection,
        hasImage: !!capturedImage
      })
      return
    }

    try {
      console.log('Renderer: Generating cropped base64...')
      const base64 = await getCroppedBase64()
      console.log('Renderer: Base64 generated, length:', base64.length)

      console.log('Renderer: Sending pin-screenshot IPC...')
      window.electron.ipcRenderer.send('pin-screenshot', {
        imageDataUrl: base64,
        bounds: {
          x: (displayBounds?.x || 0) + selection.x,
          y: (displayBounds?.y || 0) + selection.y,
          width: selection.w,
          height: selection.h
        }
      })
      console.log('Renderer: IPC sent')
    } catch (err) {
      console.error('Renderer: Error in handleMove:', err)
    }
  }

  const handleReset = (): void => {
    setSelection(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (selection) {
          setIsSelecting(false)
          setSelection(null)
        } else {
          window.electron.ipcRenderer.send('close-screenshot')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [selection])

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'crosshair',
        userSelect: 'none'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <video ref={videoRef} style={{ display: 'none' }} />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />

      {/* Overlay Dimmer via Box Shadow */}
      {capturedImage && selection && selection.w > 0 && selection.h > 0 && (
        <div
          style={{
            position: 'absolute',
            left: selection.x,
            top: selection.y,
            width: selection.w,
            height: selection.h,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
            border: '2px solid #00bfff',
            pointerEvents: 'none' // Let clicks pass through to container for drag end
          }}
        >
          {/* Toolbar */}
          {!isSelecting && selection.w > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: -45,
                right: 0,
                display: 'flex',
                gap: 8,
                backgroundColor: '#333',
                padding: 8,
                borderRadius: 4,
                pointerEvents: 'auto',
                boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                zIndex: 100
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button onClick={handleReset} title="Cancel Selection" style={btnStyle}>
                ❌ Cancel
              </button>
              <button onClick={handleClipboard} title="Save to Clipboard" style={btnStyle}>
                📋 Copy
              </button>
              <button onClick={handleSave} title="Save to File" style={btnStyle}>
                💾 Save
              </button>
              <button onClick={handleMove} title="Pin to Screen" style={btnStyle}>
                📌 Pin
              </button>
            </div>
          )}
        </div>
      )}

      {/* Close button for global cancel (if no selection) */}
      {!selection && (
        <button
          onClick={handleCancel}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            zIndex: 100,
            fontSize: 20,
            cursor: 'pointer'
          }}
        >
          ✖
        </button>
      )}
    </div>
  )
}

const btnStyle = {
  background: 'transparent',
  border: 'none',
  color: 'white',
  cursor: 'pointer',
  fontSize: '14px',
  display: 'flex',
  alignItems: 'center',
  gap: 4
}
