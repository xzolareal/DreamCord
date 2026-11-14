# DreamCord

Mod Discord ultra simple pour **Windows** : un **fond d'écran animé** (image, GIF ou vidéo) derrière Discord, quelques réglages de style et 6 plugins utiles. Rien d'autre.

## Utilisation

Injecter dans ton Discord officiel :

```powershell
npm run inject
```

Puis quitte complètement Discord (clic droit sur l'icône dans la barre des tâches → **Quitter Discord**) et relance-le.
Pour retirer DreamCord : `npm run uninject`.

Client autonome : `npm start` · Installateur Windows : `npm run build`.

> Si tu déplaces le dossier DreamCord, relance `npm run inject`.

## Ouvrir les réglages

**F9**, **Ctrl + Alt + D**, ou le bouton ✦ à côté du micro / casque.
Le panneau s'ouvre sur le côté : tu vois le fond changer **en direct** pendant que tu règles.

## Fond d'écran

Onglet **Fond d'écran** :

- **Choisir une image / vidéo…** : un fichier de ton PC (`.mp4`, `.webm`, `.mov`, `.gif`, `.png`, `.jpg`, `.webp`…), ou colle un lien direct.
- **Luminosité** (10 – 200 %), **Opacité du fond**, **Opacité de l'interface Discord** (plus bas = on voit mieux le fond), **Flou**, **Contraste**, **Saturation**.
- **Vitesse de la vidéo** (0,25× – 2×) pour les vidéos, **Ajustement** (Remplir / Ajuster / Étirer).
- **Pause** automatique quand la fenêtre est réduite (et, en option, quand Discord n'a pas le focus) pour économiser le processeur.

Les vidéos sont toujours sans son et jouées en boucle.

Conseils : privilégie le **MP4 (H.264)** ou le **WebM**, en 1080p. Une vidéo 4K lourde consomme beaucoup de carte graphique. Pour un fond plus lisible, baisse la luminosité et/ou l'opacité de l'interface.

Le fichier choisi n'est pas copié : il est servi uniquement à Discord via un petit serveur local (`127.0.0.1`, jeton aléatoire à chaque lancement, un seul fichier). Si tu déplaces ou supprimes le fichier, choisis-en un nouveau.

## Style

5 palettes (Carbone, Noir pur, Océan, Violet, Discord), couleur d'accent, arrondi des coins.
Dans **Avancé** : CSS personnalisé, masquer le bouton ✦, tout réinitialiser.

## Plugins (6)

| Plugin | Rôle |
| --- | --- |
| Messages supprimés visibles | Garde les messages supprimés à l'écran, en rouge |
| Bloquer la télémétrie | Empêche l'envoi des statistiques d'usage |
| Liens propres | Retire les paramètres de suivi des liens |
| Avatars en HD | Alt + clic sur un avatar / bannière / icône pour l'agrandir |
| Booster de volume | Son des vidéos du chat jusqu'à 300 % (désactivé par défaut) |
| Interface épurée | Cache Nitro, Boutique, Quêtes et le bouton Cadeau |

## Si le fond ne s'affiche pas bien

Discord change régulièrement le nom de ses éléments. Si une zone reste opaque, ajoute une règle dans **Style → Avancé → CSS personnalisé**, par exemple :

```css
[class*="nomDeLaZone_"] { background: transparent !important; }
```

Le journal du mod est dans `%APPDATA%\DreamCord\patch.log`.
