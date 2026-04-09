# Ce qui reste à regarder

La cryptographie est désactivé.

On appel causal_broadcast trop rapidement, donc on spread avec le même mid les différentes lettres, donc les doublons ne sont pas acceptés.
Le fait d'avoir une couche CORE différentes pour les processus a pour conséquence que des lettres correctement délivré par tous les processus ne s'affichent pas pour ceux qui ne l'ont pas broadcast.

Hypothèse :
Le processus qui l'a expédié lui a fourni des informations de positionnement spécifique à son CORE qui diffèrent des autres processus. 
Donc même si ces derniers arrivent à délivrer cette opération correctement, elle est mal comprise par la couche CORE qui doit l'afficher.

Exemple:
P1 a comme CORE : "hell"
P2 a comme CORE : "hel"
P1 broadcast l'opération de rajout "o" après "hell".
P2 reçoit et délivre "o" mais ne s'affiche pas sur l'écran car arrivé dans la couche CORE, cette lettre ne trouve pas sa place car il manque un 'l'.



# Important

Notre broadcast est juste dans la couche layer, les lettres qu'on a broadcast mais pas délivré sont quand même acceptés sur notre affichage (core).
