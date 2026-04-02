import implementation from './implementation.js'

const unsupported = { isSupported: false }

export default process.platform === 'darwin' ? implementation : unsupported
