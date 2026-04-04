import { Observable, Subject } from 'rxjs'
// Import CORRECT et public
//import { IMessageIn, IMessageOut, Service } from '@coast-team/mute-core'
//import { IMessageIn, IMessageOut, Service } from '@coast-team/mute-core/dist/types/src/misc'

// APRÈS
import { IMessageIn, IMessageOut ,  Service} from './IMessage'
//import { Service } from '@coast-team/mute-core/dist/types/src/misc'
//import { IMessageIn, IMessageOut, Service } from '@coast-team/mute-core/misc'
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

//const proto = (protoRoot as any).default.causal as typeof causal


const CausalMsgFactory = causal.CausalMsg

export class CausalService extends Service<causal.ICausalMsg, causal.ICausalMsg> {
  //De ip avec 1..n
 
  public myNetworkId$ : Observable<number>
  public myNetworkId? : number
  public collaborators: Map<number, ICollaborator>

  // Compteurs par sd:sn -> Map<sender, count>
  public witness: Map<string, Map<number, number>>
  public confirm: Map<string, Map<number, number>>
  public attest: Map<string, Map<number, number>>
  public reveal: Map<string, Map<number, number>>

  // Shards reçus : sd:sn -> Map<sender, shard>
  //Il faudrait stocker l'id local en plus
  public shard: Map<string, Map<number, Uint8Array>>

  // Registers (anti-doublon) : sd:sn -> Set<sender>
  public confirmRegister: Map<string, Set<number>>
  public revealRegister: Map<string, Set<number>>
  public shardRegister: Map<string, Set<number>>
  public attestRegister: Map<string, Set<number>>
  public witnessRegister: Map<string, Set<number>>

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
  private witnessContent : Map<string, Map<number, string>>

  private suspected : Set<number>
  public deliverSubject: Subject<causal.ICausalMsg>
  public fifoBroadcastSubject : Subject<causal.ICausalMsg>
  public messageFromMuteCore$ : Observable<Uint8Array>
  public myPeerId : string

  public joinedPeers: number[] = []


  constructor(
    messageIn$: Observable<IMessageIn>,
    messageOut$: Subject<IMessageOut>,
    myNetworkId$: Observable<number>,
    messageFromMuteCore$ : Observable<Uint8Array>,
    myPeerId : string,
    memberJoin$: Observable<number>,   // à ajouter
    memberLeave$: Observable<number>   // à ajouter
  ) {
    super(messageIn$, messageOut$, Streams.CAUSALNODE as any, CausalMsgFactory)

    
    // Enregistrement des entrées
    memberJoin$.subscribe((networkId: number) => {
          if (!this.joinedPeers.includes(networkId)) {
        this.joinedPeers.push(networkId)
        this.joinedPeers.sort((a, b) => a - b)
      }
    })
    memberLeave$.subscribe((networkId: number) => {
        this.joinedPeers = this.joinedPeers.filter(id => id !== networkId)
    })


    this.myPeerId =myPeerId
  
    this.myNetworkId$ = myNetworkId$
    //Je me rajoute dans le set
    this.myNetworkId$.subscribe(id => {
      this.myNetworkId = id
      this.joinedPeers.push(id)
      this.joinedPeers.sort((a, b) => a - b)
    })
    this.deliverSubject = new Subject()
    this.fifoBroadcastSubject = new Subject()
    this.confirm = new Map()
    this.suspected = new Set()
    this.witness = new Map()
    this.attest = new Map()
    this.reveal = new Map()
    this.shard = new Map()

    this.confirmRegister = new Map()
    this.witnessContent = new Map()
    this.witnessRegister = new Map()
    this.attestRegister = new Map()
    this.revealRegister = new Map()
    this.shardRegister = new Map()

    this.confirmSent = new Set()
    this.witnessSent = new Set()
    this.revealSent = new Set()
    this.attestSent = new Set()

    this.delivered = new Map([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]])
    this.confirmed = new Map()
    this.nbCollab = 6
    this.nbByz = 1


    this.messageFromMuteCore$ = messageFromMuteCore$

    this.messageFromMuteCore$.subscribe(msg => {
      this.causal_broadcast(msg)
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

      switch (msg.type) {
        case causal.CausalType.SHARD: {
          if (idSender != mid?.sd && (past?.[String(idSender)] ?? 0) + 1 == mid!.sd
            || this.hasInRegister(this.shardRegister, key, idSender)) { return }
          this.addToRegister(this.shardRegister, key, idSender)

          //Todo ici j'enregistre bien mon propre shard
          this.setShardForMessage(mid!.sd!, mid!.sn!, this.myNetworkId!, shard!)


          await this.waitUntil(() => {
            const entries = Object.entries(past!)
            return entries.every(([k, v]) => (this.delivered.get(Number(k)) ?? 0) >= v)
          })

          const localConf = new Map(this.confirmed)
          const localDel = new Map(this.delivered)

          if (!this.attestSent.has(key)) {
            this.attestSent.add(key)
            const attestMsg = new causal.CausalMsg({
              mid: mid,
              initialSender: mid!.sd,
              type: causal.CausalType.ATTEST
            })
            this.send(attestMsg, StreamsSubtype.CAUSAL_ATTEST as any)
          }

          await this.waitUntil(() => this.getCountFromMap(this.attest, key) >= (this.nbCollab - this.nbByz))

          if ((this.confirmed.get(mid!.sd!) ?? 0) < mid!.sn!) {
            this.confirmed.set(mid!.sd!, mid!.sn!)
          }

          if (!this.confirmSent.has(key)) {
            this.confirmSent.add(key)
            const confirmMsg = new causal.CausalMsg({
              mid: mid,
              initialSender: mid!.sd,
              type: causal.CausalType.CONFIRM
            })
            this.send(confirmMsg, StreamsSubtype.CAUSAL_CONFIRM as any)
          }

          await this.waitUntil(() => this.getCountFromMap(this.confirm, key) >= (3 * this.nbByz + 1))

          if (!this.revealSent.has(key)) {
            this.revealSent.add(key)
            const revealMsg = new causal.CausalMsg({
              mid: mid,
              initialSender: mid!.sd,
              type: causal.CausalType.REVEAL,
              deliveredSd: this.mapToObj(localDel),
              confirmed: this.mapToObj(localConf),
              shard: shard
            })
            this.send(revealMsg, StreamsSubtype.CAUSAL_REVEAL as any)
          }
          break
        }

        case causal.CausalType.REVEAL: {
          if (this.hasInRegister(this.revealRegister, key, idSender)) { return }
          this.addToRegister(this.revealRegister, key, idSender)

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
          //todo ici ranger les shard avec mid -> shard -> idPoly(x)

          const shardCount = this.shard.get(key)?.size ?? 0
          if (shardCount === this.nbCollab - 2 * this.nbByz) {
            await this.try_deliver(mid!.sd!, mid!.sn!)
          }
          break
        }

        //Je réceptionne les Attest
        case causal.CausalType.ATTEST: {
          if (this.hasInRegister(this.attestRegister, key, idSender)) { return }
          this.addToRegister(this.attestRegister, key, idSender)
          const prevAttest = this.getCountFromMap(this.attest, key)
          this.setCountInMap(this.attest, key, idSender, prevAttest + 1)
          break
        }

        //Je réceptionne les confirm
        case causal.CausalType.CONFIRM: {
          if (this.hasInRegister(this.confirmRegister, key, idSender)) { return }
          this.addToRegister(this.confirmRegister, key, idSender)
          const prevConfirm = this.getCountFromMap(this.confirm, key)
          this.setCountInMap(this.confirm, key, idSender, prevConfirm + 1)
          break
        }

        case causal.CausalType.WITNESS: {
          if (this.hasInRegister(this.witnessRegister, key, idSender)) { return }
          this.addToRegister(this.witnessRegister, key, idSender)
          this.setWitnessContent(mid!.sd!, mid!.sn!, idSender, content!)
          const prevWitness = this.getCountFromMap(this.witness, key)
          this.setCountInMap(this.witness, key, idSender, prevWitness + 1)
          const count = this.getCountFromMap(this.witness, key)
          //todo : la je le fais a chaque fois
          //when both of the following conditions hold for the first time, for some mid:
          if (count >= (this.nbCollab - (this.nbByz))) {
            const m = this.getWinningWitness(mid!.sd!, mid!.sn!, this.nbCollab- 2*this.nbByz)
            if (m != null) {
              this.suspected.add(mid!.sd!)
            }
          }

          const m = this.getWinningWitness(mid!.sd!, mid!.sn!, this.nbCollab- 2*this.nbByz)
          if (m != null) {
            if (!this.witnessSent.has(key)) {
              this.witnessSent.add(key)
              const witnessMsg = new causal.CausalMsg({
                mid: mid,
                initialSender: mid!.sd,
                type: causal.CausalType.WITNESS,
                content : m
              })
              this.send(witnessMsg, StreamsSubtype.CAUSAL_WITNESS as any)
            }
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

  // ---- Helpers compteurs : sd:sn -> Map<sender, count> ----

  private getCountFromMap(map: Map<string, Map<number, number>>, key: string): number {
    let total = 0
    map.get(key)?.forEach(v => total += v)
    return total
  }

  private setCountInMap(map: Map<string, Map<number, number>>, key: string, sender: number, val: number): void {
    let inner = map.get(key)
    if (!inner) {
      inner = new Map()
      map.set(key, inner)
    }
    inner.set(sender, val)
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

  private setWitnessContent(sd: number, sn: number, sender: number, val: string): void {
    const key = this.makeKey(sd, sn)
    let inner = this.witnessContent.get(key)
    if (!inner) {
      inner = new Map()
      this.witnessContent.set(key, inner)
    }
    inner.set(sender, val)
  }

  private getAllWitnessContent(sd: number, sn: number): Map<number, string> {
    return this.witnessContent.get(this.makeKey(sd, sn)) ?? new Map()
  }

  private getWinningWitness(sd: number, sn: number, borne: number ): string | null {
    const witnesses = this.getAllWitnessContent(sd, sn)
    const counts = new Map<string, number>()
    for (const [, m] of witnesses) {
      counts.set(m, (counts.get(m) ?? 0) + 1)
    }
    for (const [m, count] of counts) {
      if (count >= borne) return m
    }
    return null
  }

  // ---- try_deliver ----

  protected async try_deliver(sd: number, sn: number) {
    //Pas bien implémenté
    //todo implémentation en utilisant les fonctions de la lib secret sharing pour travailler sur corps gallois
    const shardsForPoly = this.existancePolynome(sd, sn)
    if (shardsForPoly == null){
      console.log("----- PAS DE SOLUTION --------")
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

    await this.waitUntil(() => {
      const witnesses = this.getAllWitnessContent(sd, sn)
      const counts = new Map<string, number>()
      for (const [, m] of witnesses) {
        counts.set(m, (counts.get(m) ?? 0) + 1)
      }
      return Array.from(counts.values()).some(count => count >= this.nbCollab - this.nbByz)
    })

    const m = this.getWinningWitness(sd, sn, this.nbCollab - this.nbByz)
    if (m != null) {
      //Rajout pour le test
      const shardArray = this.getShardsForMessage(sd, sn) //ajout
      const encodeContent = await combine(shardArray) //ajout
      const decoder = new TextDecoder() //ajout
      const content = decoder.decode(encodeContent) //ajout
      this.deliverSubject.next(new causal.CausalMsg({ mid : {sd, sn}, initialSender: sd, type: causal.CausalType.DELIVER, content }))

      //todo
      //C'est notre sortie a la couche au dessus via pub sub
      // causal_deliver m
    }
    console.warn("---- J'ai déliver ------")

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
    console.warn('--- Rentre dans causalBroadcast')

    //todo
    //On est partit du principe qu'on avait toutes les address ip dans une map idToIp
    // Il faudrait adapter ça a mute
    // Par :
    //const collabs = this.collaborators ?? new Map()
    if (this.joinedPeers.length === 0) {
      console.warn('[CausalService] Pas encore de collaborateurs, broadcast ignoré')
      return
    }
    else {
      console.warn("Il y a plusieurs collab -> "+this.joinedPeers.length)
    }
    const arrayShard: Uint8Array[] = await split(content, this.nbCollab, (this.nbByz+1))
    const snMid = (this.delivered.get(this.myNetworkId!) ?? 0) + 1
    const past = new Map(this.delivered)
    let i=1
    for (const id of this.joinedPeers) {
      const shard = arrayShard[i!-1]
      console.log("Le x est -> : "+shard[shard.length-1])
      const replyMsg = new causal.CausalMsg({
        mid: { sd: this.myNetworkId, sn: snMid },
        initialSender: this.myNetworkId,
        deliveredSd: this.mapToObj(past),
        type: causal.CausalType.SHARD,
        shard : shard,
      })
      this.send(replyMsg, StreamsSubtype.CAUSAL_SHARD as any, id)
    }
    await this.waitUntil(() => (this.delivered.get(this.myNetworkId!) ?? 0) >= snMid)
  }

  
}
