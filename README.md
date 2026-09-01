# Uma Parent Deck Builder

Static site for **Umamusume: Pretty Derby (Global)** that picks a parent uma and a support card deck so the parent can pass down the skills your trainee is missing.

Live: https://senjeyb.github.io/umamusume-parent-deck-builder/

## What it does

1. You choose the **trainee** (the uma you will train for the Champions Meeting), her support deck and the **skills you want her to inherit**, ordered by priority.
2. Skills the trainee already has (or their upgraded / gold versions) and skills hinted by her own deck are removed from the list.
3. For every playable uma the tool computes how many wanted skills she has innately and finds the best deck of up to 6 support cards (5 owned + 1 borrow) that hints the remaining ones. Parents are ranked by the total coverage; you can also force a specific parent.
4. Decks respect the **minimum number of cards per type** you set (default: 1 Speed). Slots that are reserved for a type but do not need a specific card are shown with the type icon, unneeded slots are shown as free slots.
5. Cards you do not own can be marked with ✕. They are then only suggested in the borrow slot and the decks are recalculated.
6. When coverage is equal, SSR cards are preferred over SR, and SR over R.

Everything runs in the browser. Inputs are stored in `localStorage`, and the **Copy link** button encodes the current setup into the URL.

## Data

`data/gl.js` and the images in `img/` are generated from the public data of [uma.guide](https://uma.guide/) (characters, support cards, skills). The support card database of [uma-tiers](https://github.com/Euophrys/uma-tiers) was used as a reference for card ids and types.

To refresh the dataset:

```bash
npm install
npm run data
```

`scripts/build-data.mjs` downloads the current data chunk, rebuilds `data/gl.js` and fetches any missing card thumbnails, character chibis and skill icons (resized with `sharp` when it is installed). Use `--no-images` to skip images or `--force-images` to re-download them.

## Development

No build step is needed. Serve the folder with any static server, for example:

```bash
npm run serve
```

and open http://localhost:8080/.

## Deployment

The repository ships a GitHub Actions workflow (`.github/workflows/pages.yml`) that publishes the repository root to GitHub Pages on every push to `main`. In the repository settings choose **Pages → Build and deployment → Source: GitHub Actions**. Alternatively pick **Deploy from a branch** with the root folder, since the site is plain static files.

## Credits

Umamusume: Pretty Derby © Cygames. Card, character and skill images belong to Cygames and are used for reference only.
