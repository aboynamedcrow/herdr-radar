# Attention token

The attention daemon owns the pane token `attention`, from source `attention-watch`.
It reports `blocked` with the agent label `attention` before it sets the token.

```sh
herdr pane report-metadata <pane> --source attention-watch --token 'attention=<class>: <first line>'
```

The daemon scrubs the value and limits it to 200 characters.
Herdr 0.9.5 limits stored token values to 80 characters. Clients receive the shorter value.
The daemon clears the token before it releases the `blocked` report.
If the clear fails, the daemon retries it before release. A restart clears tokens from its own source.

```sh
herdr pane report-metadata <pane> --source attention-watch --clear-token attention
```

Herdr returns the string at these JSON paths:

- `pane get`: `result.pane.tokens.attention`.
- `agent list`: `result.agents[].tokens.attention`.
- `api snapshot`: `result.snapshot.panes[].tokens.attention` and `result.snapshot.agents[].tokens.attention`.

Herdr supports `--ttl-ms`. The set and clear commands above do not require a TTL.

`lib/frame.js` uses this token for the blocked row's title text.
Both the current state and the displayed state must be `blocked`.
An absent or empty token restores the usual title. Other states ignore the token.
Radar does not read a pane's screen for this text.
