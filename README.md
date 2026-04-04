# Ce qu'il y à faire

Le peerId est inutile dans CausalService

Je crois que le senderId qu'on enregistre dans causalService est déjà un identifiant global.
----
Ca c'est global, les string sont global
const myPeerId = libp2p.peerId.toString()
------------
On a reçu quelque chose de local — le number que la machine distante a généré aléatoirement pour elle-même.
Mais du point de vue de notre map, ce number devient une convention partagée : puisque la machine distante a broadcasté ce même number à tous les pairs du document, tout le monde finit par associer "12D3KooWABC..." → 472918364 dans sa propre map.
Donc :

Le string (remotePeerId) est global par nature — libp2p le fournit directement depuis la connexion, c'est cryptographiquement le même pour tout le monde.
Le number (peerIdAsNumber) est local par origine — généré aléatoirement — mais devient globalement cohérent par propagation, car la machine distante envoie toujours le même à tout le monde.

----------------
Vérifier que le networkId et le peerId que je donne a init CausalBridge sont bon.
C'est le libp2pservice qui crée notre networkID et le publie au abstract network

Les fichiers libP2Pservice et network Abstract sont authentiques, rien ne diffèrent à part les imports pour le stream.


-   Gérer la cryptographie. Bug si ce n'est pas de type NONE dans environment.ts, car la clef de décryptage n'a pas l'air d'arriver. Voir si ça vient de nous ou de MUTE de base

- Dans Causal-Bridge il faut maintenant receptionner les collaborateur, avec leurs peerId pour leur assigner le X fixe pour le causal. Je ne l'ai pas fait de base car je voulais juste faire l'intégration sans créer de nouveau bugs, et toucher le moins possibles aux autres fichiers.