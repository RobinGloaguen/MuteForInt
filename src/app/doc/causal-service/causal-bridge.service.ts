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
  // Bus partagé réseau → services
  private MessageInFromNetworkToCore$: Subject<MuteCoreMessageIn> //todo ici changé IMessageIn en any
  private MessageInFromNetworkToCausal$: Subject<IMessageIn> //todo ici changé IMessageIn en any
  // Bus partagé services → réseau
  public sharedMessageOut$: Subject<IMessageOut> //todo ici changé IMessageOut en any
  private causalService: CausalService | null = null
  private subs: Subscription[] = []
    // Référence interne, exposée pour setMuteCoreMessageOut
  private _fromMuteCoreSubject: Subject<Uint8Array> | null = null

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
    //MuteCore reçoit un cast des messages entrant vers le bon type si c'est différent de CausalNode
    //Sinon envoie a CausalNode
    this.subs.push(
      this.network.messageIn.subscribe((msg) => {
          console.warn('Bridge reçoit type:', msg.streamId.type, 'subtype:', msg.streamId.subtype)
        if (msg.streamId.type === Streams.CAUSALNODE || ((msg.streamId.type === Streams.DOCUMENT_CONTENT && 
    msg.streamId.subtype === StreamsSubtype.DOCUMENT_OPERATION))) {
          console.warn("--- LE CAUSAL RECOIT")
          this.MessageInFromNetworkToCausal$.next(msg)
        }else if (
            msg.streamId.type === Streams.DOCUMENT_CONTENT &&
            (msg.streamId.subtype === StreamsSubtype.DOCUMENT_QUERY || msg.streamId.subtype === StreamsSubtype.DOCUMENT_REPLY)
          ) {
            // Bloquer pour tester causal — décommenter pour remettre la sync d'état
            // this.MessageInFromNetworkToCore$.next(msg)
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
    console.log('[CausalBridge] messageInForMuteCore getter appelé');
    return merge(
      this.MessageInFromNetworkToCore$.asObservable().pipe(
        tap((msg: any) => {
          if (msg?.streamId?.type === 400 || msg?.streamId?.type === 401) {
            console.log(`[CausalBridge] ✅ Message ${msg.streamId.type} transmis à muteCore (direct)`);
          }
        })
        
      ),

      //      this.deliverSubject.next(new causal.CausalMsg({ mid : {sd, sn}, initialSender: sd, type: causal.CausalType.DELIVER, content }))

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
          console.warn("--- Mute core envoie a causal")
        } else {
          //Sinon on envoie direct dans le réseau
          this.sharedMessageOut$.next(msg as unknown as IMessageIn) 
          //console.warn("Mute core envoie direct dans le réseau")        
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe())
    this.sharedMessageOut$.complete()
  }
}
