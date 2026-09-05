# Sword of Fargoal — Design Bible (Modern Remake)

Authoritative design reference for the Three.js remake living in `fargoal/`. It documents the
original game precisely (so the "C64 reference replica" and the Classic rules mode can be faithful)
and then specifies the modern remake on top of it. `ARCHITECTURE.md` remains the binding contract
for code structure; this file is the binding contract for *rules, numbers and look*.

**Provenance.** Research was done online (network used). The most important primary sources were:

| Source | What it gave us |
|---|---|
| Epyx 1983 C64 manual + reference card (mocagh.org scans, text layer extracted) | Story, official monster list, spell/item/trap descriptions, keys, screen legend, starting stats 12 HP / 8 skill, 200-XP doubling table, 2000-second timer, sword on levels 15–20, beacons, wandering monsters |
| Paul Robson's annotated reverse-engineering of the VIC-20 BASIC (`eris/documents/fargoal/bas.lst`) and c64cryptoboy's VIC-20 variable analysis | **Every formula**: level generator, monster generation, combat maths, healing, XP, traps, item odds, monster AI, Dimension Spider, thieves, Mage/Demon, timer |
| TRS-80 MC-10 type-in port (jggames) | Confirms the monster DATA table (names, glyph codes, combat words) |
| C64-Wiki (article + screenshots), Wikipedia, CRPG Addict play-through, Maximum Utmost, retro365, Evercade spotlight, RogueBasin, TouchArcade | C64 presentation (colours, HUD), feel, sound, ratings, remake history |

Numbers marked **[VIC]** come straight from the VIC-20 code (the C64 version is the same BASIC
program with machine-language helpers, a 40-column map, sprites, SID sound, beacons and wandering
monsters; where the C64 differs it is noted). Numbers marked **[manual]** are from the printed
manual. Numbers marked **[designed]** are ours, chosen to fit the originals. Numbers marked
**[remake 2009/2022]** describe the iOS/Steam remake and are *not* part of Classic rules.

---

## 1. Premise, win / lose conditions, scoring

### 1.1 Premise (from the "Book of Lore")
The Protectorate Sword, forged "in the fires of the gods", guarded the Great Forest from its stone
sheath in the temple of Ferrin. The young fighter **Gedwyn** was tricked into drawing it, ambushed
by a war lord in service of the wizard **Umla**, and struck blind. Umla hid the sword deep in the
mountains, where it became known as the **Sword of Fargoal**. You, a warrior from a nearby village,
are "magically transported into the uppermost level of the dungeon" with a short sword, one
Healing Potion and one Teleport spell. Bring the sword back up to Gedwyn, who waits in the temple.

### 1.2 Objective loop
1. Descend through randomly generated levels. The sword lies on a random level **15–19** [VIC:
   `sword.level = int(5*rnd+15)`] — the manual says "between the fifteenth and the twentieth".
2. On the sword level the sword occupies the square where the temple would have been, i.e. **the
   sword level has no temple** [VIC line 27]. (The manual's "on most levels [the temple is a
   sanctuary]" hedges exactly this.)
3. Picking up the sword **doubles your experience points** and starts a **2000-second (33 min 20 s)
   real-time countdown** [VIC line 79; manual]. Umla now "knows where you are".
4. Climb back to level 1 and take the up-staircase there (only exists on level 1 while you hold the
   sword) — reaching "level 0" is **"YOUR QUEST IS COMPLETE"**.

### 1.3 Losing the sword
If any monster **attacks you** (monster-initiated combat) while you carry the sword, the sword is
**stolen** and the monster vanishes ("THE SWORD IS STOLEN!!") [VIC line 225]. The sword goes back to
the level where it was originally placed; you must descend again, and **the clock keeps running**.
(Being the aggressor never risks the sword; hence the manual's "do not pass GO... find staircases
going up as quickly as you can!")

### 1.4 Lose conditions
| Condition | Rule |
|---|---|
| Slain in combat | HP drops **below −5** during a fight → "THOU ART SLAIN!" / "SLAIN BY <monster>" [VIC 222, 268] |
| Death outside combat | HP **< 0** at the start of an idle tick: if a Healing Potion exists it is drunk automatically, otherwise "YOU DIED!!" [VIC 55, 83] |
| Out of time | Sword timer reaches 0 → "OUT OF TIME!" and the game ends [VIC 6, 324] |
| Quit | Q key ends the game (score screen) |

Permadeath: no saving in the original (the remake adds save/continue, see §9).

### 1.5 Score screen (after death, quit, time-out or victory) [VIC 325–328]
`EXPERIENCE`, `LEVEL`, `DEEPEST LV`, `MONSTERS` (slain), `HEALTH: n HITS`, `SKILL`,
`QUEST TOOK n MIN` (total minutes since game start), then `PLAY AGAIN? Y/N`.
The "score" the community compares is **experience points** (C64-Wiki high scores: 320,247 XP at
experience level 11, dungeon level 12, 184 monsters slain). The manual's "Further Goals": fastest
time, most XP, highest characteristics, most monsters slain, deepest level.

**[designed] Remake score** = XP + 1000 × deepest level + 25,000 × victory + time bonus
(victory only: `max(0, remainingSeconds) × 10`). Hall of fame stores name, score, XP, level, depth,
kills, elapsed time, seed, difficulty, outcome.

---

## 2. Level generation (original rules)

### 2.1 Grid and screen
| | VIC-20 (1982) | C64 (1983) |
|---|---|---|
| Text screen | 22 × 23 characters | 40 × 25 characters |
| Map area | 22 wide × 22 rows (rows 1–22); row 0 is the message/status line | 40 wide × 24 rows (rows 1–24) [observed from screenshots; verify in emulator]; row 0 is the status line |
| Off-screen map | A second 22×23 "map" buffer holds the true level; the visible screen is a copy revealed as you explore | Same idea (map buffer + display), 40 columns |

The whole level fits on one screen. **No scrolling** in the original.

### 2.2 Room-and-tunnel digger [VIC lines 8–25]
1. Fill the map with rock (glyph 36).
2. Carve **10 rooms**: width `int(4*rnd+2)` = 2–5, height 2–5, placed at random x in `[0, 21-w)`,
   y in `[1, 21-h]`. Rooms may overlap (they merge). Remember each room's centre.
3. For each room in order, starting at its centre, dig a **random-walk tunnel** ("twisting
   corridors"):
   - pick a direction 1–4 (N/S/E/W) that is **not the reverse** of the previous direction;
   - choose a segment length `int(5*rnd+5)` = 5–9;
   - step one tile at a time carving floor; if the step lands on rock set a flag; when the tunnel
     has passed through rock and reaches an existing open tile, **stop — the room is connected**;
   - stepping off the map (x<1, x>20, or outside rows 2–21) **undoes** the step and picks a new
     direction;
   - when the segment length is reached, pick a new direction.
   Result: one-tile-wide, winding corridors that connect the rooms, frequently with dead-end stubs.
   (CRPG Addict notes that occasionally "half-levels" end up unreachable — the remake fixes this,
   see §9 fidelity list.)
4. Status/inventory screen is shown halfway through generation ("WAIT...").

### 2.3 Object placement [VIC lines 27–33] (all on random empty floor tiles)
| Object | Count per level | Notes |
|---|---|---|
| Temple | 1 | Replaced by the **Sword** on the sword level (if not yet found) |
| Stairs down | `int(2*rnd+2)` = **2–3** | |
| Stairs up | 1 if `level > 1` **or** you carry the sword | Level 1 has no up-stairs until you hold the sword |
| Gold bags | `int(5*rnd+6)` = **6–10** | Value `int(20*rnd + 10*level)` = 10L … 10L+19 gp |
| Hidden treasure/trap squares | `int(level*rnd+3)` = **3 … level+2** | 4/9 trap, 5/9 treasure (see §5.4); manual says "50-50" |
| "Other" monsters (creatures) | `int(3*rnd+1)+1` = **2–4** | See §4 |
| Human-type monsters | `int(3*rnd)+1` = **1–3** | See §4 |
| Pits | 0 at generation | Pits are **created by pit traps** when sprung; they then remain and can be used as multi-level shortcuts |
| Player start | random empty tile | Always dark except the 8 neighbours |

C64 additions: **Beacons** (a rare treasure, §5.2) and **wandering monsters** — "if you wait too long
on a level, unfriendly visitors will begin climbing from levels above and BELOW!" [refcard].
**[designed]**: wandering monster timer = 90 s + 10 s × (1 + kills on this level), then one new
monster (rolled for depth ±1) spawns on a random dark tile at least 8 tiles away; repeat every 60 s.

### 2.4 Level count and persistence
- Levels are **not stored**: leaving a level and returning generates a brand-new layout ("it will
  not be the same when you return") [manual]. Buried gold left behind is lost.
- The dungeon is **effectively endless** (`level` is an unbounded integer); nothing stops you from
  going below the sword level, and monster strength keeps scaling. Practical depth ≈ 20–25.
- Pits can drop you `int(4*rnd+2)` = **2–5 levels** at once [VIC 173].
- Maps for other levels are keyed by level number only (any future visit to that level number is
  fully lit).

### 2.5 Fog of war [VIC 112, 148, 140]
- Everything starts dark. Moving reveals the **8 neighbouring tiles** (radius 1, no line-of-sight).
- With **Light** cast, radius becomes **2** in the 8 compass directions (a second tile is revealed only
  if the first is not rock).
- Revealed tiles stay revealed for the whole level ("remain lighted as long as you are on that
  level"), except: springing a trap (pit, ceiling, explosion, teleport-trap) has a **1-in-4 chance
  of "LOST YOUR MAP!"** which re-darkens the whole screen (spiral wipe animation) [VIC 206–207].
- **Monsters are drawn wherever they are on already-revealed tiles**; on dark tiles they are hidden.
  A monster stepping onto a dark tile leaves its previous tile revealed (monsters "open up" tiles
  they walk over) [VIC 314, 317]. Assassins additionally are invisible unless Light is on.
- Magic Map: the whole level is copied to the screen on entry (all walls, floors, objects, temple,
  stairs, monsters).

### 2.6 Depth scaling summary
| Quantity | Formula [VIC] |
|---|---|
| Monster move rate | one monster phase every `max(1, 20 − level)` player input polls |
| Creature strength | `Σ_{k=1}^{2+⌊L/4⌋} int(4·rnd + L)` + type bonus `int(x·rnd + x)` |
| Creature HP | `Σ int(6·rnd + 1.5L)` + `int(x·rnd + x)` |
| Human strength | `Σ_{k=1}^{3+⌊L/4⌋} int(3·rnd + 1.5L)` + `int(x·rnd + x)` |
| Human HP | `Σ int(4·rnd + L)` + `int(x·rnd + x)` |
| Monster type index x | `int(4·rnd + L/2)`; if ≥ 10 → `r=int(6·rnd)`: r>0 → type `10−r`, r=0 → **Mage/Demon** |
| Gold per bag | `int(20·rnd + 10L)` |
| Trap/treasure squares | 3 … L+2 |
| Damage from explosion | `int(15·rnd + L)` |
| Damage from pit / ceiling trap | `int(10·rnd + L)` |
| Potion heal | `int(20·rnd + 3L)` |
| XP for descending stairs | `int(10·rnd + 1) × L` |

---

## 3. Player

### 3.1 Starting character [VIC 343–347; manual; screenshots]
| Stat | Value |
|---|---|
| Hit points / Maximum Hits | `3 × int(6·rnd + 1)` = **3–18** (manual example 12; C64 screenshot 11) |
| Battle Skill | `3 × int(6·rnd + 1)` = **3–18** (manual example 8; screenshot 11) |
| Experience Points / Level | 0 / 1; next level at **200** |
| Dungeon Level | 1; Monsters Slain 0 |
| Inventory | 1 Healing Potion, 1 Teleport spell, Enchanted Weapon +0, 0 sacks, gold capacity **100** |

**[designed] Classic mode keeps the random roll. "Standard" and "Story" difficulties start at 12 HP /
8 skill (the manual's canonical character) so runs are comparable for daily seeds.**

### 3.2 Experience and levelling [VIC 58, 88]
| Level | XP required (cumulative) |
|---|---|
| 2 | 200 |
| 3 | 400 |
| 4 | 800 |
| 5 | 1,600 |
| 6 | 3,200 |
| 7 | 6,400 |
| 8 | 12,800 |
| 9 | 25,600 |
| 10 | 51,200 |
| 11 | 102,400 |
| n | 200 × 2^(n−2) |

On level-up ("LEVEL RAISED TO n"): **Max HP += int(15·rnd+5) (5–19)**, **Battle Skill += int(10·rnd+1)
(1–10)**. Level-up is checked when you next move. There is no level cap; players plateau around
character level 10–11 near dungeon level 10–12.

XP sources (all [VIC]):
| Source | XP |
|---|---|
| Killing a monster | `(monster strength + monster initial HP) × dungeon level` |
| Temple sacrifice | **1 XP per gold piece**, automatic on stepping onto the temple with gold |
| Descending stairs | `int(10·rnd+1) × level` (1–10 × level) |
| Finding any treasure item | `int(50·rnd + level)` |
| Climbing/falling a pit successfully | `int(10·rnd + 5×levelsMoved)` |
| Picking up the Sword | **XP doubled** (once) |

XP losses: a **Demon** halves your XP and reduces experience level by 1 (§4).

### 3.3 Battle Skill growth
+1–10 per experience level, **+1–5 per monster kill** [VIC 228/272], **+5–14 per Enchanted Weapon**
[VIC 187]. Battle skill is the single combat stat (see §7).

### 3.4 Regeneration [VIC 2, 45, 56, 86]
- `autoheal.rate` starts at **50** on every level.
- Every idle tick (a main-loop pass with no key pressed) increments a counter; when
  `counter > (HP / MaxHP) × autoheal.rate` you heal **1 HP**. Consequence: **the lower your HP the
  faster you regenerate** (near 0 HP: ~1 HP per tick; near full: 1 HP per 50 ticks).
- Regeneration spell: `autoheal.rate /= 2` (stackable: two spells = ×4 speed), lasts until you
  leave the level.
- Temple: `autoheal.rate /= 2` while standing on it, restored on leaving.
- **[designed]** idle tick = **100 ms** of game time. Full heal from 0→100 max HP then takes about
  4 min unassisted, ~2 min in a temple, matching "might have taken five minutes" (CRPG Addict).

### 3.5 Gold [VIC 95–96, 153–164, 226, 276]
- Capacity **100** + 100 per Magic Sack. Gold cannot be spent; its only use is sacrifice for XP.
- Picking up more than you can carry: the excess is auto-buried on that tile ("CAN'T CARRY MORE
  GOLD" / "HIDING THE GOLD") as a hidden-treasure marker.
- **B** buries all carried gold under your feet (max **10 caches per level**), marked on the map;
  step on it again to recover ("HIDDEN TREASURE!!").
- **Theft**: when a *human-type* monster attacks you while you carry gold and it is either a
  **Rogue** (always) or its damage ratio is `< 0.5` or `> 1` (much weaker or stronger than you), it
  takes **all** your gold ("YOUR GOLD IS STOLEN!!") and runs away; if it reaches an unrevealed tile
  it escapes into the shadows for good. Kill it first and you get the gold back ("FOUND YOUR n
  GOLD!!"). Human monsters also pick up gold bags lying on the floor as they walk.

### 3.6 Death
See §1.4. On death the full map is revealed (spiral wipe of the true level), the score screen is
shown and the game restarts from scratch.

---

## 4. Bestiary

The original C64/VIC game has **20 named monsters** in two families of 10, plus two hidden
"special" monsters (**Mage** and **Demon**) that are generated in place of a normal monster and are
displayed with an ordinary glyph — **22 monsters total**. (Kobolds, sprites, vampires, slimes,
salamanders, etc. do **not** exist in Fargoal; they belong to other games.)

Every monster's stats are rolled at level entry from the depth (§2.6), so there are no fixed
hit-point values. Instead each monster gets a **type index x (0–9)** which adds `int(x·rnd + x)` to
both strength and HP and decides its name and glyph, and a **quality prefix** based on how it
compares with *your* battle skill: creatures are "WEAK" (ratio × 5 < 1) or "POWER" (ratio × 5 > 6),
humans are "INFERIOR" or "EXPER" (experienced). The prefix is the only in-game hint of danger.

Depth range = levels on which the type index can be rolled (`x = int(4·rnd + L/2)`, with x ≥ 10
remapped to 5–9 or to Mage/Demon). "Weight" = which slot of the 10-entry table.

### 4.1 Creatures ("Other Monsters" — rely on strength; will fall into pits if baited) [manual, VIC DATA]
| # | Name | Depth (first–last) | Glyph code [VIC] | Rel. HP | Rel. dmg | Speed | Special behaviour | XP |
|---|---|---|---|---|---|---|---|---|
| 0 | Dire Wolf | 1 only (x=0) | 31 | low | low | normal | The tutorial monster; "weak dire wolf" is the archetypal first fight | (str+HP)×L |
| 1 | Ogre | 1–3 | 27 | med | med | normal | — ([remake] throws skulls) | " |
| 2 | Hobgoblin | 1–5 | 27 | med | med | normal | — | " |
| 3 | Werebear | 1–7 | 27 | high | high | normal | "Deadly at the first level but a snap at the third" [manual] | " |
| 4 | Gargoyle | 2–9 | 28 | high | med | normal | Same glyph the **Demon** hides behind | " |
| 5 | Troll | 4–11, and 14+ | 27 | high | high | normal | ([remake] extra damage vs shields) | " |
| 6 | Wyvern | 6–13, and 14+ | 30 | high | high | normal | Dragon glyph ([remake] poison breath) | " |
| 7 | Dimension Spider | 8–15, and 14+ | 29 | med | high | **blinks** | "Phases in and out between dimensions": when within 3 tiles (and not diagonally adjacent) it **teleports to a random empty tile next to you** [VIC 319–323] | " |
| 8 | Shadow Dragon | 10–17, and 14+ | 30 | very high | very high | normal | ([remake] "breathes scorching darkness") | " |
| 9 | Fyre Drake (Fire Drake) | 12+ | 30 | very high | very high | normal | Top creature | " |
| — | **Demon** | 14+ (4% at L14 → 17% at L20+) | 28 (looks like a Gargoyle) | n/a | n/a | normal | Not fought: on contact "THE DEMON DRAINS YOUR EXPERIENCE LEVEL!!" — **XP halved, experience level −1**, then it vanishes [VIC 234] | 0 |

Creature combat words (printed each round, one at random): CRUNCH, CLAW, GNARL, UGH!, GROWL!, SHRED, THUMP.

### 4.2 Human-type monsters (intelligent, always carry a weapon, pick up and steal treasure) [manual, VIC DATA]
| # | Name | Depth | Glyph code [VIC] | Rel. HP | Rel. dmg | Speed | Special behaviour | XP |
|---|---|---|---|---|---|---|---|---|
| 0 | Rogue | 1 only | 42 | low | low | normal | **Always steals your gold** when it attacks you (glyph 42 check) [VIC 220] | (str+HP)×L |
| 1 | Barbarian | 1–3 | 41 | med | med | normal | — | " |
| 2 | Elvin Ranger | 1–5 | 41 | med | med | normal | ([remake] shoots arrows) | " |
| 3 | Dwarven Guard | 1–7 | 43 | med | high | normal | Distinct glyph (shield) | " |
| 4 | Mercenary | 2–9 | 41 | med | med | normal | — | " |
| 5 | Swordsman | 4–11, 14+ | 41 | high | high | normal | — | " |
| 6 | Monk | 6–13, 14+ | 41 | high | high | normal | ([remake] drinks healing potions) | " |
| 7 | Dark Warrior | 8–15, 14+ | 41 | high | high | normal | Umla's elite ([remake] can become a Dark Weretiger) | " |
| 8 | Assassin | 10–17, 14+ | 40 (**blank**) | high | very high | normal | **Invisible** unless a Light spell is active (then drawn with glyph 41) [VIC 287]; "likes to linger by stairs" (CRPG Addict) | " |
| 9 | War Lord | 12+ | 41 | very high | very high | normal | Top human; the boss-tier threat of the escape ([remake] carries a War Shield) | " |
| — | **Mage** | 14+ (same odds as Demon) | 41 (looks like any human) | n/a | n/a | normal | Not fought: "THE MAGE TAKES YOUR MAGIC SPELLS!!" — **all six spell counts set to 0**, then it vanishes [VIC 233] | 0 |

Human combat words: CLANG, OUCH!, SLASH, CLINK, CHOP, THUD, SHRIEK!

Humans steal gold under the rule in §3.5, and **any** attacking monster (either family) steals the
Sword.

### 4.3 Typical rolled stats (expected values, for tuning and for the remake's tooltips)
| Depth | Creature str / HP | Human str / HP | Player skill (typical) | Monster hit (avg) | Player hit (avg) |
|---|---|---|---|---|---|
| 1 | 5 / 8 (+0–2 type) | 8 / 8 | 10 | 1–2 | 1–8 |
| 5 | 19 / 34 | 34 / 26 | 40–60 | 1–7 | 1–40 |
| 10 | 55 / 79 | 89 / 67 | 150–300 | 1–14 | 1–100+ |
| 15 | 100 / 155 | 160 / 120 | 300–600 | 1–20 | 1–150 |
| 19 | 140 / 210 | 215 / 165 | 500–800 | 1–25 | 1–200 |

(Battle-skill inflation from kills means late monsters mostly hurt through *quantity*, thieves and
the Mage/Demon, not through raw damage — matching the "easy on the way down, almost impossible on
the way up" feel: on the way up everything wants to *touch* you.)

### 4.4 Monster AI [VIC 282–323]
- All monsters of a level move in one **monster phase** every `max(1, 20 − level)` player input
  polls (level 1: player gets ~19 inputs per monster step; level 19+: 1:1).
- A monster only acts if the player is within **9 tiles** on both axes.
- Chase: step greedily toward the player (dx then dy). If blocked by rock, another monster, the
  temple or the pit, retry vertical-only, then horizontal-only, then up to **5 random directions**.
- If the player is **on a temple** or **invisible** (and Light is off), the monster picks a random
  target instead (wanders).
- A monster that steps onto the player's tile **attacks** (forced fight, §7).
- Creatures die if they step on a pit; humans sweep up gold bags they cross.
- Dimension Spider special blink (see table). Assassin visibility (see table).
- Monsters do not follow you between levels (levels are regenerated), but the C64 adds wandering
  monsters "climbing from above and below".

**[remake 2009/2022]**-only behaviours (Lizard Man stench, Wyvern poison, Ogre skulls, Elvin arrows,
Monk potions, War Shields, Dark Weretiger) are *not* Classic; they are listed in §9 as optional
"Extended bestiary" content.

---

## 5. Spells and items

### 5.1 Spells (six; found as treasure, "do not go into effect until you actually cast it") [manual, VIC]
| Spell | Key | Effect (exact) | Duration | Notes |
|---|---|---|---|---|
| Teleport | T / Panic button | Move to a random empty floor tile on this level; new 8-neighbour reveal | instant | Panic button uses it to escape a monster-initiated fight or a Ceiling Trap; C64 with a Beacon placed: teleports land **on the beacon**; from the beacon, fire button teleports you **to the temple for free** [refcard] |
| Shield | S | Take **no damage** from monsters or explosions | until the end of the next fight (or blast) | Must be cast *before* combat; consumed when the fight ends (win or flee) |
| Regeneration | R | `autoheal.rate /= 2` (heal twice as fast); **stackable** | rest of this level | |
| Invisibility | I | Monsters stop chasing you (random wander) | until you kill a monster, or you cast/turn on Light | "You will be seen if you cast a Light spell" |
| Light | L (O toggles on/off) | Reveal radius 2 instead of 1; **reveals Assassins** | rest of this level (turns off on level change) | Toggling keeps the spell; casting a new one is only needed on a new level |
| Drift | Panic button only | Negates fall damage from a pit ("LIKE A FEATHER...") | one fall | Cannot be cast pre-emptively; only when the fall prompt is up |

Panic button (joystick fire, C64 red button): during a fall → Drift; during a ceiling trap or a
monster-initiated fight → Teleport; on stairs → climb; on an empty tile → Pass.

### 5.2 Items and treasures
| Item | Effect | How found | Notes |
|---|---|---|---|
| Healing Potion | Heal `int(20·rnd + 3·level)` HP, capped at max | Treasure squares (2/14 of items); start with 1 | **Auto-drunk when HP < 0** outside combat ("HEALING POTION TAKEN!"); key H |
| Magic Sack | Gold capacity **+100** (cumulative) | Treasure (2/14) | |
| Magic Map | "MAP TO nth LEVEL!!" for level `int(8·rnd + level + 3)` = L+3 … L+10; that level is fully lit on entry | Treasure (1/14) | Any trap sprung on that level has a 1/4 chance of destroying the map ("lights go out"); up to 10 maps |
| Enchanted Weapon | **Battle skill += int(10·rnd+5)** and **+1 flat damage per enchantment** on every hit; permanent and cumulative ("ENCHANTED WEAPON +n") | Treasure (1/14) | |
| Beacon **[C64 only]** | Press **+** to place: standing on the beacon you are invisible to monsters; fire button there teleports you to the temple free; all later Teleports on that level arrive at the beacon | Treasure (rare) | Absent from the VIC-20 |
| Gold bag | +`int(20·rnd + 10·level)` gp | 6–10 lie on the floor per level | Manual: "grab gold as soon as possible" |
| Hidden treasure (buried gold) | Recover the cache | Your own buried/overflow gold | Same glyph as treasure/trap squares |
| Healing Charm, Light Charm | Permanent regeneration / permanent light | *Reported by C64-Wiki as "seldom" chest contents* | Not in VIC code; **unverified — treat as C64 rumour, not Classic** |
| **The Sword of Fargoal** | XP ×2; starts the 2000 s timer; stealable | Replaces the temple on the sword level | Manual & lore only; no combat bonus in the VIC code (the ZX port gives +3 skill/+5 HP, not Classic) |

### 5.3 Treasure item odds [VIC 180] (when a treasure/trap square yields a treasure)
`x = int(14·rnd+1)` → 1 potion, 2 sack, 3 potion, 4 regeneration, 5 sack, 6 shield, 7 teleport,
8 light, 9 enchanted weapon, 10 map, 11 invisibility, 12 shield, 13 teleport, 14 drift.
So: Potion 14.3 %, Sack 14.3 %, Shield 14.3 %, Teleport 14.3 %, Regeneration 7.1 %, Light 7.1 %,
Enchanted Weapon 7.1 %, Map 7.1 %, Invisibility 7.1 %, Drift 7.1 %. C64 adds Beacons
**[designed: 3 % taken evenly from the 14.3 % entries]**. Finding any treasure also gives
`int(50·rnd+level)` XP.

### 5.4 Traps (hidden treasure/trap squares; must be stepped on) [VIC 165–178]
`r = int(9·rnd+1)`: 1 Pit, 2 Ceiling, 3 Explosion, 4 Teleport trap, 5–9 Treasure (§5.3) → **44 % trap**.
| Trap | Effect | Escape |
|---|---|---|
| Pit ("PIT!!...YOU FELL!") | Damage `int(10·rnd + level)`; leaves a permanent **pit** tile; you drop `int(4·rnd+2)` = 2–5 levels; 1/4 chance to lose the map | Panic button + Drift spell → no damage |
| Ceiling trap ("CEILING TRAP!") | "Drops a huge block of stone": damage `int(10·rnd + level)`; leaves a "hole in the ceiling" tile; may lose map | Panic button + Teleport → "TELEPORT TO SAFETY!" |
| Explosion ("EXPLOSION!!") | Damage `int(15·rnd + level)`; flashing red/yellow blast animation; may lose map | Active Shield → "SHIELDED FROM BLAST!" (shield consumed) |
| Teleport trap ("TELEPORT...") | Same as the Teleport spell; may lose map | none needed |

Pits as shortcuts: walk onto an open pit → "CLIMBING THE PIT..." 50 % you climb down 2–5 levels
safely (XP `int(10·rnd + 5×levels)`), 50 % "YOU FELL!" for `int(10·rnd + 3×levels + level)`
damage (Drift negates). The tile "CLIMBABLE PIT ABOVE" on the destination level lets you climb
back **up** the same number of levels with C.

---

## 6. Temples

- Exactly **one temple per level**, except the sword level (sword takes its place).
- **Sanctuary**: while you stand on the temple, monsters ignore you (they pick random wander
  targets) — "you are invisible to all monsters" [manual]. They can still bump into you by chance
  in the VIC code only if they randomly path onto the tile; **[designed] Classic mode: monsters
  never enter the temple tile.**
- **Healing**: `autoheal.rate` halves on the temple (heal twice as fast) [VIC 86].
- **Sacrifice**: stepping onto the temple with gold immediately converts **all** carried gold to XP
  at **1 gp = 1 XP** ("SACRIFICE OF GOLD!") with a jingle. No partial sacrifice in the original.
- Beacon + fire button = free teleport to the temple (C64).
- Manual strategy: "After clearing out a level, rest at the temple... you have time to rest, eat,
  etc., without worry." The C64's wandering monsters exist precisely to punish camping forever.

---

## 7. Real-time feel and combat

### 7.1 The hybrid clock
The original is neither turn-based nor pure real-time. The BASIC main loop polls the keyboard and
joystick continuously; **the player moves once per poll while the stick is held**, HP regeneration
ticks on idle polls, and **monsters all move once every `20 − level` polls** (a droning SID sound
marks each monster phase on the C64). The manual calls monsters "wandering"; players describe
"running circles around them" on early levels and monsters being "almost 1:1" by the sword level.
Nothing waits for you: stand still and monsters keep approaching, gold-thieves keep escaping, and
the sword timer keeps ticking in real seconds.

**[designed] time mapping for the remake (fixed step 1/30 s):**
| Thing | Original | Remake (Classic) |
|---|---|---|
| Player step | 1 poll while held | **6 tiles/s** max (167 ms per tile), instant response |
| Monster phase | every `20−L` polls | every `max(0.2, (20 − depth) / 6)` s → 3.2 s at L1, 1.7 s at L10, 0.5 s at L17, 0.2 s at L19+ |
| Idle heal tick | 1 poll | 100 ms |
| Combat round | 1 poll | **250 ms** per exchange (auto-repeats while you hold the direction into the monster) |
| Sword timer | 60 Hz jiffy clock, 2000 s | wall-clock game seconds, 2000 s; **pauses while the game is paused** |

### 7.2 Initiating combat
- **Bump to attack**: move into a monster. The monster's name is printed (e.g. "A WEAK DIRE WOLF",
  "AN EXPER WAR LORD"). Keep the joystick pushed to fight; **centre the stick at any moment to
  disengage** ("if you attack, you always have the option to leave the battle") [VIC 264, 279].
- **Monster-initiated**: a monster stepping onto you starts a fight **you cannot walk out of** —
  "YOU ARE ATTACKED BY <name>": only the panic button (Teleport) ends it early; and if you carry the
  sword it is stolen instead of a fight starting. Being ambushed is therefore the main risk, and
  is how thieves and the Sword-stealing rule work.
- **Pass (P / fire on an empty tile)** lets you step over an occupied tile without fighting — used
  to slip past monsters in corridors.

### 7.3 Resolution [VIC 217–228, 265–279]
Let `x = monsterStrength / battleSkill` (the "damage ratio").
| Step | Rule |
|---|---|
| Player hit | `monsterHP −= int((1/x) × 4 × level × rnd + 1 + enchantments)` |
| Monster hit | `playerHP −= int(x × 4 × level × rnd + 1)` — **skipped entirely if Shield is up** |
| Order | Player-initiated: you strike first each round. Monster-initiated: monster strikes first |
| Feedback | Only *your* HP is shown ("HITS: n" + a random combat word: CRUNCH / SLASH ...); monster HP is hidden |
| Kill | `monsterHP < 0` → "YOU HAVE SLAIN <name>" (or "YOU VANQUISHED"), XP `(str + initialHP) × level`, skill `+int(5·rnd+1)`, kills+1; Shield and Invisibility end; recover stolen gold if it was the thief |
| Death | `playerHP < −5` inside a fight → slain. (Between fights HP < 0 auto-drinks a potion.) |
| Fleeing | Player-initiated only: release the stick; Shield is cancelled on fleeing |

No hit rolls, no misses, no criticals: every round both sides deal damage. **[designed]** the remake
shows floating damage numbers for both sides and adds a visual "crit" flag when a roll is in the top
10 % (cosmetic only in Classic).

### 7.4 What made it great (design pillars to preserve)
1. **Tension from darkness and sound.** You hear before you see: the C64's monster-phase drone,
   the attack sting, footsteps, the "found sword" fanfare. The dungeon is black; the reveal is
   the game. The remake's "heartbeat" (see §9) generalises the drone into an adaptive proximity cue.
2. **Hit-and-run.** "You heal; the monsters don't." Attacking first is always safe; being caught is
   always dangerous. Every corridor corner is a decision.
3. **The escape.** Descending is a power fantasy (skill inflates); ascending with the sword and a
   ticking 33-minute clock, through freshly generated levels full of monsters that only need to
   *touch* you, is a horror run. Save Invisibility and four Shields for the way up [manual].
4. **Gold as XP** creates a push-your-luck economy: carry it (theft risk) or bank it at the temple
   (must find it first; the sword level has none).
5. **Readable, tiny rule set**: six spells, five items, one stat. "By far the most approachable
   roguelike" (TouchArcade). CGW ranked it #147 of the 150 best games (1996).

---

## 8. Presentation of the original (drives the reference replica)

### 8.1 Screen layout (C64)
```
row 0   HITS: 16     EXP PTS: 346     GOLD: 0        <- white text, custom 8x8 font, black bg
rows 1-24  40x24 map: black floor, grey brick walls, yellow-dither unexplored rock
```
- The **status line** is overwritten by messages: monster names ("A WEAK DIRE WOLF"), "YOU ARE
  ATTACKED BY", "STAIRS GOING DOWN", "TREASURE: 27 GP'S", "SHIELD SPELL CAST!", "LOST YOUR MAP!",
  "THE SWORD OF FARGOAL!!", "TIMER: 1873" (C64 shows the sword timer on the between-level screen;
  VIC shows `H: E: G:`). Messages persist ~1 s then the status is redrawn.
- **Between-level screens** (black background, white custom font, centred): the characteristics
  block (`EXPERIENCE PTS / EXPERIENCE LV / MAXIMUM HITS / BATTLE SKILL / DUNGEON LEVEL / MONSTERS
  SLAIN`, plus `TIMER: n` once the sword is held) then "WAIT...", then the inventory block
  (`HEALING POTIONS / MAGIC SACKS / BEACONS / SPELLS: INVISIBILITY REGENERATION TELEPORT SHIELD
  DRIFT LIGHT / ENCHANTED WEAPON + n`) then "WAIT..." while the level generates.
- **Title**: "EPYX PRESENTS:" / "THE SWORD OF FARGOAL!!" / a full-width yellow dither bar /
  "BY: JEFF MCCORD  [knight sprite]  C MCMLXXXIII", white on black, then the sword fanfare.
- Border colour black; screen background black.

### 8.2 Tiles / glyphs (C64 custom character set; VIC codes in brackets)
| Thing | Look on C64 | VIC glyph code |
|---|---|---|
| Unexplored rock | fine **yellow/black checkerboard** dither filling the whole screen | 0 (dark) |
| Wall (revealed) | **dark-grey cobblestone/brick** pattern on black (drawn only where explored floor touches rock) | 36 |
| Explored floor | solid **black** | 32 |
| Player | white knight with red boots/plume, sword raised (hardware multicolour sprite on C64) | 26 |
| Creature monsters | white/light blocky beasts (several shapes) | 27–31 |
| Human monsters | white figures **always holding a weapon** | 40–43 (40 = invisible Assassin) |
| Gold | small white sack | 47 |
| Temple | white pillar/altar with a cross (refcard icon: cross in a box) | 38 |
| Sword | glowing sword glyph (only on the sword level) | 37 |
| Stairs up | white "III" columns with an open doorway (refcard icon) | 34 |
| Stairs down | white columns, doorway facing down | 35 |
| Hidden treasure/trap & buried gold | small **checkerboard square** | 60 (buried), 0-coded trap squares |
| Pit / climbable pit above | ring / dotted ring | 61 / 62 |
| Hole in the ceiling | debris glyph | 59 |
| Beacon (C64) | small green cross/marker | — |
| Explosion animation | cycles 4 glyphs (43, 38, 61, 59) while the cell flashes red/yellow | — |

### 8.3 Palette
C64 colour indices used (values are the VICE "default" palette as seen in the reference
screenshots; Pepto/colodore values in brackets for a calibrated look):
| Use | C64 colour | Hex (VICE) | Hex (colodore) |
|---|---|---|---|
| Background, border, floor | 0 black | `#000000` | `#000000` |
| HUD text, sprites, most glyphs | 1 white | `#ffffff` | `#ffffff` |
| Unexplored rock dither, title bar | 7 yellow | `#d0dc71` | `#edf171` |
| Walls | 11 dark grey | `#555555` | `#4a4a4a` |
| Wall highlights / some glyphs | 12 grey | `#808080` | `#7b7b7b` |
| Player sprite accents | 10 light red | `#bb776d` | `#c46c71` |
| Beacon / temple accent | 5 green | `#68a941` | `#56ac4d` |
| Explosion flash | 2 red / 7 yellow alternating | `#894036` / `#d0dc71` | `#813338` / `#edf171` |

VIC-20: 22-column, colour RAM per cell — revealed cells white (1), spiral-darkened cells yellow (7),
player cyan (3); it has no sprites and no music.

### 8.4 Sound (C64 SID; VIC used three square-wave oscillators + noise)
| Event | Cue |
|---|---|
| Footstep | short noise click on every move (VIC: noise 220 at vol 5) |
| Key press / spell cast | descending blip (VIC: osc3 245, volume fade 9→0) |
| Monster phase (C64 only) | low **droning** buzz while monsters take their step — "the one sound effect I didn't like" (CRPG Addict) but the core tension cue |
| Attacked by monster | two oscillators sweeping in opposite directions (230→200 and 175→205) then a 15-step fade — an alarm sting |
| Each combat round | short hit noise per family (creature vs human) with the printed word |
| Monster slain | "little two-note victory tune" (VIC: notes 231/237) |
| Treasure / gold | rising jingle; sacrifice at temple has its own chime |
| Item found | two-tone chime (219/237) |
| Healing potion | "chugging" gulp |
| Stairs | sweep down (freq 200) when descending, sweep up (191) when ascending; up-stairs discovery is a "crescendo" |
| Trap / fall / ceiling | crash noise; explosion: noise 128 with volume decaying `14/j` over 20 frames |
| Teleport | warble |
| Found the Sword | fanfare (also the title tune) |
| Time out / death | descending dirge |
There is no background music in the C64 original (HVSC lists only its SFX driver). The 2009 remake
added a Daniel Pemberton orchestral/synth score.

### 8.5 Version notes
| | VIC-20 (1982) | C64 (1983) | iOS (Dec 2009) / Mac / Steam (2022, Pixel Games UK) | Fargoal 2 |
|---|---|---|---|---|
| Author | Jeff McCord (BASIC, from his PET game *Gammaquest II*) | McCord + ML by Scott Carter (Corsaire) & Steve Lepisto | Paul Pridham (lead), McCord; "Legends" edition | Kickstarter 2012, betas to ~2020, **unreleased/TBA** |
| Map | 22×22 | 40×24 | Scrolling, animated tiles, retro top-down mode | 4 classes, interactive dungeons |
| Extras | — | Beacons, wandering monsters, sprites, SID | Music, difficulty modes, extended monster behaviours, Lizard Man etc. | Action cards, side quests |
Also: an authorised 2003 PC remake (Pridham & Pschernig, Allegro) claims code-accurate generation
and a ZX Spectrum homebrew port with its own numbers (not Classic).

---

## 9. Modern remake plan

### 9.1 "Classic rules" fidelity checklist (mode: *Classic*, default for daily seed & hall of fame)
- [ ] Ten 2–5 rooms + random-walk tunnels (5–9 segments), 1-tile corridors, whole level on one map
      (**[designed] map 48×32**, still generated by the same algorithm scaled; *Classic-Strict*
      toggle uses exactly 40×24)
- [ ] Guarantee connectivity **[designed fix]**: after digging, flood-fill from the temple; connect
      any unreachable room with one extra tunnel (log the fix in debug)
- [ ] Objects per level: 1 temple (none on sword level), 2–3 down stairs, up stairs rule, 6–10 gold
      bags (10L…10L+19), 3…L+2 treasure/trap squares (44 % trap), 2–4 creatures + 1–3 humans
- [ ] Sword level 15–19, sword replaces temple, XP ×2 on pickup, 2000 s timer, stolen by any
      monster-initiated attack, returns to its level, victory on level-1 up-stairs
- [ ] Monster generation formulas incl. type index, WEAK/POWER & INFERIOR/EXPER prefixes,
      Mage/Demon from depth 14, Rogue always steals, thief steal rule, Assassin invisibility,
      Dimension Spider blink, creatures die in pits, humans collect gold, 9-tile aggro range
- [ ] Monster phase timing `20 − depth` (mapped per §7.1), temple/invisible wander rule
- [ ] Combat maths verbatim (§7.3), flee-by-release, forced fight when ambushed, Pass command,
      Shield/regeneration/light/invisibility rules and durations, panic button semantics
- [ ] Healing: rate 50, HP-fraction rule, potion 20·rnd+3L, auto-potion, death < −5 in combat
- [ ] XP table 200×2^n, level-up +5–19 HP / +1–10 skill, kill skill +1–5, enchant +5–14 & +1 dmg
- [ ] Gold cap 100 + 100/sack, bury (10 caches), overflow auto-bury, sacrifice 1:1
- [ ] Traps (pit 2–5 levels, ceiling, explosion, teleport) with exact damages and 1/4 map loss,
      pits usable as stairs (50 % fall), climbable pit above
- [ ] Item odds 14-slot table (+ beacons 3 %), map to L+3…L+10
- [ ] C64 extras: beacons (+), wandering monsters
- [ ] Message texts reproduced verbatim (uppercase in the C64 replica, sentence case in the modern log)
- [ ] All randomness via `core/rng.js` forks: `level`, `monsters`, `loot`, `combat`, `ai`

### 9.2 Modern quality-of-life and innovations
| Feature | Spec |
|---|---|
| Minimap | Explored tiles, stairs, temple, beacon, buried gold; toggle M; corner overlay (`ui/minimap.js`) |
| Message log | Scrollable, colour-coded (combat/loot/danger/magic/quest), last 3 lines fade in the HUD (`ui/log.js`) |
| Tooltips | Hover any visible tile/monster/item: name, prefix, *estimated* danger (ratio band), what a trap square is ("hidden treasure or trap — 44 % trap") (`ui/tooltip.js`) |
| Click-to-move & auto-explore | Left-click path (A*), stops when a monster becomes visible or something is picked up; `X` auto-explores nearest unexplored frontier with the same interrupt rules; never auto-steps onto trap squares, pits or monsters |
| Auto-pause | Game pauses (and the sword timer with it) when a new monster enters view, when the tab loses focus, and when a menu is open; a one-second "!" banner explains why |
| Hotkeys | WASD/arrows/numpad/vi-keys move; Space = panic/action; H I R T S L O B P C as original; Tab inventory; M minimap; X auto-explore; Esc pause; 1–6 spell hotbar; `?` help |
| Save / continue | Autosave on level change and on quit; single slot per difficulty; permadeath preserved (save is deleted on death) except in Story mode |
| Difficulty modes | **Classic** (rolled stats, exact rules), **Standard** (12 HP/8 skill start, connectivity fix, monster-view auto-pause), **Story** (no permadeath, 3000 s timer, sword cannot be stolen below 50 % HP), **Nightmare** (wandering monsters ×2, Mage/Demon from depth 10, timer 1500 s) |
| Daily seed | Seed = UTC date hash; Classic rules; one attempt recorded per day in the hall of fame |
| Hall of fame | Top 20 locally (`core/save.js`), filter by mode/daily; shows seed for replay |
| Accessibility | Colour-blind-safe palette option (Okabe–Ito accents for monster families/loot), screen-shake toggle, flash reduction, font scaling 100–200 %, high-contrast HUD, full keyboard play, remappable keys, hold-to-repeat with adjustable delay |
| Heartbeat | Adaptive low pulse whose tempo rises with the nearest hunting monster's proximity (generalising the C64 monster drone); optional visual pulse on the vignette for deaf players |
| Death recap | Cause, killer, depth, timeline of the last 30 s, and a "share seed" button |

### 9.3 Visual direction — "HD-2D diorama" in Three.js
- **Camera**: tilted orthographic (≈ 35° pitch, 45° yaw, slight per-level yaw variation),
  follows the player with critically damped smoothing; zoom 0.7–1.4; cinematic dolly on stairs
  (camera drops through the floor into the new level). Screen shake on hits/explosions (toggle).
- **Dungeon as a physical diorama**: 1-unit tiles; walls are 1.2-unit stone blocks with bevelled
  procedural masonry (canvas normal maps), floors flagstone with moss and puddles in low rooms,
  corridors narrower and darker with dripping water particles; rooms get "type" dressing
  (barracks, crypt, cistern, library) purely cosmetic; the sword level is a maze of obsidian
  with violet fog.
- **Fog of war as darkness**: unexplored = unlit bedrock (`render/lighting.js` `bedrock()`), not a
  black void; explored-but-not-visible = a "memory" that keeps ~3/4 of its saturation at ~60 %
  brightness, so a walked room still shows its own colour field; visible = fully lit. Reveal
  animates tiles rising out of the void over 200 ms. Magic Map: a wave of light sweeps the level.
- **Lighting**: player torch (warm point light, flicker noise 8 Hz + 0.5 Hz drift, radius scales
  with Light spell), temple candles (cool white with bloom), gold sparkle, sword glow (cyan-violet
  rim light that pulses with the timer), monster eyes as emissive dots in darkness before their
  bodies are revealed. Bloom, vignette, cheap SSAO-ish contact shadow, colour grading per depth
  band (warm ochre 1–5, cold blue-grey 6–12, cold green 13–18, red-violet 19+).
- **Characters**: stylised low-poly (200–600 tris) procedural meshes with strong silhouettes:
  triangular wolf, barrel ogre, hunched troll, winged gargoyle, long-legged spider, serpentine
  drakes; humans share a rig with weapon props (bow, axe, shield, staff, twin daggers, war shield).
  Animation clips: idle (breathing), walk (4-frame bob + lean), attack (wind-up 100 ms, strike
  80 ms, recover 120 ms), hit flinch, death (crumble/dissolve), spawn (rise from floor). Player:
  knight with red plume and a raised sword echoing the C64 sprite.
- **Particles & effects** (`render/effects.js`): hit sparks (steel) and blood puffs (creatures),
  spell bursts per spell colour (Teleport cyan spiral, Shield gold shell, Regeneration green
  motes, Invisibility dissolve to outline, Light bright ring, Drift feathers), explosion fireball
  + debris + red/yellow flash homage, level-up golden pillar, gold sparkle, sacrifice ascending
  motes, sword-stolen shadow snatch, timer-critical red pulse in the last 300 s.
- **UI**: parchment-and-brass HUD with the original's numbers front and centre (HITS / EXP / GOLD),
  sword timer as a burning fuse, spell hotbar with counts, status effects; the C64 replica mode
  swaps the whole scene for a pixel-perfect 40×25 character screen using the palette in §8.3.
- **Performance budget**: instanced tile meshes, ≤ 150 draw calls, ≤ 2 dynamic shadow lights,
  60 fps at 1600×900 on integrated GPUs; renders in SwiftShader for screenshots.

### 9.4 Mapping to the architecture contract
- `TILE.WALL/FLOOR/CORRIDOR/STAIRS_DOWN/STAIRS_UP/PIT/TEMPLE/TRAP_TELEPORT/TRAP_PIT` cover the
  original tile set; hidden treasure/trap squares are `ItemInstance{type:'chest', hidden:true}`;
  ceiling-hole and climbable-pit-above are `RUBBLE` and `PIT` with flags; the beacon is an
  `ItemInstance{type:'beacon'}`; `WATER`/`DOOR` are cosmetic-only in Classic.
- Events: `sword:found`, `sword:timer`, `temple:sacrifice`, `trap:triggered`, `entity:attacked`,
  `game:over` carry the numbers above; `log` texts use the original wording.
- Balance tables live in `core/constants.js` (`BALANCE.classic` etc.) and the monster table in
  `game/monsters.js` with `family`, `typeIndex`, `glyph`, `special`, `depthMin/Max`.

### 9.5 Open questions to verify in an emulator (do not block implementation)
1. Exact C64 map height (24 vs 23 rows) and whether the C64 generator uses more than 10 rooms.
2. Whether the C64 sword level is 15–19 (VIC) or 15–20.
3. Beacon drop rate and whether beacons persist across level regeneration (assumed no).
4. Wandering-monster timing and count on the C64.
5. Existence of "healing/light charms" on the C64 (C64-Wiki claim; absent from VIC code).

---

## Appendix A — Original message strings (VIC/C64, uppercase on screen)
`YOUR QUEST BEGINS!!` · `YOUR QUEST CONTINUES!` · `WAIT...` · `STAIRS GOING DOWN` · `STAIRS GOING UP` ·
`TREASURE: n GP'S` · `CAN'T CARRY MORE GOLD` · `HIDING THE GOLD` · `HIDING n GOLD P'S` ·
`HIDDEN TREASURE!!` · `GOLD TOO HEAVY` · `TEMPLE!` · `SACRIFICE OF GOLD!` · `LEVEL RAISED TO n` ·
`HEALING POTION TAKEN!` · `<SPELL> SPELL CAST!` · `LIGHT ON` / `LIGHT OFF` · `TREASURE MAP!!` ·
`MAP TO nTH LEVEL!!` · `REGENERATION SPELL!!` · `HEALING POTION!!` · `MAGIC SACK!!` · `SHIELD SPELL!!` ·
`LIGHT SPELL!!` · `ENCHANTED WEAPON!!` · `TELEPORT SPELL!!` · `DRIFT SPELL!!` · `INVISIBILITY SPELL!!` ·
`EXPLOSION!!` · `SHIELDED FROM BLAST!` · `PIT!!...YOU FELL!` · `CEILING TRAP!` · `TELEPORT...` ·
`LIKE A FEATHER...` · `TELEPORT TO SAFETY!` · `CLIMBING THE PIT...` · `YOU FELL!` · `DOWN n LEVELS` /
`UP n LEVELS` · `CLIMBABLE PIT ABOVE!` · `HOLE IN THE CEILING!!` · `LOST YOUR MAP!` ·
`YOU ARE ATTACKED BY` / `<name>` · `HITS: n <WORD>` · `YOU HAVE SLAIN <name>` · `YOU VANQUISHED <name>` ·
`FOUND YOUR n GOLD!!` · `YOUR GOLD IS STOLEN!!` · `THE SWORD IS STOLEN!!` · `THE MAGE TAKES YOUR MAGIC
SPELLS!!` · `THE DEMON DRAINS YOUR EXPERIENCE LEVEL!!` · `THE SWORD OF FARGOAL!!` · `THOU ART SLAIN!` ·
`SLAIN BY <name>` · `YOU DIED!!` · `OUT OF TIME!` · `YOUR QUEST IS COMPLETE` · `YOUR SCORES:` ·
`QUEST TOOK n MIN` · `PLAY AGAIN?` / `AGAIN?`

## Appendix B — Key map (C64 reference card)
Joystick: 8-way move; fire = PANIC (Teleport/Drift), climb stairs/pits, pass over next square.
Keys: **H** potion · **I** invisibility · **R** regeneration · **T** teleport · **S** shield ·
**L** light · **O** light on/off · **+** place beacon · **C** climb · **B** bury gold · **P** pass · **Q** quit.

## Appendix C — Sources
- Epyx manual (1982/83): https://www.mocagh.org/epyx/fargoal-manual.pdf ; reference card:
  https://www.mocagh.org/epyx/fargoal-refcard.pdf ; text transcription:
  http://pirates.emucamp.com/a/t/swordfargoal/c64/docs.html
- VIC-20 BASIC reverse-engineering (Paul Robson): https://github.com/paulscottrobson/eris/blob/master/documents/fargoal/bas.lst ;
  variable analysis: https://github.com/c64cryptoboy/CommodoreBasicVarAnalysis ; MC-10 port:
  https://github.com/jggames/trs80mc10 (quicktype/Dungeon/Fargoal)
- C64-Wiki: https://www.c64-wiki.com/wiki/Sword_of_Fargoal (screenshots, cheats, variables)
- Wikipedia: https://en.wikipedia.org/wiki/Sword_of_Fargoal ; RogueBasin: https://www.roguebasin.com/index.php/Sword_of_Fargoal
- CRPG Addict (2014 play-through and rating): http://crpgaddict.blogspot.com/2014/01/game-136-sword-of-fargoal-1982.html
- Maximum Utmost review: https://maxutmost.com/review-sword-of-fargoal/ ; retro365 history:
  https://retro365.blog/2025/12/03/sword-of-fargoal-a-commodore-legend/ ; Evercade spotlight:
  https://evercade.co.uk/evercade-game-spotlight-sword-of-fargoal-thec64-collection-2/
- Steam manual (2022): https://cdn.akamai.steamstatic.com/steam/apps/2231080/manuals/Sword_of_Fargoal_Steam_Version_manual.pdf
- 2003 PC remake: https://archive.org/details/fargoal ; official site: https://www.fargoal.com/ ;
  TouchArcade (2009 iOS): https://toucharcade.com/2009/12/01/sword-of-fargoal-a-classic-dungeon-adventure-reimagined
