# How ChromaDice works

The method in two pages.

## 1. The idea (from the Technion paper)

Stand a die on a corner. Three faces point up and outward, 120° apart. Put a viewer in front of each face, far away. Each viewer sees one face per die, so each die is **one pixel in three pictures at once**. A face shows 1 to 6 pips: more pips, darker. The only decision per die is its **orientation**, and a die has 24 of them, so there are 24 possible triples of (face seen by viewer 1, face seen by viewer 2, face seen by viewer 3).

To dither three grey-scale pictures onto this, go die by die. For each one, pick the orientation whose three faces are closest to the three grey levels wanted there, then push the leftover error onto the neighbouring dice in each picture (Floyd-Steinberg, the usual weights 7/16, 3/16, 5/16, 1/16). The error diffusion is what makes the mosaic read right from a distance: average tone is preserved even though each die only has six levels.

Two pictures: stand the dice on an edge instead, two faces, same idea. One picture: dice flat, ordinary dice art.

## 2. What I had to add to build it

**Where the dice go.** Put the centres at the integer points of the plane *x + y + z = 0*. Projecting along the *x* axis sends (x, y, z) to (y, z), which is one-to-one on that plane, so viewer 1 sees exactly one face per die at integer positions: a square grid, no gaps, no die hiding another. Same for the other two viewers. On the viewer's screen that grid is rotated 45° (because "up" is the body diagonal of the cube), so the picture is sampled at each die's screen position, not at its grid position. The dice are cut to a W × H block on the table, like the Technion jig (theirs was 64 × 64). The block is a rectangle for the viewer looking along one of its edges and a tilted rhombus for the other two; each picture is kept upright for its own viewer and fitted to what that viewer sees, as in the paper ("the dithered image will be scaled to fit the jig's shape").

For two pictures the centres are on *x + y = 0* and the two viewers look along *x* and *y*. Both see an upright W × H rectangle, which is why two pictures is the friendlier mode: no rhombus, no cropping.

**In what order to process them.** Error diffusion only works if error lands on dice that haven't been decided yet. Scanning row by row in one viewer's grid sends error backwards in another viewer's grid, because the three grids are shears of each other. Sorting the dice by *y - 2z* fixes this: for each viewer, every Floyd-Steinberg neighbour has a strictly larger key (one line of algebra per viewer). A unit test checks it for every die and every viewer.

**Refinement.** After the diffusion pass, a second pass re-visits every die and tries all orientations again, keeping the one that most reduces the error after a small blur (the blur stands in for looking from a distance). Cheap, and it fixes the places where the greedy pass got stuck.

**The tool.** 3D viewer with every die as a rounded cube (one draw call per die colour), camera buttons that snap to the exact view directions, a crop frame per picture, and exports: assembly plan, shopping list, SVG of each view.

## 3. What I learned about colour

**Multi-view colour.** I wanted colour pictures, so I let the solver also choose a die colour. Each viewer still gets its own picture, because the pips differ on every face. But it looked worse than black and white, three times in a row, and the reason is one sentence: **a die has one colour for all three viewers.** So the *shape* of each picture is independent per viewer, but the *colours* are shared. Where one picture wants blue and another wants orange at the same spot, the solver can only compromise, and the other pictures' colours leak in. So multi-view mosaics use one die colour, and colour palettes are for single pictures.

**Keeping hues.** With several die colours on one picture, plain OKLab nearest-colour matching picks a white die for a light-blue scarf or a forehead highlight: the lightness error beats the chroma error. People read that as "the scarf turned white", which is why adding white dice made results look worse, against intuition. I added a hue-identity term to the cost: the chroma deficit of a candidate along the target's own hue, squared, times a weight, ramped in only for targets with a clear hue (chroma above about 0.03, so dark hair doesn't turn purple). It is measured on the picture's colour, not the error-corrected one, so error diffusion can't talk a die out of its hue. Default weight 6; the Great Wave wants 20 because its blues are pale.

## 4. Stack

TypeScript throughout. `src/core` is the solver and geometry with no dependencies, used by the tests, by a Web Worker in the browser, and by the gallery script in Node. `src/web` is Vite and Three.js. 21 unit tests. About half a second for 6,000 dice in the browser.
