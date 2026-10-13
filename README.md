# Recall the Teleprompter

A fullscreen teleprompter for presenting from your own laptop. Paste a script,
press Start, and speak: the text follows your voice. It runs entirely in the
browser with no install, no build and no account, and your script stays on
your machine.

> [!NOTE]
> Safari (or Chrome) recommended. Others not supported.

## Run it

Open **https://gurre.github.io/teleprompter/** in Safari or Chrome. Nothing to
install; your script stays in your browser.

Or run it from this folder. Serve it from localhost so the browser remembers
the microphone permission:

```sh
python3 -m http.server 8000   # in this directory
open http://localhost:8000
```

Opening `index.html` directly also works, but the browser may ask for the
microphone every time.

After updating the files, reload without the cache (Safari ⌥⌘R, Chrome ⇧⌘R):
this server lets the browser keep old copies.

## Before you speak

The editor asks for everything it needs up front, so no browser prompt ends up
hidden behind the fullscreen prompter. The **Permissions** panel on the right
lists each one and its status: microphone, speech recognition, keeping the
screen awake, and fullscreen. If something is blocked, allow it in the
browser's site settings and press **Ask again**.

Each time the prompter opens, the word you start (or resume) from shows
whether it is ready:

- **Flashing green underline:** ready. Start speaking and the text follows you.
- **Steady red underline:** something is not ready yet. The status line says
  what (microphone still starting or blocked, no speech service). If your
  voice can't be followed at all, press Space and the text scrolls at the
  optimal pace instead.

If a permission is missing, a red banner says which for 10 seconds; the
status line keeps the detail.

## While you speak

- **The text follows you.** It glides at your speaking pace, and the word you
  are saying sits on the highlighted reading line. After looking at the
  audience, your eyes land in the same place every time.
- **The underlined word is where you are.** It stays tied to what was
  recognized: it marks the next word, and looks at most one word further
  while you talk. When you pause it settles on the next word to say. It moves one word at a
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
- **At the end the timer stops** and a card in the middle of the screen sums
  up the talk: "Ended 1m 1s over", "Ended 20s early" or "Ended on time"
  against your target, or "Ended after 4m 12s" without one. It ends at the
  last word, or when you go quiet within the last few words (the very last
  word is often not recognized as you stop).

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
  at the start of the sentence you were in, timer included. An older session
  (yesterday's rehearsal) is only offered as a second button, and a finished
  talk is not resumed; Start begins at the top.
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
| R | recall practice: reveal the next hidden word; voice prompter: say the next words; talk in ear: read again from where you are |
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

## Voice prompter

Tick **Voice prompter** in the editor to get help without looking down. The
text shows as usual; when you stall, a voice in your earphones says what comes
next, like a theatre prompter. It is meant for AirPods (or any earphones)
with the Mac on the lectern.

- **It stays silent while you talk.** After a moment of silence (the
  **Silence before a prompt** slider, 0.2–3 s, 1 s by default) it says the
  next words, up to three, ending on the first one that carries meaning
  ("the future", not "the"). Below about 0.3 s, a pause between two words can
  already count as a stall.
- **Still quiet?** After the same wait again it says the phrase, up to four
  words. Then it waits for you; it never reads on by itself.
- **Pauses between sentences are yours.** Before a new sentence it waits
  twice as long, before a new paragraph three times.
- **When it does not know where you are, it says nothing.** After about four
  seconds of talking that matches nothing in the script (an ad-lib), it
  waits until you are back on the script. **R** says the next words anyway.
- **Before you start, R says your first words**, which also checks where the
  sound plays once you are connected to the venue.
- **It says what you might not see.** "Ready" when it is listening, "Prompts
  off" when speech recognition has been down for five seconds ("Prompts on"
  when it is back), and why prompts stopped if it cannot follow your voice
  or hear the room.
- It works alongside **recall practice**: R then says the next words and
  reveals the next hidden word.

**Test the prompt voice** in the editor says a sample, so you can hear where
prompts play and how loud. If the Samantha voice is missing, the editor says
so next to the option. Once it is on, the Permissions panel shows the
**Prompt voice**, and why a prompt did not play if one did not.

Trade-offs:

- Prompts are always said in the **Samantha** voice. Without it (System
  Settings → Accessibility → Spoken Content) the option cannot be ticked. She
  speaks English, so a script in another language is pronounced as English.
- **Use earphones.** Through speakers the room hears the prompts.
- **Keep the prompter in front.** In a hidden tab or a minimized window it
  stops prompting, and says so when the browser tells. Covered by another
  window it may stop without saying.
- Where the browser tells which device sound plays on, prompts pause if the
  sound moves (HDMI plugged in, earphones out) and resume when it moves back.
  R still plays, wherever the sound is: it is how you check. The status line
  says when the device is not watched.
- A prompt plays to its end even if you start speaking.
- The waits are first guesses. Try them in a rehearsal.

## Talk in ear

Tick **Talk in ear** in the editor and a voice in your earphones reads the
script a few words ahead of you, the way a news presenter works with an ear
prompter: you hear a phrase, then say it. You keep your eyes on the audience
the whole time.

- **You set the tempo.** It reads a little faster than you speak (1.3× your
  pace) and follows you as you speed up or slow down, so it stays ahead and
  pauses between phrases rather than falling behind. When you catch up with
  it, it speeds up further (up to 1.6×).
- **Talking from memory, you can run ahead of it.** Once you pass the word
  it is on, it drops the rest of that phrase and goes on from where you are.
- **When you pause, it waits.** It is never more than the **Reads ahead**
  number of words (2–8, 4 by default) past where you are. Stop to take a
  question and it goes quiet, then carries on as you do.
- **It reads in phrases.** It stops at commas and full stops, and otherwise
  waits until it can say at least three words, so you never hear it one word
  at a time.
- **It starts as soon as the prompter is listening**: it reads your opening
  words and waits for you. **R** reads again from where you are: the opening you missed while walking on,
  or a phrase you lost.
- **If it hears itself, it stops.** If the microphone picks up the voice, it
  would follow itself and read the whole talk alone. When words are
  recognized sooner after the voice than you could repeat them, it holds
  still for a moment. If you carry on talking, it goes on. If everything
  stops with it, it says "I can hear myself. Talk in ear is off."
- **It reads in the Samantha voice**, the best quality installed first.
  Without her (System Settings → Accessibility → Spoken Content) the option
  cannot be ticked. The Permissions panel shows the voice. She speaks
  English, so a script in another language is pronounced as English.

It and the voice prompter are never both on: ticking one unticks the other.

Trade-offs:

- **Use earphones, with the Mac's own microphone.** Through speakers the room
  hears the voice and it hears itself. With AirPods as the microphone, macOS
  drops them to call quality.
- **Short gaps between phrases** (a tenth to a third of a second) come from
  the browser starting each one; they sound like breaths.
- **A lead of 2 or 3 words is short for a fast speaker.** At 200 wpm that is
  under a second, less than the voice needs to start a phrase, so it may
  hold you up. From 4 words it keeps up.
- **AirPods fall asleep after some seconds of silence**, so the first word
  after a long pause may be clipped. Press **R** if you missed it.
- **Use it in a rehearsal first.** How far ahead suits you, and how the voice
  sounds in your earphones, can only be found by trying.

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
