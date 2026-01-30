import { useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'

export const Pin = () => {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const location = useLocation()

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.body.style.backgroundImage = 'none'
    
    // In HashRouter, the query string is available in location.search
    // e.g., /#/pin?id=123 -> pathname: '/pin', search: '?id=123'
    const searchParams = new URLSearchParams(location.search)
    const id = searchParams.get('id')
    
    // Fallback: manually parse window.location.hash if useLocation fails us
    const hashId = !id && window.location.hash.includes('?') 
        ? new URLSearchParams(window.location.hash.split('?')[1]).get('id') 
        : null

    const finalId = id || hashId
    
    console.log('Pin: Init', { location, finalId })
    
    if (finalId) {
        window.electron.ipcRenderer.invoke('get-pin-image', finalId).then(img => {
            console.log('Pin: Got image data', { length: img?.length })
            setImgSrc(img)
        })
    }
  }, [location])

  const closeWindow = () => {
    // Since this is a separate window, we can just close it.
    // But window.close() might be blocked if not opened by script.
    // However, this window is created by Main process, so renderer close() works if enabled.
    // Or send IPC.
    window.close()
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'transparent'
      }}
    >
      <img
        src={imgSrc || ''}
        style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        draggable={false}
      />

      {/* Drag Handle Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          cursor: 'move',
          ['WebkitAppRegion' as any]: 'drag'
        }}
      ></div>

      {/* Close Button */}
      <button
        style={{
          position: 'absolute',
          top: -10,
          left: -10,
          width: 30,
          height: 30,
          zIndex: 20,
          cursor: 'pointer',
          ['WebkitAppRegion' as any]: 'no-drag',
          borderRadius: '50%',
          background: 'red',
          color: 'white',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 10,
          paddingLeft: 10
        }}
        onClick={closeWindow}
      >
        x
      </button>
    </div>
  )
}
