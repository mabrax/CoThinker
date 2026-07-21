import { loadLocalEnvironment } from './environment.js'

loadLocalEnvironment()

const { startServer } = await import('./index.js')

startServer()
