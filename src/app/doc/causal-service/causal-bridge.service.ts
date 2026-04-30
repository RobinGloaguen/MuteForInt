import { Injectable, OnDestroy } from '@angular/core'
import {BehaviorSubject, merge, Observable, Subject, Subscription} from 'rxjs'

import { IMessageIn , IMessageOut , StreamId  } from './IMessage'
import { SettingsService } from '@app/core/settings'
import { NetworkServiceAbstracted } from '../network/network.service.abstracted'
import {Streams, StreamsSubtype} from '../Streams'

//Venant de Core ou ce qu'on va lui donner
import {Streams as MuteCoreStream, StreamsSubtype as MuteCoreStreamsSubType } from '@coast-team/mute-core'
import { IMessageIn as MuteCoreMessageIn, IMessageOut as MuteCoreMessageOut } from '@coast-team/mute-core/dist/types/src/misc'
//import { doc as proto } from '@coast-team/mute-core/dist/types/src/proto'
//Il faut le décoder spécifique de proto


// Imports depuis causal-broadcast
// Adapter le chemin selon l'organisation finale de ton projet
import { CausalService } from './CausalService'
import {filter, map, tap} from "rxjs/operators";

@Injectable()
export class CausalBridgeService implements OnDestroy {

  private _joinedPeers: number[] = []
  private _nbCollab = 6  // ou récupéré depuis settings

      // ---- RTT ping/pong ----
  private pingTimestamps: Map<string, number> = new Map()  // key: "sd:sn"
  private pingTriggered = false


  // Bus partagé réseau → services
  private MessageInFromNetworkToCore$: Subject<MuteCoreMessageIn> //todo ici changé IMessageIn en any
  private MessageInFromNetworkToCausal$: Subject<IMessageIn> //todo ici changé IMessageIn en any
  // Bus partagé services → réseau
  public sharedMessageOut$: Subject<IMessageOut> //todo ici changé IMessageOut en any
  private causalService: CausalService | null = null
  private subs: Subscription[] = []
    // Référence interne, exposée pour setMuteCoreMessageOut
  private _fromMuteCoreSubject: Subject<Uint8Array> | null = null

  private myNetworkId? : number

  constructor(
    private network: NetworkServiceAbstracted,
    private settings: SettingsService
  ) {
    this.sharedMessageOut$ = new Subject<IMessageOut>()
    this.MessageInFromNetworkToCausal$ = new Subject<IMessageIn>()
    this.MessageInFromNetworkToCore$ = new Subject<MuteCoreMessageIn>()

  }

  /**
   * À appeler dans doc.service.ts > joinSession(),
   * juste avant les deux lignes de connexion muteCore ↔ réseau.
   *
   * @param myNetworkId  L'identifiant réseau local (network.myNetworkId)
   * @param myPeerId     Le peerId libp2p local (network.solution.libp2pInstance.peerId.toString())
   */
  init(myNetworkId: number, myPeerId: string): void {
    this.myNetworkId = myNetworkId
    this._joinedPeers.push(myNetworkId)
    //MuteCore reçoit un cast des messages entrant vers le bon type si c'est différent de CausalNode
    //Sinon envoie a CausalNode
    this.subs.push(
      this.network.messageIn.subscribe((msg) => {
          // ---- Interception ping/pong ----
      if (msg.streamId.type === Streams.PING_PONG) {
        const decoder = new TextDecoder()
        const text = decoder.decode(msg.content)
        
        if (msg.streamId.subtype === StreamsSubtype.PING) {
          const parts = text.split(':')
          const pingSd = Number(parts[1])
          const pingSn = Number(parts[2])
          this.respondToPing(pingSd, pingSn)
        } else if (msg.streamId.subtype === StreamsSubtype.PONG) {
          this.handlePongReceived(text, msg.senderNetworkId)
        }
        return  // ne pas router plus loin
      }


        if (msg.streamId.type === Streams.CAUSALNODE || ((msg.streamId.type === Streams.DOCUMENT_CONTENT && 
    msg.streamId.subtype === StreamsSubtype.DOCUMENT_OPERATION))) {
//console.log('Causal reçoit type:', Streams[msg.streamId.type], 'subtype:', StreamsSubtype[msg.streamId.subtype], 'avec le MID', )
          this.MessageInFromNetworkToCausal$.next(msg)
        }else if (
            msg.streamId.type === Streams.DOCUMENT_CONTENT &&
            (msg.streamId.subtype === StreamsSubtype.DOCUMENT_QUERY || msg.streamId.subtype === StreamsSubtype.DOCUMENT_REPLY)
          ) {
            //console.warn('Causal reçoit type:', Streams[msg.streamId.type], 'subtype:', StreamsSubtype[msg.streamId.subtype])

            //this.MessageInFromNetworkToCausal$.next(msg)

            // Bloquer pour tester causal — décommenter pour remettre la sync d'état
             //this.MessageInFromNetworkToCore$.next(msg as unknown as MuteCoreMessageIn)
          } else {
          this.MessageInFromNetworkToCore$.next(msg as unknown as MuteCoreMessageIn)
        }
          
      }
    )
    )

    // Les messages sortants du bus partagé partent sur le réseau.
    // muteCore et CausalService écrivent tous les deux dans sharedMessageOut$.
    this.subs.push(
      this.sharedMessageOut$.subscribe(({ streamId, content, recipientNetworkId }) => {
        this.network.send(streamId, content, recipientNetworkId)
      })
    )

    // Écoute des membres pour déclencher le ping quand tout le monde est là
    this.subs.push(
      this.network.onMemberJoin.subscribe((networkId: number) => {
        if (!this._joinedPeers.includes(networkId)) {
          this._joinedPeers.push(networkId)
          this._joinedPeers.sort((a, b) => a - b)

          if (this._joinedPeers.length === this._nbCollab && !this.pingTriggered) {
            this.pingTriggered = true
            //this.startPingRTT(this._joinedPeers)
          }
        }
      })
    )


    this._fromMuteCoreSubject  = new Subject<Uint8Array>()
    const myNetworkId$ = new BehaviorSubject<number>(myNetworkId)
    this.causalService = new CausalService(
      this.MessageInFromNetworkToCausal$.asObservable(),
      this.sharedMessageOut$,
      myNetworkId$.asObservable(),
      this._fromMuteCoreSubject.asObservable(),
      myPeerId,
      this.network.onMemberJoin,
      this.network.onMemberLeave
    )

  }

  get messageInForMuteCore(): Observable<any> {
    //MessageInFromNetworkToCore cast déjà dans le bon type
    return merge(
      this.MessageInFromNetworkToCore$.asObservable(),
      this.causalService!.deliverSubject.pipe(
          filter((msg) => !!msg?.content),
          map((msg) => {
            return {
              senderNetworkId: msg.senderNetworkId,
              streamId: { 
                type: MuteCoreStream.DOCUMENT_CONTENT, 
                subtype: MuteCoreStreamsSubType.DOCUMENT_OPERATION 
              },
              content: msg.content,
            } as unknown as MuteCoreMessageIn
          }),
          filter((msg: any) => msg !== null)
        ))

  }

  setMuteCoreMessageOut(source: Observable<any>): void {
    if (!this._fromMuteCoreSubject) {
      console.error('[CausalBridge] init() doit être appelé avant setMuteCoreMessageOut()');
      return;
    }

    this.subs.push(
      source.subscribe((msg) => {
        const { streamId, content, recipientNetworkId } = msg;
        // Si 402 = DocumentContent donc on envoie a Causal
        if (streamId.type === MuteCoreStream.DOCUMENT_CONTENT && streamId.subtype === MuteCoreStreamsSubType.DOCUMENT_OPERATION) {
         //On envoie directement le message codé
          // C'est bien un broadcast
          this._fromMuteCoreSubject!.next(content);
        }else if (
            msg.streamId.type === Streams.DOCUMENT_CONTENT &&
            (msg.streamId.subtype === StreamsSubtype.DOCUMENT_QUERY || msg.streamId.subtype === StreamsSubtype.DOCUMENT_REPLY)
          ) {
            
          }  else {
          //Sinon on envoie direct dans le réseau
          this.sharedMessageOut$.next(msg as unknown as IMessageIn) 
        }
      })
    );
  }

  // À appeler quand tous les peers sont connectés
private async startPingRTT(joinedPeers: number[]): Promise<void> {
  for (let i = 0; i < 5; i++) {
  await new Promise(resolve => setTimeout(resolve, 5000))

    if (joinedPeers[0] === this.myNetworkId!) {
      const sn = 1
      const key = this.makeKey(this.myNetworkId!, sn)
      this.pingTimestamps.set(key, Date.now())
      
      const encoder = new TextEncoder()
      const content = encoder.encode(`ping:${this.myNetworkId}:${sn}`)
      
      // Broadcast à tous via le réseau directement
      this.network.send(
        { type: Streams.PING_PONG, subtype: StreamsSubtype.PING },
        content,
        undefined  // broadcast
      )
    }
  }
}

private respondToPing(pingSd: number, pingSn: number): void {
  const encoder = new TextEncoder()
  const pongContent = encoder.encode(`pong:${pingSd}:${pingSn}`)
  
  this.network.send(
    { type: Streams.PING_PONG, subtype: StreamsSubtype.PONG },
    pongContent,
    pingSd  // réponse directe à l'émetteur du ping
  )
}

private handlePongReceived(text: string, pongSender: number): void {
  const parts = text.split(':')
  const pingSd = Number(parts[1])
  const pingSn = Number(parts[2])
  
  if (pingSd === this.myNetworkId) {
    const key = this.makeKey(pingSd, pingSn)
    const t0 = this.pingTimestamps.get(key)
    if (t0 !== undefined) {
      const rtt = Date.now() - t0
      const latency = rtt / 2
      console.log(`DIRECT [RTT] Pong de ${pongSender} → RTT=${rtt}ms, latence estimée ≈ ${latency}ms`)
    }
  }
}
// ---- Helpers clé composite ----

  private makeKey(sd: number, sn: number): string {
    return `${sd}:${sn}`
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe())
    this.sharedMessageOut$.complete()
  }
}
