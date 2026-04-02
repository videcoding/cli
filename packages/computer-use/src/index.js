import implementation from './implementation.js'

if (process.platform !== 'darwin') {
  throw new Error('computer-use is only available on macOS')
}

export default implementation
