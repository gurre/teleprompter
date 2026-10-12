# Recall the Teleprompter

A fullscreen teleprompter for presenting from your own laptop. Paste a script,
press Start, and speak: the text follows your voice. It runs entirely in the
browser with no install, no build and no account, and your script stays on
your machine.

## Run it

Serve it from localhost so the browser remembers the microphone permission:

```sh
python3 -m http.server 8000   # in this directory
open http://localhost:8000
```

Opening `index.html` directly also works, but the browser may ask for the
microphone every time.

## Before you speak

The first word shows whether the prompter is ready:

- **Flashing green underline:** ready. Start speaking and the text follows you.
- **Steady red underline:** something is not ready yet. The status line says
  what (microphone still starting or blocked, no speech service). If your
  voice can't be followed at all, press Space and the text scrolls at the
  optimal pace instead.

## While you speak

- **The text follows you.** It glides at your speaking pace, and the word you
  are saying sits on the highlighted reading line. After looking at the
  audience, your eyes land in the same place every time.
- **The underlined word is where you are.** It is never behind the last word
  recognized: it marks the next one, and looks a little ahead while you talk.
  When you pause it rests on the next word to say. It moves one word at a
  time and never skips a word, except for real jumps (going back to the top,
  a skipped sentence).
- **A faint gray line** glides under the word you would be on at the optimal
  pace: the pace that ends exactly on your target length, or 140 wpm without
  one. If it's behind you, you're ahead of schedule; if it's ahead, you're
  behind.
- **The top bar** shows the time of day, how long you have been speaking, and
  the time left. Each moves one way only: time left pauses rather than
  counting back up. With a target set, it also shows "on time", "0:20 early"
  or "0:40 over", changing in 5-second steps.

How the following behaves:

- **It only moves forward.** If it gets ahead of you, it holds still until you
  catch up. Repeating an earlier phrase never pulls it back, and words it has
  already used never count again.
- **When you pause, it pauses.** A level meter on the microphone tells when you
  are talking, so the text stops within a word of where you stopped.
- **Lookahead adapts to you.** Speech is recognized a fraction of a second after
  you say it. The prompter measures your pace (while you are talking, so pauses
  don't count) and that delay (each time you resume after a pause), and looks
  ahead by pace × delay. The status line shows all three.
- **Big jumps need more evidence.** Moving a few words ahead takes two matching
  words. Moving further takes four or five, and is confirmed by your next word,
  so an ad-lib doesn't send it ahead. A genuine skip is followed one word
  later.
- **To start over, press Home.** It goes back to the top and follows you from
  there. A skip of more than about 60 words is not followed.

## On stage

- **Nothing is lost.** The script, settings, your place and the speech timer are
  saved as you go. Within 30 minutes, Start says "Resume at N%" and picks up
  where you were, timer included. An older session (yesterday's rehearsal) is
  only offered as a second button; Start begins at the top.
- **Losing fullscreen keeps you going.** If Esc or a notification takes you
  out of fullscreen, the prompter keeps running. F brings fullscreen back. Esc
  when not fullscreen returns to the editor.
- **The screen stays awake** while the prompter is showing. If the browser
  refuses, a red banner says so.
- **Problems show as a red banner** until they are resolved.

| Key | Action |
|---|---|
| Space | pause / resume listening (without voice: start / pause the optimal-pace scroll) |
| + − | font size |
| R | recall practice: reveal the next hidden word |
| T T | restart the speech timer (press twice) |
| F | back to fullscreen |
| Home | back to the top |
| Esc | leave fullscreen; again for the editor |

Holding a key does not repeat it, except for font size.

## Recall practice

Tick **Recall practice** in the editor to rehearse from memory. Words are
hidden behind gray boxes the size of the word, picked afresh each time you
start. The slider sets how many: 10–95% of the words.

- The first word of a paragraph is always shown, so you know where you are.
- The first word of a sentence is only hidden from 80% up: a third of them
  at 80%, two thirds at 85%, all of their share from 90%.
- As you speak past a hidden word it appears: **green** if you were heard
  saying it, **red** if not. A red word turns green if a later, corrected
  recognition shows you did say it. Recognition errors can make a correctly
  said word red, so read red as "not heard", not as proof.
- Stuck? **R** reveals the next hidden word, uncoloured. A hint is not a recall.

## Target length

Optionally set a target length (for example `10:00`). It sets the optimal pace,
which the gray line, the "early/over" readout and the fallback scroll use. When
you are faster than the pace that ends on time, the text also looks ahead less,
so it holds back a little ("held to target" in the status line). It never
speeds up when you are behind.

## Trade-offs

- Chrome sends audio to Google's speech service and needs internet; Safari uses
  Apple's. Firefox has no speech recognition, so it scrolls at the optimal pace.
- The level meter needs microphone access a second time. Without it, the text
  still follows you, but it runs on about a word past a pause before it waits.
  The status line says so.
- The level meter's thresholds are tuned on synthetic audio. Check them in the
  room with your own microphone before the talk.

## Tests

```sh
node --test tests/*.test.js
```
