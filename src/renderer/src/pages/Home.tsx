export const Home = () => {
  const startScreenshot = async () => {
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 20
      }}
    >
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
