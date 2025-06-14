# 📘 Documentation du module xcraft-core-probe

## Aperçu

Le module `xcraft-core-probe` fournit des utilitaires de profilage et de mesure de performance pour l'écosystème Xcraft. Il permet d'enregistrer des événements temporels avec leurs métadonnées dans une base de données SQLite, offrant ainsi un mécanisme de monitoring et d'analyse des performances des applications Xcraft.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Variables d'environnement](#variables-denvironnement)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé autour de trois composants principaux :

- **`lib/probe.js`** : Classe principale `Probe` qui gère la base de données SQLite et les mesures de performance
- **`lib/index.js`** : Point d'entrée conditionnel qui charge le module seulement si `xcraft-core-book` est disponible
- **`probe.js`** : Commandes Xcraft pour activer/désactiver le profilage via le bus de commandes

## Fonctionnement global

Le système de probes fonctionne selon le principe suivant :

1. **Initialisation conditionnelle** : Le module ne s'active que si `xcraft-core-book` (SQLite) est disponible et si la variable d'environnement `XCRAFT_PROBE` est définie
2. **Base de données dédiée** : Chaque tribu Xcraft possède sa propre base de données de probes (`probe-{tribe}`)
3. **Enregistrement par lots** : Les événements sont enregistrés par transactions de 10 000 entrées pour optimiser les performances
4. **Mesure de delta** : Chaque probe peut mesurer le temps écoulé entre son déclenchement et sa finalisation

La structure de données stockée comprend :

- `timestamp` : Horodatage de l'événement en millisecondes
- `delta` : Temps écoulé en nanosecondes (optionnel)
- `topic` : Identifiant du type d'événement
- `payload` : Données JSON associées à l'événement

## Exemples d'utilisation

### Activation via commandes Xcraft

```javascript
// Activer le profilage
await this.quest.cmd('probe.enable');

// Désactiver le profilage
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

- **[xcraft-core-book]** : Fournit l'interface SQLite pour la persistance des données de profilage
- **[xcraft-core-etc]** : Gestion de la configuration pour déterminer l'emplacement de stockage
- **[xcraft-core-host]** : Récupération des arguments d'application (notamment la tribu)
- **[xcraft-core-bus]** : Exposition des commandes d'activation/désactivation sur le bus

## Variables d'environnement

| Variable       | Description                                               | Exemple          | Valeur par défaut       |
| -------------- | --------------------------------------------------------- | ---------------- | ----------------------- |
| `XCRAFT_PROBE` | Active le système de probes si définie et différente de 0 | `XCRAFT_PROBE=1` | Non définie (désactivé) |

## Détails des sources

### `lib/index.js`

Point d'entrée conditionnel qui vérifie la disponibilité de `xcraft-core-book`. Si le module SQLite n'est pas disponible, retourne `null` pour désactiver gracieusement le système de probes.

### `lib/probe.js`

#### Classe Probe

La classe `Probe` étend `SQLite` de `xcraft-core-book` et implémente le système de profilage.

**Caractéristiques principales :**

- Gestion automatique des transactions par lots (10 000 entrées)
- Base de données dédiée par tribu
- Mode WAL (Write-Ahead Logging) pour optimiser les performances
- Fermeture automatique lors de l'arrêt du processus

#### État et modèle de données

La classe maintient un état interne avec :

- `_pushCounter` : Compteur d'entrées pour la gestion des transactions
- `_disabled` : État d'activation du système
- `_dbName` : Nom de la base de données (format : `probe-{tribe}`)

Structure de la table `data` :

```sql
CREATE TABLE data (
  timestamp TEXT,
  delta TEXT,
  topic TEXT,
  payload JSON
);
```

Index créés pour optimiser les requêtes :

- Index sur `timestamp` pour les recherches temporelles
- Index sur `topic` pour filtrer par type d'événement

#### Méthodes publiques

- **`setEnable(enabled)`** — Active ou désactive le système de probes. Retourne l'état de disponibilité après l'opération.
- **`push(topic, payload)`** — Enregistre un nouvel événement dans la base de données. Retourne une fonction de callback pour mesurer le delta de temps.
- **`isAvailable()`** — Vérifie si le système de probes est disponible et activé.
- **`open()`** — Ouvre la base de données et initialise les tables et requêtes préparées.
- **`close()`** — Ferme la base de données après avoir committé la transaction en cours.

### `probe.js`

Expose les commandes Xcraft pour contrôler le système de probes via le bus de commandes.

#### Commandes disponibles

- **`probe.enable`** — Active le système de probes et affiche l'emplacement de la base de données
- **`probe.disable`** — Désactive le système de probes

Ces commandes sont configurées pour s'exécuter en parallèle et gèrent les cas d'erreur lorsque le module n'est pas disponible.

---

_Ce document a été mis à jour pour refléter l'état actuel du code source._

[xcraft-core-book]: https://github.com/Xcraft-Inc/xcraft-core-book
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus