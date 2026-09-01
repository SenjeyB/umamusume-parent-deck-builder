# Uma Parent Deck Builder

Static site for **Umamusume: Pretty Derby (Global)** that picks a parent uma and a support card deck so the parent can pass down the skills your trainee is missing.

Live: https://senjeyb.github.io/umamusume-parent-deck-builder/

## What it does

1. You choose the **trainee** (the uma you will train for the Champions Meeting), her support deck and the **skills you want her to inherit**, ordered by priority.
2. Skills the trainee already has (or their upgraded / gold versions) and skills hinted by her own deck are removed from the list.
3. For every playable uma the tool computes how many wanted skills she has innately and finds the best deck of up to 6 support cards (5 owned + 1 borrow) that hints the remaining ones. Parents are ranked by the total coverage; you can also force a specific parent.
4. Decks respect the **minimum number of cards per type** you set (default: 1 Speed). Slots that are reserved for a type but do not need a specific card are shown with the type icon, unneeded slots are shown as free slots.
5. Cards you do not own can be marked with ✕. They are then only suggested in the borrow slot and the decks are recalculated. Umas you do not own can be marked the same way on the parent candidates and are skipped.
6. Game rules are respected: the parent is never the trainee's character (in any outfit), a deck never contains a card of the parent's own character, and never two cards of the same character.
7. When coverage is equal, SSR cards are preferred over SR, and SR over R.
8. Skills that did not fit into the best deck are listed separately. One click turns them into the wish list for the **second parent**, with the first parent's character excluded from the candidates.

The wish list can hold up to 150 skills. When a gold skill is in the list, its white version is not offered in the search, because the tool already falls back to it when needed.

Everything runs in the browser. Inputs are stored in `localStorage`, and the **Copy link** button encodes the current setup into the URL.

## How skills are modelled

- **Hints** of a support card and **innate / awakening skills** of an uma are always available.
- **Career events** of a card or an uma can also give skills (this is how gold skills such as Swinging Maestro from SSR Super Creek appear). Events with several options are exclusive: only one option of an event is counted, and the tool tells you which option it assumed.
- **Grandparents**: you can name up to two umas that will be the parents of the parent you are building. Their white skills and unique skills count as inheritable through that parent, which is the only way to pass down a skill owned by the trainee's own character in another outfit (for example Triumphant Pulse of Oguri Cap [Starlight Beat] to Oguri Cap [Ashen Miracle]).
- White versions of gold skills are resolved from the skill families in the data (including reversed numbering such as Uma Stan / Superstan and ○ → ◎ → gold chains). A gold skill without any white version in the data is reported as such.
- **Training scenarios** (URA Finale, Unity Cup, Trackblazer, Grand Concert): scenario-exclusive skills and rewards are modelled from the GameTora and uma.guide scenario guides. Unity Cup grants the Ignited Spirit skills through Extreme Spirit Bursts, one Burning Spirit skill through the "Team Zenith Declares War" event, It's On! at team rank S+, and the R-card hint pools of the fixed teammates Haru Urara, Rice Shower, Matikanefukukitaru and Taiki Shuttle. Trackblazer grants Glittering Star (Umamusume of the Year) and Radiant Star (Twinkle Star Climax win). Grand Concert offers one reward skill at 16 songs, gold only with a linked character or her card (Smart Falcon, Mihono Bourbon, Agnes Tachyon, Silence Suzuka), and I Wanna Win with You at 18 songs. You choose the trainee's scenario; the parent's scenario is picked automatically or fixed.
- Only skills that exist as **Sparks** (inheritance factors) can be passed down. Gold skills and ◎ versions have no spark, so the tool falls back to the inheritable version (usually the ○ / white skill).
- A parent **cannot pass down a gold skill**, only its white version. A wanted gold skill is therefore kept only when the trainee herself or a card in her deck can give it; otherwise the tool warns and searches for the white version instead (for example Swinging Maestro becomes Corner Recovery ○). Gold skills of a parent are counted as their white versions.

## Data

`data/gl.js` and the images in `img/` are generated from the public data of [uma.guide](https://uma.guide/) (characters, support cards, skills). Skill rewards of career events come from [GameTora](https://gametora.com/umamusume) support card and character pages. The support card database of [uma-tiers](https://github.com/Euophrys/uma-tiers) was used as a reference for card ids and types.

To refresh the dataset:

```bash
npm install
npm run data
```

`scripts/build-data.mjs` downloads the current data chunk, rebuilds `data/gl.js`, fetches the event data from GameTora (cached in `.cache/`) and downloads any missing card thumbnails, character chibis and skill icons (resized with `sharp` when it is installed). Flags: `--no-images`, `--force-images`, `--no-events` (keep the previous event data), `--force-events` (ignore the GameTora cache).

## Development

No build step is needed. Serve the folder with any static server, for example:

```bash
npm run serve
```

and open http://localhost:8080/.

## Deployment

The repository ships a GitHub Actions workflow (`.github/workflows/pages.yml`) that publishes the repository root to GitHub Pages on every push to `main` (and, until the code is merged, to `claude/umamusume-deck-generator-v6mutn`).

One-time setup, which the workflow cannot do on its own: open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. Then re-run the failed "Deploy to GitHub Pages" run from the Actions tab or push any commit. Alternatively pick **Deploy from a branch** with the root folder, since the site is plain static files.

## Credits

Umamusume: Pretty Derby © Cygames. Card, character and skill images belong to Cygames and are used for reference only.
