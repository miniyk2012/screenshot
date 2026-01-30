import React, { useEffect, useRef, useState } from 'react'

export const Screenshot = () => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  )
  const [isSelecting, setIsSelecting] = useState(false)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    // Clear default body styles for transparent window
    document.body.style.background = 'transparent'
    document.body.style.backgroundImage = 'none'

    const getSources = async () => {
      try {
        const sources = await window.electron.ipcRenderer.invoke('get-screen-sources')
        if (!sources || sources.length === 0) {
          console.warn('No screen sources found. Check permissions.')
          return
        }
        const source = sources[0]
        if (source) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: source.id,
                  maxWidth: 4000,
                  maxHeight: 4000
                }
              } as any
            })
            setStream(stream)
            if (videoRef.current) {
              videoRef.current.srcObject = stream
              videoRef.current.play()
            }
          } catch (e) {
            console.error(e)
          }
        }
      } catch (e) {
        console.error('Failed to get sources in renderer:', e)
      }
    }
    getSources()

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.onloadedmetadata = () => {
        // Short delay to ensure frame is ready
        setTimeout(() => {
          if (!canvasRef.current || !videoRef.current) return
          const canvas = canvasRef.current
          const video = videoRef.current

          // Match window size
          canvas.width = window.innerWidth
          canvas.height = window.innerHeight

          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            setCapturedImage(canvas.toDataURL('image/png'))
            // Stop stream
            stream.getTracks().forEach((track) => track.stop())
          }
        }, 200)
      }
    }
  }, [stream])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!capturedImage) return
    // If clicking on toolbar buttons, don't start selection
    if ((e.target as HTMLElement).tagName === 'BUTTON') return

    setIsSelecting(true)
    setStartPos({ x: e.clientX, y: e.clientY })
    setSelection({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !startPos) return
    const currentX = e.clientX
    const currentY = e.clientY

    const x = Math.min(startPos.x, currentX)
    const y = Math.min(startPos.y, currentY)
    const w = Math.abs(currentX - startPos.x)
    const h = Math.abs(currentY - startPos.y)

    setSelection({ x, y, w, h })
  }

  const handleMouseUp = () => {
    setIsSelecting(false)
  }

  const handleCancel = () => {
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
    ctx!.drawImage(
      img,
      selection!.x,
      selection!.y,
      selection!.w,
      selection!.h,
      0,
      0,
      selection!.w,
      selection!.h
    )

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

  const handleSave = async () => {
    if (!selection || !capturedImage) return
    const blob = await getCroppedBlob()
    const buffer = await blob.arrayBuffer()
    window.electron.ipcRenderer.send('save-file-request', new Uint8Array(buffer))
  }

  const handleClipboard = async () => {
    if (!selection || !capturedImage) return
    const blob = await getCroppedBlob()
    const buffer = await blob.arrayBuffer()
    window.electron.ipcRenderer.send('copy-to-clipboard', new Uint8Array(buffer))
    window.electron.ipcRenderer.send('close-screenshot')
  }

  const handleMove = async () => {
     console.log('Renderer: handleMove called')
     if(!selection || !capturedImage) {
         console.warn('Renderer: Missing selection or capturedImage', { selection, hasImage: !!capturedImage })
         return
     }
     
     try {
         console.log('Renderer: Generating cropped base64...')
         const base64 = await getCroppedBase64()
         console.log('Renderer: Base64 generated, length:', base64.length)
         
         console.log('Renderer: Sending pin-screenshot IPC...')
         window.electron.ipcRenderer.send('pin-screenshot', { 
             imageDataUrl: base64, 
             bounds: { x: selection.x, y: selection.y, width: selection.w, height: selection.h } 
         })
         console.log('Renderer: IPC sent')
     } catch (err) {
         console.error('Renderer: Error in handleMove:', err)
     }
  }

  const handleReset = () => {
    setSelection(null)
  }

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
      {capturedImage && selection && (
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
