import { Strategy } from '@coast-team/mute-core'
import { EncryptionType } from '@app/core/crypto/EncryptionType.model'
import { networkSolution } from '@app/doc/network/solutions/networkSolution'
import { IEnvironment, NetfluxLogLevel } from './IEnvironment.model'


const hostname = window.location.hostname
const isCodespace = hostname.endsWith('.app.github.dev')

// Sur codespace : potential-goldfish-xxx-4200.app.github.dev
// On remplace le port 4200 par 8010
const signalingHost = isCodespace
  ? hostname.replace('-4200.', '-8010.')
  : 'localhost'

const signalingServer = isCodespace
  ? `/dns4/${signalingHost}/tcp/443/wss/p2p-webrtc-star/`
  : `/dns4/localhost/tcp/8010/ws/p2p-webrtc-star/`

const signalingServerTestAddr = isCodespace
  ? `https://${signalingHost}`
  : `http://localhost:8010`


export const defaultEnvironment: IEnvironment = {
  production: false,

  network: networkSolution.LIBP2P,

  crdtStrategy: Strategy.LOGOOTSPLIT,

  debug: {
    visible: true,
    log: {
      netflux: [NetfluxLogLevel.DEBUG],
      crypto: false,
      doc: false,
    },
  },

   p2p: {
    rtcConfiguration: {
      iceServers: [
        {
          urls: 'stun:stun.stunprotocol.org',
        },
        {
          urls: 'stun:stun.framasoft.org',
        },
      ],
    },
    //libp2p value
    signalingServer: signalingServer,
    signalingServerTestAddr: signalingServerTestAddr,
    //netflux value
    //signalingServer: `ws://localhost:8010`,
  },

  cryptography: {
    type: EncryptionType.METADATA,
    // coniksClient: {
    //   url: 'https://localhost:3001', // Coniks clinet URL (must be a localhost)
    //   binaries: {
    //     linux: '',
    //     windows: '',
    //     macOS: '',
    //   },
    // },
    // keyserver: {
    //   urlPrefix: 'http://localhost:4000/public-key',
    // },
  },
}
