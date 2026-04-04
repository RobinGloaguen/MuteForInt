// src/app/doc/causal-service/IMessage.ts
import { Observable, Subject , Subscription} from 'rxjs';
import { Streams, StreamsSubtype } from '../Streams';
import {filter, map} from "rxjs/operators";

export interface StreamId {
  type: Streams
  subtype: StreamsSubtype
}
interface IMessage {
  streamId: StreamId
  content: Uint8Array
}

export interface IMessageIn extends IMessage {
  senderNetworkId: number
}

export interface IMessageOut extends IMessage {
  recipientNetworkId?: number // O value means send to a random peer
}


export abstract class Disposable {
  private subs: Subscription[]

  constructor() {
    this.subs = []
  }

  protected set newSub(sub: Subscription) {
    this.subs[this.subs.length] = sub
  }

  protected dispose() {
    this.subs.forEach((s) => s.unsubscribe())
  }
}


export interface IMessageFactory<OutMsg, InMsg extends OutMsg> {
  create: (properties?: OutMsg) => InMsg
  encode: (message: OutMsg) => { finish: () => Uint8Array }
  decode: (reader: Uint8Array) => InMsg
}

export abstract class Service<OutMsg, InMsg extends OutMsg> extends Disposable {
  protected messageIn$: Observable<{ senderNetworkId: number; msg: InMsg }>

  private messageOut$: Subject<IMessageOut>
  private streamId: Streams
  /*
   * Service protobufjs object generated from `.proto` file.
   */
  private proto: IMessageFactory<OutMsg, InMsg>

  constructor(
    messageIn: Observable<IMessageIn>,
    messageOut: Subject<IMessageOut>,
    myStreamId: Streams,
    proto: IMessageFactory<OutMsg, InMsg>
  ) {
    super()
    this.proto = proto
    this.messageIn$ = messageIn.pipe(
      filter(({ streamId }) => streamId.type === myStreamId),
      map(({ senderNetworkId, content }) => ({ senderNetworkId, msg: proto.decode(content) }))
    )
    this.messageOut$ = messageOut
    this.streamId = myStreamId
  }

  protected send(msg: OutMsg, subtype: StreamsSubtype, recipientNetworkId?: number) {
    this.messageOut$.next({
      streamId: { type: this.streamId, subtype },
      recipientNetworkId,
      content: this.proto.encode(this.proto.create(msg)).finish(),
    })
  }
}
