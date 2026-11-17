# Section 7 (17 November 2026): a tighter part-number check

**The cases:** part numbers typed as BLADE78, FILTER69, FILTER859, FRONT PAD145, SOLITE859 (all on J-01018).

## What changed

- **One rule** (`src/lib/part-number-check.ts`) used by the Parts page, the check-before-send window, the LPO approval screen and the lists. A part number is flagged when it is:
  - the part's name, a word of it, or a kind-of-part word (PAD, DISC, BLADE, FILTER, FRONT, REAR, KIT…);
  - **such a word with digits added**, in either order: BLADE78, FRONT PAD145, FILTER-69, 78BLADE (new);
  - a placeholder like 1234AA / 123AA, or a stand-in (OFJ, OFJ1).
  - Real numbers stay clean (A1673306800, LR012345, 04465-0K290, 5Q0698151, 0W20 on an oil). **"No part number yet"** stays the honest answer.
- **Flagged lines stay flagged until a real number is entered:**
  - on the Parts page ("Part number is the name");
  - in the check-before-send window ("the part's name with a number added");
  - on the LPO approval screen, on the line itself (also "No part number yet: ask the supplier for it").
- **The owner:** the count in the evening daily summary ("n part numbers look made up"), and the **list every Monday** by car and who typed it.
- **"Part number check"** (Parts → Part number check, owner, parts desk and accounts): the list any time, each car linking to its Parts page.

## Read-only check on live: the part numbers that would be flagged today

```
Flagged today: 67 (on cars in the workshop: 34) of 461 parts with a part number
J-00317 (gone) | TRANSMISSION MOUNT | "123AA" | placeholder | PETER
J-00940 (gone) | TRANSMISSION OI - ZF | "123AA" | placeholder | PETER
J-00971 | GASKET, VALVE COVER | "GASKET458" | word_digits | PETER
J-00971 | FRONT BRAKE PAD | "PAD145" | word_digits | PETER
J-00971 | CLUTCH KIT | "KIT78" | word_digits | PETER
J-00971 | THRUST BEARING | "BEARING789" | word_digits | PETER
J-00971 | FRONT BRAKE PAD DISC | "PAD758" | word_digits | PETER
J-00971 | REAR BRAKE PAD | "PAD8562" | word_digits | PETER
J-00971 | SPARK PLUG | "PLUGS526" | word_digits | PETER
J-00971 | DRIVE BELT | "BELT78" | word_digits | PETER
J-00971 | INTAKE MANIFOLD GASKET | "GASKET78" | word_digits | PETER
J-00971 | IDLER PULLY BEARING | "PULLY90989" | word_digits | PETER
J-00981 (gone) | GLASS MOULDING | "123AA" | placeholder | PETER
J-00981 (gone) | FRONT WINDHSHIELD | "123AA" | placeholder | PETER
J-00984 (gone) | ALTERNATOR | "123AA" | placeholder | PETER
J-00985 (gone) | FIT SWREW | "123AA" | placeholder | PETER
J-00985 (gone) | FRONT BRAKE PAD | "123AA" | placeholder | PETER
J-00985 (gone) | FRONT BRAKE PAD SENSOR | "1234AA" | placeholder | PETER
J-00985 (gone) | FRONT BRAKE DISC | "123AA" | placeholder | PETER
J-00985 (gone) | REAR BRAKE PAD | "123AA" | placeholder | PETER
J-00985 (gone) | RETAINING SPRING SET | "1234AA" | placeholder | PETER
J-00985 (gone) | REAR BRAKE PAD SENSOR | "1234AA" | placeholder | PETER
J-00985 (gone) | REAR BRAKE DISC | "1234AA" | placeholder | PETER
J-00989 (gone) | BRIDGESTONE 275/50 R22 | "123AA" | placeholder | PETER
J-00989 (gone) | WIPER BLADE | "1234AA" | placeholder | PETER
J-00989 (gone) | MAIN BATTERY | "1234AA" | placeholder | PETER
J-00990 (gone) | AIR FILTER | "FILTER" | word | PETER
J-00990 (gone) | DRIVE BELT | "BELT" | word | PETER
J-00990 (gone) | DRIVE BELT | "DRIVE BELT" | name | PETER
J-00992 (gone) | FRONT BUMPER - JEEP GENUINE | "FRONT BUMPER" | word | PETER
J-00992 (gone) | OIL FILTER HOUSING GASKET | "OIL FILTER" | word | PETER
J-00992 (gone) | FRONT BUMPER INNER BRACKET | "BRACKET" | word | PETER
J-00992 (gone) | LH INDICATOR LIGHT | "LIGHT" | word | PETER
J-01000 (gone) | OIL FILTER | "FILTER123" | word_digits | PETER
J-01000 (gone) | DRAIN PLUG AND WASHER | "WASHER 123" | word_digits | PETER
J-01002 | SPARK PLUG | "PLUG 145" | word_digits | PETER
J-01002 | ENGINE MOUNT | "MOUNT" | word | PETER
J-01002 | ENGINE OIL FILTER | "OIL FILTER" | word | PETER
J-01002 | AIR FILTER | "AIR FILTER" | name | PETER
J-01002 | DRIVE BELT | "BELT" | word | PETER
J-01002 | BELT TENSIONER | "TENSIONER" | word | PETER
J-01002 | IDLER PULLY - 2 | "PULLY - 2" | word_digits | PETER
J-01002 | GASKET, VALVE COVER | "GASKET" | word | PETER
J-01002 | REAR WIPER BLADE | "REAR BLADE" | word | PETER
J-01002 | BRAKE PADS | "PAD" | word | PETER
J-01002 | CABIN FILTER | "FILTER" | word | PETER
J-01002 | GEAR MOUNTING | "GEAR MOUNT" | word | PETER
J-01002 | KUMHO 205/60 R16 (2026) | "TYRE" | word | PETER
J-01002 | FRONT WIPER BLADE | "BLADE" | word | PETER
J-01007 (gone) | REAR BRAKE PAD | "PAD" | word | PETER
J-01007 (gone) | REAR BRAKE DISC | "DISC" | word | PETER
J-01007 (gone) | WIPER BLADE | "BLADE" | word | PETER
J-01007 (gone) | DIFFERENTIAL OIL | "FLUID" | word | PETER
J-01007 (gone) | REAR WIPER BLADE | "REAR WIPER BLADE" | name | PETER
J-01007 (gone) | ENGINE MOUNTING - 1 | "ENGINE MOUNT - 1" | word_digits | PETER
J-01007 (gone) | ENGINE MOUNTING - 2 | "ENGINE MOUNT - 2" | word_digits | PETER
J-01007 (gone) | GEAR MOUNTING | "GEAR MOUNTING" | name | PETER
J-01010 | ENGINE ASSEMBLY - USED | "USED-ENGINE859" | word_digits | PETER
J-01018 | BRAKE PADS | "FRONT PAD145" | word_digits | PETER
J-01018 | FRONT BRAKE DISC | "DISC5269" | word_digits | PETER
J-01018 | AIR FILTER | "FILTER858" | word_digits | PETER
J-01018 | BATTERY - SOLITE | "SOLITE859" | word_digits | PETER
J-01018 | AC FILTER | "FILTER859" | word_digits | PETER
J-01018 | SPARK PLUGS | "PLUGS859" | word_digits | PETER
J-01018 | FRONT WIPER BLADE  RH | "BLADE78" | word_digits | PETER
J-01018 | FRONT WIPER BLADE LH | "BLADE78" | word_digits | PETER
J-01018 | OIL FILTER | "FILTER69" | word_digits | PETER
```

Every one was typed by PETER (the parts desk). The 34 on cars still in the workshop are on the Part number check page now.

## Proof (TEST)

- `npm run test:s17-7` passes 6 of 6: the Parts page flag, the flag on the LPO approval screen (the owner's view), the check page by car and who typed it, a real number clearing it everywhere, and a technician refused.
- `tests/unit/part-number-check.test.mjs` passes 21 of 21 (the owner's cases flagged, real numbers clean, both old checks now using the one rule).
- Screenshots in `docs/proof/2026-11-17-part-numbers/` (1440 and 800 wide).

No database change.
