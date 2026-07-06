const router = require('express').Router()
const http   = require('http')
const dgram  = require('dgram')
const config = require('../config')
const { getHeartbeat } = require('./servers')

// UDP reachability check; the game port does not accept TCP.
function udpCheck(host, port) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4')
    const msg = Buffer.from('ping')
    let resolved = false

    const done = (result) => {
      if (resolved) return
      resolved = true
      try { socket.close() } catch {}
      resolve(result)
    }

    socket.on('error', () => done(false))

    socket.send(msg, 0, msg.length, port, host, (err) => {
      if (err) return done(false)
      done(true)
    })

    setTimeout(() => done(false), 3000)
  })
}

// Fetch Prometheus metrics from SkyMP HTTP UI and derive online player count.
// Online players ≈ skymp_connects_total − skymp_disconnects_total
function fetchPlayerCount(host, uiPort) {
  return new Promise(resolve => {
    const req = http.get(
      { hostname: host, port: uiPort, path: '/metrics', timeout: 3000 },
      res => {
        let raw = ''
        res.on('data', c => { raw += c })
        res.on('end', () => {
          const val = name => {
            const m = raw.match(new RegExp(`^${name}\\s+(\\d+)`, 'm'))
            return m ? parseInt(m[1], 10) : null
          }
          const connects    = val('skymp_connects_total')
          const disconnects = val('skymp_disconnects_total')
          if (connects !== null && disconnects !== null) {
            resolve(Math.max(0, connects - disconnects))
          } else {
            resolve(null)
          }
        })
      }
    )
    req.on('error',   () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

// server heartbeats every ~5s; allow a few misses before calling it offline
const HEARTBEAT_TTL_MS = 20_000

router.get('/', async (_req, res) => {
  const { skyrimServerHost: host, skyrimServerPort: gamePort, skympUiPort: uiPort } = config
  const hb = getHeartbeat()

  // a fresh heartbeat proves the server process is up; fall back to UDP only if none seen
  let online
  if (hb && hb.lastSeen) {
    online = (Date.now() - new Date(hb.lastSeen).getTime()) < HEARTBEAT_TTL_MS
  } else {
    online = await udpCheck(host, gamePort)
  }

  // player count from the heartbeat, else from Prometheus /metrics
  let players = null
  if (online) {
    players = (hb && typeof hb.online === 'number') ? hb.online : await fetchPlayerCount(host, uiPort)
  }

  res.json({ status: online ? 'online' : 'offline', players })
})

module.exports = router
