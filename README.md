# Ce qu'il y à faire
# J'ai fait expres d'ignorer les autre substream de document_content car ça envoyait tout le document sans passer par causal

Le protocole fonctionne ! On voit bien `---- J'ai déliver c'était différent de null------` sur les deux machines. Mais seul le "c" est reçu, pas les "d".

Le problème vient du `delivered` qui n'est pas mis à jour correctement. Dans `try_deliver` :

```typescript
this.delivered.set(sd, sn)
```

Cette ligne met à jour `delivered[sd] = sn`, ce qui est correct. Mais le `waitUntil` dans `causal_broadcast` attend :

```typescript
await this.waitUntil(() => (this.delivered.get(this.myNetworkId!) ?? 0) >= snMid)
```

Si l'émetteur n'est pas en train de deliver son propre message (il envoie les shards mais ne les reçoit pas via `messageIn$` car c'est lui-même), `delivered[myNetworkId]` ne se met jamais à jour et le broadcast suivant est bloqué en attente.

Le problème est que tu ne t'envoies pas le shard à toi-même via `messageIn$` — tu l'envoies via le réseau mais il revient comme un message réseau normal. Ajoute une mise à jour directe de `delivered` après le broadcast :

```typescript
// À la fin de causal_broadcast, remplace le waitUntil par :
this.delivered.set(this.myNetworkId!, snMid)
```

Ou mieux, dans `try_deliver`, quand c'est ton propre message qui est délivré (`sd === this.myNetworkId`), le `delivered` se met bien à jour — mais le `waitUntil` dans `causal_broadcast` tourne en parallèle et doit voir cette mise à jour. Vérifie que `try_deliver` est bien appelé pour tes propres messages.


-   Gérer la cryptographie. Bug si ce n'est pas de type NONE dans environment.ts, car la clef de décryptage n'a pas l'air d'arriver. Voir si ça vient de nous ou de MUTE de base

