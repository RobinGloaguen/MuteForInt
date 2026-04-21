import { Observable, Subject } from 'rxjs'
import { IMessageIn, IMessageOut, Service } from './IMessage'
import { split, combine, interpolatePolynomial } from './shamit-secret-sharing'
import { causal } from './causal_proto.js'
import { StreamsSubtype, Streams } from '../Streams'

const CausalMsgFactory = causal.CausalMsg

// Broadcast causal byzantin : découpe les messages en shards (Shamir),
// les fait circuler via les phases SHARD → ATTEST → CONFIRM → REVEAL → WITNESS,
// puis reconstitue et livre le message original.
export class CausalService extends Service<causal.ICausalMsg, causal.ICausalMsg> {
  public myNetworkId$: Observable<number>
  public myNetworkId?: number

  // Registres des messages reçus par phase : "sd:sn" → ensemble des expéditeurs
  public witness: Map<string, Set<number>>
  public confirm: Map<string, Set<number>>
  public attest: Map<string, Set<number>>
  public reveal: Map<string, Set<number>>

  // Shards reçus : "sd:sn" → Map<sender, shard>
  public shard: Map<string, Map<number, Uint8Array>>
  // Anti-doublon pour les shards : "sd:sn" → ensemble des expéditeurs déjà vus
  public shardRegister: Map<string, Set<number>>

  // Anti-doublon pour les envois : empêche de renvoyer plusieurs fois la même phase
  private witnessSent: Set<string>
  private confirmSent: Set<string>
  private attestSent: Set<string>
  private revealSent: Set<string>

  // delivered : networkId → dernier sn livré
  // confirmed : networkId → dernier sn confirmé
  private delivered: Map<number, number>
  private confirmed: Map<number, number>

  // n = nbCollab collaborateurs, t = nbByz byzantins tolérés
  public nbCollab: number
  private nbByz: number

  // Contenu des WITNESS reçus : "sd:sn" → Map<sender, contenu|null>
  private witnessContent: Map<string, Map<number, Uint8Array | null>>

  // Processus suspectés d'être byzantins (pas de majorité de witness valides)
  private suspected: Set<number>

  public deliverSubject: Subject<{ senderNetworkId: number; content: Uint8Array }>
  public fifoBroadcastSubject: Subject<causal.ICausalMsg>
  public messageFromMuteCore$: Observable<Uint8Array>
  public myPeerId: string

  public joinedPeers: number[] = []

  private pingTriggered = false

  // File FIFO des messages à broadcaster, vidée en batch par la boucle d'envoi
  private broadcastBuffer: Queue<Uint8Array>

  constructor(
    messageIn$: Observable<IMessageIn>,
    messageOut$: Subject<IMessageOut>,
    myNetworkId$: Observable<number>,
    messageFromMuteCore$: Observable<Uint8Array>,
    myPeerId: string,
    memberJoin$: Observable<number>,
    memberLeave$: Observable<number>
  ) {
    super(messageIn$, messageOut$, Streams.CAUSALNODE as any, CausalMsgFactory)

    this.delivered = new Map()
    this.myPeerId = myPeerId

    this.broadcastBuffer = new Queue<Uint8Array>()

    this.myNetworkId$ = myNetworkId$
    this.myNetworkId$.subscribe(id => {
      this.myNetworkId = id
      this.joinedPeers.push(id)
      this.joinedPeers.sort((a, b) => a - b)
      this.delivered.set(id, 0)
    })
    this.deliverSubject = new Subject()
    this.fifoBroadcastSubject = new Subject()
    this.confirm = new Map()
    this.suspected = new Set()
    this.witness = new Map()
    this.attest = new Map()
    this.shard = new Map()
    this.witnessContent = new Map()
    this.reveal = new Map()
    this.shardRegister = new Map()
    this.confirmSent = new Set()
    this.witnessSent = new Set()
    this.revealSent = new Set()
    this.attestSent = new Set()
    this.confirmed = new Map()
    this.nbCollab = 6
    this.nbByz = 1

    memberJoin$.subscribe((networkId: number) => {
      if (!this.joinedPeers.includes(networkId)) {
        this.joinedPeers.push(networkId)
        this.joinedPeers.sort((a, b) => a - b)
        this.delivered.set(networkId, 0)

        // Démarre la mesure de latence dès que tous les pairs sont connectés
        if (this.joinedPeers.length === this.nbCollab && !this.pingTriggered) {
          this.pingTriggered = true
          this.startPingRTT()
        }
      }
    })

    memberLeave$.subscribe((networkId: number) => {
      this.joinedPeers = this.joinedPeers.filter(id => id !== networkId)
    })

    this.messageFromMuteCore$ = messageFromMuteCore$

    // Mesure la latence de bout en bout à chaque message reçu de Mute-Core
    this.messageFromMuteCore$.subscribe(msg => {
      this.measureCausalLatency(msg).then(latency => {
        console.log(`Latence de causal_broadcast : ${latency} ms`)
      })
    })

    // Dispatch des messages réseau entrants selon leur phase
    this.messageIn$.subscribe(async ({ senderNetworkId, msg }) => {
      const idSender = senderNetworkId
      const past = msg.deliveredSd as { [k: string]: number } | null
      const shard = msg.shard
      const mid = msg.mid
      const conf = msg.confirmed
      const content = msg.content
      const key = this.makeKey(mid!.sd!, mid!.sn!)
      console.log(
        'Causal reçoit type:',
        causal.CausalType[msg.type!],
        'avec le MID',
        mid?.sd,
        ':',
        mid?.sn,
        'envoyé par ',
        idSender
      )

      switch (msg.type) {
        case causal.CausalType.SHARD: {
          await this.handleShard(mid!, shard!, past as { [k: string]: number }, idSender)
          break
        }

        // Shard révélé par un pair : attend la causalité puis tente la livraison
        case causal.CausalType.REVEAL: {
          if (this.hasInSet(this.reveal, key, idSender)) return
          this.addToSet(this.reveal, key, idSender)

          // Attend que tous les messages dont dépend ce reveal soient livrés et confirmés
          await this.waitUntil(() => {
            const entries = Object.entries(past!)
            return entries.every(([k, v]) => {
              const kNum = Number(k)
              const deliveredK = this.delivered.get(kNum) ?? 0
              if (deliveredK < v) return false
              const confK = conf![k] ?? 0
              const isSuspected = this.suspected.has(kNum)
              return deliveredK >= confK || isSuspected
            })
          })
          this.setShardForMessage(mid!.sd!, mid!.sn!, idSender, shard!)

          const shardCount = this.shard.get(key)?.size ?? 0
          if (shardCount === this.nbCollab - 2 * this.nbByz) {
            await this.try_deliver(mid!.sd!, mid!.sn!)
          }
          break
        }

        case causal.CausalType.ATTEST: {
          if (this.hasInSet(this.attest, key, idSender)) return
          this.addToSet(this.attest, key, idSender)
          break
        }

        case causal.CausalType.CONFIRM: {
          if (this.hasInSet(this.confirm, key, idSender)) return
          this.addToSet(this.confirm, key, idSender)
          break
        }

        // Si majorité de witness concordants → on relaie le nôtre
        // Si pas de majorité → on suspecte l'expéditeur initial
        case causal.CausalType.WITNESS: {
          if (this.hasInSet(this.witness, key, idSender)) return
          this.setWitnessContent(mid!.sd!, mid!.sn!, idSender, content ?? null)
          this.addToSet(this.witness, key, idSender)
          const count = this.getCountFromSet(this.witness, key)

          const m = this.getWinningWitness(
            mid!.sd!,
            mid!.sn!,
            this.nbCollab - 2 * this.nbByz
          )
          if (count >= this.nbCollab - this.nbByz) {
            if (m == null || m == undefined) {
              this.suspected.add(mid!.sd!)
            }
          }

          if (m !== undefined && !this.witnessSent.has(key)) {
            this.witnessSent.add(key)
            const witnessMsg = new causal.CausalMsg({
              mid,
              initialSender: mid!.sd,
              type: causal.CausalType.WITNESS,
              content: m
            })
            this.addToSet(this.witness, key, this.myNetworkId!)
            this.send(witnessMsg, StreamsSubtype.CAUSAL_WITNESS as any)
          }

          break
        }
      }
    })

    this.startBroadcastLoop()
  }

  // Clé composite identifiant un message : "sd:sn"
  private makeKey(sd: number, sn: number): string {
    return `${sd}:${sn}`
  }

  private hasInSet(register: Map<string, Set<number>>, key: string, sender: number): boolean {
    return register.get(key)?.has(sender) ?? false
  }

  private addToSet(map: Map<string, Set<number>>, key: string, sender: number): void {
    let inner = map.get(key)
    if (!inner) {
      inner = new Set()
      map.set(key, inner)
    }
    inner.add(sender)
  }

  private getCountFromSet(map: Map<string, Set<number>>, key: string): number {
    return map.get(key)?.size ?? 0
  }

  private setShardForMessage(sd: number, sn: number, sender: number, shard: Uint8Array): void {
    const key = this.makeKey(sd, sn)
    let inner = this.shard.get(key)
    if (!inner) {
      inner = new Map()
      this.shard.set(key, inner)
    }
    inner.set(sender, Uint8Array.from(shard))
  }

  protected getShardsForMessage(sd: number, sn: number): Uint8Array[] {
    return Array.from(this.shard.get(this.makeKey(sd, sn))?.values() ?? [])
  }

  protected getMapShardsForMessage(sd: number, sn: number): Map<number, Uint8Array> {
    return this.shard.get(this.makeKey(sd, sn)) ?? new Map()
  }

  private setWitnessContent(sd: number, sn: number, sender: number, val: Uint8Array | null): void {
    const key = this.makeKey(sd, sn)
    let inner = this.witnessContent.get(key)
    if (!inner) {
      inner = new Map()
      this.witnessContent.set(key, inner)
    }
    inner.set(sender, val)
  }

  private getAllWitnessContent(sd: number, sn: number): Map<number, Uint8Array | null> {
    return this.witnessContent.get(this.makeKey(sd, sn)) ?? new Map()
  }

  // Retourne le contenu majoritaire parmi les WITNESS reçus :
  // undefined = pas encore assez, null = majorité null (byzantin), Uint8Array = valeur valide
  private getWinningWitness(
    sd: number,
    sn: number,
    borne: number
  ): Uint8Array | null | undefined {
    const witnesses = this.getAllWitnessContent(sd, sn)
    const counts = new Map<string, { count: number; value: Uint8Array | null }>()
    for (const [, m] of witnesses) {
      const key = m === null ? '__null__' : Array.from(m).join(',')
      const existing = counts.get(key)
      if (existing) {
        existing.count++
      } else {
        counts.set(key, { count: 1, value: m })
      }
    }

    for (const { count, value } of counts.values()) {
      if (count >= borne) return value
    }

    return undefined
  }

  // Tente de reconstruire le message à partir des shards reçus,
  // envoie un WITNESS, puis attend la majorité avant de livrer à Mute-Core
  protected async try_deliver(sd: number, sn: number) {
    const key = this.makeKey(sd, sn)
    const trydelTime = Date.now()

    const shardsForPoly = this.existancePolynome(sd, sn)

    this.logStep(key, `A checker l'existence du poly`, trydelTime)
    if (shardsForPoly == null) {
      console.log('----- PAS DE SOLUTION TROUVÉ POUR LE POLY --------')
    }

    // Envoie un WITNESS avec le contenu reconstruit, ou null si reconstruction impossible
    if (shardsForPoly != null) {
      console.warn(
        "-----Taille de shard qu'on renvoie pour reconsruire le poly :-----" +
          shardsForPoly.size
      )
      const shardArray = [...shardsForPoly.entries()].map(([, shard]) => shard)
      const encodeContent = await combine(shardArray)
      if (!this.witnessSent.has(key)) {
        this.witnessSent.add(key)
        this.setWitnessContent(sd, sn, this.myNetworkId!, encodeContent)
        this.addToSet(this.witness, key, this.myNetworkId!)
        const witnessMsg = new causal.CausalMsg({
          mid: { sd, sn },
          initialSender: sd,
          type: causal.CausalType.WITNESS,
          content: encodeContent
        })
        this.send(witnessMsg, StreamsSubtype.CAUSAL_WITNESS as any)
      }
    } else {
      if (!this.witnessSent.has(key)) {
        this.witnessSent.add(key)
        this.addToSet(this.witness, key, this.myNetworkId!)
        this.setWitnessContent(sd, sn, this.myNetworkId!, null)
        const witnessMsg = new causal.CausalMsg({
          mid: { sd, sn },
          initialSender: sd,
          type: causal.CausalType.WITNESS,
          content: null
        })
        this.send(witnessMsg, StreamsSubtype.CAUSAL_WITNESS as any)
      }
    }

    this.logStep(key, `Avant le wait de try_del`, trydelTime)
    await this.waitUntil(() => {
      return this.getWinningWitness(sd, sn, this.nbCollab - this.nbByz) !== undefined
    })
    this.logStep(key, `Apres le wait de try_del`, trydelTime)

    const m = this.getWinningWitness(sd, sn, this.nbCollab - this.nbByz)
    if (m != null) {
      const msgs: Uint8Array[] = []
      try {
        // Tentative de décodage batch : [uint32 len][msg bytes]...
        let offset = 0
        const view = new DataView(m.buffer, m.byteOffset, m.byteLength)

        while (offset + 4 <= m.length) {
          const len = view.getUint32(offset, false)
          offset += 4
          if (len === 0) continue
          if (offset + len > m.length) {
            throw new Error('Batch tronqué')
          }
          const slice = m.slice(offset, offset + len)
          offset += len
          msgs.push(slice)
        }

        if (msgs.length > 0) {
          const decoder = new TextDecoder()

          for (const msg of msgs) {
            const text = decoder.decode(msg)

            // Ping interne : mesure la latence entre envoi et réception
            if (text.startsWith('ping:')) {
                if (sd !== this.myNetworkId) {
                    const receiveTime = Date.now()
                    const sendTime = Number(text.split(':')[1])
                    const latency = receiveTime - sendTime
                    console.log(`[LATENCE] Message ping reçu de ${sd} → latence = ${latency}ms`)
                }
                continue
            }

            this.deliverSubject.next({ senderNetworkId: sd, content: msg })
          }

          this.delivered.set(sd, sn)
          return
        }
      } catch {
        // Pas un batch valide → fallback message simple
      }

        const decoder = new TextDecoder()
        const contentStr = decoder.decode(m)
        this.deliverSubject.next({ senderNetworkId: sd, content: m })
        console.warn("---- J'ai deliver un message simple------")
      
    } else {
      console.warn("---- J'ai deliver c'était null------")
    }

    this.delivered.set(sd, sn)
  }

  // Vérifie qu'il existe un polynôme de degré t cohérent avec au moins (n-3t) shards.
  // Retourne les (t+1) shards de la combinaison valide, ou null si aucune trouvée.
  protected existancePolynome(sd: number, sn: number): Map<number, Uint8Array> | null {
    const shards = this.getMapShardsForMessage(sd, sn)
    const n = this.nbCollab
    const t = this.nbByz
    const d = t
    const validationThreshold = n - 3 * t

    if (shards.size < n - 2 * t) return null

    const entries = Array.from(shards.entries())

    const basePoints = entries.map(([id, share]) => ({
      id,
      share,
      x: share[share.length - 1]!
    }))

    const shardLength = entries[0][1].length

    // Génère toutes les combinaisons de (d+1) shards parmi ceux reçus
    function* shardCombinations(
      points: { id: number; share: Uint8Array; x: number }[],
      k: number
    ): Generator<{ id: number; share: Uint8Array; x: number }[]> {
      function* backtrack(
        start: number,
        current: { id: number; share: Uint8Array; x: number }[]
      ): Generator<{ id: number; share: Uint8Array; x: number }[]> {
        if (current.length === k) {
          yield [...current]
          return
        }
        for (let i = start; i < points.length; i++) {
          current.push(points[i])
          yield* backtrack(i + 1, current)
          current.pop()
        }
      }
      yield* backtrack(0, [])
    }

    // Pour chaque combinaison, vérifie si le polynôme interpolé est cohérent
    // avec au moins (n-3t) shards reçus (seuil de tolérance byzantine)
    for (const combo of shardCombinations(basePoints, d + 1)) {
      let isValidCombo = true

      for (let i = 0; i < shardLength - 1; i++) {
        const xSamples = new Uint8Array(combo.map(c => c.x))
        const ySamples = new Uint8Array(combo.map(c => c.share[i]!))

        let validCount = 0
        for (const p of basePoints) {
          const expected = interpolatePolynomial(xSamples, ySamples, p.x)
          if (expected === p.share[i]) validCount++
        }

        if (validCount < validationThreshold) {
          isValidCombo = false
          break
        }
      }

      if (isValidCombo) {
        const result = new Map<number, Uint8Array>()
        for (const p of combo) {
          result.set(p.id, p.share)
        }
        return result
      }
    }

    return null
  }

  protected evaluatePolynomial(polynomial: (x: number) => number, x: number): number {
    return polynomial(x)
  }

  protected mapToObj(map: Map<number, number>): { [k: string]: number } {
    const obj: { [k: string]: number } = {}
    map.forEach((val, key) => {
      obj[key] = val
    })
    return obj
  }

  // Attend en boucle (polling 50ms) que la condition soit vraie
  protected waitUntil(cond: () => boolean, interval = 50): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (cond()) resolve()
        else setTimeout(check, interval)
      }
      check()
    })
  }

  private waitUntilDelivered(sd: number, sn: number): Promise<void> {
    return this.waitUntil(() => (this.delivered.get(sd) ?? 0) >= sn)
  }

  // Boucle infinie qui traite le broadcastBuffer dès qu'il contient des messages
  private startBroadcastLoop() {
    const loop = async () => {
      while (true) {
        try {
          await this.try_broadcast()
        } catch (e) {
          console.error('[BroadcastLoop] Erreur dans try_broadcast :', e)
        }
      }
    }
    loop()
  }

  // Vide tout le buffer en un seul batch, le sérialise en [len][msg]...,
  // le broadcast, puis attend sa livraison avant le batch suivant
  private async try_broadcast() {
    if (this.broadcastBuffer.isEmpty()) {
      await new Promise(resolve => setTimeout(resolve, 50))
      return
    }

    const batch: Uint8Array[] = []
    while (!this.broadcastBuffer.isEmpty()) {
      batch.push(this.broadcastBuffer.dequeue())
    }

    // Framing binaire : [uint32 big-endian len][msg bytes]...
    let totalLength = 0
    for (const msg of batch) {
      totalLength += 4 + msg.length
    }

    const buf = new Uint8Array(totalLength)
    const view = new DataView(buf.buffer)
    let offset = 0

    for (const msg of batch) {
      view.setUint32(offset, msg.length, false)
      offset += 4
      buf.set(msg, offset)
      offset += msg.length
    }

    const snMid = (this.delivered.get(this.myNetworkId!) ?? 0) + 1

    await this.processSingleBroadcast(buf, snMid)
    await this.waitUntilDelivered(this.myNetworkId!, snMid)
  }

  // Enfile un message dans le buffer — l'envoi effectif est géré par la boucle
  async causal_broadcast(content: Uint8Array): Promise<void> {
    this.broadcastBuffer.enqueue(content)
  }

  // Découpe le contenu en shards Shamir et envoie chaque shard au pair correspondant.
  // L'envoi est parallélisé avec Promise.all. Le nœud se traite lui-même localement.
  async processSingleBroadcast(content: Uint8Array, snMid: number) {
    const arrayShard: Uint8Array[] = await split(content, this.nbCollab, this.nbByz + 1)
    const past = new Map(this.delivered)
    const pastObj = this.mapToObj(past)

    console.warn('--- Envoie du shard avec le sn -> ' + snMid)

    const sendPromises = this.joinedPeers.map((id, i) => {
      const shard = arrayShard[i]
      console.log('Le x est -> : ' + shard[shard.length - 1])

      if (id === this.myNetworkId) {
        const pastLocal = this.mapToObj(new Map(this.delivered))
        return this.handleShard(
          { sd: this.myNetworkId!, sn: snMid },
          shard,
          pastLocal,
          this.myNetworkId!
        )
      } else {
        const replyMsg = new causal.CausalMsg({
          mid: { sd: this.myNetworkId, sn: snMid },
          initialSender: this.myNetworkId,
          deliveredSd: pastObj,
          type: causal.CausalType.SHARD,
          shard
        })
        return this.send(replyMsg, StreamsSubtype.CAUSAL_SHARD as any, id)
      }
    })

    await Promise.all(sendPromises)
  }

  // Traite un shard reçu : vérifie la validité, attend la causalité,
  // puis enchaîne les phases ATTEST → CONFIRM → REVEAL
  private async handleShard(
    mid: NonNullable<causal.ICausalMsg['mid']>,
    shard: Uint8Array,
    past: { [k: string]: number },
    idSender: number
  ) {
    const key = this.makeKey(mid.sd!, mid.sn!)
    const t0 = Date.now()

    const sn = mid.sn
    if (sn == null) {
      console.warn('Shard reçu avec sn null/undefined → rejet')
      return
    }

    const lastDelivered = this.delivered.get(mid.sd!) ?? 0

    // Rejet si : expéditeur != émetteur initial, sn inattendu, ou doublon
    if (idSender !== mid.sd
      || mid.sn !== (this.delivered.get(mid.sd!) ?? 0) + 1
      || this.hasInSet(this.shardRegister, key, idSender)) {
      console.warn('---RECEPTION DOUBLON OU ANCIEN MID SHARD---')
      return
    }

    this.addToSet(this.shardRegister, key, idSender)
    // Stocke le shard sous myNetworkId : c'est le shard qui nous est attribué
    this.setShardForMessage(mid.sd!, mid.sn!, this.myNetworkId!, shard)

    // Attend que tous les messages dont dépend ce shard soient livrés (causalité)
    this.logStep(key, `Avant le wait de causalité résolu`, t0)
    await this.waitUntil(() => {
      const entries = Object.entries(past)
      const blocking = entries.filter(
        ([k, v]) => (this.delivered.get(Number(k)) ?? 0) < v
      )
      return blocking.length === 0
    })
    this.logStep(key, `WAIT1 causalité résolue`, t0)

    const localConf = new Map(this.confirmed)
    const localDel = new Map(this.delivered)

    // Phase ATTEST : on atteste avoir reçu le shard et attend n-t attestations
    if (!this.attestSent.has(key)) {
      this.attestSent.add(key)
      this.addToSet(this.attest, key, this.myNetworkId!)
      const attestMsg = new causal.CausalMsg({
        mid,
        initialSender: mid.sd,
        type: causal.CausalType.ATTEST
      })
      this.send(attestMsg, StreamsSubtype.CAUSAL_ATTEST as any)
    }

    await this.waitUntil(() => this.getCountFromSet(this.attest, key) >= this.nbCollab - this.nbByz)
    this.logStep(key, `WAIT2 nb attest suffisant`, t0)

    if ((this.confirmed.get(mid.sd!) ?? 0) < mid.sn!) {
      this.confirmed.set(mid.sd!, mid.sn!)
    }

    // Phase CONFIRM : on confirme et attend 3t+1 confirmations
    if (!this.confirmSent.has(key)) {
      this.confirmSent.add(key)
      this.addToSet(this.confirm, key, this.myNetworkId!)
      const confirmMsg = new causal.CausalMsg({
        mid,
        initialSender: mid.sd,
        type: causal.CausalType.CONFIRM
      })
      this.send(confirmMsg, StreamsSubtype.CAUSAL_CONFIRM as any)
    }

    await this.waitUntil(
      () => this.getCountFromSet(this.confirm, key) >= 3 * this.nbByz + 1
    )
    this.logStep(key, `WAIT3 nb confirm suffisant`, t0)

    // Phase REVEAL : on révèle notre shard pour permettre la reconstruction
    if (!this.revealSent.has(key)) {
      this.revealSent.add(key)
      this.addToSet(this.reveal, key, this.myNetworkId!)

      const revealMsg = new causal.CausalMsg({
        mid,
        initialSender: mid.sd,
        type: causal.CausalType.REVEAL,
        deliveredSd: this.mapToObj(localDel),
        confirmed: this.mapToObj(localConf),
        shard
      })
      this.send(revealMsg, StreamsSubtype.CAUSAL_REVEAL as any)
    }
  }

  // Mesure le temps entre l'appel à causal_broadcast et la livraison du message
  measureCausalLatency(content: Uint8Array): Promise<number> {
    const t0 = Date.now()

    return new Promise(resolve => {
      const sub = this.deliverSubject.subscribe(({ senderNetworkId }) => {
        if (senderNetworkId === this.myNetworkId) {
          const latency = Date.now() - t0
          sub.unsubscribe()
          resolve(latency)
        }
      })

      this.causal_broadcast(content)
    })
  }

  // Attend 30s puis envoie un ping horodaté si on est le pair initiateur (joinedPeers[0])
  private async startPingRTT(): Promise<void> {
      await new Promise(resolve => setTimeout(resolve, 30000))
      if (this.joinedPeers[0] == this.myNetworkId!) {
          const encoder = new TextEncoder()
          const sendTime = Date.now()
          this.causal_broadcast(encoder.encode(`ping:${sendTime}`))
      }
  }

  // Log un jalon de performance avec le temps écoulé depuis t0
  private logStep(key: string, step: string, t0: number): number {
    const now = Date.now()
    console.log(`[PERF] ${key} | ${step} | +${now - t0}ms`)
    return now
  }
}

// File d'attente FIFO chaînée utilisée pour le broadcastBuffer
export class Node<T> {
  value: T
  next: Node<T> | null
  constructor(value: T) {
    this.value = value
    this.next = null
  }
}

export class Queue<T> {
  first: Node<T> | null
  last: Node<T> | null
  size: number
  constructor() {
    this.first = null
    this.last = null
    this.size = 0
  }
  enqueue(value: T): void {
    const newNode = new Node(value)
    if (this.last !== null) this.last.next = newNode
    this.last = newNode
    if (this.first === null) this.first = this.last
    this.size++
  }
  dequeue(): T {
    if (this.first === null) {
      throw new Error('Queue is empty')
    }
    const nodeToDequeue = this.first
    this.first = this.first.next
    if (this.first === null) this.last = null
    this.size--
    return nodeToDequeue.value
  }
  isEmpty(): boolean {
    return this.size === 0
  }
}