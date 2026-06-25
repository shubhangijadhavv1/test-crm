import mongoose from 'mongoose'
import { env } from './env'

let memoryServer: { stop: () => Promise<unknown> } | null = null

/**
 * Connect to MongoDB. If MONGODB_URI is set, use it (local mongod / Atlas).
 * Otherwise spin up an in-memory MongoDB so the API runs with zero setup.
 */
export async function connectDB(): Promise<{ uri: string; inMemory: boolean }> {
  let uri = env.mongoUri
  let inMemory = false

  if (!uri) {
    // Lazy import so production builds without the dev dependency still work.
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    const mem = await MongoMemoryServer.create()
    uri = mem.getUri('gdc-crm')
    memoryServer = mem
    inMemory = true
  }

  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  return { uri, inMemory }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect()
  if (memoryServer) await memoryServer.stop()
}
