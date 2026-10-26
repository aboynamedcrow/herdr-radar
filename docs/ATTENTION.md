# Attention token

The attention daemon owns the pane token `attention`, from source `attention-watch`.
The token alone marks a pane that needs ingwon. The pane can stay `idle`.
The daemon does not report `blocked` or change the agent label.
Radar shows attention when the state is `blocked` or the token is not empty.

```sh
herdr pane report-metadata <pane> --source attention-watch --token 'attention=<class>: <first line>'
```

The daemon scrubs the value and writes at most 80 characters.
Herdr 0.9.5 also limits stored token values to 80 characters.
The daemon clears the token when the pane no longer needs ingwon.
If the clear fails, the daemon retries it. A restart clears tokens from its own source.

```sh
herdr pane report-metadata <pane> --source attention-watch --clear-token attention
```

Herdr returns the string at these JSON paths:

- `pane get`: `result.pane.tokens.attention`.
- `agent list`: `result.agents[].tokens.attention`.
- `api snapshot`: `result.snapshot.panes[].tokens.attention` and `result.snapshot.agents[].tokens.attention`.

Herdr supports `--ttl-ms`. The set and clear commands above do not require a TTL.

`lib/frame.js` shows token attention with the blocked colour and priority.
It uses the token as the row title after the configured title hook.
An absent or empty token restores the usual title.
Token attention does not create a blocked hold after the token clears.
The existing holds still apply to a native `blocked` state.
Token attention consumes an unseen done badge, as native blocked attention does.
Clearing the token does not restore that badge.
Radar does not read a pane's screen for this text.

Radar publishes `radar_attention_only=1` beside a blocked mark that has no native question hold.
A replacement Radar process reads this marker before it recovers native blocked holds.
Radar clears the marker when the blocked mark clears or a native question takes priority.
Its stop, uninstall, and orphan cleanup paths also clear the marker.
