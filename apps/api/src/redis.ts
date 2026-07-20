import { Redis } from 'ioredis'

import { env } from './env'

// The db index is part of REDIS_URL (…:6379/2). This is a shared, unauthenticated
// dev instance, so the index is a convention between projects, not a boundary.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

redis.on('error', (err) => {
  console.error('[redis]', err.message)
})

export async function pingRedis(): Promise<boolean> {
  try {
    if (redis.status === 'wait') await redis.connect()
    return (await redis.ping()) === 'PONG'
  } catch {
    return false
  }
}
