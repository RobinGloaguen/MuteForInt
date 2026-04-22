# Important

Changement de libP2P.service pour avoir qu'un seul stream ouvert par connexion P2P et pas un nouveau par message.

Changement de CausalService en Event Driven à la place de Wait Until avec Timeout.

La libp2p refusait d'envoyer des messages à son propre processus donc j'ai remplacé la recepetion de shard par une fonction qu'on appel.

# Benchemark

Le .time() qui start le ping n'est pas idéalement placé.

