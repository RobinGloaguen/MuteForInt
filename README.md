# Important

Changement de libP2P.service pour avoir qu'un seul stream ouvert par connexion P2P et pas un nouveau par message.

Changement de CausalService en Event Driven à la place de Wait Until avec Timeout.

La libp2p refusait d'envoyer des messages à son propre processus donc j'ai remplacé la recepetion de shard par une fonction qu'on appel.

# Récupération d'une librairie

Pour l'implémentation de l'algorithme Secret Sharing nous avons récupéré le code de cette [bibliotheque](https://github.com/privy-io/shamir-secret-sharing) que nous avons légèrement modifié pour ne travailler avec des X allant de 1 à n et non des valeurs aléatoires.

