Music streams from YouTube by default (links in src/config.js → AUDIO).
The same 4-stage soundtrack plays in the Cinematic and the Interactive mode:

  phase1  Spring Snow                  walking, catch, picnic, dragon & scarf — loops
  phase2  Bruno Mars – Marry You       nightfall, the fireworks and the group dance
  phase3  Nezuko's Theme               the YES / NO question and any NO (beat-up) — loops
  phase4  Tanjiro's Theme              on YES, starting at 2:21 — the climax and THE END

Local fallback (used only if a YouTube embed can't play — e.g. offline or
embedding disabled). Supply your own copies; use only audio you have the
rights to:

  spring-snow.mp3
  marry-you.mp3
  nezuko-theme.mp3
  tanjiro-theme.mp3   (played from 2:21, like the stream)

If no source works for a stage, that stage runs silently and logs a warning.
