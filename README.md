# 📘 xcraft-core-probe

## Aperçu

Le module `xcraft-core-probe` fournit des utilitaires de profilage et de mesure de performance pour l'écosystème Xcraft. Il permet d'enregistrer des événements temporels avec leurs métadonnées dans une base de données SQLite, offrant ainsi un mécanisme de monitoring et d'analyse des performances des applications Xcraft. En complément de l'enregistrement brut des données, le module est désormais capable de générer automatiquement un diagramme de Gantt (au format EPS, via GNUplot) représentant la chronologie d'exécution des commandes Xcraft.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Variables d'environnement](#variables-denvironnement)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module est organisé autour de quatre composants principaux :

- **`lib/probe.js`** : Classe principale `Probe` qui gère la base de données SQLite, l'enregistrement des mesures de performance et le déclenchement de la génération du rapport graphique à la fermeture.
- **`lib/index.js`** : Point d'entrée conditionnel qui charge le module seulement si `xcraft-core-book` est disponible.
- **`lib/charts/ganttCmd.js`** : Générateur de diagramme de Gantt (`GanttCmdChart`) qui transforme les données de probes liées aux commandes Xcraft en un script GNUplot exploitable.
- **`probe.js`** : Commandes Xcraft (`probe.enable` / `probe.disable`) pour activer ou désactiver le profilage via le bus de commandes.

## Fonctionnement global

Le système de probes fonctionne selon le principe suivant :

1. **Initialisation conditionnelle** : Le module ne s'active que si `xcraft-core-book` (SQLite) est disponible. Si `xcraft-core-book` est absent (dépendance optionnelle), `lib/index.js` exporte `null` et l'ensemble du système est désactivé silencieusement.
2. **Activation par variable d'environnement** : Au démarrage, si la variable `XCRAFT_PROBE` est définie et différente de `0`, la base de données est immédiatement ouverte ; sinon elle reste fermée jusqu'à un appel explicite à `setEnable(true)` (via la commande `probe.enable`).
3. **Base de données dédiée par tribu** : Chaque tribu Xcraft (`tribe`, récupérée via `xcraft-core-host`) possède sa propre base de données de probes, nommée `probe-{tribe}` (ou `probe-0` si aucune tribu n'est définie).
4. **Enregistrement par lots** : Les événements sont enregistrés au sein de transactions SQLite explicites (`BEGIN EXCLUSIVE` / `COMMIT`). Une transaction est committée et une nouvelle est démarrée toutes les 10 000 insertions (`_pushCounter`), afin d'optimiser les performances d'écriture.
5. **Mesure de delta** : Chaque appel à `push()` retourne une fonction de rappel qui, lorsqu'elle est invoquée, calcule le temps écoulé en nanosecondes depuis le `push()` initial (via `process.hrtime`) et met à jour la colonne `delta` de l'entrée correspondante.
6. **Génération automatique d'un diagramme de Gantt** : Lors de la fermeture de la base (`close()`), une instance de `GanttCmdChart` est créée à partir du handle SQLite et du dossier de sortie des probes. Elle analyse les entrées liées à l'exécution des commandes Xcraft (topics de la forme `push/...` et `...::*.finished` / `...::*.error`) pour reconstituer, pour chaque commande, son intervalle d'exécution, puis produit :
   - un fichier de données texte (`gantt_cmd_report.txt`) listant, pour chaque commande, son timestamp de début, de fin, son niveau (ligne verticale du diagramme) et son nom ;
   - un script GNUplot (`gantt_cmd_report.gp`) prêt à être exécuté pour produire le diagramme au format EPS.

La structure de données stockée dans la table `data` comprend :

- `timestamp` : Horodatage de l'événement en millisecondes.
- `delta` : Temps écoulé en nanosecondes (optionnel, rempli après coup).
- `topic` : Identifiant du type d'événement (ou de la commande concernée).
- `payload` : Données JSON associées à l'événement.

## Exemples d'utilisation

### Activation via commandes Xcraft

```javascript
// Activer le profilage
await this.quest.cmd('probe.enable');

// Désactiver le profilage (déclenche la génération du diagramme de Gantt)
await this.quest.cmd('probe.disable');
```

### Utilisation programmatique

```javascript
const xProbe = require('xcraft-core-probe');

// Enregistrer un événement simple
if (xProbe) {
  xProbe.push('user.login', {userId: 123, method: 'oauth'});
}

// Mesurer le temps d'exécution d'une opération
if (xProbe) {
  const endProbe = xProbe.push('database.query', {
    table: 'users',
    operation: 'select',
  });

  // ... exécution de la requête ...

  endProbe(); // Enregistre le delta de temps
}
```

### Exemple avec gestion d'erreur

```javascript
const xProbe = require('xcraft-core-probe');

async function processData(data) {
  const endProbe =
    xProbe?.push('data.processing', {
      size: data.length,
      type: data.type,
    }) || (() => {});

  try {
    // Traitement des données
    const result = await heavyProcessing(data);
    return result;
  } finally {
    endProbe(); // Mesure le temps même en cas d'erreur
  }
}
```

## Interactions avec d'autres modules

Le module interagit avec plusieurs composants de l'écosystème Xcraft :

- **[xcraft-core-book]** : Fournit la classe `SQLite` dont hérite `Probe`, ainsi que l'interface de persistance des données de profilage. Il s'agit d'une dépendance optionnelle : en son absence, le module se désactive intégralement.
- **[xcraft-core-etc]** : Gestion de la configuration Xcraft, utilisée pour déterminer l'emplacement racine (`xcraftRoot`) où sera stockée la base de données des probes (`var/probe`).
- **[xcraft-core-host]** : Récupération des arguments d'application (`appArgs`), notamment la tribu (`tribe`) utilisée pour nommer la base de données.
- **[xcraft-core-bus]** / **[xcraft-core-server]** : Le fichier `probe.js` expose les commandes `probe.enable` et `probe.disable` sur le bus Xcraft ; ces commandes sont découvertes dynamiquement au démarrage par `xcraft-core-server`.

## Variables d'environnement

| Variable       | Description                                                                  | Exemple          | Valeur par défaut       |
| -------------- | ---------------------------------------------------------------------------- | ---------------- | ----------------------- |
| `XCRAFT_PROBE` | Active le système de probes dès le démarrage si définie et différente de `0` | `XCRAFT_PROBE=1` | Non définie (désactivé) |

## Détails des sources

### `lib/index.js`

Point d'entrée conditionnel qui tente de charger `xcraft-core-book`. Si ce module est introuvable (`MODULE_NOT_FOUND`), `lib/index.js` exporte `null` afin de désactiver gracieusement l'ensemble du système de probes ; toute autre erreur est propagée.

### `lib/probe.js`

#### Classe Probe

La classe `Probe` étend `SQLite` de [xcraft-core-book] et implémente le système de profilage. Une instance unique (singleton) est exportée par le module (`module.exports = new Probe()`).

À la construction, si aucune configuration Xcraft n'est disponible (`etc.load('xcraft')` retourne une valeur fausse), l'instance est initialisée en mode désactivé sans base de données. Sinon, l'emplacement de stockage est calculé (`{xcraftRoot}/var/probe`) et la base est ouverte immédiatement si `XCRAFT_PROBE` est actif, ou fermée dans le cas contraire.

**Caractéristiques principales :**

- Gestion automatique des transactions par lots (commit toutes les 10 000 entrées).
- Base de données dédiée par tribu (`probe-{tribe}`).
- Mode WAL (Write-Ahead Logging) activé à l'ouverture pour optimiser les performances d'écriture concurrente.
- Génération automatique d'un diagramme de Gantt (via `GanttCmdChart`) à la fermeture de la base.
- Fermeture automatique lors de l'arrêt du processus (`process.on('exit', ...)`).

#### État et modèle de données

La classe maintient un état interne avec :

- `_pushCounter` : Compteur d'entrées insérées depuis le dernier commit, utilisé pour déclencher un nouveau cycle de transaction toutes les 10 000 entrées.
- `_disabled` : Indique si le système de probes est actuellement désactivé (aucune écriture n'est effectuée si vrai).
- `_dbName` : Nom de la base de données SQLite utilisée, sous la forme `probe-{tribe}`.

Structure de la table `data` (créée si absente à l'ouverture) :

- `timestamp` (TEXT) — horodatage en millisecondes de l'entrée.
- `delta` (TEXT) — durée en nanosecondes entre le `push()` et l'appel de la fonction de callback retournée, initialisée à `0`.
- `topic` (TEXT) — identifiant du type d'événement ou de la commande.
- `payload` (JSON) — données associées à l'événement.

Deux index sont créés pour optimiser les requêtes : un sur `timestamp` (recherches temporelles) et un sur `topic` (filtrage par type d'événement).

#### Méthodes publiques

- **`setEnable(en)`** — Active ou désactive le système de probes. Si activé, ouvre la base de données ; si désactivé, la ferme (ce qui déclenche la génération du diagramme de Gantt). Retourne l'état de disponibilité après l'opération.
- **`push(topic, payload)`** — Enregistre un nouvel événement dans la base de données si le système est disponible (sinon retourne un callback vide). Gère le cycle de commit toutes les 10 000 insertions. Retourne une fonction sans argument qui, une fois appelée, calcule et enregistre le delta de temps écoulé (en nanosecondes) pour cette entrée.
- **`isAvailable()`** — Vérifie si le système de probes est actuellement activé et utilisable.
- **`open()`** — Ouvre (ou réutilise) la base de données, crée les tables/index si nécessaire, prépare les requêtes SQL et démarre la première transaction. N'a aucun effet si le système est déjà actif ou si la base n'est pas utilisable.
- **`close()`** — Génère le diagramme de Gantt des commandes (via `GanttCmdChart`), committe la transaction en cours, puis ferme la base de données. N'a aucun effet si le système n'est pas disponible.
- **`stmts`** (accesseur) — Retourne les requêtes SQL préparées (`begin`, `commit`, `push`, `delta`) associées à la base de données courante.

### `lib/charts/ganttCmd.js`

Ce fichier fournit la classe `GanttCmdChart`, responsable de la production d'un diagramme de Gantt représentant la chronologie d'exécution des commandes Xcraft enregistrées par les probes.

Une instance est créée par `Probe.close()` à partir du handle de base de données (`db`) et du répertoire de sortie (`outputDir`, correspondant à l'emplacement de la base de probes). La méthode `generate()` orchestre l'ensemble du processus :

1. Elle interroge la base pour reconstituer, pour chaque commande, l'intervalle entre son déclenchement (topic préfixé par `push/`) et sa complétion (topic se terminant par `.finished` ou `.error`), en associant les deux événements via un identifiant extrait de la fin du topic. Un niveau vertical (`level`) unique est attribué à chaque nom de commande distinct, puis l'ordre des niveaux est inversé pour l'affichage.
2. Elle écrit ces données dans un fichier texte (`gantt_cmd_report.txt`), une ligne par exécution de commande (début, fin, niveau, nom).
3. Elle construit un script GNUplot (`gantt_cmd_report.gp`) qui :
   - configure les statistiques (bornes de temps et de durée), la taille et le format de sortie (EPS) ;
   - définit les axes, la grille et la palette de couleurs (dégradé du vert au rouge selon la durée) ;
   - ajoute les graduations verticales (`ytics`) correspondant à chaque commande ;
   - positionne des étiquettes de nom de commande à l'intérieur ou à côté de chaque barre, selon la place disponible, en évitant les recouvrements sur une même ligne (délai minimal de 2 secondes entre deux étiquettes consécutives) ;
   - trace enfin les barres du diagramme (`boxxyerrorbars`) représentant chaque exécution de commande.

Ce mécanisme permet de visualiser rapidement, sous forme de diagramme de Gantt, la répartition temporelle et le chevauchement des commandes Xcraft exécutées pendant une session de profilage.

### `probe.js`

Expose les commandes Xcraft pour contrôler le système de probes via le bus de commandes.

#### Commandes disponibles

- **`probe.enable`** — Active le système de probes et journalise l'emplacement de la base de données de sortie.
- **`probe.disable`** — Désactive le système de probes (ce qui déclenche la fermeture de la base et la génération du diagramme de Gantt).

Ces deux commandes sont configurées pour s'exécuter en parallèle (`parallel: true`) et gèrent le cas où le module `xcraft-core-probe` n'est pas disponible (dépendance `xcraft-core-book` absente), en émettant alors un événement d'erreur.

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

---

_Ce contenu a été généré par IA_

[xcraft-core-book]: https://github.com/Xcraft-Inc/xcraft-core-book
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-server]: https://github.com/Xcraft-Inc/xcraft-core-server
