import { Observable, Subject } from 'rxjs'
// Import CORRECT et public
import { IMessageIn, IMessageOut ,  Service} from './IMessage'

import { split, combine, add, mult, div, interpolatePolynomial } from "./shamit-secret-sharing";
import { causal } from './causal_proto.js' //Nouveau
import { ICollaborator } from '@coast-team/mute-core'
// Import library's Streams with alias
import { StreamsSubtype, Streams } from '../Streams';

/*
todo
Revoir que dans mes send de witness j'envoie bien le message décoder
Et je l'utilise comme tel

Revoir si c'est normal qu'on puisse delivrer un message sans réussir a trouver un polynome satsfaisant
Revoir si le peerId est le meme pour tout le monde même si on ne lance pas les noeuds sur la même machines
*/

const CausalMsgFactory = causal.CausalMsg

export class CausalService extends Service<causal.ICausalMsg, causal.ICausalMsg> {
  //De ip avec 1..n
 
  public myNetworkId$ : Observable<number>
  public myNetworkId? : number

  // FIX : Set<number> au lieu de Map<number, number> — on veut compter les senders distincts, pas cumuler
  // Enregistre MID -> SD pour savoir pour un MID je l'ai reçu de qui.
  public witness: Map<string, Set<number>>
  public confirm: Map<string, Set<number>>
  public attest: Map<string, Set<number>>
  public reveal: Map<string, Set<number>>

  // Pour un MID j'enregistre le shard que j'ai reçu d'un sender
  // Shards reçus : sd:sn -> Map<sender, shard>
  public shard: Map<string, Map<number, Uint8Array>>

  // Registers (anti-doublon) : sd:sn -> Set<sender>
  public shardRegister: Map<string, Set<number>>

  // Sent (anti-doublon envoi) : sd:sn -> boolean
  private witnessSent: Set<string>
  private confirmSent: Set<string>
  private attestSent: Set<string>
  private revealSent: Set<string>

  private delivered : Map<number, number>
  private confirmed : Map<number, number>
  public nbCollab: number
  private nbByz: number

  // Contenu des witness : sd:sn -> Map<sender, content>
  private witnessContent : Map<string, Map<number, string | null>>

  private suspected : Set<number>
  public deliverSubject: Subject<{ senderNetworkId: number, content: Uint8Array }>
  public fifoBroadcastSubject : Subject<causal.ICausalMsg>
  public messageFromMuteCore$ : Observable<Uint8Array>
  public myPeerId : string

  public joinedPeers: number[] = []

  // ---- RTT ping/pong ----
  private pingTimestamps: Map<string, number> = new Map()  // key: "sd:sn"
  private pingTriggered = false


  constructor(
    messageIn$: Observable<IMessageIn>,
    messageOut$: Subject<IMessageOut>,
    myNetworkId$: Observable<number>,
    messageFromMuteCore$ : Observable<Uint8Array>,
    myPeerId : string,
    memberJoin$: Observable<number>,
    memberLeave$: Observable<number>
  ) {
    super(messageIn$, messageOut$, Streams.CAUSALNODE as any, CausalMsgFactory)

    this.delivered = new Map()
    this.myPeerId = myPeerId
  
    this.myNetworkId$ = myNetworkId$
    //Je me rajoute dans le set
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

    // Enregistrement des entrées
    memberJoin$.subscribe((networkId: number) => {
      if (!this.joinedPeers.includes(networkId)) {
        this.joinedPeers.push(networkId)
        this.joinedPeers.sort((a, b) => a - b)
        this.delivered.set(networkId, 0)

        // Dès qu'on est nbCollab sur le document, chacun envoie un ping
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

    this.messageFromMuteCore$.subscribe(msg => {
      //this.causal_broadcast(msg)
      this.measureCausalLatency(msg).then(latency => {
        console.log(`Latence de causal_broadcast : ${latency} ms`)
      })  
    })

    this.messageIn$.subscribe(async ({ senderNetworkId, msg }) => {
      const idSender = senderNetworkId
      const InitialSender = msg.initialSender
      const past = msg.deliveredSd as { [k: string]: number } | null
      const shard = msg.shard
      const mid = msg.mid
      const conf = msg.confirmed
      const content = msg.content
      const key = this.makeKey(mid!.sd!, mid!.sn!)
      console.log('Causal reçoit type:', causal.CausalType[msg.type!], 'avec le MID', mid?.sd, ':', mid?.sn, 'envoyé par ',idSender)

      switch (msg.type) {
        case causal.CausalType.SHARD: {
          await this.handleShard(mid!, shard!, past as { [k: string]: number }, idSender)
          break
        }

        case causal.CausalType.REVEAL: {
          if (this.hasInRegister(this.reveal, key, idSender)) { return }
          this.addToRegister(this.reveal, key, idSender)

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
          //Les shards sont rangés suivant l'identifiant local...
          this.setShardForMessage(mid!.sd!, mid!.sn!, idSender, shard!)

          const shardCount = this.shard.get(key)?.size ?? 0
          if (shardCount === this.nbCollab - 2 * this.nbByz) {
            await this.try_deliver(mid!.sd!, mid!.sn!)
          }
          break
        }

        //Je réceptionne les Attest
        case causal.CausalType.ATTEST: {
          if (this.hasInRegister(this.attest, key, idSender)) { return }
          this.addToSet(this.attest, key, idSender)
          break
        }
        //Je réceptionne les confirm
        case causal.CausalType.CONFIRM: {
          if (this.hasInRegister(this.confirm, key, idSender)) { return }
          this.addToSet(this.confirm, key, idSender)
          break
        }

        case causal.CausalType.WITNESS: {
          if (this.hasInRegister(this.witness, key, idSender)) { return }
          this.setWitnessContent(mid!.sd!, mid!.sn!, idSender, content ?? null)
          this.addToSet(this.witness, key, idSender)
          const count = this.getCountFromSet(this.witness, key)

          //when both of the following conditions hold for the first time, for some mid:
          const m = this.getWinningWitness(mid!.sd!, mid!.sn!, this.nbCollab- 2*this.nbByz)
          if (count >= (this.nbCollab - (this.nbByz))) {
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
            this.send(witnessMsg, StreamsSubtype.CAUSAL_WITNESS as any)
          }
          
          break
        }
      }
    })
  }

  // ---- Helpers clé composite ----

  private makeKey(sd: number, sn: number): string {
    return `${sd}:${sn}`
  }

  // ---- Helpers register (Set) ----

  private hasInRegister(register: Map<string, Set<number>>, key: string, sender: number): boolean {
    return register.get(key)?.has(sender) ?? false
  }

  private addToRegister(register: Map<string, Set<number>>, key: string, sender: number): void {
    let inner = register.get(key)
    if (!inner) {
      inner = new Set()
      register.set(key, inner)
    }
    inner.add(sender)
  }

  // FIX : nouveaux helpers pour Map<string, Set<number>> (attest, confirm, witness)
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

  // ---- Helpers shards ----

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

  // ---- Helpers witnessContent ----

  private setWitnessContent(sd: number, sn: number, sender: number, val: string | null): void {
    const key = this.makeKey(sd, sn)
    let inner = this.witnessContent.get(key)
    if (!inner) {
      inner = new Map()
      this.witnessContent.set(key, inner)
    }
    inner.set(sender, val)
  }

  private getAllWitnessContent(sd: number, sn: number): Map<number, string |null > {
    return this.witnessContent.get(this.makeKey(sd, sn)) ?? new Map()
  }

  private getWinningWitness(sd: number, sn: number, borne: number ): string | null | undefined{
    const witnesses = this.getAllWitnessContent(sd, sn)
    const counts = new Map<string | null, number>()
    for (const [, m] of witnesses) {
      counts.set(m, (counts.get(m) ?? 0) + 1)
    }
    for (const [m, count] of counts) {
      if (count >= borne) return m
    }
    return undefined
  }

  // ---- try_deliver ----

  protected async try_deliver(sd: number, sn: number) {
    const key = this.makeKey(sd, sn)

    const trydelTime = Date.now()
   
    const shardsForPoly = this.existancePolynome(sd, sn)

    this.logStep(key, `A checker l'existence du poly`, trydelTime)
    if (shardsForPoly == null){
      console.log("----- PAS DE SOLUTION TROUVÉ POUR LE POLY --------")
    }
    if (shardsForPoly != null) {
      console.warn("-----Taille de shard qu'on renvoie pour reconsruire le poly : normalement 2 -> :-----"+shardsForPoly.size)
      const shardArray = [...shardsForPoly.entries()].map(([, shard]) => shard)
      const encodeContent = await combine(shardArray)
      const decoder = new TextDecoder()
      const content = decoder.decode(encodeContent)
      const key = this.makeKey(sd, sn)
      //Normalement pas besoin je crois
      if (!this.witnessSent.has(key)) {
        this.witnessSent.add(key)
        const witnessMsg = new causal.CausalMsg({
          mid: { sd, sn },
          initialSender: sd,
          type: causal.CausalType.WITNESS,
          content : content
        })
        this.send(witnessMsg, StreamsSubtype.CAUSAL_WITNESS as any)
      }
    } else {
      const key = this.makeKey(sd, sn)
      //Normalement pas besoin je crois
      if (!this.witnessSent.has(key)) {
        this.witnessSent.add(key)
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
    //wait until ∃m, pi has received witness(mid, m) from at least n − t different processes;
    await this.waitUntil(() => {
      return this.getWinningWitness(sd, sn, this.nbCollab - this.nbByz) !== undefined
    })
    this.logStep(key, `Apres le wait de try_del`, trydelTime)

    const m = this.getWinningWitness(sd, sn, this.nbCollab - this.nbByz)
    if (m != null) {
      //Rajout pour le test
      //On a déjà décodé normalement
      const shardArray = this.getShardsForMessage(sd, sn) //ajout
      const encodeContent = await combine(shardArray) //ajout

      // ---- Interception ping / pong avant de monter à mute-core ----
      const text = m

      if (text === 'ping') {
        if (sd !== this.myNetworkId) {
          this.respondToPing(sd, sn)   // on répond au ping des autres
        }
        // ne remonte pas à mute-core
      } else if (text.startsWith('pong:')) {
        this.handlePongReceived(text, sd)   // on traite le pong si c'est notre ping
        // ne remonte pas à mute-core
      } else {
        this.deliverSubject.next({ senderNetworkId: sd, content: encodeContent })
        console.warn("---- J'ai déliver c'était différent de null------")
      }
    
    } else {
      console.warn("---- J'ai déliver c'était null------")
    }
  
    this.delivered.set(sd, sn)
  }

  protected existancePolynome(
    sd: number,
    sn: number
  ): Map<number, Uint8Array> | null {
    const shards = this.getMapShardsForMessage(sd, sn);
    const n = this.nbCollab;
    const t = this.nbByz;
    const d = t; // degré du polynôme
    const validationThreshold = n - 3 * t;

    if (shards.size < n - 2 * t) return null;

    const entries = Array.from(shards.entries());

    // On prend le dernier byte de chaque share comme x (comme dans split)
    const basePoints = entries.map(([id, share]) => ({
      id,
      share,
      x: share[share.length - 1]!,
    }));

    const shardLength = entries[0][1].length;

    // Générateur de toutes les combinaisons de d+1 shards
    function* shardCombinations(
      points: { id: number; share: Uint8Array; x: number }[],
      k: number
    ): Generator<{ id: number; share: Uint8Array; x: number }[]> {
      function* backtrack(
        start: number,
        current: { id: number; share: Uint8Array; x: number }[]
      ): Generator<{ id: number; share: Uint8Array; x: number }[]> {
        if (current.length === k) {
          yield [...current];
          return;
        }
        for (let i = start; i < points.length; i++) {
          current.push(points[i]);
          yield* backtrack(i + 1, current);
          current.pop();
        }
      }
      yield* backtrack(0, []);
    }
    

    // Parcours toutes les combinaisons de d+1 shards
    for (const combo of shardCombinations(basePoints, d + 1)) {
      let isValidCombo = true;

      // Vérification par byte
      for (let i = 0; i < shardLength - 1; i++) {
        const xSamples = new Uint8Array(combo.map(c => c.x));
        const ySamples = new Uint8Array(combo.map(c => c.share[i]!));

        let validCount = 0;
        for (const p of basePoints) {
          //Ici c'est la fonction de secret sharing de la lib
          const expected = interpolatePolynomial(xSamples, ySamples, p.x);
          if (expected === p.share[i]) validCount++;
        }

        if (validCount < validationThreshold) {
          isValidCombo = false;
          break; // Cette combinaison ne fonctionne pas pour ce byte
        }
      }

      if (isValidCombo) {
        // Retourne d+1 shards valides
        const result = new Map<number, Uint8Array>();
        for (const p of combo) {
          result.set(p.id, p.share);
        }
        return result;
      }
    }

    return null; // Aucune combinaison valide
  }

  protected evaluatePolynomial(
    polynomial: (x: number) => number,
    x: number
  ): number {
    return polynomial(x);
  }

  protected mapToObj(map: Map<number, number>): { [k: string]: number } {
    const obj: { [k: string]: number } = {}
    map.forEach((val, key) => { obj[key] = val })
    return obj
  }

  protected waitUntil(cond: () => boolean, interval = 50): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (cond()) resolve()
        else setTimeout(check, interval)
      }
      check()
    })
  }

  //On le reçoit déjà encodé
  async causal_broadcast(content: Uint8Array) {
    const arrayShard: Uint8Array[] = await split(content, this.nbCollab, (this.nbByz+1))
    const snMid = (this.delivered.get(this.myNetworkId!) ?? 0) + 1
    const past = new Map(this.delivered)

    let i=0
    console.warn('--- Envoie du shard -> '+content.toString+' avec le sn -> '+ snMid)

    for (const id of this.joinedPeers) {
      console.warn(`Envoi shard[${i}] à peer ${id}`)
      const shard = arrayShard[i]
      console.log("Le x est -> : "+shard[shard.length-1])

      if (id === this.myNetworkId) {
        const past = this.mapToObj(new Map(this.delivered))
        this.handleShard(
          { sd: this.myNetworkId, sn: snMid },
          shard,
          past,
          this.myNetworkId!
        )  // pas de await, sinon ça bloque la boucle d'envoi aux autres
        i++
        continue //Normalement pas besoin du continue, mais je le laisse pour être sûr de ne pas faire de bêtise
      } else {
        const replyMsg = new causal.CausalMsg({
          mid: { sd: this.myNetworkId, sn: snMid },
          initialSender: this.myNetworkId,
          deliveredSd: this.mapToObj(past),
          type: causal.CausalType.SHARD,
          shard : shard,
        })
        this.send(replyMsg, StreamsSubtype.CAUSAL_SHARD as any, id)
        i+=1
      }
    }
    await this.waitUntil(() => (this.delivered.get(this.myNetworkId!) ?? 0) >= snMid)
  }

  private async handleShard(
    mid: NonNullable<causal.ICausalMsg['mid']>,
    shard: Uint8Array,
    past: { [k: string]: number },
    idSender: number
  ) {
    const key = this.makeKey(mid.sd!, mid.sn!)
    const t0 = Date.now()

    if (idSender !== mid.sd
      || mid.sn !== (this.delivered.get(mid.sd!) ?? 0) + 1
      || this.hasInRegister(this.shardRegister, key, idSender)) {
      console.warn("---RECEPTION DOUBLON D'UN MID SHARD---")
      return
    }
    this.addToRegister(this.shardRegister, key, idSender)
    this.setShardForMessage(mid.sd!, mid.sn!, this.myNetworkId!, shard)

    this.logStep(key, `Avant le wait de causalité résolu`, t0)
    //todo ici changement
    await this.waitUntil(() => {
      const entries = Object.entries(past)
      const blocking = entries.filter(([k, v]) => (this.delivered.get(Number(k)) ?? 0) < v)
      return blocking.length === 0
    })
    this.logStep(key, `WAIT1 causalité résolue`, t0)

    const localConf = new Map(this.confirmed)
    const localDel = new Map(this.delivered)

    if (!this.attestSent.has(key)) {
      this.attestSent.add(key)
      const attestMsg = new causal.CausalMsg({
        mid, initialSender: mid.sd, type: causal.CausalType.ATTEST
      })
      this.send(attestMsg, StreamsSubtype.CAUSAL_ATTEST as any)
    }

    // FIX : utilise getCountFromSet au lieu de getCountFromMap
    await this.waitUntil(() => this.getCountFromSet(this.attest, key) >= (this.nbCollab - this.nbByz))
    this.logStep(key, `WAIT2 nb attest suffisant`, t0)

    if ((this.confirmed.get(mid.sd!) ?? 0) < mid.sn!) {
      this.confirmed.set(mid.sd!, mid.sn!)
    }

    if (!this.confirmSent.has(key)) {
      this.confirmSent.add(key)
      const confirmMsg = new causal.CausalMsg({
        mid, initialSender: mid.sd, type: causal.CausalType.CONFIRM
      })
      this.send(confirmMsg, StreamsSubtype.CAUSAL_CONFIRM as any)
    }

    // FIX : utilise getCountFromSet au lieu de getCountFromMap
    await this.waitUntil(() => this.getCountFromSet(this.confirm, key) >= (3 * this.nbByz + 1))
    this.logStep(key, `WAIT2 nb confirm suffisant`, t0)

    if (!this.revealSent.has(key)) {
      this.revealSent.add(key)
      const revealMsg = new causal.CausalMsg({
        mid, initialSender: mid.sd,
        type: causal.CausalType.REVEAL,
        deliveredSd: this.mapToObj(localDel),
        confirmed: this.mapToObj(localConf),
        shard
      })
      this.send(revealMsg, StreamsSubtype.CAUSAL_REVEAL as any)
    }
  }

  // Mesure le temps de causal_broadcast en attendant la livraison du message dans deliverSubject
  measureCausalLatency(content: Uint8Array): Promise<number> {
    const t0 = Date.now()

    return new Promise((resolve) => {
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

  // ---- RTT : envoi du ping ----

  private async startPingRTT(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10000))
    if (this.joinedPeers[0] == this.myNetworkId!) {
      const sn = (this.delivered.get(this.myNetworkId!) ?? 0) + 1
      const key = this.makeKey(this.myNetworkId!, sn)
      this.pingTimestamps.set(key, Date.now())
      const encoder = new TextEncoder()
      this.causal_broadcast(encoder.encode('ping'))
    }
  }

  // ---- RTT : réponse au ping d'un autre ----

  private respondToPing(pingSd: number, pingSn: number): void {
    const encoder = new TextEncoder()
    const pongContent = encoder.encode(`pong:${pingSd}:${pingSn}`)
    this.causal_broadcast(pongContent)
  }

  // ---- RTT : réception d'un pong répondant à notre ping ----

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
        console.log(`[RTT] Pong de ${pongSender} → RTT=${rtt}ms, latence estimée ≈ ${latency}ms`)
      }
    }
  }

  // Helper de timing
  private logStep(key: string, step: string, t0: number): number {
    const now = Date.now()
    console.log(`[PERF] ${key} | ${step} | +${now - t0}ms`)
    return now
  }
}