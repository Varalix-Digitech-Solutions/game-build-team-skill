# Game-feel & juice playbook (degrade target)

The self-contained fallback for the **Creative Director** and **Animation
Developer** when GodotPrompter's `tween-animation` / `animation-system` /
`particles-vfx` / `camera-system` / `emil-design-eng` aren't installed. Same
taxonomy those skills carry, distilled for a mobile isometric strategy/sim game
(Clash-of-Clans base-building + Plague-Inc-style simulation).

## What "juice" is (and isn't)

Juice = the layer of responsive, exaggerated feedback that makes an input feel
*satisfying* without changing what the game does. It is fidelity, not garnish: a
correct feature that ships static where it should react feels broken, not minimal.
It is NOT new mechanics, new content, or anything that alters the Logic Developer's
verified behavior — that boundary is the Animation Developer's scope discipline.

## The feedback budget — every meaningful action gets a reaction

For each player action and each significant simulation event, ask: does it have
**visual + audio + motion** feedback? Map them before building.

| Trigger | Typical juice (Godot primitive) |
|---------|--------------------------------|
| Tap / select a tile or building | scale-pop `Tween` (1.0→1.08→1.0, ~120ms), highlight ring, soft click SFX |
| Place / build on the iso grid | snap-settle squash&stretch, dust `GPUParticles2D`, grid-cell flash, thunk SFX |
| Invalid placement | red flash + short negative shake, error blip — never a silent no-op |
| Resource gain (coins/energy) | number pops + floats up & fades, counter tweens (don't snap), coin ping |
| Upgrade / level-up complete | burst particles, brief `camera-system` zoom-punch, fanfare sting |
| Simulation spread / infection tick | cell-to-cell propagation `Tween` with stagger, pulsing tint, ambient loop |
| Damage / loss | screen shake scaled to severity, hit-flash, freeze-frame (1–3 frame hitstop) |
| Screen / menu transition | slide/fade with eased timing, not an instant cut |

## Craft rules (Godot 4)

- **Easing is the whole game.** Linear feels robotic. Default to ease-out for
  things arriving (`Tween.set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)` for
  pop), ease-in for things leaving. Reserve elastic/bounce for celebratory beats.
- **Anticipation + follow-through.** A tiny pre-move dip and a slight overshoot
  read as alive. Squash on impact, stretch on launch.
- **Timing.** Micro-feedback 80–150ms; transitions 200–350ms; celebratory 400–700ms.
  Snappy beats slow on mobile.
- **Stagger** lists/grids (`Tween` with per-item delay) so groups feel orchestrated,
  not simultaneous.
- **Screen shake** via the camera, trauma-based (decays over time), magnitude scaled
  to event weight; cap it so it never nauseates on a phone.
- **Hitstop / freeze-frame** on big impacts (briefly pause/slow), then resume.
- **Don't animate layout you can't afford.** Prefer `modulate`, `scale`, `position`
  offsets, and shaders over re-flowing UI containers every frame.

## Performance + accessibility (part of fidelity on mobile)

- Pool particles/tweens; don't allocate per-frame. Watch draw calls with many
  iso tiles on screen.
- Respect a reduced-motion / "reduce effects" setting: gate non-essential shake,
  flashes, and continuous decorative motion behind it. Never strobe.
- Keep essential feedback (what happened, was it valid) even when effects are
  reduced — juice degrades, it doesn't disappear.

## Verify by observation, never by eyeballing the code

Juice is gated like everything else: the Tester captures a real frame and the
Creative Director judges *feel* against the brief. A tween that exists in code but
doesn't fire on the running game is a defect. Drive it (or capture the moment), don't
assume it.

## The Creative Director's "fun" rubric (the creative gate)

When re-reviewing a Tester-approved feature, score against the brief:
1. **Readable** — can the player instantly tell what happened and whether it worked?
2. **Responsive** — does every action have immediate feedback (no dead taps)?
3. **Satisfying** — does the core action have weight/pop proportional to its importance?
4. **On-theme** — does the feel match the game's identity (per the design contract)?
5. **Fair** — failures communicate clearly; nothing punishes silently.

Miss on 1, 2, or 5 → creative NG (must fix). Misses on 3/4 are graded against the
brief's ambition, not the reviewer's personal taste.
